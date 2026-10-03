/**
 * Almacenamiento persistente sobre IndexedDB (Semana 5).
 *
 * Implementa `StorageAdapter` para el navegador. Los datos sobreviven al
 * cierre de la pestaña y al reinicio del navegador, que es lo que permite
 * guardar inspecciones sin conexión. `applyBatch` usa una sola transacción
 * de escritura sobre todos los almacenes implicados: IndexedDB garantiza que
 * se confirma completa o se revierte completa.
 *
 * Este adaptador no se ejecuta en Node (no hay IndexedDB), así que no lo
 * cubren las pruebas automatizadas; se verifica en un navegador real. Ver
 * docs/sync-policy.md, sección de límites.
 */

import {
  CURRENT_SCHEMA_VERSION,
  DB_NAME,
  STORE_NAMES,
  type BatchOp,
  type StorageAdapter,
  type StoreName
} from "./schema";

export interface IndexedDbStorageOptions {
  dbName?: string;
  factory?: IDBFactory;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("error de IndexedDB"));
  });
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): StorageAdapter {
  const factory = options.factory ?? indexedDB;
  const dbName = options.dbName ?? DB_NAME;
  let opened: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (opened) return opened;
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, CURRENT_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        STORE_NAMES.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("no se pudo abrir IndexedDB"));
      request.onblocked = () => reject(new Error("apertura de IndexedDB bloqueada por otra pestaña"));
    });
    // Si la apertura falla, el siguiente intento vuelve a abrir en lugar de heredar el rechazo.
    opened.catch(() => {
      opened = null;
    });
    return opened;
  }

  return {
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      const db = await open();
      const tx = db.transaction(store, "readonly");
      return requestToPromise(tx.objectStore(store).get(key)) as Promise<T | undefined>;
    },

    async getAll<T>(store: StoreName): Promise<T[]> {
      const db = await open();
      const tx = db.transaction(store, "readonly");
      return requestToPromise(tx.objectStore(store).getAll()) as Promise<T[]>;
    },

    async applyBatch(ops: BatchOp[]): Promise<void> {
      if (ops.length === 0) return;
      const db = await open();
      const storeNames = Array.from(new Set(ops.map((op) => op.store)));
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeNames, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("transacción de IndexedDB fallida"));
        tx.onabort = () => reject(tx.error ?? new Error("transacción de IndexedDB abortada"));
        ops.forEach((op) => {
          const objectStore = tx.objectStore(op.store);
          if (op.type === "put") objectStore.put(op.value, op.key);
          else objectStore.delete(op.key);
        });
      });
    }
  };
}
