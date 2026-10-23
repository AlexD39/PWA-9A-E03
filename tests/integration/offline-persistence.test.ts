/**
 * Integración: guardar sin conexión persiste la inspección (Semana 8).
 *
 * Riesgo cubierto: "persistencia/reconexión". Se ensamblan la cola real, el
 * almacén (memoria, con la misma interfaz que IndexedDB) y el servidor
 * simulado real. Lo único controlado es la red: primero no hay conexión y
 * después vuelve. Una segunda cola creada sobre el MISMO almacén representa
 * "recargar la página": el estado en memoria se pierde, los datos no.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../../src/lib/storage/memory-storage";
import { createSyncQueue } from "../../src/lib/sync/queue";
import { createServerStore, listServerRecords } from "../../src/lib/sync/server-store";
import { SYNTHETIC_NOW, sequentialIds, validFields } from "../fixtures/inspections";
import { offlineTransport, serverTransport } from "../fixtures/transports";

const RECORD_ID = "insp-integ-0001";

function deps(storage: ReturnType<typeof createMemoryStorage>, transport: ReturnType<typeof offlineTransport>) {
  return { storage, transport, now: () => SYNTHETIC_NOW, newId: sequentialIds(), random: () => 0.5 };
}

describe("guardar sin conexión", () => {
  it("la inspección queda en el almacén local con una operación pendiente aunque no haya red", async () => {
    const storage = createMemoryStorage();
    const offline = offlineTransport();
    const queue = createSyncQueue(deps(storage, offline));

    const saved = await queue.saveInspection({ id: RECORD_ID, fields: validFields() });
    assert.equal(saved.ok, true);

    // Antes de intentar cualquier envío ya está persistido, en un solo lote atómico.
    const snapshot = storage.snapshot();
    assert.deepEqual(Object.keys(snapshot.records), [RECORD_ID]);
    assert.equal(Object.keys(snapshot.outbox).length, 1);
    assert.equal(offline.sent.length, 0);

    const report = await queue.flush({ ignoreBackoff: true });
    assert.equal(report.retried, 1);
    assert.equal(report.applied, 0);

    // Sin red no se pierde nada ni se marca como fallo definitivo.
    const stats = await queue.getStats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.failed, 0);
    assert.equal(stats.done, 0);
    const [view] = await queue.getRecordViews();
    assert.equal(view.state, "pending");
  });

  it("una falla de escritura local no deja un registro a medias", async () => {
    const storage = createMemoryStorage();
    const queue = createSyncQueue(deps(storage, offlineTransport()));
    storage.failNextBatch();

    const result = await queue.saveInspection({ id: RECORD_ID, fields: validFields() });

    assert.equal(result.ok, false);
    assert.deepEqual(storage.snapshot(), { records: {}, outbox: {}, meta: {} });
  });
});

describe("recargar y reconectar", () => {
  it("tras recargar, la inspección y su operación siguen ahí y se sincronizan una sola vez", async () => {
    const storage = createMemoryStorage();
    const before = createSyncQueue(deps(storage, offlineTransport()));
    const saved = await before.saveInspection({ id: RECORD_ID, fields: validFields() });
    assert.equal(saved.ok, true);
    const originalKey = saved.ok && saved.operation ? saved.operation.idempotencyKey : "";
    await before.flush({ ignoreBackoff: true });

    // "Recarga": una cola nueva sobre el mismo almacén; vuelve la conexión.
    const server = createServerStore();
    const online = serverTransport(server);
    const after = createSyncQueue(deps(storage, online));

    const records = await after.getRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, RECORD_ID);
    assert.deepEqual(records[0].fields, validFields());
    const pending = await after.getOperations();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].idempotencyKey, originalKey, "la operación conserva su clave tras recargar");
    assert.equal(pending[0].status, "pending");

    const report = await after.flush({ ignoreBackoff: true });
    assert.equal(report.applied, 1);
    assert.equal(report.duplicates, 0);

    assert.deepEqual(online.sent, [originalKey]);
    assert.equal(listServerRecords(server).length, 1);
    const [view] = await after.getRecordViews();
    assert.equal(view.state, "synced");
    assert.equal(view.record.syncedRevision, 1);
    assert.equal((await after.getStats()).pending, 0);
  });

  it("una operación que quedó en vuelo al cerrar la pestaña se recupera y se reenvía", async () => {
    const storage = createMemoryStorage();
    const first = createSyncQueue(deps(storage, offlineTransport()));
    await first.saveInspection({ id: RECORD_ID, fields: validFields() });

    // Simula el cierre a mitad de un envío: la operación quedó "syncing".
    const [operation] = await first.getOperations();
    await storage.applyBatch([
      {
        store: "outbox",
        type: "put",
        key: operation.idempotencyKey,
        value: { ...operation, status: "syncing", attempts: 1, leaseId: "lease-muerto", leaseExpiresAt: SYNTHETIC_NOW + 60000 }
      }
    ]);

    const server = createServerStore();
    const second = createSyncQueue(deps(storage, serverTransport(server)));
    const recovery = await second.recover({ force: true });
    assert.equal(recovery.recovered, 1);

    const report = await second.flush({ ignoreBackoff: true });
    assert.equal(report.applied, 1);
    assert.equal(listServerRecords(server).length, 1);
  });

  async function leaseLeftBehind(leaseExpiresAt: number) {
    const storage = createMemoryStorage();
    const first = createSyncQueue(deps(storage, offlineTransport()));
    await first.saveInspection({ id: RECORD_ID, fields: validFields() });
    const [operation] = await first.getOperations();
    await storage.applyBatch([
      {
        store: "outbox",
        type: "put",
        key: operation.idempotencyKey,
        value: { ...operation, status: "syncing", attempts: 1, leaseId: "lease-previo", leaseExpiresAt }
      }
    ]);
    const server = createServerStore();
    const transport = serverTransport(server);
    return { queue: createSyncQueue(deps(storage, transport)), transport, server };
  }

  it("un envío en vuelo cuyo lease ya venció se recupera solo, sin forzar", async () => {
    const { queue, server } = await leaseLeftBehind(SYNTHETIC_NOW - 1);

    const report = await queue.flush();

    assert.equal(report.applied, 1);
    assert.equal(listServerRecords(server).length, 1);
  });

  it("un envío en vuelo con lease vigente no se reenvía: otra pestaña podría estar enviándolo", async () => {
    const { queue, transport } = await leaseLeftBehind(SYNTHETIC_NOW + 60000);

    const report = await queue.flush();

    assert.equal(report.attempted, 0);
    assert.deepEqual(transport.sent, []);
    assert.equal((await queue.getOperations())[0].status, "syncing");
  });
});
