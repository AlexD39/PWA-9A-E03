# Estrategia de pruebas — Semana 8

Convierte el flujo que ya existe (**crear → guardar sin conexión → recargar → reconectar →
sincronizar sin duplicar**, más la variante con una capacidad del dispositivo denegada o
ausente) en pruebas repetibles, organizadas en una pirámide y automatizadas en CI. No se
construyó otra versión de la PWA: las pruebas se agregan sobre la de la Semana 6.

## 1. Diagnóstico inicial

Antes de escribir pruebas se ejecutó la PWA tal como quedó al terminar la Semana 6
(`npm ci`, `npm run build`, `npm run start`, y las siete suites existentes).

| Qué se hizo | Resultado observado |
|---|---|
| `npm ci` y `npm run build` | Correctos |
| `npm test` (7 suites previas, `sync.spec.ts` con 69 casos y `capabilities.spec.ts` con 47) | En verde |
| Flujo manual en el navegador: guardar con el envío al servidor bloqueado, recargar y sincronizar | El registro quedó pendiente (1 operación), sobrevivió a la recarga y se sincronizó una sola vez (1 registro y 1 clave en el servidor) |
| Lint | No existía configuración; se agregó y el código existente pasó sin cambios |
| Cobertura, E2E y reportes de resultados | No existían |

**Fallos y bloqueos encontrados** (ninguno impidió probar el flujo, pero los tres primeros
habrían producido pruebas engañosas):

1. **Reutilizar un servidor ya abierto da resultados falsos.** Playwright reutilizaba un
   `next start` viejo que quedó vivo y la E2E "pasaba" contra una compilación anterior, incluso
   con el defecto controlado de la sección 6. Se configuró `reuseExistingServer: false`: si el
   puerto está ocupado, la prueba falla con un mensaje claro en lugar de dar un falso verde.
2. **El modo estricto de TypeScript hacía "detectar" defectos por error de compilación**, no por
   una prueba. Al romper el código a propósito se comprueba que falle una aserción, no la
   compilación (`scripts/run-layer.mjs` compila en modo estricto).
3. **Dos elementos con rol `status`** (el aviso de instalación y el aviso de guardado) hacían
   ambiguo el selector de la E2E. Se acotó con `filter({ hasText })`. No es un fallo de la
   aplicación, pero un lector de pantalla anuncia ambos.
4. Tras recargar sin conexión, una operación pendiente no se reenvía hasta que ocurre el evento
   `online`, la persona pulsa "Sincronizar ahora" o pasan hasta 10 s (el intervalo de
   sincronización). Es el comportamiento diseñado; las pruebas lo esperan en lugar de forzarlo.
5. Rótulos de interfaz desactualizados ("Semana 5" en la cabecera de captura). Es cosmético y
   no se corrigió esta semana.

**No se pudo ejecutar** y por tanto no se declara aprobado: una captura con cámara real, una
notificación del sistema con permiso concedido, IndexedDB real dentro de las pruebas de Node
(solo se ejerce con el navegador, en la E2E) y la ejecución en GitHub Actions desde esta
máquina (se registra en el README con el enlace a la corrida).

## 2. Riesgos y matriz riesgo → prueba → capa

| Riesgo | Qué se rompería | Capa elegida | Prueba | Por qué esa capa |
|---|---|---|---|---|
| **Captura inválida** | Entraría a la cola o al servidor un registro malformado | Unitaria | `tests/unit/validation.test.ts` | Es una regla pura con muchas combinaciones de entrada: barata y exhaustiva en Node, sin navegador |
| Captura inválida (interfaz) | La persona no vería por qué se rechaza su captura | E2E | `critical-flow.spec.ts` › "captura inválida" | Solo el navegador demuestra que el mensaje llega a la pantalla y que no se guarda nada |
| **Persistencia / reconexión** | Perder una inspección guardada sin red o al recargar | Integración | `tests/integration/offline-persistence.test.ts` | Hay que ensamblar cola + almacén + servidor; el almacén en memoria tiene la misma interfaz que IndexedDB y permite simular una "recarga" con una segunda cola |
| Persistencia (real) | IndexedDB, caché del service worker o recarga real no funcionan | E2E | `critical-flow.spec.ts` › flujo con desconexión | La desconexión (`setOffline`), el service worker y IndexedDB solo existen en un navegador |
| **Duplicado de sincronización** | Un reintento crearía otra revisión o registro | Unitaria + integración + E2E | `queue-rules.test.ts`, `sync-duplicates.test.ts`, E2E "respuesta perdida" | La regla vive en la cola y en el servidor (unitaria); el caso difícil (el servidor aplicó pero el cliente no lo supo) requiere ensamblar cliente HTTP y ruta (integración); la E2E confirma lo que ve la persona |
| **Permisos del dispositivo** | Una capacidad denegada o ausente bloquearía la captura | Unitaria + E2E | `tests/unit/device-fallbacks.test.ts`, E2E "denegada o ausente" | Los estados de fallo se simulan con determinismo en Node; la E2E demuestra que la captura se completa aunque la capacidad falte |
| Reintentos mal acotados | Estar sin conexión agotaría los intentos y marcaría la operación como fallida; o el retardo crecería sin límite | Unitaria | `queue-rules.test.ts` | Reglas de tiempo y contadores: se controlan con un reloj y un transporte simulados |
| Recuperación tras cerrar la pestaña | Una operación "en vuelo" quedaría atascada, o se reenviaría una que otra pestaña aún envía | Integración | `offline-persistence.test.ts` (lease vencido y vigente) | Combina almacén, cola y reloj |
| Contrato HTTP de la ruta | Cabecera de idempotencia ignorada, errores mal codificados | Integración | `sync-duplicates.test.ts` (POST real de la ruta) | Se invoca el manejador real sin abrir un puerto |

