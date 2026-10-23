/**
 * Configuración de las pruebas E2E con Playwright (Semana 8).
 *
 * Las pruebas se ejecutan contra la aplicación COMPILADA (`next build` +
 * `next start`): el service worker solo se registra en producción, y el flujo
 * "recargar sin conexión" depende de él. Por eso el servidor se arranca con
 * `npm run start`, no con `next dev`; hay que compilar antes (`npm run build`).
 *
 * Variables opcionales:
 *   E2E_PORT              puerto del servidor (3100 por omisión).
 *   E2E_BROWSER_CHANNEL   usa un navegador ya instalado ("msedge", "chrome") en
 *                         lugar del Chromium que descarga Playwright. Útil en
 *                         Windows sin ejecutar `npx playwright install`.
 *
 * Un solo worker y sin paralelismo: el servidor simulado guarda sus registros
 * en memoria del proceso, así que dos pruebas a la vez se verían entre sí.
 * Cada prueba abre un contexto nuevo (IndexedDB, caché y service worker
 * aislados) y reinicia el servidor con DELETE /api/sync/inspections.
 */

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 3100);
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "reports/junit-e2e.xml" }],
    ["json", { outputFile: "reports/e2e-results.json" }]
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel } }],
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: baseURL,
    // Nunca se reutiliza un servidor ya abierto: uno viejo (con otra compilación) daría resultados falsos.
    reuseExistingServer: false,
    timeout: 120_000
  }
});
