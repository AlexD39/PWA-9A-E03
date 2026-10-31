/** @type {import('next').NextConfig} */

/**
 * Las cabeceras de seguridad (CSP con nonce, Permissions-Policy y el resto) las aplica
 * `src/middleware.ts` con `src/lib/security/headers.ts`: es la única fuente de verdad.
 *
 *  - `poweredByHeader: false` no anuncia la tecnología del servidor.
 *  - `images.unoptimized: true` desactiva el optimizador de imágenes de Next, que la
 *    aplicación no usa y que acumula avisos de seguridad (ver docs/threat-model.md).
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true }
};

export default nextConfig;
