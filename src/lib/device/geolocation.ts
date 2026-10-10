/**
 * Ubicación opcional como evidencia (Semana 6).
 *
 * Una sola lectura, pedida por una acción explícita; nunca `watchPosition`, así
 * que no hay seguimiento. Precisión baja por omisión (sin GPS de alta
 * precisión) y coordenadas redondeadas a 3 decimales (unos 110 m, a nivel de
 * edificio): basta para ubicar un laboratorio y evita guardar el punto exacto
 * de una persona. Sin API, sin permiso, sin señal o sin respuesta a tiempo, la
 * captura sigue siendo posible sin ubicación.
 *
 * Todo es inyectable (`LocationDeps`) y nunca lanza. Ver docs/capabilities.md.
 */

export const LOCATION_LIMITS = {
  decimals: 3,
  timeoutMs: 8000,
  maxAgeMs: 60000
} as const;

export type LocationFailure = "denied" | "unsupported" | "unavailable" | "timeout" | "error";

export interface EvidenceLocation {
  latitude: number;
  longitude: number;
  /** Incertidumbre en metros, nunca menor que la del redondeo aplicado. */
  accuracyMeters: number;
  capturedAt: string;
}

export type LocationResult =
  | { status: "ok"; location: EvidenceLocation }
  | { status: LocationFailure; message: string };

export type LocationPermission = "granted" | "denied" | "prompt" | "unsupported";

export interface PositionLike {
  coords: { latitude: number; longitude: number; accuracy: number };
}

export interface GeolocationLike {
  getCurrentPosition(
    success: (position: PositionLike) => void,
    error: (error: { code?: number; message?: string }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }
  ): void;
}

export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>;
}

export interface LocationDeps {
  /** `null` fuerza "sin API"; `undefined` usa `navigator.geolocation`. */
  geolocation?: GeolocationLike | null;
  permissions?: PermissionsLike | null;
  now?: () => number;
  timeoutMs?: number;
  maxAgeMs?: number;
}

const MESSAGES: Record<LocationFailure, string> = {
  denied: "No hay permiso de ubicación. Puedes continuar sin ella: es opcional.",
  unsupported: "Este navegador no ofrece ubicación. Puedes continuar sin ella: es opcional.",
  unavailable: "No se pudo determinar la ubicación (sin señal o servicio apagado). Puedes continuar sin ella.",
  timeout: "La ubicación tardó demasiado. Puedes intentarlo de nuevo o continuar sin ella.",
  error: "No se pudo obtener la ubicación. Puedes continuar sin ella."
};

function failure(status: LocationFailure): LocationResult {
  return { status, message: MESSAGES[status] };
}

export function roundCoordinate(value: number, decimals: number = LOCATION_LIMITS.decimals): number {
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Incertidumbre mínima, en metros, que introduce el redondeo a `decimals` decimales. */
export function roundingMeters(decimals: number = LOCATION_LIMITS.decimals): number {
  return Math.ceil(111 * Math.pow(10, 3 - decimals));
}

export function mapGeolocationError(error: unknown): LocationFailure {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 1) return "denied";
  if (code === 2) return "unavailable";
  if (code === 3) return "timeout";
  return "error";
}

function resolveGeolocation(deps: LocationDeps): GeolocationLike | null {
  if (deps.geolocation !== undefined) return deps.geolocation;
  if (typeof navigator === "undefined") return null;
  return (navigator.geolocation as unknown as GeolocationLike | undefined) || null;
}

export function isGeolocationSupported(deps: LocationDeps = {}): boolean {
  const geo = resolveGeolocation(deps);
  return Boolean(geo && typeof geo.getCurrentPosition === "function");
}

/** Estado del permiso sin pedirlo (no muestra ningún aviso al usuario). */
export async function getLocationPermission(deps: LocationDeps = {}): Promise<LocationPermission> {
  if (!isGeolocationSupported(deps)) return "unsupported";
  const permissions =
    deps.permissions !== undefined
      ? deps.permissions
      : typeof navigator !== "undefined"
        ? ((navigator.permissions as unknown as PermissionsLike | undefined) || null)
        : null;
  if (!permissions || typeof permissions.query !== "function") return "prompt";
  try {
    const status = await permissions.query({ name: "geolocation" });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
    return "prompt";
  } catch {
    return "prompt";
  }
}

/** Una lectura aproximada. Debe llamarse desde una acción del usuario. */
export function requestLocation(deps: LocationDeps = {}): Promise<LocationResult> {
  const geo = resolveGeolocation(deps);
  if (!geo || typeof geo.getCurrentPosition !== "function") return Promise.resolve(failure("unsupported"));

  const now = deps.now || Date.now;
  const timeoutMs = deps.timeoutMs === undefined ? LOCATION_LIMITS.timeoutMs : deps.timeoutMs;
  const maxAgeMs = deps.maxAgeMs === undefined ? LOCATION_LIMITS.maxAgeMs : deps.maxAgeMs;

  return new Promise<LocationResult>((resolve) => {
    let settled = false;
    const finish = (result: LocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Red de seguridad: algunos navegadores nunca llaman a ninguna de las dos funciones.
    const timer = setTimeout(() => finish(failure("timeout")), timeoutMs + 1000);

    try {
      geo.getCurrentPosition(
        (position) => {
          const coords = position && position.coords;
          const lat = coords ? Number(coords.latitude) : NaN;
          const lon = coords ? Number(coords.longitude) : NaN;
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            finish(failure("error"));
            return;
          }
          const accuracy = coords && Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : 0;
          finish({
            status: "ok",
            location: {
              latitude: roundCoordinate(lat),
              longitude: roundCoordinate(lon),
              accuracyMeters: Math.max(Math.round(accuracy), roundingMeters()),
              capturedAt: new Date(now()).toISOString()
            }
          });
        },
        (error) => finish(failure(mapGeolocationError(error))),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maxAgeMs }
      );
    } catch {
      finish(failure("error"));
    }
  });
}