Criterio general: cada riesgo se prueba en la capa **más barata que aún lo demuestre**, y solo
se sube de capa cuando lo que se afirma depende de algo que la capa inferior no tiene
(un navegador, la red real o un service worker). Un E2E no sustituye a las unitarias ni al
revés.

## 3. Capas

| Capa | Ubicación | Qué ejerce | Qué se controla | Cantidad |
|---|---|---|---|---|
| Unitaria | `tests/unit/` | Una regla a la vez | Todo: reloj, ids, almacén y red simulados | 40 pruebas en 3 archivos |
| Integración | `tests/integration/` | Cola + almacén + transporte + servidor (y la ruta HTTP real) | Las respuestas remotas (fixtures) y la red | 12 pruebas en 2 archivos |
| E2E | `tests/e2e/` | La interfaz, un navegador real, el service worker e IndexedDB | La red (real, con `setOffline`) y las APIs del dispositivo (simuladas) | 5 pruebas |
| Heredadas | `tests/*.spec.ts` | Manifest, service worker, offline, renderizado, sincronización y capacidades (Semanas 2–6) | Dependencias inyectadas | 7 suites |

Los datos son sintéticos (`tests/fixtures/inspections.ts`) y cada prueba parte de un estado
limpio: las unitarias y de integración crean su propio almacén; cada E2E abre un contexto nuevo
de navegador (IndexedDB, caché y service worker aislados) y vacía el servidor simulado con
`DELETE /api/sync/inspections`.

**Correspondencia con lo que ya existía.** Los archivos `tests/*.spec.ts` de semanas anteriores
siguen vigentes y se ejecutan con `npm test`. No se movieron para no romper su historial ni sus
workflows. Las capas nuevas no los duplican: se concentran en los cuatro riesgos de esta
semana con un corredor estándar (`node:test`) que produce reportes JUnit.

## 4. Comandos por etapa

| Etapa | Comando | Qué hace |
|---|---|---|
| Instalación limpia | `npm ci` | Instala exactamente lo del `package-lock.json` |
| Lint | `npm run lint` | ESLint con `next/core-web-vitals`, sin advertencias permitidas |
| Tipos | `npm run typecheck` | `tsc --noEmit` en modo estricto sobre `src/` y `tests/` |
| Build | `npm run build` | `next build` |
| Unitarias | `npm run test:unit` | Compila `tests/unit` y lo ejecuta; reporte `reports/junit-unit.xml` |
| Integración | `npm run test:integration` | Igual; reporte `reports/junit-integration.xml` |
| Todo lo que no usa navegador | `npm test` | Tipos, las 7 suites heredadas, unitarias e integración |
| Cobertura | `npm run test:coverage` | Unitarias + integración bajo `c8`; escribe `coverage/` (`lcov.info`, `coverage-summary.json`) |
| E2E | `npm run test:e2e` | Playwright; reportes `reports/junit-e2e.xml`, `reports/e2e-results.json` y `playwright-report/` |
| Verificación integral | `npm run verify` (`make verify`) | Estructura, lint, tipos, `npm test` y build; escribe `reports/verification.json` |

**Arranque del servidor para E2E.** Se prueba la aplicación **compilada**, porque el service
worker solo se registra en producción y el flujo "recargar sin conexión" depende de él. Antes de
la E2E hay que ejecutar `npm run build`. `playwright.config.ts` arranca el servidor con
`npm run start -- -p 3100` (puerto configurable con `E2E_PORT`), espera a que responda y lo
detiene al terminar. No reutiliza un servidor existente.

Las E2E usan Chromium. En una máquina sin él se puede instalar con
`npx playwright install chromium`, o usar un navegador ya instalado con
`E2E_BROWSER_CHANNEL=msedge` (o `chrome`).

## 5. Cobertura y huecos

La cobertura (V8, con mapas de origen sobre `src/`, contando también los archivos que ninguna
prueba carga) se genera para **identificar huecos**, no para cumplir un porcentaje. Resultado
de unitarias + integración: 40,6 % de líneas y 68,2 % de ramas en todo `src/`.

