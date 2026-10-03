/**
 * Cola de sincronización offline-first (Semana 5).
 *
 * Guarda cada cambio en el dispositivo antes de intentar enviarlo y lo
 * sincroniza cuando hay red, sin duplicar ni perder datos. Garantías:
 *
 *  - Persistencia atómica: el registro local y su operación pendiente se
 *    escriben en un solo lote; si falla, no queda ninguno a medias.
 *  - Idempotencia: cada operación tiene una `idempotencyKey` fija que se
 *    reenvía idéntica en todos los reintentos; el servidor no aplica dos veces
 *    la misma clave. Guardar dos veces el mismo contenido no crea otra operación.
 *  - Reintentos con backoff exponencial y jitter. Los fallos de red no agotan
 *    el presupuesto de reintentos (estar sin conexión no es un error); los
 *    fallos del servidor sí, y al agotarse la operación pasa a `failed`.
 *  - Cierre de pestaña: antes de enviar, la operación queda marcada
 *    `syncing` con un lease. Si la pestaña muere, `recover()` (o el siguiente
 *    `flush()`) devuelve a `pending` las operaciones con lease vencido y se
 *    reenvían con la misma clave: si la primera vez sí llegó, el servidor
 *    responde `duplicate`.
 *  - Respuestas fuera de orden o tardías: cada envío lleva un identificador de
 *    lease; una respuesta cuyo identificador ya no coincide se descarta y se registra. La
 *    revisión del servidor conocida por el cliente nunca retrocede.
 *  - Conflictos: se resuelven con `resolveConflict` (fusión de tres vías) y el
 *    resultado se reenvía como operación nueva sobre la revisión actual.
 *  - Observabilidad: eventos tipados, bitácora acotada y contadores.
 *
 * Modelo: cada operación lleva el estado completo del registro, no un delta.
 * Por registro hay a lo sumo una operación en curso y una "cola" posterior que
 * absorbe nuevas ediciones; así el orden se conserva y no hay conflictos
 * contra uno mismo. Ver docs/sync-policy.md.
 */

import {
  META_SEQUENCE_KEY,
  fieldsEqual,
  isLocalRecord,
  isOutboxOperation,
  validateInspectionFields,
  validateRecordId,
  type BatchOp,
  type InspectionFields,
  type LocalRecord,
  type OutboxOperation,
  type StorageAdapter,
  type WireOperation
} from "../storage/schema";
import { resolveConflict } from "./conflict-policy";
import type { SyncTransport, TransportResult } from "./transport";

/* ---------- Configuración ---------- */

export interface SyncConfig {
  /** Fallos reintentables que no son de red antes de pasar la operación a `failed`. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  /** Cuánto dura el lease de una operación en vuelo antes de poder recuperarla. */
  leaseMs: number;
  /** Fusiones de conflicto consecutivas permitidas para una misma cadena. */
  maxConflicts: number;
  maxLogEntries: number;
  maxOperationsPerFlush: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterRatio: 0.2,
  leaseMs: 30000,
  maxConflicts: 5,
  maxLogEntries: 200,
  maxOperationsPerFlush: 200
};

/**
 * Retardo antes del siguiente intento. `attempt` es el número de envíos ya
 * realizados (1 = primer fallo). Crece como base * 2^(attempt-1), con jitter
 * simétrico, y nunca supera `maxDelayMs`.
 */
export function computeBackoffMs(
  attempt: number,
  config: Pick<SyncConfig, "baseDelayMs" | "maxDelayMs" | "jitterRatio">,
  random: () => number = Math.random
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * Math.pow(2, safeAttempt - 1));
  const jitter = 1 + config.jitterRatio * (2 * random() - 1);
  return Math.max(0, Math.min(config.maxDelayMs, Math.round(exponential * jitter)));
}

/* ---------- Observabilidad ---------- */

