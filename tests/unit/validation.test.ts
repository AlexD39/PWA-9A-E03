/**
 * Pruebas unitarias de la regla de validación de una captura (Semana 8).
 *
 * Riesgo cubierto: "captura inválida". Una inspección con datos malformados
 * nunca debe entrar a la cola ni al servidor. Se prueba la regla pura
 * `validateInspectionFields` (y las que dependen de ella) con entradas válidas
 * e inválidas y se afirma sobre el resultado, no solo sobre su existencia.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  validateIdempotencyKey,
  validateInspectionFields,
  validateRecordId,
  validateWireOperation
} from "../../src/lib/storage/schema";
import { validFields, wireOperation } from "../fixtures/inspections";

function errorsOf(input: unknown): string[] {
  const result = validateInspectionFields(input);
  assert.equal(result.ok, false, "se esperaba que la validación rechazara la entrada");
  return result.ok ? [] : result.errors;
}

describe("validateInspectionFields: entradas válidas", () => {
  it("acepta una captura completa y devuelve los valores normalizados", () => {
    const result = validateInspectionFields(validFields());
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, validFields());
  });

  it("recorta espacios y descarta campos desconocidos", () => {
    const result = validateInspectionFields({
      ...validFields({ location: "  Laboratorio B  ", inspector: " Persona 02 " }),
      extra: "no debe conservarse"
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.location, "Laboratorio B");
      assert.equal(result.value.inspector, "Persona 02");
      assert.equal("extra" in result.value, false);
    }
  });

  it("acepta los límites exactos de longitud y de hallazgos", () => {
    const edge = validFields({
      location: "L".repeat(LIMITS.locationMax),
      inspector: "I".repeat(LIMITS.inspectorMax),
      summary: "S".repeat(LIMITS.summaryMax),
      status: "attention",
      findings: LIMITS.findingsMax
    });
    assert.equal(validateInspectionFields(edge).ok, true);
  });

  it("acepta el 29 de febrero solo en año bisiesto", () => {
    assert.equal(validateInspectionFields(validFields({ date: "2028-02-29" })).ok, true);
    assert.match(errorsOf(validFields({ date: "2027-02-29" })).join(" "), /date:/);
  });
});

describe("validateInspectionFields: capturas inválidas", () => {
  it("rechaza lo que no es un objeto", () => {
    for (const input of [null, undefined, "texto", 42, [], [validFields()]]) {
      assert.deepEqual(errorsOf(input), ["fields: debe ser un objeto"]);
    }
  });

  it("exige laboratorio y responsable, incluso si solo hay espacios", () => {
    assert.match(errorsOf(validFields({ location: "" })).join(" "), /location:/);
    assert.match(errorsOf(validFields({ location: "   " })).join(" "), /location:/);
    assert.match(errorsOf(validFields({ inspector: "" })).join(" "), /inspector:/);
  });

  it("rechaza campos que exceden su longitud máxima", () => {
    assert.match(errorsOf(validFields({ location: "L".repeat(LIMITS.locationMax + 1) })).join(" "), /location:/);
    assert.match(errorsOf(validFields({ inspector: "I".repeat(LIMITS.inspectorMax + 1) })).join(" "), /inspector:/);
    assert.match(errorsOf(validFields({ summary: "S".repeat(LIMITS.summaryMax + 1) })).join(" "), /summary:/);
  });

  it("rechaza fechas con formato o calendario inválido", () => {
    for (const date of ["", "20/10/2026", "2026-2-3", "2026-02-30", "2026-13-01", "ayer"]) {
      assert.match(errorsOf(validFields({ date })).join(" "), /date:/, `la fecha "${date}" debió rechazarse`);
    }
  });

  it("rechaza hallazgos que no son enteros dentro de rango", () => {
    for (const findings of [-1, 1.5, Number.NaN, LIMITS.findingsMax + 1, "3" as unknown as number]) {
      const errors = errorsOf({ ...validFields({ status: "attention" }), findings });
      assert.match(errors.join(" "), /findings:/, `findings=${String(findings)} debió rechazarse`);
    }
  });

  it("rechaza un estado desconocido", () => {
    const errors = errorsOf({ ...validFields(), status: "critico" });
    assert.match(errors.join(" "), /status:/);
  });

  it("aplica la regla cruzada entre estado y hallazgos", () => {
    assert.match(errorsOf(validFields({ status: "ok", findings: 2 })).join(" "), /no admite hallazgos/);
    assert.match(errorsOf(validFields({ status: "attention", findings: 0 })).join(" "), /al menos 1 hallazgo/);
  });

  it("informa todos los errores a la vez, no solo el primero", () => {
    const errors = errorsOf({ location: "", date: "x", inspector: "", status: "ok", findings: 0, summary: "" });
    assert.equal(errors.length, 3);
  });
});

describe("identificadores y operaciones de sincronización", () => {
  it("valida el formato del id de registro", () => {
    assert.equal(validateRecordId("insp-abc").ok, true);
    for (const id of ["", "ab", "INSP-ABC", "insp_abc", "-insp", `a${"b".repeat(64)}`, 7, null]) {
      assert.equal(validateRecordId(id).ok, false, `el id ${JSON.stringify(id)} debió rechazarse`);
    }
  });

  it("valida el formato de la clave de idempotencia", () => {
    assert.equal(validateIdempotencyKey("op-fixture-0001").ok, true);
    for (const key of ["", "op", "op con espacios", "!op-1", undefined]) {
      assert.equal(validateIdempotencyKey(key).ok, false, `la clave ${JSON.stringify(key)} debió rechazarse`);
    }
  });

  it("acepta una operación bien formada y rechaza una sin clave de idempotencia", () => {
    assert.equal(validateWireOperation(wireOperation()).ok, true);
    const { idempotencyKey: _removed, ...withoutKey } = wireOperation();
    const result = validateWireOperation(withoutKey);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join(" "), /idempotencyKey/);
  });

  it("rechaza una revisión base negativa o fraccionaria y una marca de tiempo inválida", () => {
    assert.equal(validateWireOperation(wireOperation({ baseServerRevision: -1 })).ok, false);
    assert.equal(validateWireOperation(wireOperation({ baseServerRevision: 0.5 })).ok, false);
    assert.equal(validateWireOperation(wireOperation({ updatedAt: "no es fecha" })).ok, false);
  });
});
