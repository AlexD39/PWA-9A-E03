/**
 * E2E del flujo crítico (Semana 8): crear → guardar sin conexión → recargar →
 * reconectar → sincronizar sin duplicar, más la variante con una capacidad de
 * dispositivo denegada o ausente.
 *
 * Todo ocurre desde la interfaz, en un navegador real, contra la aplicación
 * compilada. La falta de red es real (`context.setOffline`); los fallos de las
 * APIs del dispositivo se simulan, porque una prueba no puede depender de los
 * permisos físicos de la máquina que la ejecuta.
 */

import { expect, test } from "@playwright/test";
import {
  fillInspection,
  localRecords,
  openCapture,
  prepareOffline,
  resetServer,
  saveInspection,
  serverState,
  syncStat
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetServer(page);
});

test.describe("flujo crítico con desconexión", () => {
  test("crear, guardar sin conexión, recargar, reconectar y sincronizar sin duplicar", async ({ page, context }) => {
    await openCapture(page);
    await prepareOffline(page);

    await context.setOffline(true);
    await fillInspection(page, { inspector: "Persona E2E 01", summary: "Captura sintética hecha sin conexión." });
    await saveInspection(page);

    await expect(localRecords(page)).toHaveCount(1);
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");
    await expect(syncStat(page, "Pendientes")).toHaveText("1");

    // Recargar sin red: la inspección sigue ahí, todavía pendiente.
    await page.reload();
    await expect(localRecords(page)).toHaveCount(1);
    await expect(localRecords(page).first()).toContainText("Persona E2E 01");
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");
    expect((await serverState(page)).records).toHaveLength(0);

    // Vuelve la red: se sincroniza sola, una sola vez.
    await context.setOffline(false);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });
    await expect(syncStat(page, "Pendientes")).toHaveText("0");
    await expect(syncStat(page, "En el servidor")).toHaveText("1");

    // Forzar otra sincronización no crea nada nuevo.
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await expect(page.getByRole("button", { name: "Sincronizar ahora" })).toBeEnabled();

    const state = await serverState(page);
    expect(state.records).toHaveLength(1);
    expect(state.records[0].fields.inspector).toBe("Persona E2E 01");
    expect(state.records[0].serverRevision).toBe(1);
    expect(state.processedKeys).toBe(1);
    await expect(localRecords(page)).toHaveCount(1);
  });

  test("si el servidor aplica la operación pero la respuesta se pierde, el reintento no duplica", async ({ page }) => {
    // `?perder=1` hace que el servidor procese la operación y luego responda 503.
    await openCapture(page, "?perder=1");
    await fillInspection(page, { inspector: "Persona E2E 02" });
    await saveInspection(page);

    await expect.poll(async () => (await serverState(page)).records.length).toBe(1);
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");

    // La persona vuelve a abrir la aplicación sin el gancho de falla.
    await openCapture(page);
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();

    await expect(localRecords(page).first()).toContainText("Sincronizado");
    await expect(page.getByText("El servidor ya lo tenía: duplicado evitado")).toBeVisible();
    const state = await serverState(page);
    expect(state.records).toHaveLength(1);
    expect(state.records[0].serverRevision).toBe(1);
    expect(state.processedKeys).toBe(1);
  });

  test("una captura inválida se rechaza en la interfaz y no se guarda nada", async ({ page }) => {
    await openCapture(page);
    await page.getByRole("button", { name: "Guardar inspección" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "inspector:" })).toBeVisible();
    await expect(localRecords(page)).toHaveCount(0);
    await expect(syncStat(page, "Pendientes")).toHaveText("0");
    expect((await serverState(page)).records).toHaveLength(0);
  });
});