export type SyncEventType =
  | "enqueued"
  | "coalesced"
  | "unchanged"
  | "rejected-input"
  | "storage-error"
  | "corrupt-entry-skipped"
  | "flush-start"
  | "send"
  | "acked"
  | "duplicate"
  | "conflict-resolved"
  | "retry-scheduled"
  | "failed"
  | "stale-response-ignored"
  | "recovered"
  | "retried-failed"
  | "flush-end";

export interface SyncEvent {
  type: SyncEventType;
  at: number;
  recordId?: string;
  opKey?: string;
  attempt?: number;
  detail?: string;
}

/* ---------- API pública ---------- */

export interface SaveInput {
  /** Si se omite, se crea un registro nuevo. Reutilizar el mismo id hace el guardado idempotente. */
  id?: string;
  fields: unknown;
}

export type SaveResult =
  | {
      ok: true;
      record: LocalRecord;
      operation: OutboxOperation | null;
      created: boolean;
      unchanged: boolean;
    }
  | { ok: false; errors: string[] };

export interface FlushOptions {
  /** Reintenta ahora aunque el backoff no haya vencido (p. ej. al volver la red). */
  ignoreBackoff?: boolean;
}

export interface FlushReport {
  attempted: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  retried: number;
  failed: number;
  stale: number;
  /** El ciclo se detuvo por un fallo reintentable para no insistir contra un servidor caído. */
  stoppedEarly: boolean;
}

export interface RecoveryReport {
  recovered: number;
}

export type RecordSyncState = "synced" | "pending" | "syncing" | "failed";

export interface RecordView {
  record: LocalRecord;
  state: RecordSyncState;
  openOperations: number;
  lastError: string | null;
}

export interface SyncStats {
  records: number;
  pending: number;
  syncing: number;
  done: number;
  failed: number;
  /** Próximo instante en que habrá una operación lista, o `null` si no hay pendientes. */
  nextAttemptAt: number | null;
}

export interface SyncQueue {
  saveInspection(input: SaveInput): Promise<SaveResult>;
  /** Un solo ciclo a la vez: una llamada concurrente comparte el ciclo en curso. */
  flush(options?: FlushOptions): Promise<FlushReport>;
  recover(options?: { force?: boolean }): Promise<RecoveryReport>;
  retryFailed(): Promise<number>;
  getRecords(): Promise<LocalRecord[]>;
  getRecordViews(): Promise<RecordView[]>;
  getOperations(): Promise<OutboxOperation[]>;
  getStats(): Promise<SyncStats>;
  getLog(): SyncEvent[];
  subscribe(listener: (event: SyncEvent) => void): () => void;
  /** Elimina las operaciones `done` más antiguas, dejando `keepDone`. Devuelve cuántas borró. */
  compact(keepDone?: number): Promise<number>;
}

export interface SyncQueueDeps {
  storage: StorageAdapter;
  transport: SyncTransport;
  now?: () => number;
  newId?: (kind: "record" | "op" | "lease") => string;
  random?: () => number;
  onEvent?: (event: SyncEvent) => void;
  config?: Partial<SyncConfig>;
}

/* ---------- Utilidades internas ---------- */

