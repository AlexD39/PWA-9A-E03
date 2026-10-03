/**
 * Esquema de persistencia local y validación (Semana 5).
 *
 * Define qué se guarda en el dispositivo (`records` y `outbox`), cómo se
 * valida cada entrada antes de escribirla y leerla, y la interfaz mínima de
 * almacenamiento (`StorageAdapter`) que implementan `memory-storage.ts`
 * (pruebas y respaldo volátil) e `indexeddb-storage.ts` (navegador).
 *
 * Todo es TypeScript puro, sin DOM ni React: se ejecuta igual en Node, que es
 * lo que permite probar la cola de sincronización de forma determinista.
 */

export const DB_NAME = "inspecciones-lab";
export const CURRENT_SCHEMA_VERSION = 1;

export type StoreName = "records" | "outbox" | "meta";
export const STORE_NAMES: readonly StoreName[] = ["records", "outbox", "meta"];
export const META_SCHEMA_VERSION_KEY = "schemaVersion";
export const META_SEQUENCE_KEY = "sequence";

/* ---------- Dominio: campos de una inspección ---------- */

export type InspectionStatus = "ok" | "attention";

export interface InspectionFields {
  location: string;
  date: string;
  inspector: string;
  status: InspectionStatus;
  findings: number;
  summary: string;
}

export type FieldName = keyof InspectionFields;
export const FIELD_NAMES: readonly FieldName[] = [
  "location",
  "date",
  "inspector",
  "status",
  "findings",
  "summary"
];

export const LIMITS = {
  locationMax: 80,
  inspectorMax: 60,
  summaryMax: 500,
  findingsMax: 999
} as const;

const STATUS_LABELS: Record<InspectionStatus, string> = {
  ok: "Sin incidencias",
  attention: "Requiere atención"
};

export function statusLabelFor(status: InspectionStatus): string {
  return STATUS_LABELS[status];
}

/* ---------- Registros locales y cola de salida ---------- */

/** Última versión conocida del servidor para un registro; base de la fusión de tres vías. */
export interface ServerSnapshot {
  fields: InspectionFields;
  serverRevision: number;
  updatedAt: string;
}

export interface LocalRecord {
  id: string;
  fields: InspectionFields;
  /** Se incrementa en cada cambio local; nunca retrocede. */
  revision: number;
  updatedAt: string;
  base: ServerSnapshot | null;
  /** Mayor `revision` local confirmada por el servidor. */
  syncedRevision: number;
}

export type OperationStatus = "pending" | "syncing" | "done" | "failed";
export type OperationOutcome =
  | "applied"
  | "duplicate"
  | "conflict-merged"
  | "superseded";

export interface OutboxOperation {
  /** Clave de idempotencia: identifica esta operación ante el servidor en todos sus reintentos. */
  idempotencyKey: string;
  recordId: string;
  /** Estado completo del registro que esta operación quiere dejar en el servidor. */
  fields: InspectionFields;
  clientRevision: number;
  /** Revisión del servidor sobre la que se basa. `null` hasta el primer envío; luego queda fija. */
  baseServerRevision: number | null;
  updatedAt: string;
  status: OperationStatus;
  /** Envíos realizados (todos). */
  attempts: number;
  /** Fallos reintentables que NO fueron de red (5xx, 429, respuesta inválida). */
  failures: number;
  /** Cuántas fusiones de conflicto lleva esta cadena de operaciones. */
  conflicts: number;
  nextAttemptAt: number;
  /** Identifica el envío en curso; una respuesta con otro `leaseId` es obsoleta y se descarta. */
  leaseId: string | null;
  leaseExpiresAt: number | null;
  lastError: string | null;
  outcome: OperationOutcome | null;
  ackedServerRevision: number | null;
  createdAt: number;
  /** Orden global de creación. */
  sequence: number;
}

/* ---------- Contrato con el servidor ---------- */

