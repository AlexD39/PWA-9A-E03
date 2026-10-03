/**
 * Cableado de la cola de sincronización en el navegador (Semana 5).
 *
 * Crea una única cola por pestaña sobre IndexedDB (o memoria volátil si el
 * navegador no la ofrece) y la mantiene sincronizando: al volver la red, al
 * volver a la pestaña visible y cada pocos segundos.
 *
 * Al arrancar se llama a `recover({ force: true })`: si la pestaña anterior se
 * cerró con una operación en vuelo, se reenvía de inmediato en lugar de esperar
 * a que venza su lease. Es seguro aunque otra pestaña siga viva, porque el
 * reenvío lleva la misma clave de idempotencia y el servidor deduplica.
 */

import { createIndexedDbStorage, isIndexedDbAvailable } from "../storage/indexeddb-storage";
import { createMemoryStorage } from "../storage/memory-storage";
import { ensureSchema } from "../storage/schema";
import { createSyncQueue, type SyncQueue } from "./queue";
import { createHttpTransport } from "./transport";

export interface SyncRuntime {
  queue: SyncQueue;
  /** `false` si se usa memoria volátil: los datos no sobreviven a cerrar la pestaña. */
  persistent: boolean;
  /** Mensaje si el esquema local es incompatible; la captura no debe usarse en ese caso. */
  schemaError: string | null;
}

const FORWARDED_PARAMS = ["fallo", "perder"];

function forwardedQuery(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return FORWARDED_PARAMS.filter((name) => params.get(name) === "1")
    .map((name) => `${name}=1`)
    .join("&");
}

let runtime: Promise<SyncRuntime> | null = null;

async function createRuntime(): Promise<SyncRuntime> {
  const persistent = isIndexedDbAvailable();
  const storage = persistent ? createIndexedDbStorage() : createMemoryStorage();

  let schemaError: string | null = null;
  try {
    const check = await ensureSchema(storage);
    if (!check.ok) schemaError = check.error;
  } catch (error) {
    schemaError = error instanceof Error ? error.message : String(error);
  }

  const queue = createSyncQueue({
    storage,
    transport: createHttpTransport({ query: forwardedQuery() })
  });
  if (schemaError === null) await queue.recover({ force: true });
  return { queue, persistent, schemaError };
}

export function getSyncRuntime(): Promise<SyncRuntime> {
  if (!runtime) runtime = createRuntime();
  return runtime;
}

export interface AutoSyncOptions {
  intervalMs?: number;
}

/** Mantiene la cola sincronizando. Devuelve la función que detiene todo. */
export function startAutoSync(queue: SyncQueue, options: AutoSyncOptions = {}): () => void {
  const intervalMs = options.intervalMs === undefined ? 10000 : options.intervalMs;
  const syncDue = () => {
    void queue.flush();
  };
  const syncNow = () => {
    void queue.flush({ ignoreBackoff: true });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") syncDue();
  };

  window.addEventListener("online", syncNow);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(syncDue, intervalMs);
  syncDue();

  return () => {
    window.removeEventListener("online", syncNow);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
