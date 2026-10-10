/** @type {import('next').NextConfig} */
/**
 * Permisos mínimos (Semana 6): la política de permisos habilita la cámara y la
 * ubicación solo para este mismo origen (no para iframes de terceros) y
 * deshabilita el micrófono y los pagos, que la aplicación no usa.
 */
const permissionsPolicy = "camera=(self), geolocation=(self), microphone=(), payment=()";

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Permissions-Policy", value: permissionsPolicy }]
      }
    ];
  }
};

export default nextConfig;

