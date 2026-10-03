# Política de persistencia local y sincronización — Semana 5

Responde a RF-03 y RNF-02 (la aplicación funciona sin conexión) y a RF-04 (registrar
inspecciones). Una inspección se guarda primero en el dispositivo y se sincroniza cuando hay
red, sin duplicar ni perder datos. Implementación en `src/lib/storage/` y `src/lib/sync/`;
comportamiento verificado por `tests/sync.spec.ts` y por la comprobación manual de la sección 12.

## 1. Modelo y almacenamiento

Tres almacenes de IndexedDB (`inspecciones-lab`, versión de esquema 1), todos con clave de texto:

| Almacén | Contenido | Clave |
|---|---|---|
| `records` | Última versión local de cada inspección, más la última versión que el servidor confirmó (`base`) | id del registro |
| `outbox` | Operaciones por enviar o ya resueltas, con su estado de envío | `idempotencyKey` |
| `meta` | `schemaVersion` y el contador `sequence` (orden de creación de operaciones) | nombre |

- **Validación en cada frontera.** `src/lib/storage/schema.ts` valida lo que entra (formulario y
  servidor) y también lo que se lee del almacén. Una entrada dañada se omite y queda registrada
  (`corrupt-entry-skipped`); no detiene la sincronización de las demás.
- **Reglas de los campos.** Ubicación (1–80), responsable (1–60), fecha `AAAA-MM-DD` válida,
  estado `ok` o `attention`, hallazgos entero 0–999, resumen hasta 500. Regla cruzada: `ok`
  exige 0 hallazgos y `attention` exige al menos 1.
- **Versión del esquema.** `ensureSchema` inicializa un almacén nuevo y **rechaza** uno de una
  versión más reciente que la de la aplicación, para no corromper datos que no entiende.
- **Escritura atómica.** Registro y operación se escriben en un solo lote (una transacción de
  IndexedDB). Si falla, no queda uno sin el otro.

Cada operación lleva el **estado completo** del registro, no un delta. Es más simple de razonar
y de reintentar: enviar dos veces el mismo estado es inofensivo.

## 2. Ciclo de vida de una operación

```
guardar ──▶ pending ──lease──▶ syncing ──ack──────────▶ done (applied)
              ▲  │                │ ├─duplicate──────▶ done (duplicate)
              │  │                │ ├─conflict───────▶ done (conflict-merged) + operación nueva
              │  └─ fallo ────────┘ ├─retry──────────▶ pending (backoff)
              │   reintentable      └─rejected / agotada ▶ failed
              └── recuperación: lease vencido (cierre de pestaña)
```

Por registro hay a lo sumo una operación en curso (la **cabeza**) y una posterior (la **cola**)
que absorbe nuevas ediciones. Solo la cabeza se envía, así que las ediciones llegan en orden.

## 3. Idempotencia: no duplicar

| Situación | Mecanismo |
|---|---|
| Doble clic o reenvío del mismo formulario | El formulario reutiliza el mismo id de borrador; guardar el mismo contenido devuelve `unchanged` y **no crea otra operación** |
| Edición antes del primer envío | Se funde en la misma operación (misma clave); no se acumulan operaciones |
| Reintento tras un fallo | Se reenvía la **misma `idempotencyKey`**, el mismo cuerpo y la misma revisión base |
| La respuesta se pierde (el servidor sí aplicó) | El reintento llega con la misma clave: el servidor devuelve `duplicate` con la respuesta original y **no aplica otra vez** |
| Misma información con otra clave | El servidor compara contenido y confirma sin crear una revisión nueva (duplicado semántico) |

La clave no se regenera nunca para una operación ya enviada. La base (`baseServerRevision`) se
fija en el **primer** envío y no cambia en los reintentos, para que el cuerpo sea idéntico.

## 4. Reintentos y backoff

Espera antes del siguiente intento: `base × 2^(intento−1)` con `base = 1 s`, tope de 30 s y jitter
de ±20 % (`computeBackoffMs`). Sin jitter: 1, 2, 4, 8, 16, 30, 30… segundos.

| Resultado del envío | Qué ocurre |
|---|---|
| Sin red, tiempo agotado | Reintento con backoff. **No gasta el presupuesto**: estar sin conexión no es un error de la operación |
| 5xx, 429, respuesta ilegible | Reintento con backoff y **sí cuenta**. Con 429 se respeta `Retry-After` si es mayor que el backoff |
| 5 fallos que no son de red | La operación pasa a `failed`; ya no se envía sola |
| 400 / 422 | `failed` de inmediato: reintentar una operación inválida no la arregla |

