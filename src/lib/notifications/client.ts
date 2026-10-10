/**
 * Notificaciones de cambio con fallback (Semana 6).
 *
 * Qué hace: avisa de cambios de sincronización (registro sincronizado,
 * conflicto resuelto, fallo). Si la persona dio permiso y la aplicación está
 * en segundo plano, usa una notificación del sistema; en cualquier otro caso
 * (sin API, permiso denegado o sin decidir, aplicación a la vista) el aviso se
 * muestra dentro de la aplicación, así que el flujo sigue siendo útil sin la
 * capacidad.
 *
 * Qué no hace: nunca pide permiso por su cuenta. `requestPermission` solo debe
 * llamarse desde una acción del usuario (un clic). Tampoco usa push de
 * servidor: eso exigiría claves VAPID, que son credenciales. El texto no incluye
 * datos de la inspección ni de personas.
 *
 * Todo es inyectable (`NotifierDeps`) y nada lanza. Ver docs/capabilities.md.
 */

export type PermissionState = "granted" | "denied" | "default" | "unsupported";
export type NotificationKind = "synced" | "conflict" | "failed" | "info";
export type DeliveryChannel = "system" | "in-app" | "none";
export type DeliveryReason =
  | "delivered"
  | "disabled"
  | "unsupported"
  | "permission-denied"
  | "permission-default"
  | "app-visible"
  | "deduplicated"
  | "error";

export interface ChangeNotification {
  title: string;
  body: string;
  tag: string;
  kind: NotificationKind;
}

export interface NotifyResult {
  channel: DeliveryChannel;
  reason: DeliveryReason;
  notification: ChangeNotification;
}

export interface NotificationApiLike {
  permission: string;
  requestPermission(callback?: (permission: string) => void): Promise<string> | string | void;
}

export interface RegistrationLike {
  showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
}

export interface NotifierDeps {
  /** `null` fuerza "sin API"; `undefined` usa `Notification` del navegador. */
  notification?: NotificationApiLike | null;
  /** Vía preferida: el service worker, necesaria en Android donde `new Notification` no existe. */
  getRegistration?: () => Promise<RegistrationLike | undefined | null>;
  /** Vía de respaldo del sistema cuando no hay service worker. */
  createNotification?: (title: string, options?: Record<string, unknown>) => void;
  /** Se llama con todo aviso que no sale por el sistema. */
  inApp?: (notification: ChangeNotification) => void;
  isAppVisible?: () => boolean;
  isEnabled?: () => boolean;
  now?: () => number;
  /** Misma etiqueta dentro de esta ventana se considera repetida. */
  dedupeWindowMs?: number;
  iconUrl?: string;
  targetUrl?: string;
}

export interface NotifyOptions {
  /** Ignora que la aplicación esté a la vista (para el botón "Probar aviso"). */
  forceSystem?: boolean;
}

export interface SyncEventLike {
  type: string;
}

export const DEFAULT_DEDUPE_WINDOW_MS = 4000;
export const DEFAULT_TARGET_URL = "/inspecciones/nueva#sincronizacion";

function resolveNotificationApi(deps: NotifierDeps): NotificationApiLike | null {
  if (deps.notification !== undefined) return deps.notification;
  if (typeof Notification === "undefined") return null;
  return Notification as unknown as NotificationApiLike;
}

export function getPermissionState(deps: Pick<NotifierDeps, "notification"> = {}): PermissionState {
  const api = resolveNotificationApi(deps);
  if (!api) return "unsupported";
  const permission = api.permission;
  if (permission === "granted" || permission === "denied" || permission === "default") return permission;
  return "default";
}

/**
 * Pide el permiso. Solo debe llamarse desde una acción del usuario: los
 * navegadores lo ignoran o lo deniegan si no, y no se llama si ya hay decisión.
 */
export async function requestPermission(
  deps: Pick<NotifierDeps, "notification"> = {}
): Promise<PermissionState> {
  const api = resolveNotificationApi(deps);
  if (!api) return "unsupported";
  const current = getPermissionState(deps);
  if (current !== "default") return current;
  try {
    const answer = await new Promise<string>((resolve) => {
      const maybe = api.requestPermission((value) => resolve(value));
      if (maybe && typeof (maybe as Promise<string>).then === "function") {
        (maybe as Promise<string>).then(resolve, () => resolve("default"));
      } else if (typeof maybe === "string") {
        resolve(maybe);
      }
    });
    return answer === "granted" || answer === "denied" ? answer : "default";
  } catch {
    return "default";
  }
}