function defaultNewId(kind: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw =
    cryptoApi && typeof cryptoApi.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${kind}-${raw}`.toLowerCase();
}

function createMutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

function timeOf(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bySequence(a: OutboxOperation, b: OutboxOperation): number {
  return a.sequence - b.sequence;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyReport(): FlushReport {
  return {
    attempted: 0,
    applied: 0,
    duplicates: 0,
    conflicts: 0,
    retried: 0,
    failed: 0,
    stale: 0,
    stoppedEarly: false
  };
}

function mergeReports(a: FlushReport, b: FlushReport): FlushReport {
  return {
    attempted: a.attempted + b.attempted,
    applied: a.applied + b.applied,
    duplicates: a.duplicates + b.duplicates,
    conflicts: a.conflicts + b.conflicts,
    retried: a.retried + b.retried,
    failed: a.failed + b.failed,
    stale: a.stale + b.stale,
    stoppedEarly: b.stoppedEarly
  };
}

type ProcessOutcome = "applied" | "duplicate" | "conflict" | "retry" | "failed" | "stale" | "skipped";

/* ---------- Implementación ---------- */

export function createSyncQueue(deps: SyncQueueDeps): SyncQueue {
  const storage = deps.storage;
  const transport = deps.transport;
  const config: SyncConfig = { ...DEFAULT_SYNC_CONFIG, ...(deps.config || {}) };
  const now = deps.now || Date.now;
  const random = deps.random || Math.random;
  const newId = deps.newId || defaultNewId;
  const exclusive = createMutex();
  const listeners: Array<(event: SyncEvent) => void> = [];
  const log: SyncEvent[] = [];
  let inFlight: Promise<FlushReport> | null = null;
  let rerun: FlushOptions | null = null;

  function iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  function emit(type: SyncEventType, extra: Partial<SyncEvent> = {}): void {
    const event: SyncEvent = { type, at: now(), ...extra };
    log.push(event);
    if (log.length > config.maxLogEntries) log.splice(0, log.length - config.maxLogEntries);
    if (deps.onEvent) {
      try {
        deps.onEvent(event);
      } catch {
        /* un observador defectuoso no debe afectar a la sincronización */
      }
    }
    listeners.slice().forEach((listener) => {
      try {
        listener(event);
      } catch {
        /* idem */
      }
    });
  }

  /* ----- lectura validada ----- */

  async function readRecords(): Promise<LocalRecord[]> {
    const raw = await storage.getAll<unknown>("records");
    const valid: LocalRecord[] = [];
    raw.forEach((item) => {
      if (isLocalRecord(item)) valid.push(item);
      else emit("corrupt-entry-skipped", { detail: "records" });
    });
    return valid;
  }

  async function readOperations(): Promise<OutboxOperation[]> {
    const raw = await storage.getAll<unknown>("outbox");
    const valid: OutboxOperation[] = [];
    raw.forEach((item) => {
      if (isOutboxOperation(item)) valid.push(item);
      else emit("corrupt-entry-skipped", { detail: "outbox" });
    });
    return valid.sort(bySequence);
  }

  async function readRecord(id: string): Promise<LocalRecord | undefined> {
    const raw = await storage.get<unknown>("records", id);
    if (raw === undefined) return undefined;
    if (isLocalRecord(raw)) return raw;
    emit("corrupt-entry-skipped", { recordId: id, detail: "records" });
    return undefined;
  }

  async function readOperation(key: string): Promise<OutboxOperation | undefined> {
    const raw = await storage.get<unknown>("outbox", key);
    if (raw === undefined) return undefined;
    if (isOutboxOperation(raw)) return raw;
    emit("corrupt-entry-skipped", { opKey: key, detail: "outbox" });
    return undefined;
  }

  /* ----- escritura ----- */

  function putRecord(record: LocalRecord): BatchOp {
    return { store: "records", type: "put", key: record.id, value: record };
  }

  function putOp(op: OutboxOperation): BatchOp {
    return { store: "outbox", type: "put", key: op.idempotencyKey, value: op };
  }

  async function nextSequence(): Promise<{ value: number; op: BatchOp }> {
    const current = await storage.get<number>("meta", META_SEQUENCE_KEY);
    const value = (typeof current === "number" ? current : 0) + 1;
    return { value, op: { store: "meta", type: "put", key: META_SEQUENCE_KEY, value } };
  }

  function buildOperation(params: {
    recordId: string;
    fields: InspectionFields;
    clientRevision: number;
    updatedAt: string;
    conflicts: number;
    sequence: number;
  }): OutboxOperation {
    return {
      idempotencyKey: newId("op"),
      recordId: params.recordId,
      fields: { ...params.fields },
      clientRevision: params.clientRevision,
      baseServerRevision: null,
      updatedAt: params.updatedAt,
      status: "pending",
      attempts: 0,
      failures: 0,
      conflicts: params.conflicts,
      nextAttemptAt: 0,
      leaseId: null,
      leaseExpiresAt: null,
      lastError: null,
      outcome: null,
      ackedServerRevision: null,
      createdAt: now(),
      sequence: params.sequence
    };
  }

  function isOpen(op: OutboxOperation): boolean {
    return op.status === "pending" || op.status === "syncing";
  }

  /* ----- guardar ----- */

  async function saveInspection(input: SaveInput): Promise<SaveResult> {
    const validation = validateInspectionFields(input.fields);
    const errors: string[] = validation.ok ? [] : validation.errors.slice();
    if (input.id !== undefined) {
      const idCheck = validateRecordId(input.id);
      if (!idCheck.ok) errors.push(...idCheck.errors);
    }
    if (errors.length > 0 || !validation.ok) {
      emit("rejected-input", { recordId: input.id, detail: errors.join("; ") });
      return { ok: false, errors };
    }
    const fields = validation.value;

    return exclusive(async (): Promise<SaveResult> => {
      try {
        const id = input.id !== undefined ? input.id : newId("record");
        const rawExisting = await storage.get<unknown>("records", id);
        if (rawExisting !== undefined && !isLocalRecord(rawExisting)) {
          emit("corrupt-entry-skipped", { recordId: id, detail: "records" });
          return { ok: false, errors: ["el registro local está dañado y no se puede editar"] };
        }
        const existing = rawExisting as LocalRecord | undefined;

        if (existing && fieldsEqual(existing.fields, fields)) {
          emit("unchanged", { recordId: id });
          return { ok: true, record: existing, operation: null, created: false, unchanged: true };
        }

        const nowMs = now();
        const stamp = iso(nowMs);
        const record: LocalRecord = existing
          ? { ...existing, fields, revision: existing.revision + 1, updatedAt: stamp }
          : { id, fields, revision: 1, updatedAt: stamp, base: null, syncedRevision: 0 };

        const mine = (await readOperations()).filter((op) => op.recordId === id);
        const open = mine.filter(isOpen);
        const failed = mine.filter((op) => op.status === "failed");
        const batch: BatchOp[] = [putRecord(record)];

        // El estado más reciente reemplaza a cualquier operación fallida de este registro.
        failed.forEach((op) => {
          batch.push(putOp({ ...op, status: "done", outcome: "superseded", leaseId: null, leaseExpiresAt: null }));
        });

        const tail = open.length > 0 ? open[open.length - 1] : null;
        let operation: OutboxOperation;
        if (tail && tail.status === "pending" && tail.attempts === 0) {
          // Aún no se envió nunca: se puede reescribir sin romper la idempotencia.
          operation = { ...tail, fields: { ...fields }, clientRevision: record.revision, updatedAt: stamp };
          batch.push(putOp(operation));
          emit("coalesced", { recordId: id, opKey: operation.idempotencyKey });
        } else {
          const sequence = await nextSequence();
          batch.push(sequence.op);
          operation = buildOperation({
            recordId: id,
            fields,
            clientRevision: record.revision,
            updatedAt: stamp,
            conflicts: 0,
            sequence: sequence.value
          });
          batch.push(putOp(operation));
          emit("enqueued", { recordId: id, opKey: operation.idempotencyKey });
        }

        await storage.applyBatch(batch);
        return { ok: true, record, operation, created: !existing, unchanged: false };
      } catch (error) {
        emit("storage-error", { recordId: input.id, detail: messageOf(error) });
        return { ok: false, errors: [`no se pudo guardar localmente: ${messageOf(error)}`] };
      }
    });
  }

  /* ----- envío ----- */

  function toWire(op: OutboxOperation): WireOperation {
    return {
      idempotencyKey: op.idempotencyKey,
      recordId: op.recordId,
      fields: { ...op.fields },
      baseServerRevision: op.baseServerRevision === null ? 0 : op.baseServerRevision,
      updatedAt: op.updatedAt
    };
  }

  async function safeSend(op: OutboxOperation): Promise<TransportResult> {
    try {
      const result = await transport.send(toWire(op));
      if (!result || typeof (result as { kind?: unknown }).kind !== "string") {
        return { kind: "retry", reason: "bad-response", detail: "el transporte devolvió un resultado inválido" };
      }
      return result;
    } catch (error) {
      return { kind: "retry", reason: "network", detail: messageOf(error) };
    }
  }

  async function pickNext(
    options: FlushOptions,
    visited: Record<string, true>
  ): Promise<OutboxOperation | null> {
    const ops = await readOperations();
    const nowMs = now();
    const heads: Record<string, OutboxOperation> = {};
    ops.filter(isOpen).forEach((op) => {
      const head = heads[op.recordId];
      if (!head || op.sequence < head.sequence) heads[op.recordId] = op;
    });
    const candidates = Object.keys(heads)
      .map((recordId) => heads[recordId])
      .filter(
        (op) =>
          op.status === "pending" &&
          !visited[op.idempotencyKey] &&
          (options.ignoreBackoff === true || op.nextAttemptAt <= nowMs)
      )
      .sort(bySequence);
    return candidates.length > 0 ? candidates[0] : null;
  }

  async function lease(candidate: OutboxOperation): Promise<OutboxOperation | null> {
    return exclusive(async () => {
      const fresh = await readOperation(candidate.idempotencyKey);
      if (!fresh || fresh.status !== "pending") return null;
      const record = await readRecord(fresh.recordId);
      const nowMs = now();
      // La base se fija en el primer envío y no cambia en los reintentos.
      const base =
        fresh.attempts === 0
          ? record && record.base
            ? record.base.serverRevision
            : 0
          : fresh.baseServerRevision === null
            ? 0
            : fresh.baseServerRevision;
      const leased: OutboxOperation = {
        ...fresh,
        status: "syncing",
        attempts: fresh.attempts + 1,
        baseServerRevision: base,
        leaseId: newId("lease"),
        leaseExpiresAt: nowMs + config.leaseMs
      };
      await storage.applyBatch([putOp(leased)]);
      emit("send", {
        recordId: leased.recordId,
        opKey: leased.idempotencyKey,
        attempt: leased.attempts,
        detail: `base=${base}`
      });
      return leased;
    });
  }

  async function finalizeSuccess(
    op: OutboxOperation,
    result: Extract<TransportResult, { kind: "ack" | "duplicate" }>
  ): Promise<ProcessOutcome> {
    const record = await readRecord(op.recordId);
    const incoming = result.record;
    const batch: BatchOp[] = [];
    let regression = false;

    if (record) {
      const updated: LocalRecord = {
        ...record,
        syncedRevision: Math.max(record.syncedRevision, op.clientRevision)
      };
      if (!record.base || incoming.serverRevision >= record.base.serverRevision) {
        updated.base = {
          fields: incoming.fields,
          serverRevision: incoming.serverRevision,
          updatedAt: incoming.updatedAt
        };
      } else {
        regression = true;
      }
      batch.push(putRecord(updated));
    }

    batch.push(
      putOp({
        ...op,
        status: "done",
        outcome: result.kind === "ack" ? "applied" : "duplicate",
        leaseId: null,
        leaseExpiresAt: null,
        lastError: null,
        ackedServerRevision: incoming.serverRevision
      })
    );
    await storage.applyBatch(batch);

    emit(result.kind === "ack" ? "acked" : "duplicate", {
      recordId: op.recordId,
      opKey: op.idempotencyKey,
      attempt: op.attempts,
      detail: `serverRevision=${incoming.serverRevision}`
    });
    if (regression) {
      emit("stale-response-ignored", {
        recordId: op.recordId,
        opKey: op.idempotencyKey,
        detail: "la revisión del servidor no retrocede"
      });
    }
    return result.kind === "ack" ? "applied" : "duplicate";
  }

  async function failOperation(op: OutboxOperation, message: string): Promise<ProcessOutcome> {
    await storage.applyBatch([
      putOp({ ...op, status: "failed", leaseId: null, leaseExpiresAt: null, lastError: message })
    ]);
    emit("failed", { recordId: op.recordId, opKey: op.idempotencyKey, attempt: op.attempts, detail: message });
    return "failed";
  }

  async function scheduleRetry(
    op: OutboxOperation,
    result: Extract<TransportResult, { kind: "retry" }>
  ): Promise<ProcessOutcome> {
    const failures = op.failures + (result.reason === "network" ? 0 : 1);
    const reason = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
    if (failures >= config.maxAttempts) {
      return failOperation({ ...op, failures }, `agotados ${failures} fallos (${reason})`);
    }
    const delay = Math.max(computeBackoffMs(op.attempts, config, random), result.retryAfterMs || 0);
    await storage.applyBatch([
      putOp({
        ...op,
        status: "pending",
        failures,
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: now() + delay,
        lastError: reason
      })
    ]);
    emit("retry-scheduled", {
      recordId: op.recordId,
      opKey: op.idempotencyKey,
      attempt: op.attempts,
      detail: `${reason}; +${delay}ms`
    });
    return "retry";
  }

  async function handleConflict(
    op: OutboxOperation,
    remote: Extract<TransportResult, { kind: "conflict" }>["remote"]
  ): Promise<ProcessOutcome> {
    const record = await readRecord(op.recordId);
    if (!record) return failOperation(op, "registro local ausente al resolver un conflicto");
    if (op.conflicts >= config.maxConflicts) {
      return failOperation(op, `más de ${config.maxConflicts} conflictos consecutivos`);
    }

    const resolution = resolveConflict({
      base: record.base ? record.base.fields : null,
      local: { fields: op.fields, updatedAt: op.updatedAt },
      remote: { fields: remote.fields, updatedAt: remote.updatedAt }
    });

    const all = await readOperations();
    const tail = all
      .filter(
        (other) =>
          other.recordId === op.recordId &&
          other.idempotencyKey !== op.idempotencyKey &&
          other.status === "pending" &&
          other.attempts === 0
      )
      .sort(bySequence)[0];

    const stamp = iso(now());
    let finalFields = resolution.merged;
    if (tail) {
      // Lo editado después de esta operación se reaplica sobre el resultado de la fusión.
      const rebased = resolveConflict({
        base: op.fields,
        local: { fields: tail.fields, updatedAt: tail.updatedAt },
        remote: {
          fields: resolution.merged,
          updatedAt: iso(Math.max(timeOf(op.updatedAt), timeOf(remote.updatedAt)))
        }
      });
      finalFields = rebased.merged;
    }

    const changedLocally = !fieldsEqual(finalFields, record.fields);
    const revision = changedLocally ? record.revision + 1 : record.revision;
    const alreadyOnServer = fieldsEqual(finalFields, remote.fields);

    const batch: BatchOp[] = [
      putOp({
        ...op,
        status: "done",
        outcome: "conflict-merged",
        leaseId: null,
        leaseExpiresAt: null,
        lastError: null,
        ackedServerRevision: remote.serverRevision
      })
    ];

    if (alreadyOnServer) {
      // El servidor ya tiene exactamente el resultado: no hace falta enviar nada más.
      if (tail) batch.push(putOp({ ...tail, status: "done", outcome: "superseded" }));
    } else if (tail) {
      batch.push(
        putOp({
          ...tail,
          fields: finalFields,
          clientRevision: revision,
          baseServerRevision: null,
          conflicts: op.conflicts + 1
        })
      );
    } else {
      const sequence = await nextSequence();
      batch.push(sequence.op);
      batch.push(
        putOp(
          buildOperation({
            recordId: op.recordId,
            fields: finalFields,
            clientRevision: revision,
            updatedAt: stamp,
            conflicts: op.conflicts + 1,
            sequence: sequence.value
          })
        )
      );
    }

    batch.push(
      putRecord({
        ...record,
        fields: finalFields,
        revision,
        updatedAt: changedLocally ? stamp : record.updatedAt,
        syncedRevision: alreadyOnServer ? revision : record.syncedRevision,
        base: {
          fields: remote.fields,
          serverRevision: remote.serverRevision,
          updatedAt: remote.updatedAt
        }
      })
    );
    await storage.applyBatch(batch);

    const summary = Object.keys(resolution.decisions)
      .map((name) => {
        const decision = resolution.decisions[name as keyof typeof resolution.decisions];
        return `${name}:${decision.rule}`;
      })
      .join(", ");
    emit("conflict-resolved", {
      recordId: op.recordId,
      opKey: op.idempotencyKey,
      attempt: op.attempts,
      detail: `${resolution.strategy}; ${summary}`
    });
    return "conflict";
  }

  async function settle(leased: OutboxOperation, result: TransportResult): Promise<ProcessOutcome> {
    const fresh = await readOperation(leased.idempotencyKey);
    if (!fresh || fresh.status !== "syncing" || fresh.leaseId !== leased.leaseId) {
      // Llegó tarde o fuera de orden: otro intento o una recuperación ya tomó el control.
      emit("stale-response-ignored", {
        recordId: leased.recordId,
        opKey: leased.idempotencyKey,
        attempt: leased.attempts,
        detail: `respuesta ${result.kind} descartada: el lease ya no coincide`
      });
      return "stale";
    }
    switch (result.kind) {
      case "ack":
      case "duplicate":
        return finalizeSuccess(fresh, result);
      case "conflict":
        return handleConflict(fresh, result.remote);
      case "retry":
        return scheduleRetry(fresh, result);
      default:
        return failOperation(fresh, result.errors.join("; "));
    }
  }

  async function processOperation(candidate: OutboxOperation): Promise<ProcessOutcome> {
    const leased = await lease(candidate);
    if (!leased) return "skipped";
    const result = await safeSend(leased);
    return exclusive(() => settle(leased, result));
  }

  /* ----- recuperación ----- */

  async function recoverInternal(force: boolean): Promise<number> {
    return exclusive(async () => {
      const nowMs = now();
      const stale = (await readOperations()).filter(
        (op) => op.status === "syncing" && (force || (op.leaseExpiresAt === null ? 0 : op.leaseExpiresAt) <= nowMs)
      );
      if (stale.length === 0) return 0;
      await storage.applyBatch(
        stale.map((op) =>
          putOp({ ...op, status: "pending", leaseId: null, leaseExpiresAt: null, nextAttemptAt: nowMs })
        )
      );
      stale.forEach((op) => {
        emit("recovered", { recordId: op.recordId, opKey: op.idempotencyKey, attempt: op.attempts });
      });
      return stale.length;
    });
  }

  /* ----- ciclo de sincronización ----- */

  async function doFlush(options: FlushOptions): Promise<FlushReport> {
    const report = emptyReport();
    emit("flush-start");
    try {
      await recoverInternal(false);
      const visited: Record<string, true> = {};
      for (let i = 0; i < config.maxOperationsPerFlush; i += 1) {
        const next = await exclusive(() => pickNext(options, visited));
        if (!next) break;
        visited[next.idempotencyKey] = true;
        const outcome = await processOperation(next);
        if (outcome === "skipped") continue;
        report.attempted += 1;
        if (outcome === "applied") report.applied += 1;
        else if (outcome === "duplicate") report.duplicates += 1;
        else if (outcome === "conflict") report.conflicts += 1;
        else if (outcome === "failed") report.failed += 1;
        else if (outcome === "stale") report.stale += 1;
        else if (outcome === "retry") {
          report.retried += 1;
          report.stoppedEarly = true;
          break;
        }
      }
    } catch (error) {
      emit("storage-error", { detail: messageOf(error) });
      report.stoppedEarly = true;
    }
    emit("flush-end", {
      detail: `intentos=${report.attempted} aplicadas=${report.applied} duplicadas=${report.duplicates} conflictos=${report.conflicts} reintentos=${report.retried} fallidas=${report.failed} obsoletas=${report.stale}`
    });
    return report;
  }

  async function flushLoop(options: FlushOptions): Promise<FlushReport> {
    let report = await doFlush(options);
    while (rerun) {
      const next = rerun;
      rerun = null;
      report = mergeReports(report, await doFlush(next));
    }
    return report;
  }

  function flush(options: FlushOptions = {}): Promise<FlushReport> {
    if (inFlight) {
      // Una petición de "reintentar ya" que llega durante un ciclo se atiende al terminar este.
      if (options.ignoreBackoff) rerun = options;
      return inFlight;
    }
    const run = flushLoop(options).finally(() => {
      inFlight = null;
    });
    inFlight = run;
    return run;
  }

  /* ----- consultas y mantenimiento ----- */

  async function retryFailed(): Promise<number> {
    return exclusive(async () => {
      const ops = await readOperations();
      const failed = ops.filter((op) => op.status === "failed");
      if (failed.length === 0) return 0;
      const batch: BatchOp[] = [];
      let retried = 0;
      failed.forEach((op) => {
        const hasNewer = ops.some((other) => other.recordId === op.recordId && isOpen(other));
        if (hasNewer) {
          batch.push(putOp({ ...op, status: "done", outcome: "superseded" }));
          return;
        }
        retried += 1;
        batch.push(putOp({ ...op, status: "pending", failures: 0, nextAttemptAt: 0, lastError: null }));
        emit("retried-failed", { recordId: op.recordId, opKey: op.idempotencyKey });
      });
      await storage.applyBatch(batch);
      return retried;
    });
  }

  async function getRecordViews(): Promise<RecordView[]> {
    const [records, ops] = await Promise.all([readRecords(), readOperations()]);
    return records.map((record) => {
      const mine = ops.filter((op) => op.recordId === record.id);
      const failed = mine.find((op) => op.status === "failed");
      const syncing = mine.find((op) => op.status === "syncing");
      const pending = mine.find((op) => op.status === "pending");
      const open = mine.filter(isOpen).length;
      let state: RecordSyncState = "synced";
      if (failed) state = "failed";
      else if (syncing) state = "syncing";
      else if (pending) state = "pending";
      const withError = failed || pending;
      return { record, state, openOperations: open, lastError: withError ? withError.lastError : null };
    });
  }

  async function getStats(): Promise<SyncStats> {
    const [records, ops] = await Promise.all([readRecords(), readOperations()]);
    const pending = ops.filter((op) => op.status === "pending");
    const due = pending.map((op) => op.nextAttemptAt);
    return {
      records: records.length,
      pending: pending.length,
      syncing: ops.filter((op) => op.status === "syncing").length,
      done: ops.filter((op) => op.status === "done").length,
      failed: ops.filter((op) => op.status === "failed").length,
      nextAttemptAt: due.length > 0 ? Math.min.apply(null, due) : null
    };
  }

  async function compact(keepDone = 50): Promise<number> {
    return exclusive(async () => {
      const done = (await readOperations()).filter((op) => op.status === "done");
      const excess = done.length - Math.max(0, keepDone);
      if (excess <= 0) return 0;
      const batch: BatchOp[] = done
        .slice(0, excess)
        .map((op) => ({ store: "outbox", type: "delete", key: op.idempotencyKey }) as BatchOp);
      await storage.applyBatch(batch);
      return excess;
    });
  }

  return {
    saveInspection,
    flush,
    recover: async (options) => ({ recovered: await recoverInternal(Boolean(options && options.force)) }),
    retryFailed,
    getRecords: readRecords,
    getRecordViews,
    getOperations: readOperations,
    getStats,
    getLog: () => log.slice(),
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    compact
  };
}
