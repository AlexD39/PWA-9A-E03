/**
 * Captura opcional de una foto como evidencia (Semana 6).
 *
 * Principios: la cámara solo se pide por una acción explícita de la persona
 * usuaria; sin cámara, sin permiso o sin API la aplicación sigue siendo útil
 * (hay una vía alternativa por archivo y la evidencia es opcional); y se
 * recolecta lo mínimo: la imagen se redibuja en un lienzo, se reduce y se
 * recodifica como JPEG, con lo que se descartan los metadatos del original
 * (EXIF: ubicación, modelo del dispositivo, fecha). Las pistas de la cámara se
 * detienen siempre, aunque falle algo, para que el indicador de la cámara se
 * apague.
 *
 * La lógica es pura y las dependencias del navegador se inyectan
 * (`CameraDeps`), así que se prueba en Node sin cámara real. Nada lanza: todo
 * se resuelve como un resultado con `status`. Ver docs/capabilities.md.
 */

export const PHOTO_LIMITS = {
  /** Lado mayor máximo, en píxeles. */
  maxDimension: 1024,
  jpegQuality: 0.7,
  minJpegQuality: 0.4,
  /** Tamaño máximo de la imagen ya codificada. */
  maxBytes: 250000,
  /** Tamaño máximo aceptado de un archivo de entrada antes de procesarlo. */
  maxInputBytes: 10 * 1024 * 1024,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp"]
} as const;

export type CameraFailure =
  | "denied"
  | "unsupported"
  | "no-device"
  | "busy"
  | "cancelled"
  | "invalid"
  | "error";

export interface EvidencePhoto {
  dataUrl: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
  capturedAt: string;
  source: "camera" | "file";
}

export type CameraResult =
  | { status: "ok"; photo: EvidencePhoto }
  | { status: CameraFailure; message: string };

/** Imagen sin procesar, ya capturada o decodificada, antes de reducirla. */
export interface RawImage {
  width: number;
  height: number;
  source: unknown;
}

export interface EncodedImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface MediaDevicesLike {
  getUserMedia(constraints: unknown): Promise<MediaStreamLike>;
}

export interface FileLike {
  type: string;
  size: number;
}

export interface CameraDeps {
  /** `null` fuerza "sin API"; `undefined` usa `navigator.mediaDevices`. */
  mediaDevices?: MediaDevicesLike | null;
  grabFrame?: (stream: MediaStreamLike) => Promise<RawImage>;
  decodeFile?: (file: FileLike) => Promise<RawImage>;
  encode?: (raw: RawImage, limits: typeof PHOTO_LIMITS) => Promise<EncodedImage>;
  now?: () => number;
}

const MESSAGES: Record<CameraFailure, string> = {
  denied: "No hay permiso para usar la cámara. Puedes elegir una imagen o continuar sin evidencia.",
  unsupported: "Este navegador no ofrece acceso a la cámara. Puedes elegir una imagen o continuar sin evidencia.",
  "no-device": "No se encontró una cámara disponible. Puedes elegir una imagen o continuar sin evidencia.",
  busy: "La cámara está en uso por otra aplicación. Ciérrala e inténtalo de nuevo, o elige una imagen.",
  cancelled: "No se seleccionó ninguna imagen.",
  invalid: "El archivo no es una imagen válida o es demasiado grande.",
  error: "No se pudo obtener la imagen. Puedes intentarlo de nuevo o continuar sin evidencia."
};

function failure(status: CameraFailure, message?: string): CameraResult {
  return { status, message: message || MESSAGES[status] };
}

/** Reduce proporcionalmente para que el lado mayor no pase de `max`; nunca agranda. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const largest = Math.max(width, height);
  if (largest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/** Bytes reales que representa un data URL en base64. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function mapCameraError(error: unknown): Exclude<CameraFailure, "unsupported" | "cancelled" | "invalid"> {
  const name = typeof error === "object" && error !== null ? String((error as { name?: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "error";
}

export function isCameraSupported(deps: CameraDeps = {}): boolean {
  const devices = resolveMediaDevices(deps);
  return Boolean(devices && typeof devices.getUserMedia === "function");
}

export function validateImageFile(
  file: FileLike | null | undefined
): { ok: true; reason?: undefined } | { ok: false; reason: "cancelled" | "invalid" } {
  if (!file) return { ok: false, reason: "cancelled" };
  const accepted = PHOTO_LIMITS.acceptedTypes as readonly string[];
  if (accepted.indexOf(file.type) < 0) return { ok: false, reason: "invalid" };
  if (!(file.size > 0) || file.size > PHOTO_LIMITS.maxInputBytes) return { ok: false, reason: "invalid" };
  return { ok: true };
}

/**
 * Busca la mejor codificación dentro del presupuesto de bytes: primero baja la
 * calidad hasta `minJpegQuality` y, si aún no cabe, reduce las dimensiones.
 * `render` dibuja y codifica a un tamaño y calidad dados (en el navegador usa
 * un lienzo; en las pruebas es un simulador).
 */
