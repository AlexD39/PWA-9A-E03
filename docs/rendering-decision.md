# Renderizado CSR/SSR — Semana 4

Compara dos rutas del mismo dominio (inspecciones) implementadas con estrategias de
renderizado distintas, con estados de carga y error verificables en ambas. Responde a
RF-01/RF-02 (listado y detalle) y a la restricción de conectividad intermitente ya
declarada en `docs/requirements.md`.

## 1. Qué se comparó

| | `src/app/inspecciones/page.tsx` | `src/app/inspecciones/[id]/page.tsx` |
|---|---|---|
| Estrategia | SSR (Server-Side Rendering) | CSR (Client-Side Rendering) |
| Tipo de componente | Server Component (`async function`, sin `"use client"`) | Client Component (`"use client"`) |
| Dónde se piden los datos | En el servidor, antes de enviar el HTML | En el navegador, después de montar la página |
| Contenido en el HTML inicial | Completo: las 3 inspecciones ya están en el `<body>` | Vacío: solo el estado de carga |
| Fuente de datos | `src/lib/data/inspections-repository.ts` (import directo) | Mismo repositorio, a través de `src/app/api/inspections/[id]/route.ts` |
| Config de Next.js | `export const dynamic = "force-dynamic"` + `revalidate = 0` | Ninguna especial; el propio uso de `useSearchParams` ya excluye la ruta de la generación estática |

Ambas rutas consultan el mismo dominio de datos (`src/lib/data/inspections-repository.ts`,
`src/lib/data/inspections.ts`), así que la comparación aísla la variable que importa: dónde
se ejecuta el renderizado, no qué datos se muestran.

## 2. Por qué esta asignación (listado = SSR, detalle = CSR)

- El **listado** es lo primero que ve cualquier persona al entrar a la sección. Que los
  datos ya vengan en el HTML inicial evita una pantalla vacía seguida de un salto de
  contenido, y funciona igual con JavaScript deshabilitado o en un lector que no ejecuta
  scripts.
- El **detalle** es una vista a la que se llega por interacción (un clic desde el listado).
  Ahí el costo de una segunda petición es aceptable a cambio de poder reintentar sin
  recargar toda la página — el botón "Reintentar" del estado de error solo repite el
  `fetch`, no la navegación completa.
- Es una decisión de producto, no una limitación técnica: ambas estrategias podrían
  aplicarse a cualquiera de las dos rutas. Se documenta aquí para que sea auditable.

## 3. Estados de carga y error

### Ruta SSR (`/inspecciones`)

El mecanismo es el de Next.js App Router, no un `if` dentro del componente:

- **Carga:** mientras `listInspections()` está pendiente, Next hace streaming del
  contenido de `src/app/inspecciones/loading.tsx` (un `<Suspense>` implícito por
  convención de archivo). Es una carga real: como la consulta tiene una latencia
  simulada de `DEFAULT_DELAY_MS` (350 ms), el fallback es visible en una conexión
  normal, no solo en teoría.
- **Error:** si `listInspections()` rechaza, Next.js monta
  `src/app/inspecciones/error.tsx`, el límite de error (`error boundary`) del segmento.
  Se reproduce de forma determinista visitando `/inspecciones?fallo=1`.
- **Contenido:** el `array` de inspecciones, ya resuelto, se recorre directamente en el
  JSX del Server Component.

### Ruta CSR (`/inspecciones/[id]`)

Aquí no hay archivos de convención de Next.js: los tres estados son ramas explícitas
dentro del componente, controladas por el resultado de
`fetchInspectionClient()` (`src/lib/rendering/fetch-inspection-client.ts`):

- **Carga:** estado inicial de React (`status: "loading"`), antes de que el primer
  `useEffect` corra. Se renderiza con el mismo componente `LoadingState` que usa la
  ruta SSR.
- **Error / no encontrado:** `fetchInspectionClient` nunca lanza; siempre resuelve una
  de tres formas (`ok`, `not-found`, `error`), igual que `registerServiceWorker` de la
  Semana 3 nunca lanza hacia quien lo llama. El estado `error` incluye un botón
  **Reintentar** que solo vuelve a llamar al `fetch`, sin recargar la ruta. Se reproduce
  con `/inspecciones/<id>?fallo=1` (error 500 simulado) o con un id inexistente
  (404 real, no simulado).
- **Contenido:** el objeto `inspection` recibido por `fetch`.

## 4. Cómo se evita el hydration mismatch

El requisito no funcional lo pide explícitamente. La única fuente real de mismatch en
este proyecto sería que el HTML que el servidor envía para un Client Component no
coincida con lo primero que React renderiza en el navegador antes de que corra ningún
efecto. Por eso:

- El estado inicial de `src/app/inspecciones/[id]/page.tsx` es siempre
  `{ status: "loading" }`, fijo, sin leer `Date.now()`, `Math.random()`,
  `window`, `navigator` ni el resultado de `useSearchParams()` para decidir qué
  renderizar en el primer render. El servidor y el cliente producen exactamente el
  mismo árbol (`LoadingState`) en ese primer render.
