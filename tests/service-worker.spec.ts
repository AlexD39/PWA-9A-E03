export {};

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const root = process.cwd();
const source = readFileSync(resolve(root, "public", "sw.js"), "utf8");
const ORIGIN = "http://localhost:3000";
const ACTIVE_CACHE = "inspecciones-lab-v1";

type RequestLike = Request | string | { url: string };

function createCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  let fetcher: (input: Request | string) => Promise<Response> = async () => {
    throw new Error("El fetch simulado no fue configurado");
  };

  const keyFor = (request: RequestLike) => {
    if (typeof request === "string") return new URL(request, ORIGIN).href;
    return request.url;
  };

  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      async addAll(urls: string[]) {
        const pending: Array<[string, Response]> = [];
        for (const url of urls) {
          const absoluteUrl = new URL(url, ORIGIN).href;
          const response = await fetcher(new Request(absoluteUrl));
          if (!response.ok) throw new Error(`addAll falló: ${url}`);
          pending.push([absoluteUrl, response.clone()]);
        }
        for (const [url, response] of pending) store.set(url, response);
      },
      async match(request: RequestLike) {
        const response = store.get(keyFor(request));
        return response ? response.clone() : undefined;
      },
      async put(request: RequestLike, response: Response) {
        store.set(keyFor(request), response);
      }
    };
  };

  return {
    stores,
    setFetch(next: typeof fetcher) { fetcher = next; },
    async open(name: string) { return cacheFor(name); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name: string) { return stores.delete(name); },
    seed(name: string) { cacheFor(name); }
  };
}

function loadServiceWorker(options: {
  online: boolean;
  caches: ReturnType<typeof createCacheStorage>;
  statusByPath?: Record<string, number>;
}) {
  const listeners = new Map<string, Function>();
  const calls = { skipWaiting: 0, claim: 0, fetched: [] as string[] };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, fn: Function) { listeners.set(type, fn); },
    async skipWaiting() { calls.skipWaiting++; },
    clients: { async claim() { calls.claim++; } }
  };
  const fetch = async (input: Request | string) => {
    const url = typeof input === "string" ? input : input.url;
    calls.fetched.push(url);
    if (!options.online) throw new TypeError("Failed to fetch");
    const pathname = new URL(url, ORIGIN).pathname;
    const status = options.statusByPath?.[pathname] ?? 200;
    return new Response(`ok:${url}`, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  };

  options.caches.setFetch(fetch);
  const silentConsole = { info() {}, warn() {}, error() {} };
  const context = vm.createContext({
    self,
    caches: options.caches,
    fetch,
    Request,
    Response,
    URL,
    console: silentConsole
  });
  vm.runInContext(source, context, { filename: "sw.js" });
  return { listeners, calls };
}

function extendable() {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) { promises.push(promise); },
    settle() { return Promise.all(promises); }
  };
}

function fetchEvent(request: Request | { url: string; method: string; mode: string }) {
  let response: Promise<Response> | null = null;
  return {
    request,
    respondWith(value: Promise<Response> | Response) { response = Promise.resolve(value); },
    get handled() { return response; }
  };
}

function navigation(path: string) {
  return { url: new URL(path, ORIGIN).href, method: "GET", mode: "navigate" };
}

async function precache(caches: ReturnType<typeof createCacheStorage>) {
  const worker = loadServiceWorker({ online: true, caches });
  const event = extendable();
  worker.listeners.get("install")!(event);
  await event.settle();
  return worker;
}

