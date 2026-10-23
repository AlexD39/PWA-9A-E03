/**
 * Transportes simulados para las pruebas de integración (Semana 8).
 *
 * La cola nunca habla con la red directamente: usa un `SyncTransport`. Aquí
 * hay tres que controlan la respuesta remota con exactitud:
 *
 *  - `offlineTransport`: no hay red; todo envío termina en `retry/network`.
 *  - `serverTransport`: aplica la operación sobre un `ServerStore` real
 *    (`applyOperation`), pudiendo "perder" la respuesta una cantidad dada de
 *    veces: el servidor sí aplicó la operación, pero el cliente no se entera.
 *  - `routeFetch`: un `fetch` que entrega la petición al manejador real de
 *    `src/app/api/sync/inspections/route.ts`, sin abrir ningún puerto.
 */

import { POST } from "../../src/app/api/sync/inspections/route";
import { applyOperation, type ServerStore } from "../../src/lib/sync/server-store";
import type { WireOperation } from "../../src/lib/storage/schema";
import type { SyncTransport, TransportResult } from "../../src/lib/sync/transport";

export interface RecordingTransport extends SyncTransport {
  /** Claves de idempotencia enviadas, en orden, incluyendo reintentos. */
  sent: string[];
}

export function offlineTransport(): RecordingTransport {
  const sent: string[] = [];
  return {
    sent,
    async send(operation: WireOperation): Promise<TransportResult> {
      sent.push(operation.idempotencyKey);
      return { kind: "retry", reason: "network", detail: "sin conexión (simulada)" };
    }
  };
}

export function serverTransport(
  store: ServerStore,
  options: { loseResponses?: number } = {}
): RecordingTransport {
  const sent: string[] = [];
  let toLose = options.loseResponses ?? 0;
  return {
    sent,
    async send(operation: WireOperation): Promise<TransportResult> {
      sent.push(operation.idempotencyKey);
      const result = applyOperation(store, operation);
      if (toLose > 0 && (result.kind === "applied" || result.kind === "duplicate")) {
        toLose -= 1;
        return { kind: "retry", reason: "server", detail: "HTTP 503 (respuesta perdida)" };
      }
      switch (result.kind) {
        case "applied":
          return { kind: "ack", record: result.record };
        case "duplicate":
          return { kind: "duplicate", record: result.record };
        case "conflict":
          return { kind: "conflict", remote: result.remote };
        default:
          return { kind: "rejected", errors: result.errors };
      }
    }
  };
}

/** `fetch` que invoca directamente el manejador POST de la ruta de sincronización. */
export function routeFetch(): typeof fetch {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return POST(new Request(String(input), init));
  };
  return handler as typeof fetch;
}
