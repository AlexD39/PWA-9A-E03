/**
 * Pruebas de seguridad y privacidad (Semana 9).
 *
 * Cada control tiene al menos un caso HOSTIL: una entrada pensada para romperlo. Si alguien
 * quita o debilita el control, la prueba correspondiente falla. Todo es determinista y usa datos
 * sintéticos; ninguna prueba depende de la red ni de servicios externos.
 *
 * Mapa de controles (ver docs/threat-model.md):
 *   C-01 cabeceras de seguridad        C-02 CSP con nonce       C-03 middleware (sobrescribe la CSP)
 *   C-04 guardián de peticiones        C-05 ganchos apagados    C-06 minimización de datos personales
 *   C-07 saneamiento de texto          C-08 rutas internas      C-09 borrado de datos locales
 *   C-10 robots, security.txt y configuración     C-11 sin credenciales en el repositorio
 *
 * Nota sobre el análisis de credenciales: el chequeo público del curso busca ciertas palabras en
 * todo el repositorio. Aquí se arman POR PARTES para que este archivo no las contenga literalmente.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import vm from "node:vm";
import { NextRequest } from "next/server";
import { middleware, config as middlewareConfig } from "../src/middleware";
import { buildCsp, buildCspDirectives, generateNonce, isValidNonce, parseCsp } from "../src/lib/security/csp";
import { HSTS_VALUE, PERMISSIONS_POLICY, buildSecurityHeaders } from "../src/lib/security/headers";
import {
  checkFetchMetadata,
  checkJsonContentType,
  checkOrigin,
  clientKey,
  createRateLimiter,
  readJsonBody
} from "../src/lib/security/request-guard";
import { demoHooksEnabled } from "../src/lib/security/demo-hooks";
import {
  describePersonalData,
  findPersonalData,
  luhnValid,
  redactPersonalData
} from "../src/lib/security/privacy";
import { hasHiddenCharacters, sanitizeText } from "../src/lib/security/text";
import { isSafeInternalPath, safeInternalPath } from "../src/lib/security/safe-url";
import { CACHE_PREFIX, PREFERENCE_KEYS, purgeLocalData } from "../src/lib/security/data-lifecycle";
import { createNotifier, DEFAULT_TARGET_URL } from "../src/lib/notifications/client";
import { validateInspectionFields } from "../src/lib/storage/schema";
import { DELETE, GET, POST } from "../src/app/api/sync/inspections/route";
import { getInspectionById, listInspections } from "../src/lib/data/inspections-repository";
import { validFields, wireOperation } from "./fixtures/inspections";

const ROOT = process.cwd();
const BASE = "http://localhost/api/sync/inspections";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA==";

function withHooks<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.ENABLE_DEMO_HOOKS;
  if (value === undefined) delete process.env.ENABLE_DEMO_HOOKS;
  else process.env.ENABLE_DEMO_HOOKS = value;
  return run().finally(() => {
    if (previous === undefined) delete process.env.ENABLE_DEMO_HOOKS;
    else process.env.ENABLE_DEMO_HOOKS = previous;
  });
}

function write(headers: Record<string, string>, body: unknown, query = ""): Request {
  return new Request(`${BASE}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

/* ---------- C-02 CSP ---------- */

