/**
 * Pruebas unitarias de las reglas de cola e idempotencia (Semana 8).
 *
 * Riesgo cubierto: "duplicado de sincronización". La garantía se apoya en
 * tres reglas pequeñas que se prueban por separado:
 *
 *  - la cola no crea otra operación si guardar no cambió nada;
 *  - el servidor aplica una clave de idempotencia una sola vez;
 *  - el retardo de reintento crece, pero está acotado.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../../src/lib/storage/memory-storage";
import { DEFAULT_SYNC_CONFIG, computeBackoffMs, createSyncQueue } from "../../src/lib/sync/queue";
import { applyOperation, createServerStore, listServerRecords } from "../../src/lib/sync/server-store";
import { offlineTransport } from "../fixtures/transports";
import { SYNTHETIC_NOW, sequentialIds, validFields, wireOperation } from "../fixtures/inspections";

function newQueue() {
  const storage = createMemoryStorage();
  const transport = offlineTransport();
  const queue = createSyncQueue({
    storage,
    transport,
    now: () => SYNTHETIC_NOW,
    newId: sequentialIds(),
    random: () => 0.5
  });
  return { storage, transport, queue };
}

describe("cola: guardar no duplica operaciones", () => {
  it("guardar el mismo contenido dos veces no crea otra operación", async () => {
    const { queue } = newQueue();
    const first = await queue.saveInspection({ id: "insp-unit-0001", fields: validFields() });
    const again = await queue.saveInspection({ id: "insp-unit-0001", fields: validFields() });

    assert.equal(first.ok && first.created, true);
    assert.equal(again.ok && again.unchanged, true);
    assert.equal(again.ok && again.operation, null);
    assert.equal((await queue.getOperations()).length, 1);
    assert.equal((await queue.getRecords()).length, 1);
  });

  it("una edición antes del primer envío reescribe la misma operación y conserva su clave", async () => {
    const { queue } = newQueue();
    const first = await queue.saveInspection({ id: "insp-unit-0002", fields: validFields() });
    await queue.saveInspection({
      id: "insp-unit-0002",
      fields: validFields({ status: "attention", findings: 2 })
    });

    const operations = await queue.getOperations();
    assert.equal(operations.length, 1);
    assert.equal(first.ok && operations[0].idempotencyKey, first.ok ? first.operation?.idempotencyKey : "");
    assert.equal(operations[0].fields.findings, 2);
    assert.equal(operations[0].clientRevision, 2);
  });

  it("una captura inválida se rechaza y no escribe nada en el almacén", async () => {
    const { storage, queue } = newQueue();
    const result = await queue.saveInspection({ id: "insp-unit-0003", fields: validFields({ inspector: "" }) });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join(" "), /inspector:/);
    assert.equal(storage.batchCount(), 0);
    assert.deepEqual(storage.snapshot(), { records: {}, outbox: {}, meta: {} });
  });

  it("un id mal formado se rechaza aunque los campos sean válidos", async () => {
    const { queue } = newQueue();
    const result = await queue.saveInspection({ id: "ID MALO", fields: validFields() });
    assert.equal(result.ok, false);
  });
});

describe("cola: estar sin conexión no agota los reintentos", () => {
  it("muchos fallos de red seguidos dejan la operación pendiente, nunca fallida", async () => {
    const { queue, transport } = newQueue();
    await queue.saveInspection({ id: "insp-unit-0004", fields: validFields() });

    for (let attempt = 0; attempt < DEFAULT_SYNC_CONFIG.maxAttempts + 3; attempt += 1) {
      await queue.flush({ ignoreBackoff: true });
    }

    const stats = await queue.getStats();
    assert.equal(transport.sent.length, DEFAULT_SYNC_CONFIG.maxAttempts + 3);
    assert.equal(stats.pending, 1);
    assert.equal(stats.failed, 0);
    assert.equal((await queue.getOperations())[0].failures, 0);
  });

  it("en cambio, los fallos del servidor sí agotan el presupuesto y la operación pasa a fallida", async () => {
    const storage = createMemoryStorage();
    const queue = createSyncQueue({
      storage,
      transport: { send: async () => ({ kind: "retry", reason: "server", detail: "HTTP 500" }) },
      now: () => SYNTHETIC_NOW,
      newId: sequentialIds(),
      random: () => 0.5
    });
    await queue.saveInspection({ id: "insp-unit-0005", fields: validFields() });

    for (let attempt = 0; attempt < DEFAULT_SYNC_CONFIG.maxAttempts; attempt += 1) {
      await queue.flush({ ignoreBackoff: true });
    }

    const stats = await queue.getStats();
    assert.equal(stats.failed, 1);
    assert.equal(stats.pending, 0);
    assert.equal((await queue.getRecordViews())[0].state, "failed");
  });
});

describe("servidor: la clave de idempotencia se aplica una sola vez", () => {
  it("la misma clave devuelve duplicate, sin otra revisión ni otro registro", () => {
    const store = createServerStore();
    const first = applyOperation(store, wireOperation());
    const second = applyOperation(store, wireOperation());

    assert.equal(first.kind, "applied");
    assert.equal(second.kind, "duplicate");
    assert.equal(second.kind === "duplicate" && second.record.serverRevision, 1);
    assert.equal(listServerRecords(store).length, 1);
    assert.equal(Object.keys(store.processed).length, 1);
  });

  it("la clave repetida gana aunque el contenido enviado ahora sea distinto", () => {
    const store = createServerStore();
    applyOperation(store, wireOperation());
    const replay = applyOperation(store, wireOperation({ fields: validFields({ summary: "otro texto" }) }));

    assert.equal(replay.kind, "duplicate");
    assert.equal(listServerRecords(store)[0].fields.summary, validFields().summary);
  });

  it("el mismo contenido bajo otra clave se confirma sin crear otra revisión", () => {
    const store = createServerStore();
    applyOperation(store, wireOperation());
    const other = applyOperation(store, wireOperation({ idempotencyKey: "op-fixture-0002" }));

    assert.equal(other.kind, "duplicate");
    assert.equal(listServerRecords(store)[0].serverRevision, 1);
  });

  it("una operación con base desactualizada y contenido distinto es un conflicto", () => {
    const store = createServerStore();
    applyOperation(store, wireOperation());
    const stale = applyOperation(
      store,
      wireOperation({ idempotencyKey: "op-fixture-0003", baseServerRevision: 0, fields: validFields({ summary: "cambio remoto" }) })
    );
    assert.equal(stale.kind, "conflict");
  });

  it("una operación inválida se rechaza y no toca el estado", () => {
    const store = createServerStore();
    const rejected = applyOperation(store, wireOperation({ fields: validFields({ location: "" }) }));
    assert.equal(rejected.kind, "rejected");
    assert.deepEqual(store, { records: {}, processed: {} });
  });
});

describe("reintentos: retardo con backoff exponencial acotado", () => {
  const config = { baseDelayMs: 1000, maxDelayMs: 30000, jitterRatio: 0.2 };

  it("sin variación aleatoria duplica el retardo en cada intento", () => {
    assert.deepEqual(
      [1, 2, 3, 4].map((attempt) => computeBackoffMs(attempt, config, () => 0.5)),
      [1000, 2000, 4000, 8000]
    );
  });

  it("nunca supera el máximo ni baja de cero, con cualquier aleatoriedad", () => {
    for (const random of [0, 0.5, 0.999999]) {
      for (const attempt of [1, 5, 10, 50]) {
        const delay = computeBackoffMs(attempt, config, () => random);
        assert.ok(delay >= 0 && delay <= config.maxDelayMs, `retardo ${delay} fuera de rango`);
      }
    }
  });

  it("trata intentos inválidos como el primero", () => {
    assert.equal(computeBackoffMs(0, config, () => 0.5), 1000);
    assert.equal(computeBackoffMs(-3, config, () => 0.5), 1000);
  });

  it("la configuración por omisión mantiene los fallos de red fuera del presupuesto", () => {
    assert.ok(DEFAULT_SYNC_CONFIG.maxAttempts >= 1);
    assert.ok(DEFAULT_SYNC_CONFIG.baseDelayMs < DEFAULT_SYNC_CONFIG.maxDelayMs);
  });
});
