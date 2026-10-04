export {};

const assert = require("node:assert/strict");
const schema = require("../src/lib/storage/schema");
const { createMemoryStorage } = require("../src/lib/storage/memory-storage");
const { createSyncQueue, computeBackoffMs, DEFAULT_SYNC_CONFIG } = require("../src/lib/sync/queue");
const { resolveConflict } = require("../src/lib/sync/conflict-policy");
const { createServerStore, applyOperation, listServerRecords } = require("../src/lib/sync/server-store");
const { createHttpTransport, SYNC_ENDPOINT } = require("../src/lib/sync/transport");
const route = require("../src/app/api/sync/inspections/route");

type AsyncCase = () => void | Promise<void>;
const cases: Array<{ name: string; run: AsyncCase }> = [];
function test(name: string, run: AsyncCase) {
  cases.push({ name, run });
}

function fields(overrides: Record<string, unknown> = {}) {
  return {
    location: "Laboratorio A",
    date: "2026-10-03",
    inspector: "Tecnica A",
    status: "ok",
    findings: 0,
    summary: "Sin novedades",
    ...overrides
  };
}

function wire(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "op-001",
    recordId: "inspection-001",
    fields: fields(),
    baseServerRevision: 0,
    updatedAt: "2026-10-03T12:00:00.000Z",
    ...overrides
  };
}

function clock(start = Date.parse("2026-10-03T12:00:00.000Z")) {
  let value = start;
  return { now: () => value, advance: (ms: number) => { value += ms; } };
}

function fakeServer() {
  const store = createServerStore();
  const calls: any[] = [];
  const hooks: string[] = [];
  const transport = {
    async send(operation: any) {
      calls.push(JSON.parse(JSON.stringify(operation)));
      const hook = hooks.shift();
      if (hook === "offline") return { kind: "retry", reason: "network", detail: "offline" };
      if (hook === "serverError") return { kind: "retry", reason: "server", detail: "HTTP 503" };
      const result = applyOperation(store, operation);
      if (hook === "loseResponse") return { kind: "retry", reason: "server", detail: "HTTP 503" };
      if (result.kind === "applied") return { kind: "ack", record: result.record };
      return result;
    }
  };
  return { store, calls, hooks, transport };
}

