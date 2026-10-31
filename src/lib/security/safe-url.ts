/**
 * Rutas internas seguras (Semana 9).
 *
 * Un destino que llega de fuera del código (un aviso, un parámetro, un dato
 * guardado) no debe poder llevar a la persona a otro sitio: eso es una
 * redirección abierta, base de suplantación. Solo se acepta una RUTA del mismo
 * origen: empieza con una sola `/`, sin barras invertidas, sin espacios ni
 * caracteres de control y de tamaño acotado.
 *
 * `public/sw.js` aplica la misma regla en `safeNotificationUrl` (un service
 * worker no puede importar módulos); `tests/security.spec.ts` ejecuta ambas con
 * las mismas entradas hostiles para que no se desalineen.
 */

export const MAX_PATH_LENGTH = 512;

export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  if (value.charAt(0) !== "/" || value.charAt(1) === "/") return false;
  if (value.indexOf("\\") !== -1) return false;
  return !/[\u0000- \u007F-\u009F]/.test(value);
}

/** Devuelve `value` si es una ruta interna segura; si no, `fallback`. */
export function safeInternalPath(value: unknown, fallback: string): string {
  return isSafeInternalPath(value) ? value : fallback;
}