describe("C-02 CSP con nonce", () => {
  it("el nonce es base64 de 128 bits y distinto en cada llamada", () => {
    const seen: Record<string, true> = {};
    for (let i = 0; i < 200; i += 1) {
      const nonce = generateNonce();
      assert.ok(isValidNonce(nonce), `nonce inválido: ${nonce}`);
      assert.equal(nonce.length, 24);
      assert.equal(seen[nonce], undefined, "el nonce se repitió");
      seen[nonce] = true;
    }
  });

  it("rechaza un nonce que pudiera salirse de la cabecera (inyección de directivas)", () => {
    const hostile = ["abc\"; script-src *", "a b", "x'; default-src *;", "corto", "AAAAAAAAAAAAAAAA\r\nSet-Cookie: x=1", ""];
    hostile.forEach((nonce) => {
      assert.equal(isValidNonce(nonce), false, `debió rechazar ${JSON.stringify(nonce)}`);
      assert.throws(() => buildCsp({ nonce }), /nonce inválido/);
    });
  });

  it("los scripts solo se permiten del mismo origen o con el nonce, nunca en línea", () => {
    const csp = parseCsp(buildCsp({ nonce: NONCE }));
    assert.deepEqual(csp["script-src"], ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    assert.equal(csp["script-src"].indexOf("'unsafe-inline'"), -1);
    assert.equal(csp["script-src"].indexOf("'unsafe-eval'"), -1);
  });

  it("cierra los vectores que default-src no cubre", () => {
    const csp = parseCsp(buildCsp({ nonce: NONCE }));
    assert.deepEqual(csp["default-src"], ["'self'"]);
    assert.deepEqual(csp["object-src"], ["'none'"]);
    assert.deepEqual(csp["base-uri"], ["'self'"]);
    assert.deepEqual(csp["form-action"], ["'self'"]);
    assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
    assert.deepEqual(csp["frame-src"], ["'none'"]);
    assert.deepEqual(csp["connect-src"], ["'self'"]);
    assert.deepEqual(csp["worker-src"], ["'self'"]);
  });

  it("ninguna directiva admite comodines ni orígenes externos", () => {
    buildCspDirectives({ nonce: NONCE }).forEach(([name, values]) => {
      values.forEach((value) => {
        assert.ok(!/^\*$|^https?:|\/\//.test(value), `${name} admite ${value}`);
      });
    });
  });

  it("'unsafe-eval' solo existe en desarrollo y upgrade-insecure-requests solo si se pide", () => {
    assert.ok(parseCsp(buildCsp({ nonce: NONCE, development: true }))["script-src"].indexOf("'unsafe-eval'") !== -1);
    assert.equal("upgrade-insecure-requests" in parseCsp(buildCsp({ nonce: NONCE })), false);
    assert.equal("upgrade-insecure-requests" in parseCsp(buildCsp({ nonce: NONCE, upgradeInsecure: true })), true);
  });
});

/* ---------- C-01 Cabeceras ---------- */

describe("C-01 cabeceras de seguridad", () => {
  const headers = buildSecurityHeaders({ nonce: NONCE });

  it("incluye las cabeceras esperadas con sus valores", () => {
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
    assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
    assert.equal(headers["X-Robots-Tag"], "noindex, nofollow");
    assert.ok(headers["Content-Security-Policy"].indexOf(`'nonce-${NONCE}'`) !== -1);
  });

  it("Permissions-Policy: cámara y ubicación solo del mismo origen; micrófono y pagos deshabilitados", () => {
    assert.equal(headers["Permissions-Policy"], PERMISSIONS_POLICY);
    assert.match(PERMISSIONS_POLICY, /camera=\(self\)/);
    assert.match(PERMISSIONS_POLICY, /geolocation=\(self\)/);
    assert.match(PERMISSIONS_POLICY, /microphone=\(\)/);
    assert.match(PERMISSIONS_POLICY, /payment=\(\)/);
  });

  it("HSTS solo se emite cuando la petición llegó por HTTPS", () => {
    assert.equal("Strict-Transport-Security" in headers, false);
    assert.equal(buildSecurityHeaders({ nonce: NONCE, https: true })["Strict-Transport-Security"], HSTS_VALUE);
    assert.match(HSTS_VALUE, /max-age=31536000/);
  });

  it("ningún valor de cabecera contiene saltos de línea", () => {
    Object.keys(headers).forEach((name) => assert.ok(!/[\r\n]/.test(headers[name]), name));
  });
});

/* ---------- C-03 Middleware ---------- */

describe("C-03 middleware", () => {
  function run(extra: Record<string, string> = {}, url = "http://localhost:3000/inspecciones") {
    return middleware(new NextRequest(url, { headers: extra }));
  }

  it("aplica CSP y cabeceras de seguridad a la respuesta", () => {
    const response = run();
    const csp = response.headers.get("content-security-policy") || "";
    assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("permissions-policy"), PERMISSIONS_POLICY);
  });

  it("genera un nonce distinto en cada petición", () => {
    const first = run().headers.get("content-security-policy");
    const second = run().headers.get("content-security-policy");
    assert.notEqual(first, second);
  });

  it("SOBRESCRIBE una CSP que llega en la petición (mitigación del aviso de nonces de Next)", () => {
    const hostile = "script-src 'nonce-\"><script>alert(1)</script>'";
    const response = run({ "Content-Security-Policy": hostile });
    const forwarded = response.headers.get("x-middleware-request-content-security-policy") || "";
    assert.ok(forwarded.length > 0, "debe reenviar su propia CSP a la aplicación");
    assert.equal(forwarded.indexOf("alert"), -1, "la CSP hostil llegó a la aplicación");
    assert.equal(forwarded, response.headers.get("content-security-policy"));
  });

  it("el nonce que recibe la aplicación coincide con el de la respuesta", () => {
    const response = run();
    const nonce = response.headers.get("x-middleware-request-x-nonce") || "";
    assert.ok(isValidNonce(nonce));
    assert.ok((response.headers.get("content-security-policy") || "").indexOf(`'nonce-${nonce}'`) !== -1);
  });

  it("emite HSTS solo detrás de HTTPS", () => {
    assert.equal(run().headers.get("strict-transport-security"), null);
    assert.equal(run({ "x-forwarded-proto": "https" }).headers.get("strict-transport-security"), HSTS_VALUE);
  });

  it("deja fuera los recursos estáticos con huella y el optimizador de imágenes", () => {
    assert.equal(middlewareConfig.matcher.length, 1);
    assert.match(middlewareConfig.matcher[0], /_next\/static/);
    assert.match(middlewareConfig.matcher[0], /_next\/image/);
  });
});

/* ---------- C-04 Guardián de peticiones ---------- */

describe("C-04 guardián de peticiones", () => {
  it("rechaza lo que el navegador marca como cross-site y acepta lo demás", () => {
    assert.equal(checkFetchMetadata(new Headers({ "sec-fetch-site": "cross-site" })).status, 403);
    ["same-origin", "same-site", "none"].forEach((site) => {
      assert.equal(checkFetchMetadata(new Headers({ "sec-fetch-site": site })).ok, true);
    });
    assert.equal(checkFetchMetadata(new Headers()).ok, true, "sin metadatos (curl, servidores) se acepta");
  });

  it("rechaza un Origin ajeno, ilegible o con otro puerto", () => {
    const url = "http://localhost:3000/api/sync/inspections";
    assert.equal(checkOrigin(new Headers({ origin: "http://localhost:3000" }), url).ok, true);
    assert.equal(checkOrigin(new Headers(), url).ok, true);
    ["https://evil.example", "http://localhost:3001", "null", "no es una url", "http://localhost.evil.example"].forEach((origin) => {
      const result = checkOrigin(new Headers({ origin }), url);
      assert.equal(result.ok, false, `debió rechazar ${origin}`);
      assert.equal(result.status, 403);
    });
  });

  it("una escritura debe declarar application/json", () => {
    assert.equal(checkJsonContentType(new Headers({ "content-type": "application/json" })).ok, true);
    assert.equal(checkJsonContentType(new Headers({ "content-type": "application/json; charset=utf-8" })).ok, true);
    ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""].forEach((type) => {
      const result = checkJsonContentType(new Headers(type ? { "content-type": type } : {}));
      assert.equal(result.status, 415, `debió rechazar ${JSON.stringify(type)}`);
    });
  });

  it("limita el cuerpo por tamaño declarado y también cuando llega por partes sin declararlo", async () => {
    const big = JSON.stringify({ relleno: "x".repeat(2000) });
    const declared = await readJsonBody(
      new Request(BASE, { method: "POST", headers: { "content-length": "99999" }, body: "{}" }),
      1024
    );
    assert.equal(declared.status, 413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(big);
        controller.enqueue(bytes.slice(0, 1000));
        controller.enqueue(bytes.slice(1000));
        controller.close();
      }
    });
    const chunked = await readJsonBody(
      new Request(BASE, { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" }),
      1024
    );
    assert.equal(chunked.status, 413);

    const fine = await readJsonBody(new Request(BASE, { method: "POST", body: '{"a":1}' }), 1024);
    assert.deepEqual(fine.value, { a: 1 });
  });

  it("distingue JSON inválido de cuerpo demasiado grande", async () => {
    const invalid = await readJsonBody(new Request(BASE, { method: "POST", body: "{" }), 1024);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.error, "invalid-json");
    assert.equal((await readJsonBody(new Request(BASE, { method: "GET" }), 1024)).status, 400);
  });

  it("el límite de peticiones corta el exceso, informa cuánto esperar y se renueva por ventana", () => {
    let now = 1000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 10000, now: () => now });
    assert.deepEqual([1, 2, 3].map(() => limiter.check("a").allowed), [true, true, true]);
    const blocked = limiter.check("a");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 10);
    assert.equal(limiter.check("b").allowed, true, "otra clave tiene su propia cuota");
    now += 10001;
    assert.equal(limiter.check("a").allowed, true, "la ventana se renovó");
  });

  it("el limitador no crece sin límite aunque lo inunden con claves distintas", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 10, now: () => now });
    for (let i = 0; i < 500; i += 1) {
      now += 1;
      assert.equal(limiter.check(`cliente-${i}`).allowed, true);
    }
  });

  it("identifica al cliente por X-Forwarded-For con tope de longitud", () => {
    assert.equal(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientKey(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientKey(new Headers()), "desconocido");
    assert.equal(clientKey(new Headers({ "x-forwarded-for": "a".repeat(500) })).length, 64);
  });
});

