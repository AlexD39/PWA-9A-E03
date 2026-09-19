/*
 * Service worker de la PWA de inspecciones de laboratorio (Semana 3).
 *
 * Script clásico sin dependencias: se sirve tal cual desde /sw.js con alcance "/".
 * Estrategia documentada en docs/cache-strategy.md. Contrato probado por
 * tests/service-worker.spec.ts, que ejecuta este archivo en un contexto aislado.
 *
 * Reglas:
 * - Precaché atómica en install (cache.addAll): si algo falla, no se activa.
 * - Sin skipWaiting automático: la versión nueva espera hasta que el cliente
 *   envía SKIP_WAITING (ver register-service-worker.ts).
 * - Navegación network-first con respaldo en caché y luego /offline.html.
 * - Estáticos versionados cache-first. Datos (/api/) nunca se cachean.
 * - Solo se guardan respuestas con response.ok.
 */

const CACHE_VERSION = "v1";
const CACHE_PREFIX = "inspecciones-lab-";
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const OFFLINE_URL = "/offline.html";
const APP_SHELL_URL = "/";
const PRECACHE_URLS = [
  APP_SHELL_URL,
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];
const STATIC_PREFIXES = ["/_next/static/", "/icons/"];
const NEVER_CACHE_PREFIXES = ["/api/"];

function log(level, message, detail) {
  const prefix = "[sw " + CACHE_VERSION + "] " + message;
  if (typeof console === "undefined" || typeof console[level] !== "function") return;
  if (detail === undefined) console[level](prefix);
  else console[level](prefix, detail);
}

function isOwnCache(name) {
  return typeof name === "string" && name.indexOf(CACHE_PREFIX) === 0;
}

function startsWithAny(pathname, prefixes) {
  return prefixes.some(function (prefix) {
    return pathname.indexOf(prefix) === 0;
  });
}

function offlineResponse(reason) {
  return new Response("Sin conexión: " + reason, {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

/* ---------- install: precaché atómica ---------- */

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE_URLS);
  log("info", "Precaché completa: " + PRECACHE_URLS.length + " recursos en " + CACHE_NAME);
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    precache().catch(function (error) {
      log("error", "Falló la precaché; la versión anterior sigue activa", error);
      throw error;
    })
  );
});

/* ---------- activate: limpieza de versiones propias anteriores ---------- */

async function deleteStaleCaches() {
  const names = await caches.keys();
  const stale = names.filter(function (name) {
    return isOwnCache(name) && name !== CACHE_NAME;
  });
  await Promise.all(
    stale.map(function (name) {
      log("info", "Eliminando caché obsoleta " + name);
      return caches.delete(name);
    })
  );
  return stale;
}

self.addEventListener("activate", function (event) {
  event.waitUntil(
    deleteStaleCaches()
      .then(function () {
        return self.clients.claim();
      })
      .catch(function (error) {
        log("error", "Falló la activación", error);
        throw error;
      })
  );
});

/* ---------- fetch: estrategias por tipo de recurso ---------- */

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    log("warn", "Navegación sin red, usando caché: " + request.url, error);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    log("error", "No hay respaldo offline precacheado");
    return offlineResponse("no hay contenido almacenado para esta ruta");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    log("warn", "Recurso estático no disponible offline: " + request.url, error);
    return offlineResponse("recurso estático no almacenado");
  }
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (!request || request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (startsWithAny(url.pathname, NEVER_CACHE_PREFIXES)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (startsWithAny(url.pathname, STATIC_PREFIXES)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // Cualquier otro GET del mismo origen va directo a la red sin cachear.
});

/* ---------- message: actualización e invalidación controladas ---------- */

async function clearOwnCaches() {
  const names = await caches.keys();
  const own = names.filter(isOwnCache);
  await Promise.all(own.map(function (name) { return caches.delete(name); }));
  log("info", "Cachés invalidadas por solicitud del cliente: " + own.join(", "));
  return own;
}

function reply(event, payload) {
  if (event && event.source && typeof event.source.postMessage === "function") {
    event.source.postMessage(payload);
  }
}

self.addEventListener("message", function (event) {
  const type = event && event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    log("info", "Activando versión nueva por solicitud del cliente");
    self.skipWaiting();
    return;
  }
  if (type === "CLEAR_CACHES") {
    const done = clearOwnCaches().then(function (cleared) {
      reply(event, { type: "CACHES_CLEARED", cleared: cleared });
    });
    if (typeof event.waitUntil === "function") event.waitUntil(done);
    return;
  }
  if (type === "GET_VERSION") {
    reply(event, { type: "VERSION", version: CACHE_VERSION, cacheName: CACHE_NAME });
  }
});