/** Convierte un evento de la cola de sincronización en un aviso, o `null` si no merece uno. */
export function buildChangeNotification(event: SyncEventLike): ChangeNotification | null {
  switch (event.type) {
    case "acked":
    case "duplicate":
      return {
        kind: "synced",
        tag: "sync-synced",
        title: "Inspección sincronizada",
        body: "Un registro guardado en este dispositivo ya está en el servidor."
      };
    case "conflict-resolved":
      return {
        kind: "conflict",
        tag: "sync-conflict",
        title: "Se resolvió un conflicto",
        body: "Se combinaron cambios hechos en otro dispositivo. Revisa el registro."
      };
    case "failed":
      return {
        kind: "failed",
        tag: "sync-failed",
        title: "No se pudo sincronizar",
        body: "Una inspección necesita atención. Reintenta desde el panel de sincronización."
      };
    default:
      return null;
  }
}

export interface Notifier {
  notify(notification: ChangeNotification, options?: NotifyOptions): Promise<NotifyResult>;
  handleSyncEvent(event: SyncEventLike): Promise<NotifyResult | null>;
}

export function createNotifier(deps: NotifierDeps = {}): Notifier {
  const now = deps.now || Date.now;
  const windowMs = deps.dedupeWindowMs === undefined ? DEFAULT_DEDUPE_WINDOW_MS : deps.dedupeWindowMs;
  const lastByTag: Record<string, number> = {};

  function fallback(notification: ChangeNotification, reason: DeliveryReason): NotifyResult {
    try {
      if (deps.inApp) deps.inApp(notification);
    } catch {
      /* un observador defectuoso no debe afectar al resto */
    }
    return { channel: "in-app", reason, notification };
  }

  async function notify(notification: ChangeNotification, options: NotifyOptions = {}): Promise<NotifyResult> {
    const at = now();
    const previous = lastByTag[notification.tag];
    if (previous !== undefined && at - previous < windowMs) {
      return { channel: "none", reason: "deduplicated", notification };
    }
    lastByTag[notification.tag] = at;

    if (deps.isEnabled && !deps.isEnabled()) return fallback(notification, "disabled");

    const permission = getPermissionState(deps);
    if (permission === "unsupported") return fallback(notification, "unsupported");
    if (permission === "denied") return fallback(notification, "permission-denied");
    if (permission === "default") return fallback(notification, "permission-default");

    if (!options.forceSystem && deps.isAppVisible && deps.isAppVisible()) {
      return fallback(notification, "app-visible");
    }

    const payload: Record<string, unknown> = {
      body: notification.body,
      tag: notification.tag,
      icon: deps.iconUrl || "/icons/icon-192.svg",
      data: { url: deps.targetUrl || DEFAULT_TARGET_URL, kind: notification.kind }
    };
    try {
      const registration = deps.getRegistration ? await deps.getRegistration() : undefined;
      if (registration && typeof registration.showNotification === "function") {
        await registration.showNotification(notification.title, payload);
        return { channel: "system", reason: "delivered", notification };
      }
      if (deps.createNotification) {
        deps.createNotification(notification.title, payload);
        return { channel: "system", reason: "delivered", notification };
      }
      return fallback(notification, "unsupported");
    } catch {
      return fallback(notification, "error");
    }
  }

  async function handleSyncEvent(event: SyncEventLike): Promise<NotifyResult | null> {
    const notification = buildChangeNotification(event);
    return notification ? notify(notification) : null;
  }

  return { notify, handleSyncEvent };
}

/** Dependencias por omisión del navegador (no se ejecutan en Node). */
export function createBrowserNotifierDeps(
  inApp: (notification: ChangeNotification) => void,
  isEnabled?: () => boolean
): NotifierDeps {
  return {
    inApp,
    isEnabled,
    isAppVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
    getRegistration: async () => {
      if (typeof navigator === "undefined" || !navigator.serviceWorker) return undefined;
      try {
        return (await navigator.serviceWorker.getRegistration()) as unknown as RegistrationLike | undefined;
      } catch {
        return undefined;
      }
    },
    createNotification: (title, options) => {
      if (typeof Notification !== "undefined") new Notification(title, options as NotificationOptions);
    }
  };
}