| Zona | Líneas | Lectura |
|---|---|---|
| `storage/schema.ts` | 94,5 % | Validación bien cubierta |
| `api/sync/inspections/route.ts` | 96,9 % | Contrato HTTP cubierto |
| `sync/server-store.ts` | 89,5 % | Idempotencia y conflicto cubiertos |
| `sync/queue.ts` | 75,5 % | Faltan ramas de fusión de conflictos (las cubre `sync.spec.ts`) |
| `sync/transport.ts` | 78,3 % | Faltan respuestas 409/429/422 en el cliente HTTP |
| `sync/conflict-policy.ts` | 37,1 % | La política de fusión la ejerce `sync.spec.ts`, no estas capas |
| `device/camera.ts`, `notifications/client.ts` | 53 %, 63 % | Solo los caminos de fallo; el camino feliz lo cubre `capabilities.spec.ts` |
| `device/evidence.ts`, `storage/indexeddb-storage.ts` | 0 % | Los cubren `capabilities.spec.ts` y la E2E, no estas capas |
| Componentes y páginas (`.tsx`) | 0 % | Solo la E2E los ejerce; es un hueco conocido de las pruebas de Node |

Los 0 % de los archivos de interfaz no significan que no se prueben: su comportamiento se
demuestra desde el navegador (E2E), que no genera cobertura de líneas.

## 6. Defecto controlado

**Procedimiento.** En una rama temporal (`chore/w08-defecto-controlado`, nunca integrada) se
omite la protección contra duplicados del servidor simulado: se eliminan las dos defensas de
`applyOperation` en `src/lib/sync/server-store.ts` (la consulta por clave de idempotencia y la
confirmación por contenido idéntico). Es la regresión realista de "olvidé la idempotencia".

**Resultado esperado y observado** (ejecución local, mismas pruebas que en CI):

| Capa | Observado con el defecto |
|---|---|
| Unitaria | Fallan 3: "la misma clave devuelve duplicate…", "la clave repetida gana aunque el contenido… sea distinto", "el mismo contenido bajo otra clave se confirma sin crear otra revisión" |
| Integración | Fallan 3: el reintento tras respuesta perdida (con el transporte simulado y con la ruta HTTP real) y la repetición del POST |
| E2E | Falla 1: "si el servidor aplica la operación pero la respuesta se pierde, el reintento no duplica" (la interfaz muestra "Conflicto resuelto" en lugar de "duplicado evitado") |

Al restaurar el archivo (`git checkout -- src/lib/sync/server-store.ts`) las tres capas vuelven
a pasar. La evidencia enlazada (corrida de CI en rojo con el defecto y corrida en verde tras
restaurarlo) se registra en el README y en `evidence/individual.md`.

**Mutaciones adicionales** (revisión manual de la calidad de las aserciones). Se rompió el
código de 22 maneras (validación, cola, servidor, transporte, ruta, backoff, permisos de
cámara, ubicación y avisos) y las pruebas detectaron **20**. Las 2 restantes son *mutantes
equivalentes*: quitar la comprobación de hallazgos negativos o la del mes del calendario no
cambia ningún resultado, porque otra regla (la regla cruzada estado/hallazgos y la comprobación
del día) ya rechaza lo mismo. Dos huecos reales que esta revisión descubrió se cerraron con
pruebas nuevas: que los fallos de red no agoten los reintentos y que solo se recuperen los
envíos con lease vencido.

## 7. Supuestos y límites

- Una sola instancia del servidor simulado, con registros en memoria (se pierden al reiniciar).
  Por eso la E2E corre con un worker y reinicia el servidor entre pruebas.
- La desconexión de la E2E es real (`setOffline`); los fallos de cámara y ubicación se simulan
  con `addInitScript`, porque una prueba no puede depender de los permisos físicos del equipo.
- Las pruebas de Node usan un almacén en memoria con la misma interfaz que IndexedDB: demuestran
  la lógica, no el motor del navegador. Eso queda para la E2E.
- La E2E se verificó localmente con Edge (Chromium). La ejecución en Ubuntu la valida la corrida
  de GitHub Actions.
- No se verificó una cámara real ni una notificación del sistema con permiso concedido
  (ver `docs/capabilities.md`, sección 9).
- La cobertura no incluye los archivos `.tsx` por la vía de Node; ver sección 5.
- La E2E de reconexión espera hasta 20 s a que el registro quede sincronizado, y eso no distingue
  si lo disparó el evento `online` (inmediato) o el temporizador de 10 s: al quitar el evento
  `online` en una revisión por mutación, la prueba seguía pasando. Fijarlo exigiría controlar el
  reloj de la página, lo que haría frágil el resto de la E2E (la actualización de la interfaz y el
  service worker dependen de temporizadores reales). Queda como limitación conocida; una prueba
  unitaria de `startAutoSync` con `window` simulado sería la forma determinista de cubrirlo.
