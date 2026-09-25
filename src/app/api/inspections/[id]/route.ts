/**
 * Route Handler que respalda la ruta CSR (Semana 4).
 *
 * Corre en el servidor, pero solo entrega JSON: el HTML se construye en el
 * cliente (`src/app/inspecciones/[id]/page.tsx` vía
 * `src/lib/rendering/fetch-inspection-client.ts`). Usa el mismo repositorio
 * que la ruta SSR (`src/lib/data/inspections-repository.ts`), así que ambas
 * rutas comparten el dominio de datos y su latencia característica.
 *
 * `?fallo=1` fuerza un 500 determinista para probar el estado de error sin
 * depender de un servicio externo.
 */

import { NextResponse } from "next/server";
import { getInspectionById, SIMULATED_ERROR_MESSAGE } from "../../../../lib/data/inspections-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const simulateError = url.searchParams.get("fallo") === "1";

  try {
    const inspection = await getInspectionById(params.id, { simulateError });
    if (!inspection) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ inspection });
  } catch (error) {
    const message = error instanceof Error ? error.message : SIMULATED_ERROR_MESSAGE;
    return NextResponse.json({ error: "server-error", message }, { status: 500 });
  }
}
