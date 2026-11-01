/**
 * E2E de seguridad y privacidad (Semana 9), en un navegador real y contra la aplicación compilada.
 *
 * Lo que las pruebas de Node no pueden demostrar: que el NAVEGADOR aplica la CSP (bloquea un
 * script inyectado), que la CSP no rompe la aplicación (ni siquiera la recarga sin conexión desde
 * el service worker) y que los controles de privacidad llegan a la pantalla.
 */

import { expect, test, type Page } from "@playwright/test";
import { fillInspection, localRecords, openCapture, prepareOffline, resetServer, saveInspection, serverState, syncStat } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetServer(page);
});

/** Reúne los mensajes con que Chromium informa de un bloqueo por la CSP. */
function trackViolations(page: Page): string[] {
  const found: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) found.push(message.text());
  });
  return found;
}

test.describe("cabeceras reales", () => {
  test("las páginas y la API llevan las cabeceras de seguridad", async ({ page }) => {
    const response = await page.goto("/inspecciones/nueva");
    const headers = response ? response.headers() : {};
    const csp = headers["content-security-policy"] || "";

    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+=*' 'strict-dynamic'/);
    expect(csp.split(";").find((part) => part.trim().startsWith("script-src"))).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-powered-by"]).toBeUndefined();

    const api = await page.request.get("/api/sync/inspections");
    expect(api.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("el nonce cambia en cada carga y todos los scripts de la página lo llevan", async ({ page }) => {
    const nonces: string[] = [];
    for (let visit = 0; visit < 2; visit += 1) {
      const response = await page.goto("/inspecciones/nueva");
      const csp = (response ? response.headers() : {})["content-security-policy"] || "";
      const match = /'nonce-([^']+)'/.exec(csp);
      expect(match).not.toBeNull();
      const nonce = (match as RegExpExecArray)[1];
      nonces.push(nonce);
      const unmarked = await page.evaluate((expected) => {
        return Array.from(document.querySelectorAll("script")).filter((script) => script.nonce !== expected).length;
      }, nonce);
      expect(unmarked, "hay scripts sin el nonce de la respuesta").toBe(0);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test("robots.txt y security.txt se publican", async ({ page }) => {
    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("Disallow: /");
    const security = await page.request.get("/.well-known/security.txt");
    expect(security.status()).toBe(200);
    expect(await security.text()).toContain("Contact:");
  });
});

test.describe("la CSP en el navegador", () => {
  test("el flujo crítico completo, incluida la recarga sin conexión, no produce violaciones de CSP", async ({ page, context }) => {
    const violations = trackViolations(page);
    await openCapture(page);
    await prepareOffline(page);
    await context.setOffline(true);
    await fillInspection(page, { inspector: "Persona E2E 09", summary: "Captura sintética bajo CSP." });
    await saveInspection(page);
    await page.reload();
    await expect(localRecords(page)).toHaveCount(1);
    await context.setOffline(false);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });
    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("un controlador de evento inyectado en línea NO se ejecuta (la CSP está activa de verdad)", async ({ page }) => {
    const violations = trackViolations(page);
    await openCapture(page);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", '<img src="x" onerror="window.__inyectado = 1">');
    });
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    const ran = await page.evaluate(() => (window as unknown as { __inyectado?: number }).__inyectado);
    expect(ran).toBeUndefined();
  });
});

test.describe("privacidad", () => {
  test("un dato personal escrito en el resumen se rechaza en pantalla y no se guarda nada", async ({ page }) => {
    await openCapture(page);
    await fillInspection(page, { inspector: "Persona E2E 10", summary: "Llamar a persona.prueba@ejemplo.org" });
    await page.getByRole("button", { name: "Guardar inspección" }).click();

    const alert = page.getByRole("alert").filter({ hasText: "contiene un dato personal" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("correo electrónico");
    await expect(alert).not.toContainText("persona.prueba@ejemplo.org");
    await expect(localRecords(page)).toHaveCount(0);
    expect((await serverState(page)).records).toHaveLength(0);
  });

  test("«Borrar datos de este dispositivo» vacía el almacenamiento local y la copia del servidor queda", async ({ page }) => {
    await openCapture(page);
    await fillInspection(page, { inspector: "Persona E2E 11" });
    await saveInspection(page);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });

    await page.goto("/privacidad");
    await expect(page.getByRole("heading", { name: "Aviso de privacidad simplificado" })).toBeVisible();
    await page.getByRole("button", { name: "Borrar datos de este dispositivo" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("no se puede deshacer");
    await page.getByRole("button", { name: "Sí, borrar todo" }).click();
    await expect(page.getByText("Listo: los datos de este dispositivo se borraron.")).toBeVisible();
    await expect(page.getByText("Base de datos local: borrada")).toBeVisible();

    const cachesLeft = await page.evaluate(async () => (await caches.keys()).filter((name) => name.indexOf("inspecciones-lab-") === 0).length);
    expect(cachesLeft).toBe(0);

    await page.goto("/inspecciones/nueva");
    await expect(localRecords(page)).toHaveCount(0);
    await expect(syncStat(page, "Pendientes")).toHaveText("0");
    expect((await serverState(page)).records).toHaveLength(1);
  });

  test("cancelar el borrado no elimina nada", async ({ page }) => {
    await openCapture(page);
    await fillInspection(page, { inspector: "Persona E2E 12" });
    await saveInspection(page);
    await page.goto("/privacidad");
    await page.getByRole("button", { name: "Borrar datos de este dispositivo" }).click();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("button", { name: "Borrar datos de este dispositivo" })).toBeVisible();
    await page.goto("/inspecciones/nueva");
    await expect(localRecords(page)).toHaveCount(1);
  });
});

test.describe("casos propios de Alejandro", () => {
  test("una ruta inexistente también lleva la CSP", async ({ page }) => {
    const response = await page.goto("/no-existe");
    expect(response).not.toBeNull();
    expect(response && response.status()).toBe(404);
    expect((response ? response.headers()["content-security-policy"] : "") || "").toContain("script-src");
  });

  test("la API rechaza un Origin ajeno sin guardar y acepta la misma operación sin ese Origin", async ({ page }) => {
    const operation = {
      idempotencyKey: "op-e2e-origin-01",
      recordId: "insp-e2e-origin-01",
      fields: {
        location: "Laboratorio sintético A",
        date: "2026-10-20",
        inspector: "Persona E2E 13",
        status: "ok",
        findings: 0,
        summary: "Operación sintética para comprobar el origen."
      },
      baseServerRevision: 0,
      updatedAt: "2026-10-20T15:00:00.000Z"
    };

    const rejected = await page.request.post("/api/sync/inspections", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: operation
    });
    expect(rejected.status()).toBe(403);
    expect((await serverState(page)).records).toHaveLength(0);

    const accepted = await page.request.post("/api/sync/inspections", { data: operation });
    expect(accepted.status()).toBe(200);
    expect((await serverState(page)).records).toHaveLength(1);
  });

  test("la evidencia sintética permanece en el dispositivo y nunca llega al servidor", async ({ page }) => {
    await openCapture(page);
    const pngBase64 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("El navegador no ofrece un contexto 2D");
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "evidencia-seguridad.png",
      mimeType: "image/png",
      buffer: Buffer.from(pngBase64, "base64")
    });
    await expect(page.getByAltText("Vista previa de la foto adjunta como evidencia")).toBeVisible();

    await fillInspection(page, { inspector: "Persona E2E 14" });
    await saveInspection(page);
    await expect(localRecords(page).first()).toContainText("Sincronizado", { timeout: 20_000 });

    const serialized = JSON.stringify(await serverState(page));
    expect(serialized).toContain("Persona E2E 14");
    expect(serialized).not.toContain("data:image");
  });
});
