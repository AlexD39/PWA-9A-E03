import type { Metadata, Viewport } from "next";
import { ServiceWorkerManager } from "../components/service-worker-manager";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Inspecciones de laboratorio",
  title: "Inspecciones de laboratorio",
  description: "Registro de inspecciones y mantenimiento de laboratorios con datos sintéticos.",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" }
    ]
  }
};

/**
 * La CSP lleva un nonce distinto en cada respuesta (`src/middleware.ts`), así que las páginas
 * deben renderizarse en cada petición: una página prerenderizada no podría llevar el nonce de ESA
 * respuesta y la CSP bloquearía sus scripts. Con Next 14.2.35 el middleware con nonce ya vuelve
 * dinámicas todas las rutas (comprobado al compilar sin esta línea); se declara de forma explícita
 * para no depender de ese comportamiento implícito. Ver docs/threat-model.md (control C-02).
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#172b62"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body>
        {children}
        <ServiceWorkerManager />
      </body>
    </html>
  );
}

