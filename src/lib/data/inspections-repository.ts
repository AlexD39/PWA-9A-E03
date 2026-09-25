/**
 * Acceso a datos de inspecciones (Semana 4).
 *
 * Fuente única para la ruta SSR (`src/app/inspecciones/page.tsx`, que la
 * importa directamente) y para la ruta CSR (`src/app/inspecciones/[id]/page.tsx`,
 * que llega a estos mismos datos a través de `src/app/api/inspections/[id]/route.ts`).
 * Ambas rutas comparten el mismo dominio de datos; lo que cambia es dónde se
 * ejecuta el renderizado.
 *
 * `delayMs` simula la latencia de una consulta real (red o base de datos) con
 * un `setTimeout` de verdad, no un valor inventado: por eso el tiempo medido
 * en las páginas es reproducible y verificable. `simulateError` es un gancho
 * de prueba determinista (activado por el query param `fallo=1` en ambas
 * rutas) para ejercitar el estado de error sin depender de un servicio real.
 */

import { inspections, type Inspection } from "./inspections";

export const DEFAULT_DELAY_MS = 350;
export const SIMULATED_ERROR_MESSAGE = "Fallo sintético en la consulta de inspecciones";

export interface RepositoryOptions {
  delayMs?: number;
  simulateError?: boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listInspections(options: RepositoryOptions = {}): Promise<Inspection[]> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  await wait(delayMs);
  if (options.simulateError) {
    throw new Error(SIMULATED_ERROR_MESSAGE);
  }
  return inspections;
}

export async function getInspectionById(
  id: string,
  options: RepositoryOptions = {}
): Promise<Inspection | null> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  await wait(delayMs);
  if (options.simulateError) {
    throw new Error(SIMULATED_ERROR_MESSAGE);
  }
  return inspections.find((inspection) => inspection.id === id) ?? null;
}
