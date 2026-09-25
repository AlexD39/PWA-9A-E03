/**
 * Lógica de obtención de datos para la ruta CSR (Semana 4).
 *
 * Extraída fuera del componente React para que sea una función pura,
 * inyectable y comprobable sin renderizar nada: el mismo patrón usado en
 * `src/lib/pwa/register-service-worker.ts` (Semana 3). El componente cliente
 * `src/app/inspecciones/[id]/page.tsx` es una envoltura delgada que solo
 * traduce el resultado a estados de UI.
 *
 * Nunca lanza: cualquier fallo de red o de servidor se resuelve como
 * `{ status: "error" }`, igual que el registro del service worker nunca
 * lanza hacia quien lo llama.
 */

export interface Inspection {
  id: string;
  location: string;
  date: string;
  inspector: string;
  status: "ok" | "attention";
  statusLabel: string;
  findings: number;
  summary: string;
}

export type FetchInspectionResult =
  | { status: "ok"; inspection: Inspection; fetchedMs: number }
  | { status: "not-found" }
  | { status: "error"; message: string };

export interface FetchInspectionOptions {
  /** Implementación de `fetch` a usar; por defecto `globalThis.fetch`. Inyectable para pruebas. */
  fetchImpl?: typeof fetch;
  /** Añade `?fallo=1` a la URL para forzar una respuesta 500 determinista. */
  simulateError?: boolean;
  /** Reloj inyectable para medir `fetchedMs` de forma determinista en pruebas. */
  now?: () => number;
}

export function buildInspectionUrl(id: string, simulateError = false): string {
  const encoded = encodeURIComponent(id);
  return simulateError ? `/api/inspections/${encoded}?fallo=1` : `/api/inspections/${encoded}`;
}

export async function fetchInspectionClient(
  id: string,
  options: FetchInspectionOptions = {}
): Promise<FetchInspectionResult> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  const now = options.now ?? Date.now;
  const url = buildInspectionUrl(id, options.simulateError);

  if (!fetchImpl) {
    return { status: "error", message: "fetch no está disponible en este entorno" };
  }

  const startedAt = now();
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (response.status === 404) {
      return { status: "not-found" };
    }
    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { inspection?: Inspection };
    if (!data.inspection) {
      return { status: "error", message: "Respuesta sin campo inspection" };
    }
    return { status: "ok", inspection: data.inspection, fetchedMs: now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}
