/**
 * Evidencia opcional por inspección (Semana 6).
 *
 * Guarda como máximo una foto y una ubicación por registro, en el almacén
 * `meta` bajo la clave `evidence:<recordId>`. Así no se toca el esquema de la
 * Semana 5 ni lo que se sincroniza: la evidencia es local y no se sube (subir
 * adjuntos exigiría un servicio de archivos que este proyecto no tiene).
 *
 * Minimización de datos: se valida cada pieza (formato, tamaño, precisión de
 * las coordenadas) y, cuando no queda ni foto ni ubicación, la clave se borra
 * en vez de guardar un registro vacío.
 */

import { isIsoTimestamp, validateRecordId, type StorageAdapter } from "../storage/schema";
import { PHOTO_LIMITS, dataUrlBytes, type EvidencePhoto } from "./camera";
import { LOCATION_LIMITS, roundCoordinate, type EvidenceLocation } from "./geolocation";

export const EVIDENCE_KEY_PREFIX = "evidence:";

export interface RecordEvidence {
  recordId: string;
  photo: EvidencePhoto | null;
  location: EvidenceLocation | null;
  updatedAt: string;
}

/** `undefined` conserva lo que hay, `null` lo quita y un objeto lo reemplaza. */
export interface EvidencePatch {
  photo?: unknown;
  location?: unknown;
}

export type EvidenceResult =
  | { status: "ok"; evidence: RecordEvidence | null }
  | { status: "invalid"; errors: string[] }
  | { status: "storage-error"; message: string };

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= PHOTO_LIMITS.maxDimension;
}

export function validatePhoto(
  input: unknown
): { ok: true; value: EvidencePhoto; errors?: undefined } | { ok: false; errors: string[]; value?: undefined } {
  if (!isObject(input)) return { ok: false, errors: ["photo: debe ser un objeto"] };
  const errors: string[] = [];
  const dataUrl = input.dataUrl;
  if (typeof dataUrl !== "string" || !JPEG_DATA_URL.test(dataUrl)) {
    errors.push("photo.dataUrl: debe ser una imagen JPEG en base64");
  } else {
    const bytes = dataUrlBytes(dataUrl);
    if (bytes > PHOTO_LIMITS.maxBytes) errors.push(`photo: supera ${PHOTO_LIMITS.maxBytes} bytes`);
    if (input.bytes !== bytes) errors.push("photo.bytes: no coincide con el contenido");
  }
  if (input.mimeType !== "image/jpeg") errors.push('photo.mimeType: debe ser "image/jpeg"');
  if (!isDimension(input.width) || !isDimension(input.height)) {
    errors.push(`photo: ancho y alto deben ser enteros entre 1 y ${PHOTO_LIMITS.maxDimension}`);
  }
  if (!isIsoTimestamp(input.capturedAt)) errors.push("photo.capturedAt: marca de tiempo ISO inválida");
  if (input.source !== "camera" && input.source !== "file") errors.push('photo.source: "camera" o "file"');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      dataUrl: input.dataUrl as string,
      mimeType: "image/jpeg",
      width: input.width as number,
      height: input.height as number,
      bytes: input.bytes as number,
      capturedAt: input.capturedAt as string,
      source: input.source as "camera" | "file"
    }
  };
}

export function validateLocation(
  input: unknown
): { ok: true; value: EvidenceLocation; errors?: undefined } | { ok: false; errors: string[]; value?: undefined } {
  if (!isObject(input)) return { ok: false, errors: ["location: debe ser un objeto"] };
  const errors: string[] = [];
  const lat = input.latitude;
  const lon = input.longitude;
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    errors.push("location.latitude: número entre -90 y 90");
  } else if (roundCoordinate(lat, LOCATION_LIMITS.decimals) !== lat) {
    errors.push(`location.latitude: demasiado precisa (máximo ${LOCATION_LIMITS.decimals} decimales)`);
  }
  if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    errors.push("location.longitude: número entre -180 y 180");
  } else if (roundCoordinate(lon, LOCATION_LIMITS.decimals) !== lon) {
    errors.push(`location.longitude: demasiado precisa (máximo ${LOCATION_LIMITS.decimals} decimales)`);
  }
  const accuracy = input.accuracyMeters;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 1 || accuracy > 100000) {
    errors.push("location.accuracyMeters: número entre 1 y 100000");
  }
  if (!isIsoTimestamp(input.capturedAt)) errors.push("location.capturedAt: marca de tiempo ISO inválida");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      latitude: lat as number,
      longitude: lon as number,
      accuracyMeters: accuracy as number,
      capturedAt: input.capturedAt as string
    }
  };
}

function keyFor(recordId: string): string {
  return EVIDENCE_KEY_PREFIX + recordId;
}

function isStoredEvidence(value: unknown, recordId: string): value is RecordEvidence {
  if (!isObject(value) || value.recordId !== recordId || !isIsoTimestamp(value.updatedAt)) return false;
  const photoOk = value.photo === null || validatePhoto(value.photo).ok;
  const locationOk = value.location === null || validateLocation(value.location).ok;
  return photoOk && locationOk;
}

export async function loadEvidence(storage: StorageAdapter, recordId: string): Promise<RecordEvidence | null> {
  try {
    const raw = await storage.get<unknown>("meta", keyFor(recordId));
    return raw !== undefined && isStoredEvidence(raw, recordId) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveEvidence(
  storage: StorageAdapter,
  recordId: string,
  patch: EvidencePatch,
  now: () => number = Date.now
): Promise<EvidenceResult> {
  const idCheck = validateRecordId(recordId);
  if (!idCheck.ok) return { status: "invalid", errors: idCheck.errors };

  const errors: string[] = [];
  let photo: EvidencePhoto | null | undefined;
  let location: EvidenceLocation | null | undefined;

  if (patch.photo === null) photo = null;
  else if (patch.photo !== undefined) {
    const check = validatePhoto(patch.photo);
    if (check.ok) photo = check.value;
    else errors.push(...check.errors);
  }
  if (patch.location === null) location = null;
  else if (patch.location !== undefined) {
    const check = validateLocation(patch.location);
    if (check.ok) location = check.value;
    else errors.push(...check.errors);
  }
  if (errors.length > 0) return { status: "invalid", errors };

  try {
    const current = await loadEvidence(storage, recordId);
    const next: RecordEvidence = {
      recordId,
      photo: photo === undefined ? (current ? current.photo : null) : photo,
      location: location === undefined ? (current ? current.location : null) : location,
      updatedAt: new Date(now()).toISOString()
    };
    if (next.photo === null && next.location === null) {
      await storage.applyBatch([{ store: "meta", type: "delete", key: keyFor(recordId) }]);
      return { status: "ok", evidence: null };
    }
    await storage.applyBatch([{ store: "meta", type: "put", key: keyFor(recordId), value: next }]);
    return { status: "ok", evidence: next };
  } catch (error) {
    return { status: "storage-error", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeEvidence(
  storage: StorageAdapter,
  recordId: string,
  part: "photo" | "location" | "all" = "all",
  now: () => number = Date.now
): Promise<EvidenceResult> {
  if (part === "all") return saveEvidence(storage, recordId, { photo: null, location: null }, now);
  return saveEvidence(storage, recordId, part === "photo" ? { photo: null } : { location: null }, now);
}
