/**
 * Política de seguridad de contenido (CSP) con nonce por petición (Semana 9).
 *
 * Qué hace: construye la cabecera `Content-Security-Policy`. Los scripts solo
 * se ejecutan si son del mismo origen o llevan el nonce de ESA respuesta, así
 * que un fragmento inyectado en la página no se ejecuta aunque llegue a ella.
 * `object-src 'none'`, `base-uri`, `form-action` y `frame-ancestors` cierran
 * vectores que `default-src` no cubre.
 *
 * Decisiones y límites (ver docs/threat-model.md):
 *  - `style-src` conserva `'unsafe-inline'`: las hojas de estilo en línea
 *    (p. ej. `public/offline.html`) no se pueden firmar con un nonce por
 *    petición. El riesgo de inyección de CSS es bajo y menor que el de scripts.
 *  - `'unsafe-eval'` solo existe en desarrollo (recarga en caliente de Next).
 *  - `upgrade-insecure-requests` es opcional: en `http://localhost` el
 *    navegador lo trataría como una promoción a HTTPS que no existe.
 *
 * Es lógica pura, sin dependencias de Next, para poder probarla en Node.
 */

export const NONCE_BYTES = 16;

export interface CspOptions {
  nonce: string;
  /** Solo para `next dev`: habilita `'unsafe-eval'`. */
  development?: boolean;
  /** Añade `upgrade-insecure-requests` (solo tiene sentido tras HTTPS). */
  upgradeInsecure?: boolean;
}

/** Nonce de 128 bits en base64, distinto en cada llamada. `fill` se inyecta en pruebas. */
export function generateNonce(fill?: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  if (fill) fill(bytes);
  else crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Un nonce válido es base64 estándar; cualquier otro carácter podría salirse de la cabecera. */
export function isValidNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{16,64}={0,2}$/.test(value);
}

export function buildCspDirectives(options: CspOptions): Array<[string, string[]]> {
  if (!isValidNonce(options.nonce)) {
    throw new Error("nonce inválido: debe ser base64 de al menos 16 caracteres");
  }
  const scripts = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'"];
  if (options.development) scripts.push("'unsafe-eval'");
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scripts],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]]
  ];
  if (options.upgradeInsecure) directives.push(["upgrade-insecure-requests", []]);
  return directives;
}

export function buildCsp(options: CspOptions): string {
  return buildCspDirectives(options)
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

/** Lee una cabecera CSP como `{ directiva: [valores] }`; sirve a las pruebas y a la revisión manual. */
export function parseCsp(header: string): Record<string, string[]> {
  const parsed: Record<string, string[]> = {};
  header.split(";").forEach((part) => {
    const pieces = part.trim().split(/\s+/);
    if (pieces[0]) parsed[pieces[0].toLowerCase()] = pieces.slice(1);
  });
  return parsed;
}