export function shrinkToBudget(
  raw: { width: number; height: number },
  render: (width: number, height: number, quality: number) => string,
  limits: typeof PHOTO_LIMITS = PHOTO_LIMITS
): EncodedImage | null {
  let size = fitWithin(raw.width, raw.height, limits.maxDimension);
  if (size.width === 0) return null;
  for (let round = 0; round < 6; round += 1) {
    let quality: number = limits.jpegQuality;
    while (quality >= limits.minJpegQuality - 1e-9) {
      const dataUrl = render(size.width, size.height, quality);
      const bytes = dataUrlBytes(dataUrl);
      if (bytes > 0 && bytes <= limits.maxBytes) {
        return { dataUrl, width: size.width, height: size.height, bytes };
      }
      quality -= 0.1;
    }
    size = fitWithin(size.width * 0.8, size.height * 0.8, limits.maxDimension);
    if (size.width < 16 || size.height < 16) break;
  }
  return null;
}

function resolveMediaDevices(deps: CameraDeps): MediaDevicesLike | null {
  if (deps.mediaDevices !== undefined) return deps.mediaDevices;
  if (typeof navigator === "undefined") return null;
  return (navigator.mediaDevices as unknown as MediaDevicesLike | undefined) || null;
}

function stopStream(stream: MediaStreamLike | null): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* una pista que no se puede detener no debe impedir detener las demás */
      }
    });
  } catch {
    /* idem */
  }
}

async function finish(
  raw: RawImage,
  source: "camera" | "file",
  deps: CameraDeps
): Promise<CameraResult> {
  const encode = deps.encode || browserEncode;
  const now = deps.now || Date.now;
  let encoded: EncodedImage | null;
  try {
    encoded = await encode(raw, PHOTO_LIMITS);
  } catch {
    return failure("error");
  }
  if (!encoded || encoded.bytes <= 0 || encoded.bytes > PHOTO_LIMITS.maxBytes) {
    return failure("invalid", "La imagen no se pudo reducir al tamaño permitido.");
  }
  return {
    status: "ok",
    photo: {
      dataUrl: encoded.dataUrl,
      mimeType: "image/jpeg",
      width: encoded.width,
      height: encoded.height,
      bytes: encoded.bytes,
      capturedAt: new Date(now()).toISOString(),
      source
    }
  };
}

/** Pide la cámara (debe llamarse desde una acción del usuario), toma un fotograma y la libera. */
export async function capturePhoto(deps: CameraDeps = {}): Promise<CameraResult> {
  const devices = resolveMediaDevices(deps);
  if (!devices || typeof devices.getUserMedia !== "function") return failure("unsupported");

  let stream: MediaStreamLike | null = null;
  try {
    stream = await devices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false
    });
  } catch (error) {
    return failure(mapCameraError(error));
  }

  try {
    const grab = deps.grabFrame || browserGrabFrame;
    const raw = await grab(stream);
    return await finish(raw, "camera", deps);
  } catch (error) {
    return failure(mapCameraError(error));
  } finally {
    stopStream(stream);
  }
}

/** Vía alternativa sin permisos: procesa un archivo elegido por la persona usuaria. */
export async function photoFromFile(
  file: FileLike | null | undefined,
  deps: CameraDeps = {}
): Promise<CameraResult> {
  const check = validateImageFile(file);
  if (!check.ok) return failure(check.reason);
  try {
    const decode = deps.decodeFile || browserDecodeFile;
    const raw = await decode(file as FileLike);
    return await finish(raw, "file", deps);
  } catch {
    return failure("invalid");
  }
}

/* ---------- implementaciones por omisión del navegador (no se ejecutan en Node) ---------- */

function drawToDataUrl(source: unknown, width: number, height: number, quality: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function browserEncode(raw: RawImage, limits: typeof PHOTO_LIMITS): Promise<EncodedImage> {
  const encoded = shrinkToBudget(
    raw,
    (width, height, quality) => drawToDataUrl(raw.source, width, height, quality),
    limits
  );
  if (!encoded) throw new Error("no se pudo codificar la imagen");
  return encoded;
}

async function browserGrabFrame(stream: MediaStreamLike): Promise<RawImage> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream as unknown as MediaStream;
  await video.play();
  // Un instante para que el sensor ajuste exposición y enfoque antes del fotograma.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("la cámara no entregó imagen");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no hay contexto de dibujo");
  context.drawImage(video, 0, 0, width, height);
  video.srcObject = null;
  return { width, height, source: canvas };
}

async function browserDecodeFile(file: FileLike): Promise<RawImage> {
  const bitmap = await createImageBitmap(file as unknown as Blob);
  return { width: bitmap.width, height: bitmap.height, source: bitmap };
}
