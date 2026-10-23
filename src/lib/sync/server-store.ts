/**
 * Servidor simulado de sincronización (Semana 5).
 *
 * No hay backend real en este proyecto, así que esta es la contraparte
 * sintética que respalda a `src/app/api/sync/inspections/route.ts`. Es lógica
 * pura sobre un almacén en memoria, por eso se prueba directamente en Node.
 *
 * Garantías que ofrece y que la cola da por sentadas:
 *   - Idempotencia por clave: la misma `idempotencyKey` devuelve siempre la
 *     respuesta original (`duplicate`) y no vuelve a aplicar nada.
 *   - Concurrencia optimista: solo se aplica una operación si su
 *     `baseServerRevision` coincide con la revisión actual; si no, `conflict`.
 *   - Duplicado semántico: si el contenido ya está en el servidor aunque la
 *     clave sea nueva, se confirma sin crear una revisión adicional.
 *   - Validación completa antes de tocar el estado.
 *
 * Límite: `processed` crece sin tope. Un servidor real expiraría las claves
 * pasado un plazo. Ver docs/sync-policy.md.
 */

import {
  fieldsEqual,
  validateWireOperation,
  type ServerRecord,
  type WireOperation
} from "../storage/schema";

export interface ServerStore {
  records: Record<string, ServerRecord>;
  /** Respuesta original guardada por clave de idempotencia. */
  processed: Record<string, ServerRecord>;
}

export type ApplyResult =
  | { kind: "applied"; record: ServerRecord }
  | { kind: "duplicate"; record: ServerRecord }
  | { kind: "conflict"; remote: ServerRecord }
  | { kind: "rejected"; errors: string[] };

export function createServerStore(): ServerStore {
  return { records: {}, processed: {} };
}

function copyRecord(record: ServerRecord): ServerRecord {
  return JSON.parse(JSON.stringify(record)) as ServerRecord;
}

export function applyOperation(store: ServerStore, input: unknown): ApplyResult {
  const validation = validateWireOperation(input);
  if (!validation.ok) return { kind: "rejected", errors: validation.errors };
  const op: WireOperation = validation.value;

  const previous = store.processed[op.idempotencyKey];
  if (previous) return { kind: "duplicate", record: copyRecord(previous) };

  const existing = store.records[op.recordId];

  if (!existing) {
    const created: ServerRecord = {
      id: op.recordId,
      fields: { ...op.fields },
      serverRevision: 1,
      updatedAt: op.updatedAt
    };
    store.records[op.recordId] = created;
    store.processed[op.idempotencyKey] = copyRecord(created);
    return { kind: "applied", record: copyRecord(created) };
  }

  if (existing.serverRevision === op.baseServerRevision) {
    const updated: ServerRecord = {
      id: existing.id,
      fields: { ...op.fields },
      serverRevision: existing.serverRevision + 1,
      updatedAt: op.updatedAt
    };
    store.records[op.recordId] = updated;
    store.processed[op.idempotencyKey] = copyRecord(updated);
    return { kind: "applied", record: copyRecord(updated) };
  }

  if (fieldsEqual(existing.fields, op.fields)) {
    // Mismo contenido bajo otra clave: ya está aplicado, no se crea otra revisión.
    store.processed[op.idempotencyKey] = copyRecord(existing);
    return { kind: "duplicate", record: copyRecord(existing) };
  }

  return { kind: "conflict", remote: copyRecord(existing) };
}

export function listServerRecords(store: ServerStore): ServerRecord[] {
  return Object.keys(store.records)
    .sort()
    .map((id) => copyRecord(store.records[id]));
}
