/**
 * Datos sintéticos compartidos por las pruebas unitarias y de integración
 * (Semana 8). Todo es inventado: no hay personas, laboratorios ni coordenadas
 * reales. Cada función devuelve un objeto nuevo para que una prueba no pueda
 * contaminar a otra mutando el mismo valor.
 */

import type { InspectionFields, WireOperation } from "../../src/lib/storage/schema";

export const SYNTHETIC_NOW = Date.parse("2026-10-20T15:00:00.000Z");
export const SYNTHETIC_ISO = "2026-10-20T15:00:00.000Z";

export function validFields(overrides: Partial<InspectionFields> = {}): InspectionFields {
  return {
    location: "Laboratorio sintético A",
    date: "2026-10-20",
    inspector: "Persona Inspectora 01",
    status: "ok",
    findings: 0,
    summary: "Revisión sintética sin incidencias.",
    ...overrides
  };
}

export function wireOperation(overrides: Partial<WireOperation> = {}): WireOperation {
  return {
    idempotencyKey: "op-fixture-0001",
    recordId: "insp-fixture-0001",
    fields: validFields(),
    baseServerRevision: 0,
    updatedAt: SYNTHETIC_ISO,
    ...overrides
  };
}

/** Generador de ids predecible: `op-1`, `lease-2`, etc. Evita depender de `crypto`. */
export function sequentialIds(): (kind: "record" | "op" | "lease") => string {
  let counter = 0;
  return (kind) => {
    counter += 1;
    return `${kind}-${counter}`;
  };
}