/* ---------- C-04 aplicado a la ruta real ---------- */

describe("C-04 la ruta de sincronización aplica los controles", () => {
  it("rechaza una escritura de otro sitio, con Origin ajeno o con un tipo distinto de JSON", async () => {
    await withHooks("1", async () => {
      assert.equal((await POST(write({ "sec-fetch-site": "cross-site" }, wireOperation()))).status, 403);
      assert.equal((await POST(write({ origin: "https://evil.example" }, wireOperation()))).status, 403);
      assert.equal((await POST(write({ "content-type": "text/plain" }, wireOperation()))).status, 415);
      assert.equal((await GET(new Request(BASE, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
    });
  });

  it("rechaza un cuerpo mayor de 16 KB y no guarda nada", async () => {
    await withHooks("1", async () => {
      await DELETE(new Request(BASE, { method: "DELETE" }));
      const huge = wireOperation({ fields: validFields({ summary: "x".repeat(40000) }) });
      assert.equal((await POST(write({}, huge))).status, 413);
      const state = (await (await GET(new Request(BASE))).json()) as { records: unknown[] };
      assert.equal(state.records.length, 0);
    });
  });

  it("el servidor rechaza un dato personal aunque el cliente lo omita (defensa en profundidad)", async () => {
    await withHooks("1", async () => {
      await DELETE(new Request(BASE, { method: "DELETE" }));
      const operation = wireOperation({ fields: validFields({ summary: "Contactar a persona@ejemplo.org" }) });
      const response = await POST(write({}, operation));
      assert.equal(response.status, 422);
      const text = JSON.stringify(await response.json());
      assert.match(text, /correo electrónico/);
      assert.equal(text.indexOf("persona@ejemplo.org"), -1, "el error no debe repetir el dato personal");
    });
  });

  it("aplica un límite de peticiones por cliente y responde 429 con Retry-After", async () => {
    await withHooks("1", async () => {
      const headers = { "x-forwarded-for": "198.51.100.77" };
      let last: Response | null = null;
      for (let i = 0; i < 305; i += 1) last = await GET(new Request(BASE, { headers }));
      assert.equal(last && last.status, 429);
      assert.ok(Number(last && last.headers.get("retry-after")) >= 1);
      const other = await GET(new Request(BASE, { headers: { "x-forwarded-for": "198.51.100.78" } }));
      assert.equal(other.status, 200, "otro cliente no se ve afectado");
    });
  });
});

/* ---------- C-05 Ganchos de demostración ---------- */

describe("C-05 ganchos de demostración apagados por omisión", () => {
  it("la variable solo activa con el valor exacto 1", () => {
    assert.equal(demoHooksEnabled({}), false);
    assert.equal(demoHooksEnabled({ ENABLE_DEMO_HOOKS: "1" }), true);
    ["0", "true", "yes", "", " 1", "11"].forEach((value) => {
      assert.equal(demoHooksEnabled({ ENABLE_DEMO_HOOKS: value }), false, `valor ${JSON.stringify(value)}`);
    });
  });

  it("sin la variable, DELETE responde 404 y no vacía el servidor", async () => {
    await withHooks("1", async () => {
      await DELETE(new Request(BASE, { method: "DELETE" }));
      assert.equal((await POST(write({}, wireOperation()))).status, 200);
    });
    await withHooks(undefined, async () => {
      assert.equal((await DELETE(new Request(BASE, { method: "DELETE" }))).status, 404);
      const state = (await (await GET(new Request(BASE))).json()) as { records: unknown[] };
      assert.equal(state.records.length, 1, "el borrado no debe haberse ejecutado");
    });
  });

  it("sin la variable, ?fallo=1 y ?perder=1 se ignoran", async () => {
    await withHooks("1", async () => {
      await DELETE(new Request(BASE, { method: "DELETE" }));
    });
    await withHooks(undefined, async () => {
      const operation = wireOperation({ idempotencyKey: "op-hooks-0001", recordId: "insp-hooks-0001" });
      assert.equal((await POST(write({}, operation, "?fallo=1"))).status, 200, "?fallo=1 no debe causar 503");
      const second = wireOperation({ idempotencyKey: "op-hooks-0002", recordId: "insp-hooks-0002" });
      assert.equal((await POST(write({}, second, "?perder=1"))).status, 200, "?perder=1 no debe causar 503");
    });
  });

  it("con la variable, los ganchos funcionan (las pruebas y la demostración dependen de ellos)", async () => {
    await withHooks("1", async () => {
      assert.equal((await DELETE(new Request(BASE, { method: "DELETE" }))).status, 200);
      assert.equal((await POST(write({}, wireOperation(), "?fallo=1"))).status, 503);
    });
  });

  it("el gancho ?fallo=1 del repositorio de datos también depende de la variable", async () => {
    await withHooks(undefined, async () => {
      const found = await getInspectionById("inspection-001", { delayMs: 1, simulateError: true });
      assert.ok(found, "sin la variable no debe lanzar el error simulado");
      const all = await listInspections({ delayMs: 1, simulateError: true });
      assert.ok(all.length > 0, "el listado tampoco debe lanzar el error simulado");
    });
    await withHooks("1", async () => {
      await assert.rejects(getInspectionById("inspection-001", { delayMs: 1, simulateError: true }));
      await assert.rejects(listInspections({ delayMs: 1, simulateError: true }));
    });
  });
});

/* ---------- C-06 Minimización de datos personales ---------- */

describe("C-06 minimización de datos personales", () => {
  const SYNTHETIC = {
    email: "persona.prueba@ejemplo.org",
    curp: "ABCD800101HDFXYZ09",
    rfc: "ABCD800101AB1",
    rfcMoral: "ABC800101AB1",
    card: "4111 1111 1111 1111"
  };

  function kinds(text: string): string[] {
    return findPersonalData(text).map((finding) => finding.kind);
  }

  it("detecta correo, teléfono, CURP, RFC y tarjeta", () => {
    assert.deepEqual(kinds(`escribe a ${SYNTHETIC.email} por favor`), ["email"]);
    assert.deepEqual(kinds(`CURP ${SYNTHETIC.curp}`), ["curp"]);
    assert.ok(kinds(`RFC ${SYNTHETIC.rfc}`).indexOf("rfc") !== -1);
    assert.ok(kinds(`RFC ${SYNTHETIC.rfcMoral}`).indexOf("rfc") !== -1);
    assert.deepEqual(kinds(`tarjeta ${SYNTHETIC.card}`), ["card"]);
  });

  it("detecta teléfonos mexicanos en formatos comunes", () => {
    ["5512345678", "55 1234 5678", "55-1234-5678", "+52 55 1234 5678", "52 5512345678", "656-123-4567", "55 12 34 56 78"].forEach((phone) => {
      assert.deepEqual(kinds(`llamar al ${phone} mañana`), ["phone"], `no detectó ${phone}`);
    });
  });

  it("NO marca texto técnico normal (fechas, inventario, versiones, cantidades)", () => {
    [
      "Revisión de 12 equipos el 2026-10-20",
      "Inventario INV-2026-0042 sin novedades",
      "Versión 1.2.3 del firmware, lote 4821",
      "Temperatura 23.5 grados, humedad 45 %",
      "usuario@host sin dominio completo",
      "Marca de tiempo 1730000000000",
      "Sala 301, piso 3, extintor caducado",
      // Falsos positivos reales que se encontraron al revisar el detector: fechas con hora y series con guiones.
      "Revisado el 2026-10-20 15:30 sin novedades",
      "Mantenimiento 2026-10-20 15 equipos",
      "Rango de serie 1000-2000-3000-4"
    ].forEach((text) => assert.deepEqual(kinds(text), [], `falso positivo en: ${text}`));
  });

  it("una tarjeta solo se marca si pasa el algoritmo de Luhn", () => {
    assert.equal(luhnValid("4111111111111111"), true);
    assert.equal(luhnValid("4111111111111112"), false);
    assert.deepEqual(kinds("folio 4111 1111 1111 1112"), []);
  });

  it("los hallazgos describen el TIPO y la posición, nunca el valor", () => {
    const text = `contacto ${SYNTHETIC.email}`;
    const finding = findPersonalData(text)[0];
    assert.deepEqual(Object.keys(finding).sort(), ["end", "kind", "start"]);
    assert.equal(text.slice(finding.start, finding.end), SYNTHETIC.email);
    assert.equal(describePersonalData(findPersonalData(`${SYNTHETIC.email} ${SYNTHETIC.curp} ${SYNTHETIC.email}`)), "correo electrónico, CURP");
  });

  it("redactPersonalData reemplaza el dato y conserva el resto", () => {
    const redacted = redactPersonalData(`Hablar con ${SYNTHETIC.email} sobre el equipo`);
    assert.equal(redacted, "Hablar con [dato personal omitido] sobre el equipo");
    assert.equal(redactPersonalData("sin datos personales"), "sin datos personales");
  });

  it("la validación de la inspección rechaza un dato personal en cualquier texto libre y nombra solo el tipo", () => {
    ["location", "inspector", "summary"].forEach((field) => {
      const result = validateInspectionFields(validFields({ [field]: `Nota ${SYNTHETIC.curp}` }));
      assert.equal(result.ok, false, `${field} debió rechazarse`);
      const errors = (result.errors || []).join(" ");
      assert.match(errors, new RegExp(`${field}: contiene un dato personal \\(CURP\\)`));
      assert.equal(errors.indexOf(SYNTHETIC.curp), -1, "el error no debe repetir el dato");
    });
  });

  it("un nombre sintético en el campo responsable sigue siendo válido (tiene finalidad de trazabilidad)", () => {
    assert.equal(validateInspectionFields(validFields({ inspector: "Persona Inspectora 01" })).ok, true);
  });
});

/* ---------- C-07 Saneamiento de texto ---------- */

describe("C-07 saneamiento de texto", () => {
  it("quita caracteres de control y de dirección bidireccional (Trojan Source) y espacios de ancho cero", () => {
    assert.equal(sanitizeText("Lab\u0000\u0007 A‮"), "Lab A");
    assert.equal(sanitizeText("admin⁦x⁩"), "adminx");
    assert.equal(sanitizeText("a​b﻿c"), "abc");
    assert.equal(hasHiddenCharacters("normal"), false);
    assert.equal(hasHiddenCharacters("oculto‮"), true);
  });

  it("un texto de una línea no conserva saltos ni tabulaciones; uno multilínea sí", () => {
    assert.equal(sanitizeText("a\r\nb\tc"), "a b c");
    assert.equal(sanitizeText("a\r\nb\rc", { multiline: true }), "a\nb\nc");
  });

  it("normaliza Unicode: la misma palabra acentuada escrita de dos formas es un solo valor", () => {
    assert.equal(sanitizeText("Revisión"), sanitizeText("Revisión"));
  });

  it("la validación guarda el texto ya saneado", () => {
    const result = validateInspectionFields(validFields({ summary: "Revisión‮ ok\u0000" }));
    assert.equal(result.ok, true);
    assert.equal(result.value && result.value.summary, "Revisión ok");
  });
});

/* ---------- C-08 Rutas internas ---------- */

describe("C-08 rutas internas seguras (redirección abierta)", () => {
  const HOSTILE = [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "http://evil.example/ruta",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "evil.example/ruta",
    "/ruta con espacio",
    "/ruta\nSet-Cookie: x=1",
    "\t/ruta",
    "",
    `/${"a".repeat(600)}`
  ];
  const FINE = ["/", "/inspecciones", "/inspecciones/nueva#sincronizacion", "/inspecciones/inspection-001?fallo=1"];

  it("acepta solo rutas del mismo origen", () => {
    HOSTILE.forEach((value) => assert.equal(isSafeInternalPath(value), false, `debió rechazar ${JSON.stringify(value).slice(0, 40)}`));
    [null, undefined, 42, {}, []].forEach((value) => assert.equal(isSafeInternalPath(value), false));
    FINE.forEach((value) => assert.equal(isSafeInternalPath(value), true, value));
    assert.equal(safeInternalPath("//evil.example", "/seguro"), "/seguro");
  });

  it("el notificador ignora un destino hostil y usa el predeterminado", async () => {
    for (const hostile of HOSTILE) {
      const shown: Array<Record<string, unknown> | undefined> = [];
      const notifier = createNotifier({
        notification: { permission: "granted", requestPermission: async () => "granted" },
        getRegistration: async () => ({
          async showNotification(_title: string, options?: Record<string, unknown>) {
            shown.push(options);
          }
        }),
        isAppVisible: () => false,
        targetUrl: hostile
      });
      await notifier.notify({ title: "t", body: "b", tag: "t-destino", kind: "info" });
      const data = (shown[0] as { data: { url: string } }).data;
      assert.equal(data.url, DEFAULT_TARGET_URL, `usó un destino hostil: ${JSON.stringify(hostile).slice(0, 40)}`);
    }
  });

  it("el service worker aplica la misma regla que el módulo: nunca abre un destino que el módulo rechaza", async () => {
    const source = readFileSync(resolve(ROOT, "public", "sw.js"), "utf8");
    const listeners: Record<string, (event: unknown) => void> = {};
    const opened: string[] = [];
    const self = {
      location: { origin: "https://example.test" },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url);
        }
      },
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners[type] = handler;
      },
      skipWaiting: async () => undefined
    };
    vm.runInNewContext(source, { self, console, URL, Request, Response, setTimeout, clearTimeout, caches: {} });
    const inputs = HOSTILE.concat(FINE);
    for (const url of inputs) {
      let pending: Promise<unknown> = Promise.resolve();
      listeners.notificationclick({
        notification: { data: { url }, close: () => undefined },
        waitUntil: (value: Promise<unknown>) => {
          pending = value;
        }
      });
      await pending;
    }
    assert.equal(opened.length, inputs.length);
    opened.forEach((url, index) => {
      const requested = inputs[index];
      const expected = isSafeInternalPath(requested) ? requested : DEFAULT_TARGET_URL;
      assert.equal(url, expected, `destino distinto para ${JSON.stringify(requested).slice(0, 40)}`);
    });
  });
});