export interface ServerRecord {
  id: string;
  fields: InspectionFields;
  serverRevision: number;
  updatedAt: string;
}

export interface WireOperation {
  idempotencyKey: string;
  recordId: string;
  fields: InspectionFields;
  baseServerRevision: number;
  updatedAt: string;
}

/* ---------- Interfaz de almacenamiento ---------- */

export interface BatchOp {
  store: StoreName;
  type: "put" | "delete";
  key: string;
  value?: unknown;
}

export interface StorageAdapter {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  /** Escritura atómica: se aplican todas las operaciones o ninguna. */
  applyBatch(ops: BatchOp[]): Promise<void>;
}

/* ---------- Validación ---------- */

/**
 * Las propiedades opcionales `undefined` de cada rama hacen que `.errors` y
 * `.value` se puedan leer también cuando el compilador no estrecha la unión
 * (p. ej. `tsc` sin `--strict`, como lo invoca scripts/run-tests.mjs). Con
 * `--strict` el estrechamiento por `ok` sigue funcionando igual.
 */
export type ValidationResult<T> =
  | { ok: true; value: T; errors?: undefined }
  | { ok: false; errors: string[]; value?: undefined };

const RECORD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateRecordId(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) {
    return {
      ok: false,
      errors: ["id: debe tener 3 a 64 caracteres en minúsculas, dígitos y guiones"]
    };
  }
  return { ok: true, value };
}

export function validateIdempotencyKey(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || !OPERATION_KEY_PATTERN.test(value)) {
    return { ok: false, errors: ["idempotencyKey: formato inválido"] };
  }
  return { ok: true, value };
}

/**
 * Valida y normaliza los campos de una inspección. Recorta espacios, descarta
 * campos desconocidos y aplica la regla cruzada: `ok` implica 0 hallazgos y
 * `attention` implica al menos 1.
 */
export function validateInspectionFields(input: unknown): ValidationResult<InspectionFields> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["fields: debe ser un objeto"] };
  }
  const errors: string[] = [];

  const location = typeof input.location === "string" ? input.location.trim() : "";
  if (location.length < 1 || location.length > LIMITS.locationMax) {
    errors.push(`location: obligatorio, máximo ${LIMITS.locationMax} caracteres`);
  }

  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!isValidCalendarDate(date)) {
    errors.push("date: debe ser una fecha válida con formato AAAA-MM-DD");
  }

  const inspector = typeof input.inspector === "string" ? input.inspector.trim() : "";
  if (inspector.length < 1 || inspector.length > LIMITS.inspectorMax) {
    errors.push(`inspector: obligatorio, máximo ${LIMITS.inspectorMax} caracteres`);
  }

  const status = input.status;
  if (status !== "ok" && status !== "attention") {
    errors.push('status: debe ser "ok" o "attention"');
  }

  const findings = input.findings;
  if (
    typeof findings !== "number" ||
    !Number.isInteger(findings) ||
    findings < 0 ||
    findings > LIMITS.findingsMax
  ) {
    errors.push(`findings: debe ser un entero entre 0 y ${LIMITS.findingsMax}`);
  }

  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (typeof input.summary !== "string" || summary.length > LIMITS.summaryMax) {
    errors.push(`summary: texto de máximo ${LIMITS.summaryMax} caracteres`);
  }

  if (errors.length === 0) {
    if (status === "ok" && findings !== 0) {
      errors.push('findings: el estado "ok" no admite hallazgos');
    }
    if (status === "attention" && (findings as number) < 1) {
      errors.push('findings: el estado "attention" requiere al menos 1 hallazgo');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      location,
      date,
      inspector,
      status: status as InspectionStatus,
      findings: findings as number,
      summary
    }
  };
}

