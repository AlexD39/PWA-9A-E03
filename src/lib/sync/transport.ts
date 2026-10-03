/**
 * Transporte de sincronización (Semana 5).
 *
 * `SyncTransport` es el único punto por el que la cola habla con el
 * servidor, así que las pruebas inyectan uno simulado y la aplicación usa
 * `createHttpTransport`. Cada respuesta se clasifica en una de cinco formas:
 *
 *   ack        el servidor aplicó la operación.
 *   duplicate  el servidor ya la había aplicado (misma clave de idempotencia).
 *   conflict   el registro cambió en el servidor; incluye su versión actual.
 *   retry      fallo transitorio (red, 5xx, 429, respuesta ilegible).
 *   rejected   la operación es inválida; reintentarla no sirve.
 *
 * Nunca lanza: cualquier excepción se convierte en `retry`.
 */

import { validateInspectionFields, type ServerRecord, type WireOperation } from "../storage/schema";

export type RetryReason = "network" | "server" | "throttled" | "bad-response";

export type TransportResult =
  | { kind: "ack"; record: ServerRecord }
  | { kind: "duplicate"; record: ServerRecord }
  | { kind: "conflict"; remote: ServerRecord }
  | { kind: "retry"; reason: RetryReason; detail?: string; retryAfterMs?: number }
  | { kind: "rejected"; errors: string[] };

export interface SyncTransport {
  send(operation: WireOperation): Promise<TransportResult>;
}

export const SYNC_ENDPOINT = "/api/sync/inspections";

export interface HttpTransportOptions {
  fetchImpl?: typeof fetch;
  url?: string;
  /** Parámetros de consulta adicionales, p. ej. "fallo=1" para pruebas manuales. */
  query?: string;
  timeoutMs?: number;
}

function toServerRecord(value: unknown): ServerRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const fields = validateInspectionFields(candidate.fields);
  if (
    typeof candidate.id !== "string" ||
    !fields.ok ||
    typeof candidate.serverRevision !== "number" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    fields: fields.value,
    serverRevision: candidate.serverRevision,
    updatedAt: candidate.updatedAt
  };
}

export function createHttpTransport(options: HttpTransportOptions = {}): SyncTransport {
  const url = (options.url ?? SYNC_ENDPOINT) + (options.query ? `?${options.query}` : "");
  const timeoutMs = options.timeoutMs ?? 10000;

  return {
    async send(operation: WireOperation): Promise<TransportResult> {
      const fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
      if (!fetchImpl) {
        return { kind: "retry", reason: "network", detail: "fetch no disponible" };
      }

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operation.idempotencyKey
          },
          body: JSON.stringify(operation),
          cache: "no-store",
          signal: controller ? controller.signal : undefined
        });

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          return {
            kind: "retry",
            reason: "throttled",
            retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
          };
        }
        if (response.status >= 500) {
          return { kind: "retry", reason: "server", detail: `HTTP ${response.status}` };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { kind: "retry", reason: "bad-response", detail: `HTTP ${response.status} sin JSON` };
        }
        const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

        if (response.status === 409) {
          const remote = toServerRecord(payload.remote);
          return remote
            ? { kind: "conflict", remote }
            : { kind: "retry", reason: "bad-response", detail: "409 sin registro remoto" };
        }
        if (response.status === 400 || response.status === 422) {
          const errors = Array.isArray(payload.errors)
            ? payload.errors.filter((item): item is string => typeof item === "string")
            : [`HTTP ${response.status}`];
          return { kind: "rejected", errors };
        }
        if (response.ok) {
          const record = toServerRecord(payload.record);
          if (!record) {
            return { kind: "retry", reason: "bad-response", detail: "respuesta sin registro" };
          }
          return payload.status === "duplicate"
            ? { kind: "duplicate", record }
            : { kind: "ack", record };
        }
        return { kind: "rejected", errors: [`HTTP ${response.status}`] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "retry", reason: "network", detail: message };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}
