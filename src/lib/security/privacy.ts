/**
 * Minimización de datos personales en los campos de texto (Semana 9).
 *
 * La inspección trata del EQUIPO y del laboratorio, no de personas. Las únicas
 * personas que el sistema necesita nombrar son quienes inspeccionan (campo
 * `inspector`), y solo por trazabilidad. Cualquier otro dato personal que
 * alguien escriba por costumbre en un texto libre (un correo, un teléfono, una
 * CURP, un RFC o un número de tarjeta) no tiene finalidad en este tratamiento:
 * se rechaza antes de guardarse, en el cliente y en el servidor.
 *
 * Importante: los hallazgos NUNCA incluyen el valor detectado, solo su tipo y
 * posición. Así el mensaje de error, la bitácora y las pruebas no copian el dato
 * personal a otro lugar.
 *
 * Límites: son detecciones por patrón (no un clasificador). Pueden dar falsos
 * positivos (un número de inventario de 10 dígitos parece un teléfono) y no
 * detectan nombres propios. Ver docs/privacy-data-inventory.md.
 */

export type PersonalDataKind = "email" | "phone" | "curp" | "rfc" | "card";

export interface PersonalDataFinding {
  kind: PersonalDataKind;
  start: number;
  end: number;
}

export const PERSONAL_DATA_LABELS: Record<PersonalDataKind, string> = {
  email: "correo electrónico",
  phone: "teléfono",
  curp: "CURP",
  rfc: "RFC",
  card: "número de tarjeta"
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/**
 * Teléfono de 10 dígitos con o sin lada 52, solo en las agrupaciones habituales y con el MISMO
 * separador: 5512345678, 55 1234 5678, 656-123-4567 y 55 12 34 56 78. Exigir la agrupación evita
 * confundir una fecha con hora ("2026-10-20 15:30") o una lista de números con un teléfono.
 */
const PHONE =
  /(^|[^0-9])((?:\+?52[ .-]?)?(?:[0-9]{10}|[0-9]{2}([ .-])[0-9]{4}\3[0-9]{4}|[0-9]{3}([ .-])[0-9]{3}\4[0-9]{4}|[0-9]{2}([ .-])[0-9]{2}\5[0-9]{2}\5[0-9]{2}\5[0-9]{2}))(?![0-9])/g;
const CURP = /[A-Z]{4}[0-9]{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9][0-9]/gi;
const RFC = /(?:[A-ZÑ&]{4}|[A-ZÑ&]{3})[0-9]{6}[A-Z0-9]{3}/gi;
/** 13 a 19 dígitos seguidos, o agrupados como 4-4-4-4 y 4-6-5 con el mismo separador (y pasar Luhn). */
const CARD =
  /(^|[^0-9])((?:[0-9]{13,19})|(?:[0-9]{4}([ -])[0-9]{4}\3[0-9]{4}\3[0-9]{4})|(?:[0-9]{4}([ -])[0-9]{6}\4[0-9]{5}))(?![0-9])/g;

/** Algoritmo de Luhn: descarta secuencias de dígitos que no pueden ser una tarjeta. */
export function luhnValid(digits: string): boolean {
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function collect(pattern: RegExp, text: string, kind: PersonalDataKind, group: number, found: PersonalDataFinding[]) {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const value = match[group];
    const start = match.index + match[0].indexOf(value);
    if (kind !== "card" || luhnValid(value.replace(/[ -]/g, ""))) {
      found.push({ kind, start, end: start + value.length });
    }
    if (match[0].length === 0) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
}

export function findPersonalData(text: string): PersonalDataFinding[] {
  const found: PersonalDataFinding[] = [];
  if (typeof text !== "string" || text.length === 0) return found;
  collect(EMAIL, text, "email", 0, found);
  collect(PHONE, text, "phone", 2, found);
  collect(CURP, text, "curp", 0, found);
  collect(RFC, text, "rfc", 0, found);
  collect(CARD, text, "card", 2, found);
  const sorted = found.sort((a, b) => a.start - b.start);
  // Un dato contenido dentro de otro más largo es el mismo dato visto de otra forma (los 13
  // primeros caracteres de una CURP tienen la forma de un RFC): se informa una sola vez.
  return sorted.filter((finding, index) => {
    const size = finding.end - finding.start;
    return !sorted.some((other, otherIndex) => {
      if (otherIndex === index || other.start > finding.start || other.end < finding.end) return false;
      const otherSize = other.end - other.start;
      return otherSize > size || (otherSize === size && otherIndex < index);
    });
  });
}

/** Tipos detectados, sin repetir y sin valores: "correo electrónico, teléfono". */
export function describePersonalData(findings: PersonalDataFinding[]): string {
  const labels: string[] = [];
  findings.forEach((finding) => {
    const label = PERSONAL_DATA_LABELS[finding.kind];
    if (labels.indexOf(label) === -1) labels.push(label);
  });
  return labels.join(", ");
}

export function redactPersonalData(text: string, replacement = "[dato personal omitido]"): string {
  const findings = findPersonalData(text);
  if (findings.length === 0) return text;
  let result = "";
  let cursor = 0;
  findings.forEach((finding) => {
    if (finding.start < cursor) return;
    result += text.slice(cursor, finding.start) + replacement;
    cursor = finding.end;
  });
  return result + text.slice(cursor);
}
