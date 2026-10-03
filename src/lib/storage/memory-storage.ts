/**
 * Almacenamiento en memoria (Semana 5).
 *
 * Se usa en las pruebas (Node, sin navegador) y como respaldo volátil cuando
 * IndexedDB no está disponible. Clona con JSON al guardar y al leer, igual
 * que la serialización estructurada de IndexedDB: nadie comparte referencias
 * con el almacén, así que una mutación accidental no pasa inadvertida.
 *
 * Una instancia de `MemoryStorage` compartida entre dos colas simula un
 * reinicio de la aplicación: los datos persisten y el estado en memoria de
 * la cola anterior se pierde.
 */

import type { BatchOp, StorageAdapter, StoreName } from "./schema";

export interface MemoryStorage extends StorageAdapter {
  /** Hace que el siguiente `applyBatch` falle sin escribir nada (cuota llena, cierre a mitad de escritura). */
  failNextBatch(error?: Error): void;
  /** Copia profunda del contenido actual, para aserciones. */
  snapshot(): Record<StoreName, Record<string, unknown>>;
  /** Cantidad de lotes aplicados con éxito. */
  batchCount(): number;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function createMemoryStorage(): MemoryStorage {
  const stores: Record<StoreName, Record<string, string>> = {
    records: {},
    outbox: {},
    meta: {}
  };
  let pendingFailure: Error | null = null;
  let batches = 0;

  return {
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      const raw = stores[store][key];
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },

    async getAll<T>(store: StoreName): Promise<T[]> {
      return Object.keys(stores[store]).map((key) => JSON.parse(stores[store][key]) as T);
    },

    async applyBatch(ops: BatchOp[]): Promise<void> {
      if (pendingFailure) {
        const error = pendingFailure;
        pendingFailure = null;
        throw error;
      }
      // Se prepara todo antes de escribir: o se aplican todas las operaciones o ninguna.
      const prepared = ops.map((op) => ({
        op,
        serialized: op.type === "put" ? JSON.stringify(op.value === undefined ? null : op.value) : ""
      }));
      for (const { op, serialized } of prepared) {
        if (op.type === "put") {
          stores[op.store][op.key] = serialized;
        } else {
          delete stores[op.store][op.key];
        }
      }
      batches += 1;
    },

    failNextBatch(error?: Error): void {
      pendingFailure = error ?? new Error("fallo simulado de escritura");
    },

    snapshot(): Record<StoreName, Record<string, unknown>> {
      const result = { records: {}, outbox: {}, meta: {} } as Record<
        StoreName,
        Record<string, unknown>
      >;
      (Object.keys(stores) as StoreName[]).forEach((store) => {
        Object.keys(stores[store]).forEach((key) => {
          result[store][key] = clone(JSON.parse(stores[store][key]));
        });
      });
      return result;
    },

    batchCount(): number {
      return batches;
    }
  };
}
