/**
 * API de sincronización simulada (Semana 5).
 *
 * Contraparte sintética del servidor: expone `applyOperation`
 * (src/lib/sync/server-store.ts) por HTTP. El almacén vive en memoria del
 * proceso, así que se pierde al reiniciar el servidor; es intencional, no hay
 * base de datos real en este proyecto. Se guarda en `globalThis` para que
 * sobreviva a la recarga en caliente de `next dev`.
 *
 *   POST    aplica una operación. 200 applied/duplicate, 409 conflict,
 *           422 rejected, 400 JSON inválido.
 *   GET     lista los registros del servidor (para verificar y para el panel).
 *   DELETE  reinicia el almacén (gancho de demostración).
 *
 * Ganchos de prueba manual, en la misma línea de `?fallo=1` de la Semana 4:
 *   ?fallo=1   responde 503 sin procesar nada (servidor caído).
 *   ?perder=1  procesa la operación y luego responde 503: la respuesta "se
 *              pierde". Reproduce el caso que exige idempotencia: el cliente
 *              reintenta y el servidor no debe aplicarla dos veces.
 */

import { NextResponse } from "next/server";
import {
  applyOperation,
  createServerStore,
  listServerRecords,
  type ServerStore
} from "../../../../lib/sync/server-store";

export const dynamic = "force-dynamic";

type ScopeWithStore = typeof globalThis & { __inspeccionesSyncStore?: ServerStore };

function getStore(): ServerStore {
  const scope = globalThis as ScopeWithStore;
  if (!scope.__inspeccionesSyncStore) scope.__inspeccionesSyncStore = createServerStore();
  return scope.__inspeccionesSyncStore;
}

function unavailable() {
  return NextResponse.json({ status: "unavailable" }, { status: 503 });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("fallo") === "1") return unavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "rejected", errors: ["el cuerpo no es JSON válido"] }, { status: 400 });
  }

  const headerKey = request.headers.get("Idempotency-Key");
  const bodyKey =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).idempotencyKey : undefined;
  if (headerKey !== null && headerKey !== bodyKey) {
    return NextResponse.json(
      { status: "rejected", errors: ["la cabecera Idempotency-Key no coincide con el cuerpo"] },
      { status: 422 }
    );
  }

  const result = applyOperation(getStore(), body);

  if (url.searchParams.get("perder") === "1" && (result.kind === "applied" || result.kind === "duplicate")) {
    return unavailable();
  }

  switch (result.kind) {
    case "applied":
      return NextResponse.json({ status: "applied", record: result.record });
    case "duplicate":
      return NextResponse.json(
        { status: "duplicate", record: result.record },
        { headers: { "Idempotent-Replay": "true" } }
      );
    case "conflict":
      return NextResponse.json({ status: "conflict", remote: result.remote }, { status: 409 });
    default:
      return NextResponse.json({ status: "rejected", errors: result.errors }, { status: 422 });
  }
}

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    records: listServerRecords(store),
    processedKeys: Object.keys(store.processed).length
  });
}

export async function DELETE() {
  (globalThis as ScopeWithStore).__inspeccionesSyncStore = createServerStore();
  return NextResponse.json({ status: "reset" });
}