Una operación `failed` se reactiva con `retryFailed()` (botón "Reintentar fallidas"). Si el
usuario edita el registro, el estado nuevo la **reemplaza** (`superseded`), porque el último
estado es el que importa. Tras un fallo reintentable el ciclo **se detiene**: no se insiste
contra un servidor caído con cada operación pendiente. Al volver la red (`online`) se reintenta
de inmediato, sin esperar el backoff (`ignoreBackoff`).

## 5. Cierre de pestaña y recuperación

Antes de enviar, la operación se guarda como `syncing` con un **lease** (30 s) y un
identificador de envío. Si la pestaña muere a medias, la operación queda `syncing` en
IndexedDB. `recover()` (que también corre al inicio de cada `flush()`) devuelve a `pending` las de
lease vencido, y se reenvían con la misma clave. Si el primer envío sí había llegado, el servidor
responde `duplicate`. Al abrir la aplicación se usa `recover({ force: true })`: es seguro incluso
si otra pestaña sigue viva, justamente porque el reenvío es idempotente.

## 6. Respuestas fuera de orden o tardías

Cada envío lleva un identificador de lease. Al volver la respuesta se relee la operación:
si ya no está `syncing` o su identificador cambió (la recuperó otro intento), la respuesta se
**descarta** y queda registrada (`stale-response-ignored`); no modifica nada. Además, la
revisión del servidor que el cliente conoce **nunca retrocede**: una confirmación con una revisión
menor completa la operación pero no sobrescribe la base.

## 7. Política de conflictos

Hay conflicto cuando el servidor rechaza una operación porque el registro ya cambió (la revisión
base no coincide). Se resuelve **en el cliente** con una fusión de tres vías por campo
(`src/lib/sync/conflict-policy.ts`), con tres versiones: `base` (la última que el cliente sabía
del servidor), `local` y `remote`.

| Caso del campo | Resultado |
|---|---|
| `local` = `remote` | Ese valor |
| Solo cambió el local respecto a `base` | El local |
| Solo cambió el remoto respecto a `base` | El remoto |
| Cambiaron los dos a valores distintos | Regla del campo ↓ |

| Campo con cambio en ambos lados | Regla | Por qué |
|---|---|---|
| `status` | `attention` gana sobre `ok` | Nunca se oculta una alerta |
| `findings` | Se conserva el **máximo** | Nunca se pierde un hallazgo registrado |
| `location`, `date`, `inspector`, `summary` | Gana el cambio más reciente (`updatedAt`); empate: gana el servidor | Criterio determinista y explicable |

Invariante final: si la fusión deja hallazgos mayores que 0 con estado `ok`, el estado pasa a
`attention`. Cada decisión queda registrada con su regla y el valor descartado, de modo que
**ninguna pérdida de datos es silenciosa**. Si por cualquier motivo la fusión fuera inválida, se
adopta la versión del servidor completa (`fallback-remote`) en lugar de enviar datos inválidos en
bucle.

El resultado se reenvía como operación nueva sobre la revisión actual del servidor. Si lo editado
mientras la operación estaba en vuelo también debe fusionarse, la edición posterior se **reaplica
sobre la fusión**. Una cadena de conflictos que no converge termina en `failed` tras 5 fusiones.

**Ejemplo real** (verificado en navegador): el servidor tenía una inspección en revisión 1. Otro
dispositivo la pasó a `attention` con 2 hallazgos (revisión 2). Este dispositivo, sin saberlo,
cambió el resumen. La fusión devolvió `status` y `findings` del remoto (`solo-remoto`) y el resumen
local (`solo-local`); el servidor quedó en revisión 3 con los tres cambios y sin pérdidas.

## 8. Observabilidad

`queue.getLog()` guarda los últimos 200 eventos; `queue.subscribe()` los entrega en vivo; el panel
de `/inspecciones/nueva` los muestra junto con los contadores y el estado de cada registro.

