/**
 * Middleware de seguridad (Semana 9): aplica las cabeceras de `src/lib/security`
 * a cada respuesta y genera un nonce nuevo por petición para la CSP.
 *
 * Importante: la CSP que llega en la PETICIÓN siempre se sobrescribe con la
 * propia. Next 14.2 toma el nonce de esa cabecera para marcar sus scripts, y un
 * valor controlado por un tercero llegaría así al HTML (aviso GHSA-ffhc-5mcf-pf4q,
 * corregido en 15.5.16). Sobrescribirla es la mitigación documentada; ver
 * docs/threat-model.md.
 */

import { NextResponse, type NextRequest } from "next/server";
import { generateNonce } from "./lib/security/csp";
import { buildSecurityHeaders } from "./lib/security/headers";

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const https =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const headers = buildSecurityHeaders({
    nonce,
    development: process.env.NODE_ENV !== "production",
    upgradeInsecure: process.env.ENFORCE_HTTPS_UPGRADE === "1",
    https
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  Object.keys(headers).forEach((name) => response.headers.set(name, headers[name]));
  return response;
}

/** Todo menos los recursos estáticos con huella (`/_next/static`) y el optimizador de imágenes. */
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