/* ---------- C-09 Borrado de datos locales ---------- */

describe("C-09 borrado de datos locales", () => {
  function fakes(overrides: Record<string, unknown> = {}) {
    const deleted: string[] = [];
    const removed: string[] = [];
    const caches = ["inspecciones-lab-v1", "inspecciones-lab-v0", "otra-aplicacion-v1"];
    const dropped: string[] = [];
    return {
      deleted,
      removed,
      dropped,
      deps: {
        deleteDatabase: async (name: string) => {
          deleted.push(name);
        },
        removePreference: (key: string) => {
          removed.push(key);
        },
        listCaches: async () => caches,
        deleteCache: async (name: string) => {
          dropped.push(name);
          return true;
        },
        ...overrides
      }
    };
  }

  it("borra la base local, las preferencias y SOLO las cachés de esta aplicación", async () => {
    const env = fakes();
    const report = await purgeLocalData(env.deps);
    assert.deepEqual(env.deleted, ["inspecciones-lab"]);
    assert.deepEqual(env.removed, PREFERENCE_KEYS);
    assert.deepEqual(env.dropped, ["inspecciones-lab-v1", "inspecciones-lab-v0"]);
    assert.ok(env.dropped.every((name) => name.indexOf(CACHE_PREFIX) === 0));
    assert.deepEqual(report, { database: "deleted", preferences: PREFERENCE_KEYS.length, caches: 2, errors: [] });
  });

  it("nunca lanza: un paso que falla se informa y los demás continúan", async () => {
    const env = fakes({
      deleteDatabase: async () => {
        throw new Error("bloqueada");
      }
    });
    const report = await purgeLocalData(env.deps);
    assert.equal(report.database, "error");
    assert.match(report.errors.join(" "), /bloqueada/);
    assert.equal(report.caches, 2, "las cachés se borraron igual");
  });

  it("sin APIs del navegador informa 'unavailable' en lugar de fallar", async () => {
    const report = await purgeLocalData({ deleteDatabase: null, removePreference: null, listCaches: null, deleteCache: null });
    assert.deepEqual(report, { database: "unavailable", preferences: 0, caches: 0, errors: [] });
  });
});

