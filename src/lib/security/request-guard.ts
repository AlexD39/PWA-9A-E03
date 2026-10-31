/**
 * Guardián de peticiones para las rutas de la API (Semana 9).
 *
 * La API no tiene sesión ni credenciales: cualquier página de otro origen podría
 * intentar escribir en ella desde el navegador de una persona. Estas comprobaciones
 * son de defensa en profundidad (el navegador ya bloquea las lecturas entre
 * orígenes porque no se habilita CORS):
 *
 *  - `checkFetchMetadata`: rechaza lo que el navegador marca como `cross-site`.
 *  - `checkOrigin`: si llega `Origin`, debe ser el de esta misma aplicación.
 *  - `checkJsonContentType`: una escritura debe ser `application/json`; un
 *    formulario de otro sitio no puede enviar ese tipo sin una petición previa
 *    de comprobación (preflight) que esta API no autoriza.
 *  - `readJsonBody`: lee con tope de bytes, aunque el cuerpo llegue por partes.
 *  - `createRateLimiter`: límite por ventana fija para frenar abusos; vive en
 *    memoria de la instancia (ver docs/threat-model.md, riesgos residuales).
 *
 * Las peticiones sin `Origin` ni `Sec-Fetch-Site` (curl, pruebas en Node, otros
 * servidores) se aceptan: no son un navegador y no hay credenciales ambientales
 * que abusar. Todo es puro y recibe `Headers`/`Request`, así que se prueba en Node.
 */

export interface GuardFailure {
  ok: false;
  status: number;
  error: string;
  /** Opcional con `undefined` para poder leer `.value` de un `BodyResult` sin estrechar la unión. */
  value?: undefined;
}

/** `status`/`error` opcionales con `undefined` permiten leerlos aunque el compilador no estreche la unión. */
export type GuardResult = { ok: true; status?: undefined; error?: undefined } | GuardFailure;

const PASS: GuardResult = { ok: true };

export function checkFetchMetadata(headers: Headers): GuardResult {
  if (headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, status: 403, error: "cross-site-request" };
  }
  return PASS;
}

export function checkOrigin(headers: Headers, requestUrl: string): GuardResult {
  const origin = headers.get("origin");
  if (origin === null) return PASS;
  try {
    if (new URL(origin).host === new URL(requestUrl).host) return PASS;
  } catch {
    /* un Origin ilegible se trata como no permitido */
  }
  return { ok: false, status: 403, error: "origin-not-allowed" };
}

export function checkJsonContentType(headers: Headers): GuardResult {
  const type = (headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type === "application/json") return PASS;
  return { ok: false, status: 415, error: "unsupported-media-type" };
}

export type BodyResult =
  | { ok: true; value: unknown; status?: undefined; error?: undefined }
  | GuardFailure;

/** Lee y analiza un cuerpo JSON sin pasar de `maxBytes`, aunque no declare su tamaño. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "payload-too-large" };
  }
  if (!request.body) return { ok: false, status: 400, error: "invalid-json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, error: "payload-too-large" };
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(joined)) };
  } catch {
    return { ok: false, status: 400, error: "invalid-json" };
  }
}

/* ---------- Límite de peticiones ---------- */

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateVerdict;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Tope de claves distintas en memoria: evita que el propio limitador crezca sin límite. */
  maxKeys?: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now || Date.now;
  const maxKeys = options.maxKeys === undefined ? 1000 : options.maxKeys;
  let windows: Record<string, { count: number; resetAt: number }> = {};
  let keys = 0;

  function purgeExpired(at: number): void {
    const next: Record<string, { count: number; resetAt: number }> = {};
    keys = 0;
    Object.keys(windows).forEach((key) => {
      if (windows[key].resetAt > at) {
        next[key] = windows[key];
        keys += 1;
      }
    });
    windows = next;
  }

  return {
    check(key: string): RateVerdict {
      const at = now();
      let entry = windows[key];
      if (!entry || entry.resetAt <= at) {
        if (!entry && keys >= maxKeys) {
          purgeExpired(at);
          if (keys >= maxKeys) {
            windows = {};
            keys = 0;
          }
        }
        if (!windows[key]) keys += 1;
        entry = { count: 0, resetAt: at + options.windowMs };
        windows[key] = entry;
      }
      entry.count += 1;
      const allowed = entry.count <= options.limit;
      return {
        allowed,
        remaining: Math.max(0, options.limit - entry.count),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - at) / 1000))
      };
    }
  };
}

/**
 * Identifica a quien llama. `X-Forwarded-For` solo es confiable si hay un proxy propio delante
 * que lo reescribe; sin él, quien llama puede falsearlo (ver docs/threat-model.md).
 */
export function clientKey(headers: Headers): string {
  const forwarded = (headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const key = forwarded || (headers.get("x-real-ip") || "").trim() || "desconocido";
  return key.slice(0, 64);
}
