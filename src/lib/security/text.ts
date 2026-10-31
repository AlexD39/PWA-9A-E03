/**
 * Saneamiento de texto de entrada (Semana 9).
 *
 * React escapa lo que se muestra, así que esto no es la defensa contra XSS (esa
 * es la CSP). Es higiene de datos: quita lo que no debe vivir en un registro.
 *
 *  - Caracteres de control: no tienen uso legítimo en un campo de texto y
 *    rompen exportaciones, bitácoras y comparaciones.
 *  - Caracteres de dirección bidireccional y espacios de ancho cero: permiten
 *    que un texto parezca otro (el ataque conocido como "Trojan Source") o
 *    que dos valores distintos se vean idénticos.
 *  - Normalización Unicode NFC: la misma palabra con acentos escrita de dos
 *    formas deja de ser dos valores distintos (afecta a la idempotencia y a
 *    la comparación de contenido).
 */

/** C0 y C1 sin tabulador, salto de línea ni retorno de carro. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Marcas de dirección, aislamientos bidireccionales y espacios de ancho cero. */
const INVISIBLE = /[؜​‎‏‪-‮⁠⁦-⁩﻿]/g;

export interface SanitizeOptions {
  /** Permite saltos de línea (un resumen). Por omisión el texto es de una sola línea. */
  multiline?: boolean;
}

export function sanitizeText(value: string, options: SanitizeOptions = {}): string {
  let text = typeof value.normalize === "function" ? value.normalize("NFC") : value;
  text = text.replace(CONTROL, "").replace(INVISIBLE, "");
  return options.multiline ? text.replace(/\r\n?/g, "\n") : text.replace(/[\t\n\r]+/g, " ");
}

/** `true` si el texto trae algo que `sanitizeText` quitaría. */
export function hasHiddenCharacters(value: string): boolean {
  CONTROL.lastIndex = 0;
  INVISIBLE.lastIndex = 0;
  return CONTROL.test(value) || INVISIBLE.test(value);
}
