/**
 * Integración: reintentar la misma operación no crea un duplicado (Semana 8).
 *
 * Riesgo cubierto: "duplicado de sincronización". El caso difícil es la
 * respuesta perdida: el servidor SÍ aplicó la operación, pero el cliente no
 * se entera y reintenta. La cola real, el transporte HTTP real y el manejador
 * real de la ruta `/api/sync/inspections` se conectan sin abrir un puerto; las
 * respuestas remotas se controlan con fixtures.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DELETE, GET, POST } from "../../src/app/api/sync/inspections/route";
import { createMemoryStorage } from "../../src/lib/storage/memory-storage";
import { createSyncQueue } from "../../src/lib/sync/queue";
import { createServerStore, listServerRecords } from "../../src/lib/sync/server-store";
import { createHttpTransport } from "../../src/lib/sync/transport";
import { SYNTHETIC_NOW, sequentialIds, validFields, wireOperation } from "../fixtures/inspections";
import { routeFetch, serverTransport } from "../fixtures/transports";

// Semana 9: los ganchos de demostración están apagados por omisión; esta suite los ejercita.
process.env.ENABLE_DEMO_HOOKS = "1";

const BASE = "http://localhost/api/sync/inspections";

function post(body: unknown, headers: Record<string, string> = {}, query = ""): Promise<Response> {
  return POST(
    new Request(`${BASE}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    })
  );
}

async function serverState(): Promise<{ records: Array<{ id: string; serverRevision: number }>; processedKeys: number }> {
  return (await GET(new Request(BASE))).json();
}

describe("respuesta perdida: el servidor aplicó pero el cliente reintenta", () => {
  it("con el transporte simulado, el reintento usa la misma clave y el servidor responde duplicate", async () => {
    const server = createServerStore();
    const transport = serverTransport(server, { loseResponses: 1 });
    const queue = createSyncQueue({
      storage: createMemoryStorage(),
      transport,
      now: () => SYNTHETIC_NOW,
      newId: sequentialIds(),
      random: () => 0.5
    });
    await queue.saveInspection({ id: "insp-integ-0002", fields: validFields() });

    const first = await queue.flush({ ignoreBackoff: true });
    assert.equal(first.retried, 1, "la primera respuesta se pierde");
    const second = await queue.flush({ ignoreBackoff: true });
    assert.equal(second.duplicates, 1, "el reintento se reconoce como duplicado");

    assert.equal(transport.sent.length, 2);
    assert.equal(transport.sent[0], transport.sent[1], "el reintento reutiliza la misma clave de idempotencia");
    assert.equal(listServerRecords(server).length, 1);
    assert.equal(listServerRecords(server)[0].serverRevision, 1);
    const [operation] = await queue.getOperations();
    assert.equal(operation.status, "done");
    assert.equal(operation.outcome, "duplicate");
    assert.equal((await queue.getRecordViews())[0].state, "synced");
  });

  it("con el transporte HTTP y la ruta real, perder la respuesta tampoco duplica el registro", async () => {
    await DELETE(new Request(BASE, { method: "DELETE" }));
    const storage = createMemoryStorage();
    const lossy = createSyncQueue({
      storage,
      transport: createHttpTransport({ fetchImpl: routeFetch(), url: BASE, query: "perder=1" }),
      now: () => SYNTHETIC_NOW,
      newId: sequentialIds(),
      random: () => 0.5
    });
    await lossy.saveInspection({ id: "insp-integ-0003", fields: validFields() });

    const lost = await lossy.flush({ ignoreBackoff: true });
    assert.equal(lost.retried, 1, "la ruta aplicó la operación pero respondió 503");
    assert.equal((await serverState()).records.length, 1, "el servidor ya tiene el registro");

    // Vuelve la red: misma cola, mismo almacén, sin ?perder=1.
    const healthy = createSyncQueue({
      storage,
      transport: createHttpTransport({ fetchImpl: routeFetch(), url: BASE }),
      now: () => SYNTHETIC_NOW,
      newId: sequentialIds(),
      random: () => 0.5
    });
    const retried = await healthy.flush({ ignoreBackoff: true });

    assert.equal(retried.duplicates, 1);
    const state = await serverState();
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].serverRevision, 1);
    assert.equal(state.processedKeys, 1);
  });
});

describe("ruta POST /api/sync/inspections", () => {
  beforeEach(async () => {
    await DELETE(new Request(BASE, { method: "DELETE" }));
  });

  it("la misma operación enviada dos veces devuelve applied y luego duplicate con el mismo registro", async () => {
    const operation = wireOperation({ recordId: "insp-integ-0004", idempotencyKey: "op-integ-0004" });
    const first = await post(operation, { "Idempotency-Key": operation.idempotencyKey });
    const second = await post(operation, { "Idempotency-Key": operation.idempotencyKey });

    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { status: string }).status, "applied");
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("Idempotent-Replay"), "true");
    assert.equal(((await second.json()) as { status: string }).status, "duplicate");

    const state = await serverState();
    assert.equal(state.records.length, 1);
    assert.equal(state.processedKeys, 1);
  });

  it("rechaza una cabecera Idempotency-Key que no coincide con el cuerpo y no guarda nada", async () => {
    const response = await post(wireOperation(), { "Idempotency-Key": "op-otra-clave" });
    assert.equal(response.status, 422);
    assert.equal((await serverState()).records.length, 0);
  });

  it("rechaza una captura inválida con 422 y no crea registro", async () => {
    const response = await post(wireOperation({ fields: validFields({ date: "2026-02-30" }) }));
    assert.equal(response.status, 422);
    const body = (await response.json()) as { errors: string[] };
    assert.match(body.errors.join(" "), /date:/);
    assert.equal((await serverState()).records.length, 0);
  });

  it("responde 503 con ?fallo=1 sin procesar la operación", async () => {
    const response = await post(wireOperation(), {}, "?fallo=1");
    assert.equal(response.status, 503);
    assert.equal((await serverState()).processedKeys, 0);
  });
});
