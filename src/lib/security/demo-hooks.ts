/**
 * Interruptor de los ganchos de demostración (Semana 9).
 *
 * Desde las semanas 4 y 5 la aplicación expone ganchos para probar fallos sin
 * depender de un servicio externo: `?fallo=1`, `?perder=1` y `DELETE
 * /api/sync/inspections` (que vacía el servidor simulado). Son útiles en
 * pruebas y demostraciones, pero en un despliegue cualquiera podría usarlos
 * para borrar datos o forzar errores. Por mínimo privilegio ahora están
 * APAGADOS por omisión y solo se activan con `ENABLE_DEMO_HOOKS=1`.
 *
 * La variable se lee en cada petición (no al arrancar) para que las pruebas
 * puedan activarla y apagarla dentro del mismo proceso.
 */

export type EnvLike = Record<string, string | undefined>;

export function demoHooksEnabled(env?: EnvLike): boolean {
  const source = env || (typeof process !== "undefined" ? process.env : {});
  return source.ENABLE_DEMO_HOOKS === "1";
}