/* ---------- C-10 Archivos públicos y configuración ---------- */

describe("C-10 robots.txt, security.txt y configuración", () => {
  const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").replace(/\r\n/g, "\n");

  it("robots.txt pide no rastrear nada y aclara que no es un control de acceso", () => {
    const robots = read("public/robots.txt");
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Disallow: \/$/m);
    assert.match(robots, /NO un control de acceso/);
  });

  it("security.txt declara contacto y vencimiento válidos (RFC 9116)", () => {
    const text = read("public/.well-known/security.txt");
    assert.match(text, /^Contact: mailto:\S+$/m);
    const expires = /^Expires: (\S+)$/m.exec(text);
    assert.ok(expires, "falta Expires");
    assert.ok(Date.parse((expires as RegExpExecArray)[1]) > Date.parse("2026-10-31T00:00:00.000Z"), "Expires ya venció");
  });

  it("la configuración no anuncia la tecnología ni usa el optimizador de imágenes", () => {
    // Se exige la línea de configuración real: el comentario del archivo repite estas palabras.
    const configText = read("next.config.mjs");
    assert.match(configText, /^\s*poweredByHeader:\s*false,?\s*$/m);
    assert.match(configText, /^\s*images:\s*\{\s*unoptimized:\s*true\s*\}/m);
  });

  it("la CSP vive en un solo lugar: la configuración de Next no la redefine", () => {
    assert.equal(/Content-Security-Policy/i.test(read("next.config.mjs")), false);
  });

  it("offline.html no tiene scripts ni manejadores en línea (la CSP los bloquearía)", () => {
    const page = read("public/offline.html");
    assert.equal(/<script/i.test(page), false);
    assert.equal(/\son[a-z]+\s*=/i.test(page), false);
  });
});