test.describe("capacidad del dispositivo denegada o ausente", () => {
  test("con ubicación y cámara denegadas se explica el motivo y la captura se completa", async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) }
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(Object.assign(new Error("denegado"), { name: "NotAllowedError" })) }
      });
    });
    await openCapture(page);

    await page.getByRole("button", { name: "Agregar ubicación aproximada" }).click();
    await expect(page.getByText("No hay permiso de ubicación")).toBeVisible();
    await page.getByRole("button", { name: "Tomar foto" }).click();
    await expect(page.getByText("No hay permiso para usar la cámara")).toBeVisible();

    await fillInspection(page, { inspector: "Persona E2E 03" });
    await saveInspection(page);
    const saved = page.getByRole("status").filter({ hasText: "Guardado en este dispositivo" });
    await expect(saved).not.toContainText("La evidencia se guardó");
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });

    const state = await serverState(page);
    expect(state.records).toHaveLength(1);
    expect(state.records[0].fields.inspector).toBe("Persona E2E 03");
  });

  test("sin API de cámara ni de ubicación solo se ofrece la alternativa y la captura se completa", async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    });
    await openCapture(page);

    await expect(page.getByRole("button", { name: "Agregar ubicación aproximada" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tomar foto" })).toHaveCount(0);
    await expect(page.getByText("Este navegador no ofrece ubicación.")).toBeVisible();
    await expect(page.getByText("Adjuntar imagen")).toBeVisible();

    await fillInspection(page, { inspector: "Persona E2E 04" });
    await saveInspection(page);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });
    expect((await serverState(page)).records).toHaveLength(1);
  });
});

test.describe("casos adicionales de Alejandro", () => {
  test("editar un registro pendiente sin conexión conserva un registro y aplica la segunda revisión", async ({ page, context }) => {
    await openCapture(page);
    await prepareOffline(page);
    await context.setOffline(true);

    await fillInspection(page, { inspector: "Persona E2E 05", summary: "Resumen original sin conexión." });
    await saveInspection(page);
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");

    await localRecords(page).first().getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Resumen").fill("Resumen editado antes de reconectar.");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Guardado en este dispositivo" })).toBeVisible();

    await context.setOffline(false);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });

    const state = await serverState(page);
    expect(state.records).toHaveLength(1);
    expect(state.records[0].fields.summary).toBe("Resumen editado antes de reconectar.");
    expect(state.records[0].serverRevision).toBe(2);
  });

  test("un fallo temporal del servidor deja pendiente el registro y permite reintentarlo", async ({ page }) => {
    await openCapture(page, "?fallo=1");
    await fillInspection(page, { inspector: "Persona E2E 06" });
    await saveInspection(page);

    await expect(page.getByText("Reintento programado")).toBeVisible();
    await expect(localRecords(page).first()).toContainText("Pendiente de sincronizar");
    expect((await serverState(page)).records).toHaveLength(0);

    await openCapture(page);
    await page.getByRole("button", { name: "Sincronizar ahora" }).click();
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });

    const state = await serverState(page);
    expect(state.records).toHaveLength(1);
    expect(state.processedKeys).toBe(1);
  });

  test("una imagen sintética permanece como evidencia local al volver a editar", async ({ page }) => {
    await openCapture(page);
    const pngBase64 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("El navegador no ofrece un contexto 2D");
      context.fillStyle = "#f97316";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "evidencia-sintetica.png",
      mimeType: "image/png",
      buffer: Buffer.from(pngBase64, "base64")
    });
    await expect(page.getByAltText("Vista previa de la foto adjunta como evidencia")).toBeVisible();

    await fillInspection(page, { inspector: "Persona E2E 07" });
    await saveInspection(page);
    await expect(page.getByRole("status").filter({ hasText: "La evidencia se guardó solo en este dispositivo" })).toBeVisible();

    await localRecords(page).first().getByRole("button", { name: "Editar" }).click();
    await expect(page.getByAltText("Vista previa de la foto adjunta como evidencia")).toBeVisible();
    expect((await serverState(page)).records).toHaveLength(1);
  });
});