- Los datos reales, el conteo de milisegundos y cualquier rama condicional dependiente
  de red solo aparecen después de que `useEffect` corre, es decir, únicamente en el
  cliente, después de la hidratación. React no los compara contra el HTML del servidor.
- `src/components/loading-state.tsx` no tiene hooks ni estado: es idéntico sin importar
  dónde se ejecute, así que nunca puede ser la causa de un mismatch.
- Verificación real: `npm run build && npm run start`, visitar ambas rutas y revisar la
  consola del navegador. No aparece ninguna advertencia de
  "Hydration failed"/"Text content does not match" (ver `evidence/individual.md`).

## 5. Métrica de carga medida y repetible

Cada ruta muestra en pantalla el tiempo real de su propia operación, no un valor
inventado:

- SSR: `renderMs = Date.now() - startedAt` alrededor de `await listInspections()`,
  mostrado como "Renderizado en el servidor en N ms." Es el tiempo que el servidor
  tardó en tener los datos listos antes de enviar el HTML.
- CSR: `fetchedMs` calculado dentro de `fetchInspectionClient`, mostrado como
  "Renderizado en el cliente en N ms." Es el tiempo de ida y vuelta del `fetch` desde
  el navegador.

Cómo repetirlo:

```bash
npm run build
npm run start
curl -s -o /dev/null -w "TTFB=%{time_starttransfer}s total=%{time_total}s\n" http://localhost:3000/inspecciones
curl -s -o /dev/null -w "TTFB=%{time_starttransfer}s total=%{time_total}s\n" http://localhost:3000/api/inspections/inspection-001
```

**Hallazgo real, no intuitivo, al medir:** en `/inspecciones` el primer byte
(`time_starttransfer`) llega rápido (decenas de milisegundos), muy por debajo de
`DEFAULT_DELAY_MS`. No es un error: Next.js hace *streaming* de la respuesta y envía
primero el HTML de `loading.tsx` como primer fragmento, y el contenido resuelto llega en
un fragmento posterior dentro de la misma respuesta. Por eso la métrica comparable con la
latencia real de datos es `time_total` (consistentemente ~0.38–0.46 s en tres muestras
locales, coherente con los 350 ms de `DEFAULT_DELAY_MS` más el resto del trabajo), no
`time_starttransfer`. En `/api/inspections/<id>` (sin streaming: el Route Handler no
responde hasta terminar) `time_starttransfer` y `time_total` prácticamente coinciden
(~0.37–0.43 s en tres muestras locales), y ese número sí es directamente comparable con el
"Renderizado en el cliente en N ms." mostrado en pantalla, porque es la misma petición.

## 6. Supuestos

- `DEFAULT_DELAY_MS` (350 ms, en `src/lib/data/inspections-repository.ts`) simula una
  consulta a base de datos o servicio real; hoy los datos siguen siendo el arreglo
  sintético en memoria de `src/lib/data/inspections.ts`.
- El query param `fallo=1` es un gancho de prueba, no un concepto de producto. Existe en
  ambas rutas y en el Route Handler para que el estado de error sea reproducible sin
  depender de que algo falle de verdad.
- El listado no aplica paginación: son 3 registros sintéticos, alcance suficiente para
  esta actividad.
- El Route Handler (`src/app/api/inspections/[id]/route.ts`) es de solo lectura; no hay
  mutaciones esta semana.

## 7. Límites y riesgos conocidos

| Límite o riesgo | Impacto | Mitigación |
|---|---|---|
| `error.message` de un Server Component se redacta en producción (Next.js lo reemplaza por un texto genérico y un `digest`) | Un primer intento de mostrar el mensaje original en `error.tsx` habría mostrado texto en inglés y sin sentido para quien usa la app | `src/app/inspecciones/error.tsx` usa un mensaje fijo en español y muestra `error.digest` solo como referencia técnica, nunca `error.message` |
| El query param `fallo=1` queda accesible en producción | Cualquiera puede forzar el estado de error de la app | Aceptado para esta actividad de curso; en un despliegue real se protegería detrás de una bandera de entorno o se retiraría antes de producción |
| El indicador "En línea"/"Sin conexión" del encabezado usa `navigator.onLine`, no la latencia real | Puede decir "En línea" mientras una consulta específica falla | Ya documentado como límite conocido en `docs/cache-strategy.md` (Semana 3); no se resuelve aquí |
| Sin paginación ni búsqueda real en el listado | No escala más allá de los datos sintéticos actuales | Fuera de alcance de esta semana; el campo de búsqueda del panel principal (`src/app/page.tsx`) ya está deshabilitado por el mismo motivo |
| Las pruebas ejecutan el Server Component y el Route Handler directamente en Node, sin un navegador real | No verifican el streaming visual de `loading.tsx` ni el `error.tsx` renderizado por React en el cliente | Se complementa con la verificación manual en navegador descrita en el punto 5 y en `evidence/individual.md` |
