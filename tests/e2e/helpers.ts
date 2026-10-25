/**
 * Utilidades compartidas por las pruebas E2E (Semana 8).
 *
 * Las pruebas manejan la interfaz real en un navegador real; estas funciones
 * solo evitan repetir pasos. Los datos son sintéticos y cada prueba empieza de
 * cero: Playwright abre un contexto nuevo (IndexedDB, caché y service worker
 * propios) y `resetServer` vacía el servidor simulado.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export const SYNC_API = "/api/sync/inspections";

export interface ServerState {
  records: Array<{
    id: string;
    serverRevision: number;
    fields: { inspector: string; location: string; summary: string };
  }>;
  processedKeys: number;
}

export async function resetServer(page: Page): Promise<void> {
  const response = await page.request.delete(SYNC_API);
  expect(response.ok()).toBe(true);
}

export async function serverState(page: Page): Promise<ServerState> {
  const response = await page.request.get(SYNC_API);
  expect(response.ok()).toBe(true);
  return (await response.json()) as ServerState;
}

export function heading(page: Page): Locator {
  return page.getByRole("heading", { name: "Nueva inspección" });
}

export async function openCapture(page: Page, query = ""): Promise<void> {
  await page.goto(`/inspecciones/nueva${query}`);
  await expect(heading(page)).toBeVisible();
}

/**
 * Deja la aplicación lista para trabajar sin conexión: espera a que el service
 * worker esté activo y recarga para que esta navegación pase por él y quede en
 * caché. Sin esto, recargar sin red no tendría qué mostrar.
 */
export async function prepareOffline(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

export async function fillInspection(
  page: Page,
  data: { inspector: string; summary?: string }
): Promise<void> {
  await page.getByLabel("Responsable").fill(data.inspector);
  if (data.summary) await page.getByLabel("Resumen").fill(data.summary);
}

export async function saveInspection(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Guardar inspección" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado en este dispositivo" })).toBeVisible();
}

/** Registros listados en el panel de sincronización. */
export function localRecords(page: Page): Locator {
  return page.locator(".sync-record");
}

/** Valor de un contador del panel (`Pendientes`, `Confirmadas`, `Fallidas`, `En el servidor`). */
export function syncStat(page: Page, label: string): Locator {
  return page.locator(".sync-stats > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
}
