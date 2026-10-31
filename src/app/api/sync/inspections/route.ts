/**
 * API de sincronización simulada (Semana 5, endurecida en la Semana 9).
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
 * Controles de la Semana 9 (src/lib/security/request-guard.ts):
 *   - Rechaza lo marcado `cross-site` y un `Origin` ajeno (403).
 *   - Límite de peticiones por cliente (429 con `Retry-After`).
 *   - Escritura solo `application/json` (415) y con tope de 16 KB (413).
 *
 * Ganchos de prueba manual (SOLO con ENABLE_DEMO_HOOKS=1; sin ella se ignoran
 * y `DELETE` responde 404; ver src/lib/security/demo-hooks.ts):
 *   ?fallo=1   responde 503 sin procesar nada (servidor caído).
 *   ?perder=1  procesa la operación y luego responde 503: la respuesta "se
 *              pierde". Reproduce el caso que exige idempotencia: el cliente
 *              reintenta y el servidor no debe aplicarla dos veces.
 */

import { NextResponse } from "next/server";
import { demoHooksEnabled } from "../../../../lib/security/demo-hooks";
import {
  checkFetchMetadata,
  checkJsonContentType,
  checkOrigin,
  clientKey,
  createRateLimiter,
  readJsonBody,
  type GuardResult
} from "../../../../lib/security/request-guard";
import {
  applyOperation,
  createServerStore,
  listServerRecords,
  type ServerStore
} from "../../../../lib/sync/server-store";

export const dynamic = "force-dynamic";

/** Una operación pesa ~1 KB; 16 KB deja margen y corta cuerpos abusivos. */
const MAX_BODY_BYTES = 16 * 1024;
/** Holgado a propósito: la interfaz consulta el servidor en cada ciclo de sincronización. */
const RATE_LIMIT = { limit: 300, windowMs: 60000 };

const limiter = createRateLimiter(RATE_LIMIT);

type ScopeWithStore = typeof globalThis & { __inspeccionesSyncStore?: ServerStore };

function getStore(): ServerStore {
  const scope = globalThis as ScopeWithStore;
  if (!scope.__inspeccionesSyncStore) scope.__inspeccionesSyncStore = createServerStore();
  return scope.__inspeccionesSyncStore;
}

function unavailable() {
  return NextResponse.json({ status: "unavailable" }, { status: 503 });
}

const REJECTION_TEXT: Record<string, string> = {
  "cross-site-request": "la petición viene de otro sitio",
  "origin-not-allowed": "el origen de la petición no está permitido",
  "unsupported-media-type": "el contenido debe ser application/json",
  "payload-too-large": `el cuerpo excede ${MAX_BODY_BYTES / 1024} KB`,
  "invalid-json": "el cuerpo no es JSON válido"
};

function reject(result: GuardResult) {
  const error = result.error || "rejected";
  return NextResponse.json(
    { status: "rejected", errors: [REJECTION_TEXT[error] || error] },
    { status: result.status || 400 }
  );
}

/** Comprobaciones comunes a todo método: origen y límite de peticiones. */
function guard(request: Request): Response | null {
  const checks = [checkFetchMetadata(request.headers), checkOrigin(request.headers, request.url)];
  for (let i = 0; i < checks.length; i += 1) {
    if (!checks[i].ok) return reject(checks[i]);
  }
  const verdict = limiter.check(clientKey(request.headers));
  if (!verdict.allowed) {
    return NextResponse.json(
      { status: "rate-limited" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } }
    );
  }
  return null;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const hooks = demoHooksEnabled();
  if (hooks && url.searchParams.get("fallo") === "1") return unavailable();

  const blocked = guard(request);
  if (blocked) return blocked;

  const type = checkJsonContentType(request.headers);
  if (!type.ok) return reject(type);

  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) return reject(parsed);
  const body = parsed.value;

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

  if (hooks && url.searchParams.get("perder") === "1" && (result.kind === "applied" || result.kind === "duplicate")) {
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

export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const store = getStore();
  return NextResponse.json({
    records: listServerRecords(store),
    processedKeys: Object.keys(store.processed).length
  });
}

export async function DELETE(request: Request) {
  if (!demoHooksEnabled()) return NextResponse.json({ status: "not-found" }, { status: 404 });
  const blocked = guard(request);
  if (blocked) return blocked;
  (globalThis as ScopeWithStore).__inspeccionesSyncStore = createServerStore();
  return NextResponse.json({ status: "reset" });
}