async function run() {
  {
    const worker = loadServiceWorker({ online: true, caches: createCacheStorage() });
    for (const eventName of ["install", "activate", "fetch", "message"]) {
      assert.equal(typeof worker.listeners.get(eventName), "function", `Debe registrar el evento ${eventName}`);
    }
  }

  {
    const caches = createCacheStorage();
    const worker = loadServiceWorker({ online: true, caches });
    const event = extendable();
    worker.listeners.get("install")!(event);
    await event.settle();
    const stored = caches.stores.get(ACTIVE_CACHE)!;
    for (const path of ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"]) {
      assert.equal(stored.has(new URL(path, ORIGIN).href), true, `Install debe precachear ${path}`);
    }
    assert.equal(worker.calls.skipWaiting, 0, "Install no debe saltar la espera automáticamente");
  }

  {
    const caches = createCacheStorage();
    const worker = loadServiceWorker({
      online: true,
      caches,
      statusByPath: { "/offline.html": 404 }
    });
    const event = extendable();
    worker.listeners.get("install")!(event);
    await assert.rejects(event.settle(), /addAll falló: \/offline\.html/);
    assert.equal(caches.stores.get(ACTIVE_CACHE)?.size, 0, "Un precaché fallido no debe dejar entradas parciales");
  }

  {
    const caches = createCacheStorage();
    caches.seed("inspecciones-lab-v0");
    caches.seed(ACTIVE_CACHE);
    caches.seed("otra-cache");
    const worker = loadServiceWorker({ online: true, caches });
    const event = extendable();
    worker.listeners.get("activate")!(event);
    await event.settle();
    assert.deepEqual(await caches.keys(), [ACTIVE_CACHE, "otra-cache"]);
    assert.equal(worker.calls.claim, 1, "Activate debe reclamar los clientes");
  }

  {
    const caches = createCacheStorage();
    const worker = loadServiceWorker({ online: true, caches });
    const request = navigation("/");
    const event = fetchEvent(request);
    worker.listeners.get("fetch")!(event);
    assert.ok(event.handled, "Una navegación debe ser interceptada");
    assert.equal(await (await event.handled!).text(), `${"ok:"}${ORIGIN}/`);
    assert.deepEqual(worker.calls.fetched, [`${ORIGIN}/`]);
    const cached = await (await caches.open(ACTIVE_CACHE)).match(request);
    assert.equal(await cached?.text(), `${"ok:"}${ORIGIN}/`, "La navegación correcta debe guardarse en caché");
  }

  {
    const caches = createCacheStorage();
    await precache(caches);
    const worker = loadServiceWorker({ online: false, caches });
    const event = fetchEvent(navigation("/"));
    worker.listeners.get("fetch")!(event);
    assert.equal(await (await event.handled!).text(), `${"ok:"}${ORIGIN}/`);
  }

  {
    const caches = createCacheStorage();
    await precache(caches);
    const worker = loadServiceWorker({ online: false, caches });
    const event = fetchEvent(navigation("/ruta-inexistente"));
    worker.listeners.get("fetch")!(event);
    assert.equal(await (await event.handled!).text(), `ok:${ORIGIN}/offline.html`);
  }

  {
    const caches = createCacheStorage();
    const worker = loadServiceWorker({ online: true, caches });
    const request = new Request(`${ORIGIN}/_next/static/chunk.js`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const event = fetchEvent(request);
      worker.listeners.get("fetch")!(event);
      await event.handled;
    }
    assert.equal(
      worker.calls.fetched.filter(url => url === request.url).length,
      1,
      "Un estático almacenado debe usar cache-first"
    );
  }

  {
    const worker = loadServiceWorker({ online: true, caches: createCacheStorage() });
    const ignored = [
      new Request(`${ORIGIN}/submit`, { method: "POST" }),
      new Request("https://example.com/icon.svg"),
      new Request(`${ORIGIN}/api/inspections`),
      navigation("/api/x"),
      new Request(`${ORIGIN}/archivo.txt`)
    ];
    for (const request of ignored) {
      const event = fetchEvent(request);
      worker.listeners.get("fetch")!(event);
      assert.equal(event.handled, null, `No debe interceptar ${request.method} ${request.url}`);
    }
    assert.deepEqual(worker.calls.fetched, [], "Las solicitudes ignoradas deben quedar a cargo del navegador");
  }

  {
    const caches = createCacheStorage();
    const worker = loadServiceWorker({
      online: true,
      caches,
      statusByPath: { "/icons/missing.svg": 404 }
    });
    const request = new Request(`${ORIGIN}/icons/missing.svg`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const event = fetchEvent(request);
      worker.listeners.get("fetch")!(event);
      assert.equal((await event.handled!).status, 404);
    }
    assert.equal(worker.calls.fetched.length, 2, "Una respuesta no exitosa no debe guardarse");
  }

  {
    const caches = createCacheStorage();
    caches.seed("inspecciones-lab-v0");
    caches.seed(ACTIVE_CACHE);
    caches.seed("otra-cache");
    const worker = loadServiceWorker({ online: true, caches });
    worker.listeners.get("message")!({ data: { type: "SKIP_WAITING" } });
    assert.equal(worker.calls.skipWaiting, 1);

    const replies: unknown[] = [];
    const clearEvent = {
      ...extendable(),
      data: { type: "CLEAR_CACHES" },
      source: { postMessage(message: unknown) { replies.push(message); } }
    };
    worker.listeners.get("message")!(clearEvent);
    await clearEvent.settle();
    assert.deepEqual(await caches.keys(), ["otra-cache"], "CLEAR_CACHES no debe borrar cachés ajenas");
    assert.equal((replies[0] as { type?: string }).type, "CACHES_CLEARED");

    worker.listeners.get("message")!({
      data: { type: "GET_VERSION" },
      source: { postMessage(message: unknown) { replies.push(message); } }
    });
    assert.deepEqual(
      { type: (replies[1] as any).type, version: (replies[1] as any).version },
      { type: "VERSION", version: "v1" }
    );
  }

  {
    const worker = loadServiceWorker({ online: false, caches: createCacheStorage() });
    const navigationEvent = fetchEvent(navigation("/sin-respaldo"));
    worker.listeners.get("fetch")!(navigationEvent);
    assert.equal((await navigationEvent.handled!).status, 503);

    const staticEvent = fetchEvent(new Request(`${ORIGIN}/icons/sin-respaldo.svg`));
    worker.listeners.get("fetch")!(staticEvent);
    assert.equal((await staticEvent.handled!).status, 503);
  }

  console.log("service-worker.spec.ts: PASS");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
