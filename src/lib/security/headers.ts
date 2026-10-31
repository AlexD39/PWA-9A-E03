/**
 * Cabeceras de seguridad de las respuestas (Semana 9).
 *
 * Una sola fuente de verdad: las aplica `src/middleware.ts` a cada respuesta.
 *
 *  - CSP: ver `csp.ts`.
 *  - `X-Content-Type-Options: nosniff`: el navegador respeta el tipo declarado
 *    (evita que un archivo subido o reflejado se ejecute como script).
 *  - `Referrer-Policy: no-referrer`: la aplicación no necesita decir de dónde
 *    viene la persona; las rutas internas no se filtran a terceros.
 *  - `Permissions-Policy`: mínimo privilegio. Cámara y ubicación solo para este
 *    origen (Semana 6); micrófono y pagos, que no se usan, deshabilitados.
 *  - `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy`: aíslan la
 *    ventana y los recursos de otros orígenes.
 *  - `X-Frame-Options: DENY`: refuerzo heredado de `frame-ancestors 'none'`.
 *  - `X-Robots-Tag`: la herramienta es interna; complementa `public/robots.txt`.
 *  - `Strict-Transport-Security`: solo cuando la petición llegó por HTTPS (en
 *    HTTP el navegador la ignora; emitirla en localhost solo confunde).
 */

import { buildCsp } from "./csp";

export const PERMISSIONS_POLICY = "camera=(self), geolocation=(self), microphone=(), payment=()";
export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

export interface SecurityHeaderOptions {
  nonce: string;
  development?: boolean;
  upgradeInsecure?: boolean;
  /** `true` si la petición llegó por HTTPS. */
  https?: boolean;
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildCsp({
      nonce: options.nonce,
      development: options.development,
      upgradeInsecure: options.upgradeInsecure
    }),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow"
  };
  if (options.https) headers["Strict-Transport-Security"] = HSTS_VALUE;
  return headers;
}