function setup(config: Record<string, unknown> = {}) {
  const storage = createMemoryStorage();
  const time = clock();
  const server = fakeServer();
  let sequence = 0;
  const queue = createSyncQueue({
    storage,
    transport: server.transport,
    now: time.now,
    random: () => 0.5,
    newId: (kind: string) => `${kind}-${++sequence}`,
    config
  });
  return { storage, time, server, queue };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Validacion y esquema.
test("normaliza campos validos", () => {
  const result = schema.validateInspectionFields(fields({ location: "  Lab A  " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.location, "Lab A");
});
test("rechaza fechas inexistentes", () => assert.equal(schema.validateInspectionFields(fields({ date: "2026-02-30" })).ok, false));
test("rechaza estado ok con hallazgos", () => assert.equal(schema.validateInspectionFields(fields({ findings: 1 })).ok, false));
test("rechaza attention sin hallazgos", () => assert.equal(schema.validateInspectionFields(fields({ status: "attention" })).ok, false));
test("rechaza identificadores con mayusculas", () => assert.equal(schema.validateRecordId("Inspection-001").ok, false));
test("acepta una clave de idempotencia valida", () => assert.equal(schema.validateIdempotencyKey("op_ABC-123").ok, true));
test("rechaza una operacion de red incompleta", () => assert.equal(schema.validateWireOperation({}).ok, false));
test("reconoce marcas ISO", () => assert.equal(schema.isIsoTimestamp("2026-10-03T12:00:00.000Z"), true));
test("compara todos los campos", () => {
  assert.equal(schema.fieldsEqual(fields(), fields()), true);
  assert.equal(schema.fieldsEqual(fields(), fields({ summary: "Otro" })), false);
});
test("inicializa el esquema vacio", async () => {
  const storage = createMemoryStorage();
  const result = await schema.ensureSchema(storage);
  assert.deepEqual(result, { ok: true, version: 1, migrated: true });
});
test("rechaza un esquema futuro", async () => {
  const storage = createMemoryStorage();
  await storage.applyBatch([{ store: "meta", type: "put", key: "schemaVersion", value: 2 }]);
  assert.equal((await schema.ensureSchema(storage)).ok, false);
});

// Almacenamiento en memoria.
test("clona al guardar y leer", async () => {
  const storage = createMemoryStorage();
  const value: any = { nested: { count: 1 } };
  await storage.applyBatch([{ store: "meta", type: "put", key: "x", value }]);
  value.nested.count = 9;
  const read: any = await storage.get("meta", "x");
  read.nested.count = 7;
  assert.equal((await storage.get("meta", "x") as any).nested.count, 1);
});
test("el lote fallido es atomico", async () => {
  const storage = createMemoryStorage();
  storage.failNextBatch(new Error("sin espacio"));
  await assert.rejects(storage.applyBatch([{ store: "meta", type: "put", key: "a", value: 1 }]), /sin espacio/);
  assert.equal(await storage.get("meta", "a"), undefined);
});
test("elimina entradas y cuenta lotes", async () => {
  const storage = createMemoryStorage();
  await storage.applyBatch([{ store: "meta", type: "put", key: "a", value: 1 }]);
  await storage.applyBatch([{ store: "meta", type: "delete", key: "a" }]);
  assert.equal(storage.batchCount(), 2);
  assert.equal(await storage.get("meta", "a"), undefined);
});

// Guardado local.
test("crea registro y operacion en un lote", async () => {
  const { queue, storage } = setup();
  const result = await queue.saveInspection({ fields: fields() });
  assert.equal(result.ok && result.created, true);
  assert.equal(Object.keys(storage.snapshot().records).length, 1);
  assert.equal(Object.keys(storage.snapshot().outbox).length, 1);
});
test("rechaza entrada invalida sin escribir", async () => {
  const { queue, storage } = setup();
  assert.equal((await queue.saveInspection({ fields: fields({ findings: NaN }) })).ok, false);
  assert.equal(Object.keys(storage.snapshot().records).length, 0);
});
test("rechaza resumen de 501 caracteres", async () => {
  const { queue } = setup();
  assert.equal((await queue.saveInspection({ fields: fields({ summary: "x".repeat(501) }) })).ok, false);
});
test("rechaza id hostil", async () => {
  const { queue } = setup();
  assert.equal((await queue.saveInspection({ id: "BAD-ID", fields: fields() })).ok, false);
});
test("guardar lo mismo no crea otra operacion", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  const result = await queue.saveInspection({ id: "inspection-001", fields: fields() });
  assert.equal(result.ok && result.unchanged, true);
  assert.equal((await queue.getOperations()).length, 1);
});
test("ediciones previas al envio se fusionan", async () => {
  const { queue } = setup();
  const first = await queue.saveInspection({ id: "inspection-001", fields: fields() });
  const second = await queue.saveInspection({ id: "inspection-001", fields: fields({ summary: "Editado" }) });
  assert.equal(first.ok && second.ok && first.operation.idempotencyKey, second.ok && second.operation.idempotencyKey);
  assert.equal((await queue.getOperations()).length, 1);
});
test("una edicion incrementa la revision local", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  const result = await queue.saveInspection({ id: "inspection-001", fields: fields({ summary: "Editado" }) });
  assert.equal(result.ok && result.record.revision, 2);
});
test("un fallo atomico no deja registro huerfano", async () => {
  const { queue, storage } = setup();
  storage.failNextBatch();
  assert.equal((await queue.saveInspection({ fields: fields() })).ok, false);
  assert.deepEqual(storage.snapshot().records, {});
  assert.deepEqual(storage.snapshot().outbox, {});
});

// Sincronizacion basica e idempotencia.
test("confirma una operacion", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  assert.equal((await queue.flush()).applied, 1);
  assert.equal((await queue.getOperations())[0].outcome, "applied");
});
test("actualiza la base confirmada", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.flush();
  assert.equal((await queue.getRecords())[0].base.serverRevision, 1);
});
test("sin pendientes el ciclo no envia", async () => {
  const { queue } = setup();
  assert.equal((await queue.flush()).attempted, 0);
});
test("dos registros se sincronizan en orden", async () => {
  const { queue, server } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.saveInspection({ id: "inspection-002", fields: fields({ location: "Lab B" }) });
  assert.equal((await queue.flush()).applied, 2);
  assert.deepEqual(server.calls.map((item: any) => item.recordId), ["inspection-001", "inspection-002"]);
});
test("una respuesta perdida no duplica en servidor", async () => {
  const { queue, server, time } = setup();
  server.hooks.push("loseResponse");
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.flush();
  time.advance(1000);
  const report = await queue.flush();
  assert.equal(report.duplicates, 1);
  assert.equal(listServerRecords(server.store)[0].serverRevision, 1);
  assert.equal(server.calls[0].idempotencyKey, server.calls[1].idempotencyKey);
  assert.deepEqual(server.calls[0], server.calls[1]);
});