export function validateWireOperation(input: unknown): ValidationResult<WireOperation> {
  if (!isRecord(input)) return { ok: false, errors: ["operación: debe ser un objeto"] };
  const errors: string[] = [];

  const key = validateIdempotencyKey(input.idempotencyKey);
  if (!key.ok) errors.push(...key.errors);
  const id = validateRecordId(input.recordId);
  if (!id.ok) errors.push(...id.errors);
  const fields = validateInspectionFields(input.fields);
  if (!fields.ok) errors.push(...fields.errors);

  const base = input.baseServerRevision;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
    errors.push("baseServerRevision: debe ser un entero mayor o igual a 0");
  }
  if (!isIsoTimestamp(input.updatedAt)) {
    errors.push("updatedAt: debe ser una marca de tiempo ISO válida");
  }

  if (errors.length > 0 || !key.ok || !id.ok || !fields.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      idempotencyKey: key.value,
      recordId: id.value,
      fields: fields.value,
      baseServerRevision: base as number,
      updatedAt: input.updatedAt as string
    }
  };
}

/* ---------- Guardas de lectura (datos guardados que podrían estar dañados) ---------- */

function isValidSnapshot(value: unknown): value is ServerSnapshot {
  return (
    isRecord(value) &&
    validateInspectionFields(value.fields).ok &&
    typeof value.serverRevision === "number" &&
    Number.isInteger(value.serverRevision) &&
    isIsoTimestamp(value.updatedAt)
  );
}

export function isLocalRecord(value: unknown): value is LocalRecord {
  if (!isRecord(value)) return false;
  return (
    validateRecordId(value.id).ok &&
    validateInspectionFields(value.fields).ok &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    isIsoTimestamp(value.updatedAt) &&
    typeof value.syncedRevision === "number" &&
    (value.base === null || isValidSnapshot(value.base))
  );
}

const OPERATION_STATUSES: readonly string[] = ["pending", "syncing", "done", "failed"];

export function isOutboxOperation(value: unknown): value is OutboxOperation {
  if (!isRecord(value)) return false;
  return (
    validateIdempotencyKey(value.idempotencyKey).ok &&
    validateRecordId(value.recordId).ok &&
    validateInspectionFields(value.fields).ok &&
    typeof value.status === "string" &&
    OPERATION_STATUSES.indexOf(value.status) >= 0 &&
    typeof value.attempts === "number" &&
    typeof value.failures === "number" &&
    typeof value.conflicts === "number" &&
    typeof value.nextAttemptAt === "number" &&
    typeof value.sequence === "number" &&
    typeof value.clientRevision === "number" &&
    (value.baseServerRevision === null || typeof value.baseServerRevision === "number") &&
    isIsoTimestamp(value.updatedAt)
  );
}

export function fieldsEqual(a: InspectionFields, b: InspectionFields): boolean {
  return FIELD_NAMES.every((name) => a[name] === b[name]);
}

/* ---------- Versión del esquema ---------- */

export type SchemaCheck =
  | { ok: true; version: number; migrated: boolean }
  | { ok: false; error: string };

/**
 * Garantiza que el almacén tenga una versión de esquema compatible. Un
 * almacén nuevo se inicializa; uno de una versión posterior a la de esta
 * aplicación se rechaza para no corromper datos que no entendemos.
 */
export async function ensureSchema(storage: StorageAdapter): Promise<SchemaCheck> {
  const stored = await storage.get<number>("meta", META_SCHEMA_VERSION_KEY);
  if (stored === undefined) {
    await storage.applyBatch([
      { store: "meta", type: "put", key: META_SCHEMA_VERSION_KEY, value: CURRENT_SCHEMA_VERSION }
    ]);
    return { ok: true, version: CURRENT_SCHEMA_VERSION, migrated: true };
  }
  if (typeof stored !== "number" || !Number.isInteger(stored) || stored < 1) {
    return { ok: false, error: `versión de esquema ilegible: ${String(stored)}` };
  }
  if (stored > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `el almacén es de una versión más reciente (${stored}) que la de esta aplicación (${CURRENT_SCHEMA_VERSION})`
    };
  }
  return { ok: true, version: stored, migrated: false };
}
