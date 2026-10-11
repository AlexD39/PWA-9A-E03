export {};

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const camera = require("../src/lib/device/camera");
const geo = require("../src/lib/device/geolocation");
const evidence = require("../src/lib/device/evidence");
const notifications = require("../src/lib/notifications/client");
const { createMemoryStorage } = require("../src/lib/storage/memory-storage");

type AsyncCase = () => void | Promise<void>;
const cases: Array<{ name: string; run: AsyncCase }> = [];
function test(name: string, run: AsyncCase) {
  cases.push({ name, run });
}

function jpegUrl(bytes: number): string {
  return `data:image/jpeg;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

function encoded(bytes = 120, width = 800, height = 600) {
  return { dataUrl: jpegUrl(bytes), width, height, bytes };
}

function fakeStream(trackCount = 2) {
  const stops: number[] = [];
  return {
    stops,
    stream: {
      getTracks: () => Array.from({ length: trackCount }, (_, index) => ({
        stop: () => stops.push(index)
      }))
    }
  };
}

function cameraDeps(overrides: Record<string, unknown> = {}) {
  const fake = fakeStream();
  const constraints: unknown[] = [];
  return {
    fake,
    constraints,
    deps: {
      mediaDevices: {
        async getUserMedia(value: unknown) {
          constraints.push(value);
          return fake.stream;
        }
      },
      grabFrame: async () => ({ width: 1600, height: 1200, source: {} }),
      encode: async () => encoded(),
      now: () => Date.parse("2026-10-11T00:00:00.000Z"),
      ...overrides
    }
  };
}

function geoFake(
  behavior: (success: Function, failure: Function, options: Record<string, unknown>) => void
) {
  return {
    getCurrentPosition(success: Function, failure: Function, options: Record<string, unknown>) {
      behavior(success, failure, options);
    }
  };
}

function validPhoto(overrides: Record<string, unknown> = {}) {
  const dataUrl = jpegUrl(100);
  return {
    dataUrl,
    mimeType: "image/jpeg",
    width: 800,
    height: 600,
    bytes: camera.dataUrlBytes(dataUrl),
    capturedAt: "2026-10-11T00:00:00.000Z",
    source: "camera",
    ...overrides
  };
}

function validLocation(overrides: Record<string, unknown> = {}) {
  return {
    latitude: 18.462,
    longitude: -97.393,
    accuracyMeters: 111,
    capturedAt: "2026-10-11T00:00:00.000Z",
    ...overrides
  };
}

function sampleNotice(overrides: Record<string, unknown> = {}) {
  return {
    title: "Cambio de prueba",
    body: "Hay una actualización disponible.",
    tag: "change-test",
    kind: "info",
    ...overrides
  };
}

function notifyEnv(overrides: Record<string, unknown> = {}) {
  let current = 1000;
  const system: unknown[] = [];
  const inside: unknown[] = [];
  const deps = {
    notification: { permission: "granted", requestPermission: async () => "granted" },
    getRegistration: async () => ({
      async showNotification(title: string, options: unknown) {
        system.push({ title, options });
      }
    }),
    createNotification: (title: string, options: unknown) => system.push({ title, options }),
    inApp: (notice: unknown) => inside.push(notice),
    isAppVisible: () => false,
    isEnabled: () => true,
    now: () => current,
    ...overrides
  };
  return { deps, system, inside, advance: (ms: number) => { current += ms; } };
}

function loadSw(clients: Record<string, unknown>) {
  const listeners = new Map<string, Function>();
  const self = {
    location: { origin: "https://example.test" },
    clients,
    addEventListener(type: string, handler: Function) {
      listeners.set(type, handler);
    },
    skipWaiting: async () => undefined
  };
  const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");
  vm.runInNewContext(source, {
    self,
    console,
    URL,
    Request,
    Response,
    setTimeout,
    clearTimeout,
    caches: {}
  });
  const handler = listeners.get("notificationclick");
  assert.equal(typeof handler, "function");
  return handler as Function;
}

async function clickNotification(handler: Function, data: unknown) {
  let closed = 0;
  let pending: Promise<unknown> = Promise.resolve();
  handler({
    notification: { data, close: () => { closed += 1; } },
    waitUntil(value: Promise<unknown>) { pending = value; }
  });
  await pending;
  return closed;
}

// Cámara: utilidades puras.
test("fitWithin limita el lado mayor y conserva la proporción", () => {
  assert.deepEqual(camera.fitWithin(2048, 1024, 1024), { width: 1024, height: 512 });
  assert.deepEqual(camera.fitWithin(640, 480, 1024), { width: 640, height: 480 });
  assert.deepEqual(camera.fitWithin(0, 480, 1024), { width: 0, height: 0 });
});

test("dataUrlBytes calcula el contenido base64", () => {
  for (const bytes of [1, 2, 3, 250000]) assert.equal(camera.dataUrlBytes(jpegUrl(bytes)), bytes);
  assert.equal(camera.dataUrlBytes("sin-coma"), 0);
});

test("mapCameraError clasifica denegación, ausencia, uso y error", () => {
  assert.equal(camera.mapCameraError({ name: "NotAllowedError" }), "denied");
  assert.equal(camera.mapCameraError({ name: "NotFoundError" }), "no-device");
  assert.equal(camera.mapCameraError({ name: "NotReadableError" }), "busy");
  assert.equal(camera.mapCameraError({ name: "Otro" }), "error");
});

test("validateImageFile acepta solamente formatos y tamaños permitidos", () => {
  assert.deepEqual(camera.validateImageFile(null), { ok: false, reason: "cancelled" });
  assert.equal(camera.validateImageFile({ type: "image/gif", size: 10 }).reason, "invalid");
  assert.equal(camera.validateImageFile({ type: "image/jpeg", size: 0 }).reason, "invalid");
  assert.equal(camera.validateImageFile({ type: "image/webp", size: 10 }).ok, true);
  assert.equal(camera.validateImageFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).ok, false);
});

test("shrinkToBudget baja calidad antes de reducir dimensiones", () => {
  const calls: Array<{ width: number; quality: number }> = [];
  const result = camera.shrinkToBudget(
    { width: 1600, height: 800 },
    (width: number, height: number, quality: number) => {
      calls.push({ width, quality });
      return jpegUrl(quality > 0.5 ? 300000 : 200000);
    }
  );
  assert.equal(result.width, 1024);
  assert.equal(result.bytes, 200000);
  assert.equal(calls.some((call) => call.quality < 0.7), true);
});

test("shrinkToBudget respeta un presupuesto propio reduciendo el ancho", () => {
  const limits = { ...camera.PHOTO_LIMITS, maxBytes: 5000 };
  const result = camera.shrinkToBudget(
    { width: 1600, height: 1200 },
    (width: number, height: number, quality: number) => jpegUrl(Math.ceil(width * height * quality / 40)),
    limits
  );
  assert.ok(result);
  assert.ok(result.width < 1024);
  assert.ok(result.bytes <= 5000);
});

// Cámara: flujos con dependencias simuladas.
test("capturePhoto informa que la API no está disponible", async () => {
  assert.equal((await camera.capturePhoto({ mediaDevices: null })).status, "unsupported");
  assert.equal(camera.isCameraSupported({ mediaDevices: null }), false);
});

test("capturePhoto pide video ambiental sin audio", async () => {
  const env = cameraDeps();
  const result = await camera.capturePhoto(env.deps);
  assert.equal(result.status, "ok");
  assert.deepEqual(env.constraints[0], {
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false
  });
});

test("capturePhoto construye los metadatos mínimos", async () => {
  const result = await camera.capturePhoto(cameraDeps().deps);
  assert.equal(result.photo.mimeType, "image/jpeg");
  assert.equal(result.photo.source, "camera");
  assert.equal(result.photo.capturedAt, "2026-10-11T00:00:00.000Z");
  assert.equal(result.photo.bytes, 120);
});

test("capturePhoto clasifica un permiso denegado sin lanzar", async () => {
  const result = await camera.capturePhoto({
    mediaDevices: { getUserMedia: async () => { throw { name: "NotAllowedError" }; } }
  });
  assert.equal(result.status, "denied");
});

test("capturePhoto libera todas las pistas cuando falla la captura", async () => {
  const env = cameraDeps({ grabFrame: async () => { throw new Error("fallo simulado"); } });
  assert.equal((await camera.capturePhoto(env.deps)).status, "error");
  assert.equal(env.fake.stops.length, 2);
});

test("capturePhoto libera todas las pistas cuando falla la codificación", async () => {
  const env = cameraDeps({ encode: async () => { throw new Error("fallo simulado"); } });
  assert.equal((await camera.capturePhoto(env.deps)).status, "error");
  assert.equal(env.fake.stops.length, 2);
});

test("dos capturas seguidas liberan la cámara las dos veces", async () => {
  const streams = [fakeStream(), fakeStream()];
  let index = 0;
  const deps = cameraDeps({
    mediaDevices: { getUserMedia: async () => streams[index++].stream }
  }).deps;
  assert.equal((await camera.capturePhoto(deps)).status, "ok");
  assert.equal((await camera.capturePhoto(deps)).status, "ok");
  assert.equal(streams[0].stops.length + streams[1].stops.length, 4);
});

test("photoFromFile distingue cancelación y archivo inválido", async () => {
  assert.equal((await camera.photoFromFile(null)).status, "cancelled");
  assert.equal((await camera.photoFromFile({ type: "text/plain", size: 20 })).status, "invalid");
});

test("photoFromFile procesa un archivo sin pedir cámara", async () => {
  let decoded = 0;
  const result = await camera.photoFromFile(
    { type: "image/png", size: 200 },
    {
      decodeFile: async () => { decoded += 1; return { width: 100, height: 50, source: {} }; },
      encode: async () => encoded(80, 100, 50),
      now: () => 0
    }
  );
  assert.equal(result.status, "ok");
  assert.equal(result.photo.source, "file");
  assert.equal(decoded, 1);
});

// Ubicación aproximada.
test("roundCoordinate aplica tres decimales y normaliza cero", () => {
  assert.equal(geo.roundCoordinate(18.46249), 18.462);
  assert.equal(geo.roundCoordinate(-0.0001), 0);
  assert.equal(geo.roundingMeters(), 111);
});

test("mapGeolocationError traduce los códigos del navegador", () => {
  assert.equal(geo.mapGeolocationError({ code: 1 }), "denied");
  assert.equal(geo.mapGeolocationError({ code: 2 }), "unavailable");
  assert.equal(geo.mapGeolocationError({ code: 3 }), "timeout");
  assert.equal(geo.mapGeolocationError({ code: 9 }), "error");
});

test("getLocationPermission no solicita permiso y consulta su estado", async () => {
  let descriptor: unknown;
  const state = await geo.getLocationPermission({
    geolocation: geoFake(() => undefined),
    permissions: { query: async (value: unknown) => { descriptor = value; return { state: "granted" }; } }
  });
  assert.equal(state, "granted");
  assert.deepEqual(descriptor, { name: "geolocation" });
});

test("getLocationPermission usa estados seguros ante falta o fallo", async () => {
  assert.equal(await geo.getLocationPermission({ geolocation: null }), "unsupported");
  assert.equal(await geo.getLocationPermission({ geolocation: geoFake(() => undefined), permissions: null }), "prompt");
  assert.equal(await geo.getLocationPermission({
    geolocation: geoFake(() => undefined),
    permissions: { query: async () => { throw new Error("fallo simulado"); } }
  }), "prompt");
});

test("requestLocation usa baja precisión y límites declarados", async () => {
  let received: Record<string, unknown> | undefined;
  const result = await geo.requestLocation({
    geolocation: geoFake((success, _failure, options) => {
      received = options;
      success({ coords: { latitude: 18.46249, longitude: -97.39251, accuracy: 12 } });
    }),
    now: () => Date.parse("2026-10-11T01:00:00.000Z")
  });
  assert.deepEqual(received, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  assert.equal(result.location.latitude, 18.462);
  assert.equal(result.location.longitude, -97.393);
  assert.equal(result.location.accuracyMeters, 111);
  assert.equal(result.location.capturedAt, "2026-10-11T01:00:00.000Z");
});

test("requestLocation conserva una incertidumbre mayor", async () => {
  const result = await geo.requestLocation({
    geolocation: geoFake((success) => success({ coords: { latitude: 10, longitude: 20, accuracy: 245.7 } }))
  });
  assert.equal(result.location.accuracyMeters, 246);
});

test("requestLocation resuelve errores y coordenadas inválidas", async () => {
  assert.equal((await geo.requestLocation({ geolocation: geoFake((_ok, fail) => fail({ code: 1 })) })).status, "denied");
  assert.equal((await geo.requestLocation({ geolocation: geoFake((ok) => ok({ coords: { latitude: 91, longitude: 0, accuracy: 1 } })) })).status, "error");
  assert.equal((await geo.requestLocation({ geolocation: geoFake(() => { throw new Error("fallo simulado"); }) })).status, "error");
});

test("requestLocation informa falta de API", async () => {
  assert.equal((await geo.requestLocation({ geolocation: null })).status, "unsupported");
  assert.equal(geo.isGeolocationSupported({ geolocation: null }), false);
});

test("requestLocation tiene una salida si el navegador no responde", async () => {
  const started = Date.now();
  const result = await geo.requestLocation({ geolocation: geoFake(() => undefined), timeoutMs: 10 });
  assert.equal(result.status, "timeout");
  assert.ok(Date.now() - started < 1500);
});

// Persistencia local de evidencia.
test("validatePhoto comprueba formato, tamaño declarado y dimensiones", () => {
  assert.equal(evidence.validatePhoto(validPhoto()).ok, true);
  assert.equal(evidence.validatePhoto(validPhoto({ mimeType: "image/png" })).ok, false);
  assert.equal(evidence.validatePhoto(validPhoto({ bytes: 99 })).ok, false);
  assert.equal(evidence.validatePhoto(validPhoto({ width: 1025 })).ok, false);
});

test("validateLocation limita rangos y precisión", () => {
  assert.equal(evidence.validateLocation(validLocation()).ok, true);
  assert.equal(evidence.validateLocation(validLocation({ latitude: 91 })).ok, false);
  assert.equal(evidence.validateLocation(validLocation({ longitude: -181 })).ok, false);
  assert.equal(evidence.validateLocation(validLocation({ latitude: 18.4621 })).ok, false);
});

test("saveEvidence guarda y loadEvidence recupera una copia válida", async () => {
  const storage = createMemoryStorage();
  const result = await evidence.saveEvidence(storage, "record-001", { photo: validPhoto(), location: validLocation() });
  assert.equal(result.status, "ok");
  const loaded = await evidence.loadEvidence(storage, "record-001");
  assert.equal(loaded.recordId, "record-001");
  assert.equal(loaded.photo.source, "camera");
  assert.equal(loaded.location.latitude, 18.462);
});

test("saveEvidence usa exactamente el reloj inyectado", async () => {
  const storage = createMemoryStorage();
  const instant = "2026-10-11T00:00:00.000Z";
  const result = await evidence.saveEvidence(
    storage,
    "record-002",
    { photo: validPhoto() },
    () => Date.parse(instant)
  );
  assert.equal(result.evidence.updatedAt, instant);
  assert.equal(storage.snapshot().meta["evidence:record-002"].updatedAt, instant);
});

test("saveEvidence rechaza datos inválidos sin escribir", async () => {
  const storage = createMemoryStorage();
  const result = await evidence.saveEvidence(storage, "x", { photo: validPhoto({ width: 0 }) });
  assert.equal(result.status, "invalid");
  assert.deepEqual(storage.snapshot().meta, {});
});

test("removeEvidence conserva una parte y borra la clave al quedar vacío", async () => {
  const storage = createMemoryStorage();
  await evidence.saveEvidence(storage, "record-003", { photo: validPhoto(), location: validLocation() });
  const first = await evidence.removeEvidence(storage, "record-003", "photo");
  assert.equal(first.evidence.photo, null);
  assert.ok(first.evidence.location);
  const second = await evidence.removeEvidence(storage, "record-003", "location");
  assert.equal(second.evidence, null);
  assert.equal(storage.snapshot().meta["evidence:record-003"], undefined);
});

test("saveEvidence convierte fallos del almacén en resultado", async () => {
  const storage = createMemoryStorage();
  storage.failNextBatch(new Error("sin espacio simulado"));
  const result = await evidence.saveEvidence(storage, "record-004", { photo: validPhoto() });
  assert.equal(result.status, "storage-error");
});

// Avisos de cambios.
test("getPermissionState normaliza estados y falta de API", () => {
  assert.equal(notifications.getPermissionState({ notification: null }), "unsupported");
  assert.equal(notifications.getPermissionState({ notification: { permission: "granted" } }), "granted");
  assert.equal(notifications.getPermissionState({ notification: { permission: "otro" } }), "default");
});

test("requestPermission no vuelve a pedir una decisión existente", async () => {
  let calls = 0;
  const result = await notifications.requestPermission({
    notification: { permission: "denied", requestPermission: () => { calls += 1; return "granted"; } }
  });
  assert.equal(result, "denied");
  assert.equal(calls, 0);
});

test("requestPermission admite la forma basada en promesa", async () => {
  const result = await notifications.requestPermission({
    notification: { permission: "default", requestPermission: async () => "granted" }
  });
  assert.equal(result, "granted");
});

test("buildChangeNotification cubre cambios relevantes y omite otros", () => {
  assert.equal(notifications.buildChangeNotification({ type: "acked" }).kind, "synced");
  assert.equal(notifications.buildChangeNotification({ type: "duplicate" }).tag, "sync-synced");
  assert.equal(notifications.buildChangeNotification({ type: "conflict-resolved" }).kind, "conflict");
  assert.equal(notifications.buildChangeNotification({ type: "failed" }).kind, "failed");
  assert.equal(notifications.buildChangeNotification({ type: "pending" }), null);
});

test("notify usa el service worker y entrega datos mínimos", async () => {
  const env = notifyEnv();
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.channel, "system");
  assert.equal(env.system.length, 1);
  const call: any = env.system[0];
  assert.equal(call.options.tag, "change-test");
  assert.deepEqual(call.options.data, {
    url: "/inspecciones/nueva#sincronizacion",
    kind: "info"
  });
});

test("notify usa aviso interno cuando la aplicación está visible", async () => {
  const env = notifyEnv({ isAppVisible: () => true });
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.channel, "in-app");
  assert.equal(result.reason, "app-visible");
  assert.equal(env.system.length, 0);
});

test("notify usa aviso interno si la capacidad está desactivada", async () => {
  const env = notifyEnv({ isEnabled: () => false });
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.reason, "disabled");
  assert.equal(env.inside.length, 1);
});

test("notify nunca solicita permiso por su cuenta", async () => {
  let requests = 0;
  const env = notifyEnv({
    notification: { permission: "default", requestPermission: () => { requests += 1; return "granted"; } }
  });
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.reason, "permission-default");
  assert.equal(requests, 0);
  assert.equal(env.inside.length, 1);
});

test("notify usa el constructor si no hay registro del service worker", async () => {
  const env = notifyEnv({ getRegistration: async () => null });
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.channel, "system");
  assert.equal(env.system.length, 1);
});

test("notify deduplica por etiqueta durante 4000 ms", async () => {
  const env = notifyEnv();
  const notifier = notifications.createNotifier(env.deps);
  assert.equal((await notifier.notify(sampleNotice())).channel, "system");
  env.advance(3999);
  assert.equal((await notifier.notify(sampleNotice())).reason, "deduplicated");
  env.advance(1);
  assert.equal((await notifier.notify(sampleNotice())).channel, "system");
});

test("dedupeWindowMs cero deja pasar dos avisos iguales", async () => {
  const env = notifyEnv({ dedupeWindowMs: 0 });
  const notifier = notifications.createNotifier(env.deps);
  assert.equal((await notifier.notify(sampleNotice())).channel, "system");
  assert.equal((await notifier.notify(sampleNotice())).channel, "system");
  assert.equal(env.system.length, 2);
});

test("handleSyncEvent delega solo eventos con aviso", async () => {
  const env = notifyEnv();
  const notifier = notifications.createNotifier(env.deps);
  assert.equal((await notifier.handleSyncEvent({ type: "failed" })).notification.kind, "failed");
  assert.equal(await notifier.handleSyncEvent({ type: "retrying" }), null);
});

test("notify convierte un fallo de entrega en fallback", async () => {
  const env = notifyEnv({
    getRegistration: async () => ({ showNotification: async () => { throw new Error("fallo simulado"); } })
  });
  const result = await notifications.createNotifier(env.deps).notify(sampleNotice());
  assert.equal(result.channel, "in-app");
  assert.equal(result.reason, "error");
});

// Clic de notificación: public/sw.js se ejecuta realmente en node:vm.
test("notificationclick cierra y enfoca una ventana del mismo origen", async () => {
  let focused = 0;
  let opened = 0;
  const handler = loadSw({
    matchAll: async () => [{ url: "https://example.test/inspecciones", focus: async () => { focused += 1; } }],
    openWindow: async () => { opened += 1; }
  });
  assert.equal(await clickNotification(handler, { url: "/inspecciones/nueva" }), 1);
  assert.equal(focused, 1);
  assert.equal(opened, 0);
});

test("notificationclick abre una ruta interna si no hay ventana", async () => {
  const opened: string[] = [];
  const handler = loadSw({
    matchAll: async () => [],
    openWindow: async (url: string) => { opened.push(url); }
  });
  await clickNotification(handler, { url: "/inspecciones/nueva#sincronizacion" });
  assert.deepEqual(opened, ["/inspecciones/nueva#sincronizacion"]);
});

test("notificationclick rechaza destinos externos", async () => {
  for (const unsafe of ["https://outside.test/path", "//outside.test/path", "javascript:alert(1)"]) {
    const opened: string[] = [];
    const handler = loadSw({
      matchAll: async () => [],
      openWindow: async (url: string) => { opened.push(url); }
    });
    await clickNotification(handler, { url: unsafe });
    assert.deepEqual(opened, ["/inspecciones/nueva#sincronizacion"]);
  }
});

async function runAll() {
  const failures: string[] = [];
  for (const item of cases) {
    try {
      await item.run();
    } catch (error) {
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      failures.push(`${item.name}: ${detail}`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`capabilities.spec.ts: PASS (${cases.length} casos)`);
}

void runAll();