// Backoff y reintentos.
test("backoff determinista alcanza el tope", () => {
  const values = [1, 2, 3, 4, 5, 6, 7].map((attempt) => computeBackoffMs(attempt, DEFAULT_SYNC_CONFIG, () => 0.5));
  assert.deepEqual(values, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});
test("jitter inferior es 800", () => assert.equal(computeBackoffMs(1, DEFAULT_SYNC_CONFIG, () => 0), 800));
test("jitter superior es 1200", () => assert.equal(computeBackoffMs(1, DEFAULT_SYNC_CONFIG, () => 1), 1200));
test("fallo de red no consume presupuesto", async () => {
  const { queue, server } = setup();
  server.hooks.push("offline");
  await queue.saveInspection({ fields: fields() });
  await queue.flush();
  const operation = (await queue.getOperations())[0];
  assert.equal(operation.failures, 0);
  assert.equal(operation.status, "pending");
});
test("fallo de servidor consume presupuesto", async () => {
  const { queue, server } = setup();
  server.hooks.push("serverError");
  await queue.saveInspection({ fields: fields() });
  await queue.flush();
  assert.equal((await queue.getOperations())[0].failures, 1);
});
test("cinco fallos de servidor terminan en failed", async () => {
  const { queue, server } = setup({ maxAttempts: 5 });
  server.hooks.push("serverError", "serverError", "serverError", "serverError", "serverError");
  await queue.saveInspection({ fields: fields() });
  for (let i = 0; i < 5; i += 1) await queue.flush({ ignoreBackoff: true });
  assert.equal((await queue.getOperations())[0].status, "failed");
});
test("retryFailed reactiva operaciones", async () => {
  const { queue, server } = setup({ maxAttempts: 1 });
  server.hooks.push("serverError");
  await queue.saveInspection({ fields: fields() });
  await queue.flush();
  assert.equal(await queue.retryFailed(), 1);
  assert.equal((await queue.getOperations())[0].status, "pending");
});
test("un fallo detiene el ciclo y deja el siguiente", async () => {
  const { queue, server } = setup();
  server.hooks.push("offline");
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.saveInspection({ id: "inspection-002", fields: fields({ location: "Lab B" }) });
  const first = await queue.flush();
  assert.equal(first.stoppedEarly, true);
  assert.equal(server.calls.length, 1);
  const second = await queue.flush({ ignoreBackoff: true });
  assert.equal(second.applied, 2);
});

// Cierre de pestana y respuestas obsoletas.
test("no recupera un lease vigente", async () => {
  const base = setup();
  let release: (value: any) => void = () => undefined;
  const pending = new Promise<any>((resolve) => { release = resolve; });
  let ids = 50;
  const first = createSyncQueue({ storage: base.storage, transport: { send: () => pending }, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  await first.saveInspection({ id: "inspection-001", fields: fields() });
  const oldRun = first.flush();
  await tick();
  const second = createSyncQueue({ storage: base.storage, transport: base.server.transport, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  assert.equal((await second.recover()).recovered, 0);
  release({ kind: "retry", reason: "network" });
  await oldRun;
});
test("recupera un lease vencido con otra cola", async () => {
  const base = setup();
  let release: (value: any) => void = () => undefined;
  const hanging = { send: () => new Promise<any>((resolve) => { release = resolve; }) };
  let ids = 100;
  const first = createSyncQueue({ storage: base.storage, transport: hanging, now: base.time.now, random: () => 0.5, newId: (kind: string) => `${kind}-${++ids}` });
  await first.saveInspection({ id: "inspection-001", fields: fields() });
  void first.flush();
  await tick();
  base.time.advance(30000);
  const second = createSyncQueue({ storage: base.storage, transport: base.server.transport, now: base.time.now, random: () => 0.5, newId: (kind: string) => `${kind}-${++ids}` });
  assert.equal((await second.recover()).recovered, 1);
  assert.equal((await second.flush()).applied, 1);
  release({ kind: "ack", record: listServerRecords(base.server.store)[0] });
  await tick();
});
test("force recupera antes de vencer", async () => {
  const base = setup();
  const hanging = { send: () => new Promise(() => undefined) };
  let ids = 200;
  const first = createSyncQueue({ storage: base.storage, transport: hanging, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  await first.saveInspection({ id: "inspection-001", fields: fields() });
  void first.flush();
  await tick();
  const second = createSyncQueue({ storage: base.storage, transport: base.server.transport, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  assert.equal((await second.recover({ force: true })).recovered, 1);
});
test("descarta una respuesta tardia", async () => {
  const base = setup();
  let releaseOld: (value: any) => void = () => undefined;
  let releaseNew: (value: any) => void = () => undefined;
  const oldTransport = { send: () => new Promise<any>((resolve) => { releaseOld = resolve; }) };
  const newTransport = { send: () => new Promise<any>((resolve) => { releaseNew = resolve; }) };
  let ids = 300;
  const first = createSyncQueue({ storage: base.storage, transport: oldTransport, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  await first.saveInspection({ id: "inspection-001", fields: fields() });
  const oldRun = first.flush();
  await tick();
  const second = createSyncQueue({ storage: base.storage, transport: newTransport, now: base.time.now, newId: (kind: string) => `${kind}-${++ids}` });
  await second.recover({ force: true });
  const newRun = second.flush();
  await tick();
  const record = { id: "inspection-001", fields: fields(), serverRevision: 1, updatedAt: "2026-10-03T12:00:00.000Z" };
  releaseOld({ kind: "ack", record });
  const report = await oldRun;
  assert.equal(report.stale, 1);
  assert.ok(first.getLog().some((event: any) => event.type === "stale-response-ignored"));
  releaseNew({ kind: "ack", record });
  await newRun;
});

// Politica de conflictos pura.
test("campos iguales conservan el valor", () => {
  const result = resolveConflict({ base: fields(), local: { fields: fields(), updatedAt: "2026-10-03T12:01:00Z" }, remote: { fields: fields(), updatedAt: "2026-10-03T12:02:00Z" } });
  assert.equal(result.strategy, "identical");
});
test("solo cambio local avanza", () => {
  const base = fields();
  const result = resolveConflict({ base, local: { fields: fields({ summary: "Local" }), updatedAt: "2026-10-03T12:02:00Z" }, remote: { fields: base, updatedAt: "2026-10-03T12:01:00Z" } });
  assert.equal(result.merged.summary, "Local");
  assert.equal(result.strategy, "fast-forward-local");
});
test("solo cambio remoto gana", () => {
  const base = fields();
  const result = resolveConflict({ base, local: { fields: base, updatedAt: "2026-10-03T12:01:00Z" }, remote: { fields: fields({ summary: "Remoto" }), updatedAt: "2026-10-03T12:02:00Z" } });
  assert.equal(result.merged.summary, "Remoto");
  assert.equal(result.strategy, "remote-only");
});
test("attention gana en conflicto", () => {
  const result = resolveConflict({ base: null, local: { fields: fields(), updatedAt: "2026-10-03T12:02:00Z" }, remote: { fields: fields({ status: "attention", findings: 2 }), updatedAt: "2026-10-03T12:01:00Z" } });
  assert.equal(result.merged.status, "attention");
});
test("hallazgos conservan el maximo", () => {
  const result = resolveConflict({ base: null, local: { fields: fields({ status: "attention", findings: 2 }), updatedAt: "2026-10-03T12:02:00Z" }, remote: { fields: fields({ status: "attention", findings: 5 }), updatedAt: "2026-10-03T12:01:00Z" } });
  assert.equal(result.merged.findings, 5);
});
test("el cambio mas reciente gana texto", () => {
  const result = resolveConflict({ base: null, local: { fields: fields({ summary: "Local" }), updatedAt: "2026-10-03T12:03:00Z" }, remote: { fields: fields({ summary: "Remoto" }), updatedAt: "2026-10-03T12:02:00Z" } });
  assert.equal(result.merged.summary, "Local");
});
test("el servidor gana empates", () => {
  const result = resolveConflict({ base: null, local: { fields: fields({ summary: "Local" }), updatedAt: "2026-10-03T12:02:00Z" }, remote: { fields: fields({ summary: "Remoto" }), updatedAt: "2026-10-03T12:02:00Z" } });
  assert.equal(result.merged.summary, "Remoto");
  assert.equal(result.decisions.summary.rule, "empate-gana-remoto");
});

// Servidor simulado.
test("servidor crea revision uno", () => {
  const store = createServerStore();
  const result = applyOperation(store, wire());
  assert.equal(result.kind === "applied" && result.record.serverRevision, 1);
});
test("servidor deduplica la misma clave", () => {
  const store = createServerStore();
  applyOperation(store, wire());
  assert.equal(applyOperation(store, wire()).kind, "duplicate");
  assert.equal(listServerRecords(store).length, 1);
});
test("servidor detecta conflicto de revision", () => {
  const store = createServerStore();
  applyOperation(store, wire());
  const result = applyOperation(store, wire({ idempotencyKey: "op-002", fields: fields({ summary: "Cambio" }) }));
  assert.equal(result.kind, "conflict");
});
test("servidor evita duplicado semantico", () => {
  const store = createServerStore();
  applyOperation(store, wire());
  assert.equal(applyOperation(store, wire({ idempotencyKey: "op-002" })).kind, "duplicate");
  assert.equal(listServerRecords(store)[0].serverRevision, 1);
});
test("servidor rechaza entrada invalida", () => assert.equal(applyOperation(createServerStore(), {}).kind, "rejected"));

// Transporte HTTP.
test("transporte envia cuerpo y cabecera de idempotencia", async () => {
  let seen: any;
  const transport = createHttpTransport({ fetchImpl: async (url: string, init: any) => {
    seen = { url, init };
    return new Response(JSON.stringify({ status: "applied", record: { id: "inspection-001", fields: fields(), serverRevision: 1, updatedAt: "2026-10-03T12:00:00Z" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.equal((await transport.send(wire())).kind, "ack");
  assert.equal(seen.url, SYNC_ENDPOINT);
  assert.equal(seen.init.headers["Idempotency-Key"], "op-001");
});
test("transporte clasifica 429", async () => {
  const transport = createHttpTransport({ fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "3" } }) });
  assert.deepEqual(await transport.send(wire()), { kind: "retry", reason: "throttled", retryAfterMs: 3000 });
});
test("transporte clasifica 503", async () => {
  const transport = createHttpTransport({ fetchImpl: async () => new Response("", { status: 503 }) });
  assert.equal((await transport.send(wire())).reason, "server");
});
test("transporte clasifica JSON ilegible", async () => {
  const transport = createHttpTransport({ fetchImpl: async () => new Response("no-json", { status: 200 }) });
  assert.equal((await transport.send(wire())).reason, "bad-response");
});
test("transporte convierte excepciones en fallo de red", async () => {
  const transport = createHttpTransport({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal((await transport.send(wire())).reason, "network");
});

// Observabilidad, limites y casos propios.
test("subscribe recibe eventos y permite cancelar", async () => {
  const { queue } = setup();
  const seen: string[] = [];
  const stop = queue.subscribe((event: any) => seen.push(event.type));
  await queue.saveInspection({ fields: fields() });
  stop();
  await queue.saveInspection({ fields: fields({ location: "Lab B" }) });
  assert.deepEqual(seen, ["enqueued"]);
});
test("la bitacora respeta su limite", async () => {
  const { queue } = setup({ maxLogEntries: 2 });
  await queue.saveInspection({ fields: fields() });
  await queue.flush();
  assert.equal(queue.getLog().length, 2);
});
test("stats resume registros y operaciones", async () => {
  const { queue } = setup();
  await queue.saveInspection({ fields: fields() });
  const stats = await queue.getStats();
  assert.equal(stats.records, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.nextAttemptAt, 0);
});
test("getRecordViews expone pending y synced", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  assert.equal((await queue.getRecordViews())[0].state, "pending");
  await queue.flush();
  assert.equal((await queue.getRecordViews())[0].state, "synced");
});
test("maxOperationsPerFlush limita el ciclo", async () => {
  const { queue } = setup({ maxOperationsPerFlush: 2 });
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.saveInspection({ id: "inspection-002", fields: fields({ location: "Lab B" }) });
  await queue.saveInspection({ id: "inspection-003", fields: fields({ location: "Lab C" }) });
  assert.equal((await queue.flush()).applied, 2);
  assert.equal((await queue.flush()).applied, 1);
});
test("compact elimina operaciones terminadas antiguas", async () => {
  const { queue } = setup();
  await queue.saveInspection({ id: "inspection-001", fields: fields() });
  await queue.saveInspection({ id: "inspection-002", fields: fields({ location: "Lab B" }) });
  await queue.flush();
  assert.equal(await queue.compact(1), 1);
  assert.equal((await queue.getOperations()).length, 1);
});

// Route Handler directo.
test("DELETE reinicia el servidor de ruta", async () => assert.equal((await route.DELETE()).status, 200));
test("POST rechaza JSON invalido", async () => {
  const response = await route.POST(new Request("http://localhost/api/sync/inspections", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
});
test("POST valida la cabecera de idempotencia", async () => {
  const response = await route.POST(new Request("http://localhost/api/sync/inspections", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "op-999" }, body: JSON.stringify(wire()) }));
  assert.equal(response.status, 422);
});
test("POST aplica y luego deduplica", async () => {
  await route.DELETE();
  const request = () => new Request("http://localhost/api/sync/inspections", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "op-001" }, body: JSON.stringify(wire()) });
  assert.equal((await route.POST(request())).status, 200);
  const replay = await route.POST(request());
  assert.equal((await replay.json()).status, "duplicate");
});
test("gancho fallo responde 503 sin aplicar", async () => {
  await route.DELETE();
  const response = await route.POST(new Request("http://localhost/api/sync/inspections?fallo=1", { method: "POST", body: JSON.stringify(wire()) }));
  assert.equal(response.status, 503);
  assert.equal((await (await route.GET()).json()).records.length, 0);
});
test("gancho perder aplica antes del 503", async () => {
  await route.DELETE();
  const response = await route.POST(new Request("http://localhost/api/sync/inspections?perder=1", { method: "POST", body: JSON.stringify(wire()) }));
  assert.equal(response.status, 503);
  assert.equal((await (await route.GET()).json()).records.length, 1);
});
test("GET informa registros y claves procesadas", async () => {
  const body = await (await route.GET()).json();
  assert.equal(body.records.length, 1);
  assert.equal(body.processedKeys, 1);
});

async function runAll() {
  const failures: string[] = [];
  for (const item of cases) {
    try {
      await item.run();
    } catch (error) {
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      failures.push(`${item.name}: ${detail}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`sync.spec.ts: PASS (${cases.length} casos)`);
}

void runAll();
