const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
import * as sw from "../src/lib/pwa/register-service-worker";

function createTarget() {
  const listeners = new Map<string, Function[]>();

  return {
    addEventListener(type: string, fn: Function) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Function) {
      listeners.set(type, (listeners.get(type) ?? []).filter(candidate => candidate !== fn));
    },
    emit(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type });
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    }
  };
}

function createContainer({
  controller = null as object | null,
  registerImpl = null as null | (() => Promise<unknown>)
} = {}) {
  const containerTarget = createTarget();
  const workerTarget = createTarget();
  const registrationTarget = createTarget();
  const messages: unknown[] = [];

  const worker = {
    ...workerTarget,
    state: "installing",
    postMessage(message: unknown) {
      messages.push(message);
    }
  };
  const registration = {
    ...registrationTarget,
    installing: worker,
    waiting: null as typeof worker | null,
    active: null
  };
  const container = {
    ...containerTarget,
    controller: controller
      ? { postMessage: (message: unknown) => messages.push(message) }
      : null as { postMessage(message: unknown): void } | null,
    registerCalls: [] as unknown[][],
    register(url: string, options: unknown) {
      container.registerCalls.push([url, options]);
      return registerImpl ? registerImpl() : Promise.resolve(registration);
    }
  };

  // Los dobles implementan solo la superficie que usa el módulo bajo prueba.
  return { container: container as any, registration: registration as any, worker, messages };
}

function createLogger() {
  const calls = {
    info: [] as unknown[][],
    warn: [] as unknown[][],
    error: [] as unknown[][]
  };
  return {
    calls,
    logger: {
      info(...args: unknown[]) { calls.info.push(args); },
      warn(...args: unknown[]) { calls.warn.push(args); },
      error(...args: unknown[]) { calls.error.push(args); }
    }
  };
}

async function run() {
  {
    const { calls, logger } = createLogger();
    const registration = await sw.registerServiceWorker({ container: null, logger });
    assert.equal(registration, null, "Sin contenedor debe resolver null");
    assert.equal(calls.warn.length, 1, "Sin soporte debe registrar una advertencia");
  }

  {
    const { container, registration } = createContainer();
    const result = await sw.registerServiceWorker({ container, logger: createLogger().logger });
    assert.deepEqual(
      container.registerCalls,
      [["/sw.js", { scope: "/" }]],
      "Debe registrar el service worker con la URL y el alcance predeterminados"
    );
    assert.equal(result, registration, "Debe resolver el registro devuelto por el contenedor");
  }

  {
    const expectedError = new Error("registro rechazado");
    const { container } = createContainer({ registerImpl: () => Promise.reject(expectedError) });
    const { calls, logger } = createLogger();
    let receivedError: unknown;
    const result = await sw.registerServiceWorker({
      container,
      logger,
      onError(error: unknown) { receivedError = error; }
    });
    assert.equal(result, null, "Un error de registro debe resolverse como null");
    assert.equal(receivedError, expectedError, "onError debe recibir el error original");
    assert.equal(calls.error.length, 1, "El error de registro debe quedar registrado");
  }

  {
    const { container, registration, worker } = createContainer();
    let readyCalls = 0;
    let updateCalls = 0;
    await sw.registerServiceWorker({
      container,
      logger: createLogger().logger,
      onReady() { readyCalls++; },
      onUpdateAvailable() { updateCalls++; }
    });
    registration.emit("updatefound");
    worker.state = "installed";
    worker.emit("statechange");
    assert.equal(readyCalls, 1, "La primera instalación debe llamar onReady");
    assert.equal(updateCalls, 0, "La primera instalación no debe anunciar una actualización");
  }

  {
    const { container, registration, worker, messages } = createContainer({ controller: {} });
    let updateCalls = 0;
    await sw.registerServiceWorker({
      container,
      logger: createLogger().logger,
      onUpdateAvailable() { updateCalls++; }
    });
    registration.emit("updatefound");
    worker.state = "installed";
    worker.emit("statechange");
    assert.equal(updateCalls, 1, "Una instalación nueva con controlador debe anunciar la actualización");
    assert.deepEqual(messages, [], "La actualización no debe activarse automáticamente");
  }

  {
    const { container, registration, worker } = createContainer({ controller: {} });
    registration.waiting = worker;
    let updateCalls = 0;
    await sw.registerServiceWorker({
      container,
      logger: createLogger().logger,
      onUpdateAvailable() { updateCalls++; }
    });
    assert.equal(updateCalls, 1, "Un worker que ya espera debe anunciarse inmediatamente");
  }

  {
    const { container, registration, worker } = createContainer({ controller: {} });
    const { calls, logger } = createLogger();
    await sw.registerServiceWorker({ container, logger });
    registration.emit("updatefound");
    worker.state = "redundant";
    worker.emit("statechange");
    assert.equal(calls.error.length, 1, "Un worker redundante debe registrar el fallo de instalación");
  }

  {
    const { registration, worker, messages } = createContainer();
    registration.waiting = worker;
    assert.equal(sw.activateWaitingServiceWorker(registration), true);
    assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
    registration.waiting = null;
    assert.equal(sw.activateWaitingServiceWorker(registration), false);
  }

  {
    const { container } = createContainer();
    let callbackCalls = 0;
    const unsubscribe = sw.onControllerChange(() => { callbackCalls++; }, container);
    container.emit("controllerchange");
    container.emit("controllerchange");
    assert.equal(callbackCalls, 1, "controllerchange debe ejecutar el callback una sola vez");
    unsubscribe();
    assert.equal(container.count("controllerchange"), 0, "La desuscripción debe quitar el listener");
  }

  {
    const withController = createContainer({ controller: {} });
    assert.equal(sw.clearServiceWorkerCaches(withController.container), true);
    assert.deepEqual(withController.messages, [{ type: "CLEAR_CACHES" }]);

    const withoutController = createContainer();
    assert.equal(sw.clearServiceWorkerCaches(withoutController.container), false);
    assert.deepEqual(withoutController.messages, []);
  }

  {
    const root = process.cwd();
    const offlinePath = resolve(root, "public", "offline.html");
    const serviceWorkerPath = resolve(root, "public", "sw.js");
    const layoutPath = resolve(root, "src", "app", "layout.tsx");
    assert.equal(existsSync(offlinePath), true, "Debe existir public/offline.html");
    assert.match(readFileSync(offlinePath, "utf8"), /offline|sin conexi[oó]n/i);
    assert.match(readFileSync(serviceWorkerPath, "utf8"), /\/offline\.html/);
    assert.match(readFileSync(layoutPath, "utf8"), /ServiceWorkerManager/);
  }

  console.log("offline.spec.ts: PASS");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