/* ---------- C-11 Sin credenciales en el repositorio ---------- */

/** Palabras que busca el chequeo público, armadas por partes para no escribirlas aquí. */
const FORBIDDEN = [["api", "[_-]?", "ke", "y"], ["sec", "ret"], ["pass", "word"], ["to", "ken"]].map((parts) => parts.join(""));
const FORBIDDEN_PATTERN = new RegExp(`(${FORBIDDEN.join("|")})`, "i");
const CREDENTIAL_SHAPES: Array<[string, RegExp]> = [
  ["bloque de llave privada", new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----")],
  ["identificador de acceso de AWS", /AKIA[0-9A-Z]{16}/],
  ["credencial de GitHub", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["credencial de Slack", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/]
];
const SKIP_DIRECTORIES = ["node_modules", ".next", ".git", "coverage", ".test-build", "reports", "test-results", "playwright-report", ".claude"];
/** El chequeo público oficial se excluye a sí mismo: contiene las palabras que busca. */
const SKIP_FILES = ["public-tests/check.sh"];
const TEXT_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".yml", ".yaml", ".html", ".css", ".sh", ".svg", ".webmanifest", ".example"];

function repositoryFiles(directory: string, found: string[] = []): string[] {
  readdirSync(directory).forEach((name) => {
    const full = join(directory, name);
    if (SKIP_DIRECTORIES.indexOf(name) !== -1) return;
    if (statSync(full).isDirectory()) repositoryFiles(full, found);
    else found.push(full);
  });
  return found;
}

describe("C-11 sin credenciales en el repositorio", () => {
  const files = repositoryFiles(ROOT);
  const text = files.filter((file) => {
    const name = relative(ROOT, file).split(sep).join("/");
    return (
      TEXT_EXTENSIONS.some((extension) => file.endsWith(extension)) &&
      !file.endsWith(`${sep}package-lock.json`) &&
      SKIP_FILES.indexOf(name) === -1
    );
  });

  it("encuentra los archivos del proyecto (la búsqueda no está vacía)", () => {
    assert.ok(text.length > 50, `solo se revisaron ${text.length} archivos`);
    assert.ok(text.some((file) => file.endsWith("README.md")));
  });

  it("ningún archivo contiene las palabras que busca el chequeo público (excepto el lockfile de npm)", () => {
    const offenders = text.filter((file) => FORBIDDEN_PATTERN.test(readFileSync(file, "utf8"))).map((file) => relative(ROOT, file));
    assert.deepEqual(offenders, []);
  });

  it("ningún archivo contiene la forma de una credencial real (llaves privadas, accesos de nube, JWT)", () => {
    const hits: string[] = [];
    text.forEach((file) => {
      const content = readFileSync(file, "utf8");
      CREDENTIAL_SHAPES.forEach(([label, pattern]) => {
        if (pattern.test(content)) hits.push(`${relative(ROOT, file)}: ${label}`);
      });
    });
    assert.deepEqual(hits, []);
  });

  it("no hay archivos .env reales; solo la plantilla .env.example sin valores sensibles", () => {
    const names = files.map((file) => relative(ROOT, file).split(sep).join("/")).filter((file) => /(^|\/)\.env/.test(file));
    assert.deepEqual(names, [".env.example"]);
    const example = readFileSync(resolve(ROOT, ".env.example"), "utf8").replace(/\r\n/g, "\n");
    example.split("\n").filter((line) => /^[A-Z_]+=/.test(line)).forEach((line) => {
      assert.match(line, /^[A-Z_]+=[01]$/, `la plantilla solo debe tener interruptores 0/1: ${line}`);
    });
  });

  it("la detección funciona: reconoce una credencial sintética (la prueba no pasa en vacío)", () => {
    const fake = `AKIA${"A".repeat(16)}`;
    assert.ok(CREDENTIAL_SHAPES[1][1].test(fake));
    assert.ok(FORBIDDEN_PATTERN.test(`valor ${FORBIDDEN[3]}`));
  });
});