| Evento | Significado |
|---|---|
| `enqueued`, `coalesced`, `unchanged`, `rejected-input` | Qué pasó al guardar |
| `send`, `acked`, `duplicate` | Envío y confirmación; `duplicate` = duplicado evitado |
| `retry-scheduled`, `failed`, `retried-failed` | Reintentos y operaciones agotadas |
| `conflict-resolved` | Estrategia y regla aplicada por campo |
| `recovered`, `stale-response-ignored` | Cierre de pestaña y respuestas obsoletas |
| `storage-error`, `corrupt-entry-skipped` | Fallos del almacenamiento local |

## 9. Servidor simulado

No hay backend real. `src/lib/sync/server-store.ts` (lógica pura) y
`src/app/api/sync/inspections/route.ts` (HTTP) simulan al servidor con un almacén en memoria:
idempotencia por clave, concurrencia optimista por revisión, duplicado semántico y validación
completa. Ganchos de prueba manual, en la línea de `?fallo=1` de la Semana 4:

| Gancho | Efecto |
|---|---|
| `?fallo=1` en la página | Toda petición recibe 503 sin procesarse |
| `?perder=1` en la página | El servidor **aplica** la operación y responde 503: la respuesta "se pierde" |
| `DELETE /api/sync/inspections` | Reinicia el almacén del servidor |

## 10. Supuestos

- Un solo usuario por navegador; no hay autenticación en esta semana.
- Los datos son sintéticos y no contienen información personal. El responsable es un alias.
- Los relojes de los dispositivos son razonablemente correctos; el criterio "más reciente" se
  apoya en `updatedAt` del cliente.
- No se implementa borrado de registros.

## 11. Límites y riesgos conocidos

| Límite o riesgo | Impacto | Mitigación o estado |
|---|---|---|
| El servidor simulado vive en memoria | Al reiniciar el servidor se pierden sus datos, aunque el dispositivo siga marcándolos como sincronizados (se observó en la verificación) | Aceptado: no hay base de datos real; un servidor real persistiría y reconciliaría |
| `processed` (claves de idempotencia) crece sin tope | Memoria ilimitada en un servidor de larga vida | Un servidor real expiraría las claves pasado un plazo |
| Ganchos `?fallo`, `?perder` y `DELETE` accesibles | Cualquiera puede forzar errores o vaciar el servidor simulado | Aceptado para esta actividad; se retirarían o protegerían antes de producción |
| Sin Web Locks entre pestañas | Dos pestañas pueden enviar la misma operación | Seguro: misma clave, el servidor deduplica; el lease evita pisarse |
| Conflictos por reloj | Un reloj adelantado gana los empates "más reciente" | Reglas de `status` y `findings` no dependen del reloj; el empate lo gana el servidor |
| El adaptador de IndexedDB no se ejecuta en Node | No lo cubren las pruebas automatizadas, solo la verificación manual | La lógica de la cola se prueba contra el adaptador en memoria, que cumple el mismo contrato |
| Sin sincronización en segundo plano | Con la pestaña cerrada no se sincroniza | La Background Sync API queda fuera de alcance; al reabrir se recupera y reenvía |
| El navegador puede vaciar IndexedDB (cuota, limpieza de datos) | Se perderían operaciones aún no sincronizadas | Fuera del control de la aplicación; se muestra el aviso cuando solo hay memoria |
| La página de captura offline depende de la caché de la Semana 3 | Solo abre sin red tras haberla visitado una vez con conexión | Documentado; precachearla requeriría un cambio de versión del service worker |

## 12. Cómo verificarlo

Automatizado: `npm test` y `npm run verify` (incluye `tests/sync.spec.ts`).

Manual, con `npm run build && npm run start`, en `http://localhost:3000/inspecciones/nueva`:

1. **Captura y sincronización.** Guardar una inspección: aparece "Guardado en este dispositivo" y,
   en segundos, "Sincronizado"; `GET /api/sync/inspections` muestra un registro.
2. **Sin conexión.** Detener el servidor y guardar otra: queda "Pendiente" con
   `network: Failed to fetch`; al volver el servidor se entrega sola.
3. **Persistencia.** Recargar la página: los registros siguen ahí (IndexedDB).
4. **Respuesta perdida.** Abrir `/inspecciones/nueva?perder=1`, guardar, esperar los reintentos y
   recargar sin el parámetro: el panel muestra "duplicado evitado" y el servidor conserva **un**
   registro por inspección en revisión 1.
5. **Conflicto.** Cambiar el registro en el servidor con `POST` y otra clave (base 1), editar el
   mismo registro desde la página y guardar: el servidor termina en revisión 3 con ambos cambios.
