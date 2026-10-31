/**
 * Ciclo de vida de los datos locales (Semana 9): borrar lo que este dispositivo guardó.
 *
 * La aplicación guarda en el navegador de cada persona: las inspecciones, su
 * cola de sincronización y la evidencia opcional (IndexedDB), la preferencia de
 * avisos (localStorage) y las páginas para uso sin conexión (Cache Storage).
 * Quien usa el dispositivo debe poder eliminarlo todo (derecho de cancelación,
 * minimización y límite de conservación) sin depender de nadie.
 *
 * `purgeLocalData` nunca lanza: cada paso informa su resultado y sigue con el
 * siguiente. Todo es inyectable para probarlo en Node sin navegador.
 *
 * Límites: no revoca permisos del navegador (cámara, ubicación y avisos: eso solo
 * lo hace la persona en la configuración del sitio) ni borra copias que ya llegaron
 * al servidor simulado (un despliegue real necesitaría un canal para ejercer ese
 * derecho; ver docs/privacy-data-inventory.md).
 */

import { DB_NAME } from "../storage/schema";

export const CACHE_PREFIX = "inspecciones-lab-";
export const PREFERENCE_KEYS = ["avisos-del-sistema"];
const DELETE_TIMEOUT_MS = 5000;

export interface PurgeDeps {
  dbName?: string;
  /** `null` si el navegador no ofrece IndexedDB. */
  deleteDatabase?: ((name: string) => Promise<void>) | null;
  /** `null` si no hay `localStorage` disponible. */
  removePreference?: ((key: string) => void) | null;
  /** `null` si no hay Cache Storage. */
  listCaches?: (() => Promise<string[]>) | null;
  deleteCache?: ((name: string) => Promise<boolean>) | null;
}

export type PurgeStep = "deleted" | "unavailable" | "error";

export interface PurgeReport {
  database: PurgeStep;
  preferences: number;
  caches: number;
  errors: string[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Dependencias del navegador. Se calculan al llamar, no al importar (el módulo también corre en Node). */
export function browserPurgeDeps(): PurgeDeps {
  return {
    deleteDatabase:
      typeof indexedDB === "undefined"
        ? null
        : (name) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("el borrado de IndexedDB sigue bloqueado por otra pestaña")),
                DELETE_TIMEOUT_MS
              );
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => {
                clearTimeout(timer);
                resolve();
              };
              request.onerror = () => {
                clearTimeout(timer);
                reject(request.error || new Error("no se pudo borrar IndexedDB"));
              };
              // `onblocked` no es un fallo: el borrado termina cuando las demás pestañas cierran su conexión.
            }),
    removePreference:
      typeof localStorage === "undefined" ? null : (key) => localStorage.removeItem(key),
    listCaches: typeof caches === "undefined" ? null : () => caches.keys(),
    deleteCache: typeof caches === "undefined" ? null : (name) => caches.delete(name)
  };
}

export async function purgeLocalData(deps: PurgeDeps = browserPurgeDeps()): Promise<PurgeReport> {
  const report: PurgeReport = { database: "unavailable", preferences: 0, caches: 0, errors: [] };

  if (deps.deleteDatabase) {
    try {
      await deps.deleteDatabase(deps.dbName || DB_NAME);
      report.database = "deleted";
    } catch (error) {
      report.database = "error";
      report.errors.push(`IndexedDB: ${message(error)}`);
    }
  }

  if (deps.removePreference) {
    PREFERENCE_KEYS.forEach((key) => {
      try {
        deps.removePreference?.(key);
        report.preferences += 1;
      } catch (error) {
        report.errors.push(`preferencias: ${message(error)}`);
      }
    });
  }

  if (deps.listCaches && deps.deleteCache) {
    try {
      const names = (await deps.listCaches()).filter((name) => name.indexOf(CACHE_PREFIX) === 0);
      for (let i = 0; i < names.length; i += 1) {
        try {
          if (await deps.deleteCache(names[i])) report.caches += 1;
        } catch (error) {
          report.errors.push(`caché ${names[i]}: ${message(error)}`);
        }
      }
    } catch (error) {
      report.errors.push(`caché: ${message(error)}`);
    }
  }

  return report;
}
