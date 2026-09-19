/**
 * Registro y ciclo de vida del service worker (Semana 3).
 *
 * Diseño:
 * - Detección de soporte antes de registrar; nunca bloquea la carga de la página.
 * - El contenedor (`navigator.serviceWorker`) es inyectable para pruebas
 *   deterministas en Node sin navegador (tests/offline.spec.ts).
 * - Actualización segura: cuando una versión nueva queda en estado "waiting",
 *   se avisa por callback. La activación solo ocurre cuando el cliente envía
 *   SKIP_WAITING de forma explícita (activateWaitingServiceWorker), evitando
 *   que una versión a medio instalar reemplace a la activa.
 */

export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

export interface ServiceWorkerLogger {
  info(message: string, ...detail: unknown[]): void;
  warn(message: string, ...detail: unknown[]): void;
  error(message: string, ...detail: unknown[]): void;
}

export interface RegisterServiceWorkerOptions {
  /** Contenedor a usar. `undefined` usa `navigator.serviceWorker`; `null` fuerza "no soportado". */
  container?: ServiceWorkerContainer | null;
  scriptUrl?: string;
  scope?: string;
  /** Primera instalación completada: el shell ya está precacheado. */
  onReady?: (registration: ServiceWorkerRegistration) => void;
  /** Hay una versión nueva en "waiting"; el cliente decide cuándo activarla. */
  onUpdateAvailable?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: unknown) => void;
  logger?: ServiceWorkerLogger;
}

const defaultLogger: ServiceWorkerLogger = {
  info: (message, ...detail) => console.info(`[pwa] ${message}`, ...detail),
  warn: (message, ...detail) => console.warn(`[pwa] ${message}`, ...detail),
  error: (message, ...detail) => console.error(`[pwa] ${message}`, ...detail)
};

export function getServiceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker ?? null;
}

export function isServiceWorkerSupported(): boolean {
  return getServiceWorkerContainer() !== null;
}

function watchInstallingWorker(
  registration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
  options: RegisterServiceWorkerOptions,
  logger: ServiceWorkerLogger
): void {
  const installing = registration.installing;
  if (!installing) return;

  installing.addEventListener("statechange", () => {
    if (installing.state === "installed") {
      if (container.controller) {
        logger.info("Versión nueva instalada y en espera; requiere confirmación para activarse");
        options.onUpdateAvailable?.(registration);
      } else {
        logger.info("Service worker instalado por primera vez; shell disponible offline");
        options.onReady?.(registration);
      }
      return;
    }
    if (installing.state === "redundant") {
      logger.error("La instalación del service worker falló; la versión anterior sigue activa");
    }
  });
}

export async function registerServiceWorker(
  options: RegisterServiceWorkerOptions = {}
): Promise<ServiceWorkerRegistration | null> {
  const logger = options.logger ?? defaultLogger;
  const container = options.container === undefined ? getServiceWorkerContainer() : options.container;
  const scriptUrl = options.scriptUrl ?? SERVICE_WORKER_URL;
  const scope = options.scope ?? SERVICE_WORKER_SCOPE;

  if (!container) {
    logger.warn("Service worker no soportado en este navegador; la aplicación funciona solo en línea");
    return null;
  }

  try {
    const registration = await container.register(scriptUrl, { scope });
    logger.info(`Service worker registrado con alcance ${scope}`);

    if (registration.waiting && container.controller) {
      logger.info("Ya existe una versión nueva en espera");
      options.onUpdateAvailable?.(registration);
    }

    registration.addEventListener("updatefound", () => {
      watchInstallingWorker(registration, container, options, logger);
    });

    return registration;
  } catch (error) {
    logger.error("No se pudo registrar el service worker", error);
    options.onError?.(error);
    return null;
  }
}

/** Pide a la versión en espera que se active. Devuelve false si no hay nada esperando. */
export function activateWaitingServiceWorker(registration: ServiceWorkerRegistration): boolean {
  const waiting = registration.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

/** Ejecuta `callback` una sola vez cuando cambia el controlador. Devuelve la función para desuscribirse. */
export function onControllerChange(
  callback: () => void,
  container: ServiceWorkerContainer | null = getServiceWorkerContainer()
): () => void {
  if (!container) return () => undefined;
  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    container.removeEventListener("controllerchange", handler);
    callback();
  };
  container.addEventListener("controllerchange", handler);
  return () => container.removeEventListener("controllerchange", handler);
}

/** Invalidación controlada: pide al worker activo que borre sus cachés. */
export function clearServiceWorkerCaches(
  container: ServiceWorkerContainer | null = getServiceWorkerContainer()
): boolean {
  const controller = container?.controller;
  if (!controller) return false;
  controller.postMessage({ type: "CLEAR_CACHES" });
  return true;
}
