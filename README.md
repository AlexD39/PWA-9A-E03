# PWA de inspecciones de laboratorio — Universidad Tigres de Tehuacan

Starter oficial para la materia **Aplicaciones Web Progresivas**. Proyecto base de la PWA offline-first para registrar inspecciones y mantenimiento de laboratorios, usando únicamente datos sintéticos.

Este repositorio es el punto de partida común para las actividades de las semanas 1–13. En la Semana 1 no debes construir todavía toda la PWA: debes poner en marcha este proyecto, documentar el problema y dejar una primera versión reproducible. Cada semana conservarás el mismo repositorio y agregarás la capacidad indicada por la actividad.

## Requisitos locales

- Node.js 20 LTS o superior compatible con Next.js.
- npm 10 o superior.
- Git y una cuenta de GitHub.

## Versiones verificadas

- Node.js: v24.11.1
- npm: 11.6.2
- Git: 2.52.0.windows.1

## Arranque verificable

```bash
npm ci
npm run dev
```

Abre <http://localhost:3000>. Debes ver la pantalla inicial de inspecciones con datos sintéticos.

Antes de entregar ejecuta:

```bash
make verify
bash public-tests/check.sh
```

`npm run verify` genera `reports/verification.json`, ejecuta la prueba proporcionada y compila la aplicación. `make verify` es equivalente. El reporte y la corrida verde de GitHub Actions son evidencia técnica, no una calificación automática de la documentación.

## Semana 2: shell instalable y manifest

La aplicación declara sus metadatos PWA en `public/manifest.webmanifest`. El manifest usa `/` como ruta de inicio y alcance, solicita visualización `standalone` y referencia iconos públicos de 192 y 512 píxeles desde `public/icons/`. `src/app/layout.tsx` enlaza el manifest y mantiene el color de tema consistente.

La prueba `tests/manifest.spec.ts` valida los campos instalables esenciales, las rutas de ambos iconos y el enlace desde el layout. Para validar la entrega de Semana 2 se ejecutan, desde la raíz del repositorio:

```bash
npm ci
npm test
npm run test -- --run
npm run build
npm run verify
node scripts/verify.mjs --structure
```

En Windows, `make verify` es equivalente a `npm run verify` cuando GNU Make está disponible, y `bash public-tests/check.sh` ejecuta el mismo chequeo estructural. El workflow `.github/workflows/week-02-w02-shell-manifest.yml` realiza la instalación limpia, el build, la comprobación de artefactos obligatorios, las pruebas y la publicación de evidencia de CI. Su resultado completo también depende de los archivos de interfaz asignados al otro integrante.

## Semana 3: service worker y consulta offline

La aplicación registra `public/sw.js` con alcance `/` desde `src/components/service-worker-manager.tsx`, montado en `src/app/layout.tsx`. La lógica de registro y del ciclo de actualización vive en `src/lib/pwa/register-service-worker.ts`; la estrategia completa, sus supuestos y límites están en `docs/cache-strategy.md`.

Resumen del comportamiento:

- **Precaché atómica** en `install` de `/`, `/offline.html`, el manifest y los dos iconos. Si una URL falla, la versión nueva no se activa y la anterior sigue sirviendo.
- **Navegación network-first** con respaldo en la copia cacheada de esa ruta y, si no existe, en `public/offline.html`.
- **Estáticos cache-first** (`/_next/static/`, `/icons/`) porque llevan hash en el nombre. Las rutas `/api/` nunca se interceptan ni se cachean.
- **Actualización segura:** la versión nueva queda en espera y la interfaz muestra "Hay una versión nueva disponible" con el botón **Actualizar ahora**; solo entonces se envía `SKIP_WAITING`, se limpian las cachés `inspecciones-lab-*` anteriores y la página recarga una sola vez.
- **Invalidación controlada:** cambiar `CACHE_VERSION` en `sw.js` o enviar el mensaje `CLEAR_CACHES` desde el cliente.
- El indicador del encabezado muestra "En línea" o "Sin conexión" según `navigator.onLine`.

Supuestos: el service worker solo se registra en producción porque `next dev` sirve chunks sin hash que la caché dejaría obsoletos. Los datos siguen siendo sintéticos y viajan dentro del HTML, por lo que no hay información sensible en caché.

### Ejecución y verificación manual del offline

```bash
npm ci
npm run build
npm run start
```

Abre <http://localhost:3000>. En DevTools → Application → Service Workers debe aparecer `sw.js` activo y en Cache Storage la caché `inspecciones-lab-v1` con cinco entradas. Marca **Offline** y recarga: el panel sigue visible y el indicador cambia a "Sin conexión". Navega a `/no-existe` en modo offline para ver `offline.html`.

Para probar la actualización segura: con `v1` activa, cambia temporalmente `CACHE_VERSION` a `v2` en `public/sw.js`, ejecuta `npm run build && npm run start` y, en la pestaña ya abierta, ejecuta `registration.update()` desde la consola. Debe aparecer "Hay una versión nueva disponible" mientras `v1` sigue activa; al pulsar **Actualizar ahora** la página recarga una vez y Cache Storage conserva solo `inspecciones-lab-v2`. Los pasos completos están en la sección 6 de `docs/cache-strategy.md`. Revierte el cambio de versión antes de hacer commit.

### Verificación automatizada

Las pruebas `tests/service-worker.spec.ts` y `tests/offline.spec.ts` ejecutan `public/sw.js` y el módulo de registro en Node con globales simulados: precaché e instalación atómica, limpieza de versiones, network-first con respaldo, cache-first, exclusiones (`POST`, otro origen, `/api/`), mensajes `SKIP_WAITING`/`CLEAR_CACHES`, y el flujo de actualización que avisa sin recargar. Se ejecutan con:

```bash
npm test
npm run verify
bash public-tests/check.sh
```

El workflow `.github/workflows/week-03-w03-service-worker-offline.yml` hace instalación limpia, build, comprobación de artefactos obligatorios y la suite de pruebas, y publica `academic-evidence-w03-service-worker-offline`. Las pruebas no reemplazan un navegador real ni HTTPS; por eso se documenta también la verificación manual anterior.

### Verificación de Alejandro

En Windows se ejecutaron desde la raíz del repositorio los comandos requeridos:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run verify
node scripts/verify.mjs --structure
```

Todos terminaron con código 0. La instalación limpia agregó 28 paquetes; las pruebas `starter.spec.mjs`, `manifest.spec.ts`, `service-worker.spec.ts` y `offline.spec.ts` mostraron `PASS`; el build de Next.js 14.2.35 compiló correctamente y la verificación técnica terminó en `pass`. El workflow publica el artefacto `academic-evidence-w03-service-worker-offline`.

## Semana 4: renderizado CSR/SSR con estados verificables

Dos rutas del mismo dominio de datos, con estrategias de renderizado distintas para
compararlas. El detalle completo, incluida la métrica de carga medida y sus límites,
está en `docs/rendering-decision.md`.

- **`/inspecciones` (SSR):** Server Component con `dynamic = "force-dynamic"`. Los datos
  ya están en el HTML inicial. Mientras se consultan, Next.js hace streaming del
  contenido de `src/app/inspecciones/loading.tsx`; si la consulta falla, monta
  `src/app/inspecciones/error.tsx`. Reproducible de forma determinista con
  `/inspecciones?fallo=1`.
- **`/inspecciones/[id]` (CSR):** Client Component que pide sus datos a
  `src/app/api/inspections/[id]/route.ts` después de montar, con
  `src/lib/rendering/fetch-inspection-client.ts` como lógica extraída y comprobable
  (mismo patrón que `register-service-worker.ts` en la Semana 3: nunca lanza, siempre
  resuelve `ok` / `not-found` / `error`). Carga, error con botón **Reintentar** y "no
  encontrado" son estados de React, no archivos de convención. Reproducible con
  `/inspecciones/<id>?fallo=1` (error simulado) o con un id inexistente (404 real).
- **`src/components/loading-state.tsx`:** componente sin hooks, compartido por las dos
  rutas, para que el primer render del lado del cliente coincida siempre con el del
  servidor y no haya *hydration mismatch* (razonado con detalle en
  `docs/rendering-decision.md`, sección 4).

### Ejecución y verificación manual

```bash
npm ci
npm run build
npm run start
```

Abre `http://localhost:3000/inspecciones` (SSR, con los 3 registros ya en el HTML) y
`http://localhost:3000/inspecciones/inspection-001` (CSR, con un breve estado de carga
antes del contenido). Agrega `?fallo=1` a cualquiera de las dos para ver el estado de
error de forma reproducible. Visita `http://localhost:3000/inspecciones/no-existe` para
el estado "no encontrado". Revisa la consola del navegador: no debe aparecer ninguna
advertencia de hydration.

Para medir la latencia real:

```bash
curl -s -o /dev/null -w "TTFB=%{time_starttransfer}s total=%{time_total}s\n" http://localhost:3000/inspecciones
curl -s -o /dev/null -w "TTFB=%{time_starttransfer}s total=%{time_total}s\n" http://localhost:3000/api/inspections/inspection-001
```

### Verificación automatizada

`tests/rendering.spec.ts` ejecuta el Server Component de `/inspecciones` y el Route
Handler de la API directamente en Node (con `react-dom/server` para el primero), y
prueba `fetchInspectionClient` con un `fetch` simulado: sin necesidad de un navegador,
cubre precaché de datos, el error determinista, los códigos 200/404/500 de la API y que
`LoadingState` renderiza los atributos de accesibilidad esperados.

```bash
npm test
npm run verify
bash public-tests/check.sh
```

El workflow `.github/workflows/week-04-w04-csr-ssr.yml` hace instalación limpia, build,
comprobación de artefactos obligatorios y la suite de pruebas, y publica
`academic-evidence-w04-csr-ssr`.

### Verificación de Alejandro en Windows

Desde la raíz del repositorio se ejecutaron estos comandos en PowerShell:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run verify
node scripts/verify.mjs --structure
& 'C:\Program Files\Git\bin\bash.exe' 'public-tests/check.sh'
```

La instalación limpia agregó 28 paquetes. Las cinco pruebas terminaron en `PASS`, incluido
`rendering.spec.ts`; Next.js 14.2.35 compiló correctamente las rutas dinámicas
`/inspecciones`, `/inspecciones/[id]` y `/api/inspections/[id]`; `npm.cmd run verify`
terminó con `Verificación técnica: pass`; y tanto la comprobación estructural directa como
`public-tests/check.sh` informaron `Estructura presente`. Webpack mostró advertencias al
crear su caché, pero el build terminó con código 0.

## Semana 5: persistencia local y sincronización idempotente

Las inspecciones se guardan primero en el dispositivo (IndexedDB) y se sincronizan cuando hay
red, sin duplicar ni perder datos. La política completa, con sus límites, está en
`docs/sync-policy.md`.

- **`src/lib/storage/schema.ts`:** esquema local (`records`, `outbox`, `meta`), validación de
  entrada y de lectura, versión del esquema e interfaz `StorageAdapter`. Dos adaptadores:
  `memory-storage.ts` (pruebas y respaldo volátil) e `indexeddb-storage.ts` (navegador).
- **`src/lib/sync/queue.ts`:** cola de sincronización. Guardado atómico, `idempotencyKey` fija en
  todos los reintentos, backoff exponencial con jitter, recuperación tras cerrar la pestaña con
  *lease*, descarte de respuestas obsoletas y bitácora de eventos. Como en las semanas anteriores,
  todo es inyectable (almacenamiento, transporte, reloj), así que se prueba en Node sin navegador.
- **`src/lib/sync/conflict-policy.ts`:** fusión de tres vías por campo con reglas explícitas
  (`attention` gana, los hallazgos toman el máximo, el cambio más reciente gana el resto y el
  servidor gana los empates). Cada decisión queda registrada con el valor descartado.
- **Servidor simulado:** `src/lib/sync/server-store.ts` y `src/app/api/sync/inspections/route.ts`
  deduplican por clave, detectan conflictos por revisión y validan. Es memoria del proceso: no hay
  backend real en este proyecto.
- **Interfaz:** `/inspecciones/nueva` (formulario y panel de estado de sincronización), con el
  mismo cuidado de la Semana 4 para evitar *hydration mismatch*: el primer render es siempre el
  estado de carga y todo lo demás se calcula después de montar.

### Ejecución y verificación manual

```bash
npm ci
npm run build
npm run start
```

Abre `http://localhost:3000/inspecciones/nueva`, guarda una inspección y observa el panel. Para
reproducir los casos difíciles: detén el servidor y guarda otra (queda pendiente y se entrega sola
al volver); abre `/inspecciones/nueva?perder=1` para que el servidor aplique la operación pero
"pierda" la respuesta, y recarga sin el parámetro para ver "duplicado evitado". El detalle de cada
caso está en la sección 12 de `docs/sync-policy.md`.

### Verificación automatizada

`tests/sync.spec.ts` ejecuta la cola contra un almacenamiento en memoria y un servidor simulado:
guardado atómico y sin duplicados, idempotencia con respuesta perdida, backoff y presupuesto de
reintentos, cierre de pestaña y respuestas tardías, fusión de conflictos y comportamiento del
transporte HTTP. Se ejecuta con:

```bash
npm test
npm run verify
bash public-tests/check.sh
```

El workflow `.github/workflows/week-05-w05-sync-data.yml` hace instalación limpia, build,
comprobación de artefactos obligatorios y la suite de pruebas, y publica
`academic-evidence-w05-sync-data`. Las pruebas no cubren el adaptador de IndexedDB, que se verifica
a mano en un navegador real.

### Verificación de Alejandro en Windows

Desde la raíz del repositorio ejecuté los comandos solicitados en PowerShell y Git Bash:

```text
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run verify
node scripts/verify.mjs --structure
C:\Program Files\Git\bin\bash.exe public-tests/check.sh
```

La instalación limpia agregó 28 paquetes y terminó con código 0. Las seis suites pasaron;
`sync.spec.ts` informó `PASS (69 casos)`. El build de Next.js 14.2.35 compiló correctamente y
generó seis páginas, incluidas `/api/sync/inspections` y `/inspecciones/nueva`. La verificación
integral terminó en `pass`, y tanto la comprobación estructural como el check público informaron
`Estructura presente`. Webpack mostró advertencias al crear su caché, pero el proceso terminó con
código 0.

## Semana 6: capacidades del dispositivo y notificaciones

Se puede adjuntar evidencia opcional a una inspección (una foto y una ubicación aproximada) y la
aplicación avisa de los cambios de sincronización, con permisos mínimos, fallback funcional y datos
mínimos. El detalle, con sus límites, está en `docs/capabilities.md`.

- **`src/lib/device/camera.ts`:** foto por la cámara del navegador (sin audio, y las pistas se
  detienen siempre) o por archivo, sin permisos. La imagen se redibuja, se reduce a 1024 px y a
  250 KB como máximo y se recodifica como JPEG, con lo que pierde los metadatos del original.
- **`src/lib/device/geolocation.ts`:** una sola lectura de baja precisión, con coordenadas
  redondeadas a unos 110 m y tiempo de espera propio. Sin seguimiento continuo.
- **`src/lib/device/evidence.ts`:** guarda la evidencia en IndexedDB (`meta`), solo en el
  dispositivo y sin tocar lo que se sincroniza. Si no queda nada, borra la clave.
- **`src/lib/notifications/client.ts`:** avisos de sincronizado, conflicto y fallo. Salen por el
  sistema solo con permiso y con la aplicación en segundo plano; en cualquier otro caso se muestran
  dentro de la aplicación. Nunca pide permiso por su cuenta y el texto no incluye datos personales.
- **`public/sw.js`:** manejador de `notificationclick` que enfoca o abre la aplicación y solo acepta
  rutas del propio sitio.
- **Cabecera `Permissions-Policy`** (cámara y ubicación solo para este origen; micrófono y pagos
  deshabilitados): desde la Semana 9 la aplica `src/middleware.ts` con `src/lib/security/headers.ts`.
- **Interfaz:** los paneles "Evidencia opcional" y "Avisos de cambios" en `/inspecciones/nueva`.

### Ejecución y verificación manual

```bash
npm ci
npm run build
npm run start
```

Abre `http://localhost:3000/inspecciones/nueva`. Ningún permiso se pide al cargar: solo al pulsar
"Tomar foto", "Agregar ubicación aproximada" o "Activar avisos del sistema". Con la cámara o la
ubicación bloqueadas verás un mensaje claro y la inspección se guarda igual. Con una imagen grande
adjuntada por archivo, la vista previa muestra como máximo 1024 px y menos de 250 KB. Revisa la
cabecera con `curl -I http://localhost:3000/inspecciones/nueva`. Los pasos completos están en la
sección 9 de `docs/capabilities.md`.

### Verificación automatizada

`tests/capabilities.spec.ts` ejecuta cada capacidad con dependencias simuladas: la foto (reducción
de tamaño, presupuesto de bytes, errores de permiso y de hardware, y que la cámara siempre se
libera), la ubicación (redondeo, tiempo de espera, errores y respuestas inválidas), la evidencia
(validación y borrado de lo vacío), las notificaciones (decisión de canal, deduplicación y que
nunca pide permiso por sí sola) y el clic en la notificación dentro de `public/sw.js`.

```bash
npm test
npm run verify
bash public-tests/check.sh
```

El workflow `.github/workflows/week-06-w06-device-push.yml` hace instalación limpia, build,
comprobación de artefactos obligatorios y la suite de pruebas, y publica
`academic-evidence-w06-device-push`. Las pruebas no ejercitan hardware real ni la entrega real de
una notificación del sistema; eso se verifica a mano.

### Verificación de Alejandro en Windows

Desde la raíz del repositorio se ejecutaron estos comandos:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run verify
node scripts/verify.mjs --structure
& 'C:\Program Files\Git\bin\bash.exe' public-tests/check.sh
```

Todos terminaron con código 0. La instalación limpia agregó 28 paquetes; las siete suites pasaron,
incluidas `sync.spec.ts: PASS (69 casos)` y `capabilities.spec.ts: PASS (47 casos)`. Next.js 14.2.35
compiló correctamente y generó seis páginas. La verificación integral informó
`Verificación técnica: pass`, y tanto la comprobación directa como el check público mediante Git
Bash informaron `Estructura presente`. Webpack mostró advertencias al crear su caché durante los
builds, pero no impidieron la compilación.

La revisión por mutación detectó los tres cambios temporales requeridos: pedir audio hizo fallar
`capturePhoto pide video ambiental sin audio`; volver a solicitar una decisión existente hizo
fallar `requestPermission no vuelve a pedir una decisión existente`; y aceptar una URL externa en
el service worker hizo fallar `notificationclick rechaza destinos externos`. Cada cambio se
restauró antes de continuar y la ejecución final de `npm.cmd test` volvió a quedar en verde.

La comprobación manual de cámara, ubicación y notificación real del sistema queda pendiente en un
navegador de escritorio; no forma parte de lo demostrado por las dependencias simuladas.

## Semana 8: pirámide de pruebas e integración continua

Esta semana no agrega funciones: convierte el flujo existente (crear → guardar sin conexión →
recargar → reconectar → sincronizar sin duplicar, y la variante con una capacidad del
dispositivo denegada o ausente) en pruebas repetibles y las automatiza en CI. La estrategia, el
diagnóstico, la matriz riesgo–prueba–capa, la cobertura y el defecto controlado están en
`docs/test-strategy.md`.

**Versiones.** Node.js 20.11 o superior (verificado en local con v24.20.0; el CI usa Node 22),
npm 10 o superior (11.19.0 en local). Para E2E hace falta un Chromium: `npx playwright install
chromium`, o un navegador ya instalado con `E2E_BROWSER_CHANNEL=msedge` (o `chrome`).

**Instalación y arranque.**

```bash
npm ci
npm run dev        # desarrollo en http://localhost:3000
npm run build && npm run start   # versión compilada, la que usa la E2E
```

**Comandos de verificación** (qué ejecuta cada uno):

| Comando | Qué hace |
|---|---|
| `npm run lint` | ESLint (`next/core-web-vitals`), sin advertencias permitidas |
| `npm run typecheck` | `tsc --noEmit` en modo estricto |
| `npm run build` | Compila la aplicación |
| `npm run test:unit` | Pruebas unitarias (`tests/unit/`), reporte `reports/junit-unit.xml` |
| `npm run test:integration` | Pruebas de integración (`tests/integration/`), reporte `reports/junit-integration.xml` |
| `npm test` | Tipos, las suites de semanas anteriores, unitarias e integración |
| `npm run test:coverage` | Unitarias + integración con cobertura en `coverage/` |
| `npm run test:e2e` | E2E con Playwright (requiere `npm run build` antes); reportes en `reports/` y `playwright-report/` |
| `npm run verify` / `make verify` | Estructura, lint, tipos, `npm test` y build; escribe `reports/verification.json` |

Los E2E arrancan solos el servidor compilado (`npm run start -- -p 3100`, puerto configurable con
`E2E_PORT`) y no reutilizan uno ya abierto: si el puerto está ocupado, fallan con un mensaje
claro.

**Qué cubre cada capa.**

- `tests/unit/`: la regla de validación de una captura (`validation.test.ts`), las reglas de
  cola e idempotencia (`queue-rules.test.ts`) y los fallos de cámara, ubicación y avisos
  (`device-fallbacks.test.ts`).
- `tests/integration/`: guardar sin conexión, recargar y reconectar sobre la cola real
  (`offline-persistence.test.ts`) y reintento de la misma operación sin duplicar, incluida la
  ruta HTTP real (`sync-duplicates.test.ts`). Los datos y las respuestas remotas salen de
  `tests/fixtures/`.
- `tests/e2e/`: el flujo completo desde la interfaz, con desconexión real.

### Verificación de Oscar en Windows

Se ejecutaron `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:coverage` y `npm run test:e2e` (con `E2E_BROWSER_CHANNEL=msedge`) desde Git Bash.
Resultado: lint y tipos sin errores; `npm test` con las 7 suites heredadas, 40 pruebas unitarias
y 12 de integración en verde; build correcto; cobertura de 40,6 % de líneas y 68,2 % de ramas
sobre todo `src/`. La revisión por mutación detectó 20 de 22 roturas del código (las 2
restantes son equivalentes; ver `docs/test-strategy.md`, sección 6).

### Verificación de Alejandro en Windows

Se verificó la contribución con Node.js v24.11.1, npm 11.6.2, Git 2.52.0 y Edge (Chromium).
Desde la raíz del repositorio se ejecutaron estos comandos:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:coverage
$env:E2E_BROWSER_CHANNEL = "msedge"
npm.cmd run test:e2e
npm.cmd run verify
node scripts/verify.mjs --structure
& 'C:\Program Files\Git\bin\bash.exe' public-tests/check.sh
```

Lint y tipos terminaron sin errores; las siete suites heredadas, las 40 pruebas unitarias y las
12 de integración pasaron. El build generó seis rutas y la cobertura fue 40,56 % de líneas y
68,21 % de ramas. Los ocho E2E pasaron con un solo worker: los cinco casos de referencia y tres
propios (edición pendiente hasta `serverRevision` 2, recuperación tras `?fallo=1` y persistencia
local de una imagen sintética). `npm run verify` terminó en `pass` y el check público informó
`Estructura presente`.

En Windows dentro de OneDrive, Playwright mostró los ocho casos aprobados pero dejó procesos
`node` residuales al cerrar el servidor; se detuvieron después de liberar el puerto 3100. La
[corrida de Academic Evaluation en Ubuntu](https://github.com/AlexD39/PWA-9A-E03/actions/runs/40037975442)
terminó correctamente en 6 min 42 s y publicó el artefacto `academic-evidence-w08`, por lo que
los reportes y el cierre del servidor también quedaron comprobados en CI.

La revisión por mutación del archivo proporcionado detectó 20 de 22 roturas. V1 y V2 son
equivalentes: la regla cruzada estado/hallazgos ya rechaza los hallazgos negativos y la
comprobación del día ya rechaza una fecha cuyo mes se desborda. Además se quitaron temporalmente
`prepareOffline`, la etiqueta "Pendiente de sincronizar" y el comportamiento de `?perder=1`;
cada cambio hizo fallar el E2E correspondiente y se restauró antes de continuar.

### Defecto controlado

En la rama temporal `chore/w08-defecto-controlado`, que no se integra ni tiene PR, se eliminaron
las dos defensas contra duplicados de `applyOperation`. Localmente fallaron tres pruebas
unitarias, tres de integración y solo el E2E de respuesta perdida; el build siguió compilando,
por lo que la detección provino de las aserciones. La
[corrida con el defecto quedó roja](https://github.com/AlexD39/PWA-9A-E03/actions/runs/40039335467).
Después se revirtió el commit, volvieron a pasar 40 unitarias y 12 de integración, y la
[corrida de restauración quedó verde](https://github.com/AlexD39/PWA-9A-E03/actions/runs/40039652401).

## Semana 9: modelo de amenazas y privacidad aplicada

Analiza y endurece la aplicación acumulada (sin construir otra). El análisis está en
`docs/threat-model.md` (activos, amenazas STRIDE, controles, pruebas y riesgos residuales) y el
tratamiento de datos personales en `docs/privacy-data-inventory.md` (inventario, finalidades,
derechos ARCO y medidas, con el marco de un sujeto obligado mexicano). Los controles viven en
`src/lib/security/` y se prueban en `tests/security.spec.ts`.

| Control | Qué hace | Dónde |
|---|---|---|
| **C-01 / C-03** Cabeceras y middleware | CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, aislamiento de origen, HSTS solo tras HTTPS | `src/middleware.ts`, `src/lib/security/headers.ts` |
| **C-02** CSP con nonce | Los scripts solo corren con el nonce de esa respuesta; sin `'unsafe-inline'` en scripts | `src/lib/security/csp.ts` |
| **C-04** Guardián de la API | Rechaza `cross-site`, `Origin` ajeno, tipos distintos de JSON y cuerpos de más de 16 KB; límite de 300 peticiones por minuto | `src/lib/security/request-guard.ts`, `src/app/api/sync/inspections/route.ts` |
| **C-05** Ganchos apagados | `?fallo`, `?perder` y `DELETE` solo actúan con `ENABLE_DEMO_HOOKS=1` | `src/lib/security/demo-hooks.ts` |
| **C-06 / C-07** Minimización y saneamiento | Rechaza correo, teléfono, CURP, RFC y tarjeta en textos libres (cliente y servidor); quita caracteres de control y ocultos | `src/lib/security/privacy.ts`, `src/lib/security/text.ts`, `src/lib/storage/schema.ts` |
| **C-08** Rutas internas | Un aviso solo puede abrir rutas del propio sitio (corrige un fallo del service worker) | `src/lib/security/safe-url.ts`, `public/sw.js` |
| **C-09** Borrado de datos locales | «Borrar datos de este dispositivo» (IndexedDB, preferencias y cachés) | `src/lib/security/data-lifecycle.ts`, `src/app/privacidad/page.tsx` |
| **C-10 / C-11** Archivos públicos y credenciales | `robots.txt`, `security.txt`, sin credenciales en el repositorio | `public/`, `.env.example` |

**Variables de entorno** (`.env.example`; no hay credenciales): `ENABLE_DEMO_HOOKS=1` activa los
ganchos de demostración (las E2E la activan por su cuenta; para las verificaciones manuales de las
Semanas 4 y 5 ejecuta `ENABLE_DEMO_HOOKS=1 npm run dev`) y `ENFORCE_HTTPS_UPGRADE=1` añade
`upgrade-insecure-requests` a la CSP, solo detrás de HTTPS.

**Verificación manual.**

```bash
npm run build && npm run start -- -p 3100
curl -I http://localhost:3100/inspecciones/nueva     # CSP con nonce y demás cabeceras
curl http://localhost:3100/robots.txt                 # Disallow: /
curl -X DELETE http://localhost:3100/api/sync/inspections   # 404: los ganchos están apagados
```

Abre `/privacidad` para ver el aviso de privacidad simplificado y probar «Borrar datos de este
dispositivo».

**Comandos de esta semana.**

| Comando | Qué hace |
|---|---|
| `npm run test:security` | 61 casos de seguridad y privacidad (`tests/security.spec.ts`), reporte `reports/junit-security.xml` |
| `npm test` | Tipos, las 7 suites heredadas, unitarias, integración y seguridad |
| `npm run audit:deps` | `npm audit` de las dependencias de producción (ver el riesgo aceptado en `docs/threat-model.md`, sección 6) |

**Cambios que afectan lo anterior.** (1) Los ganchos de las Semanas 4 y 5 requieren
`ENABLE_DEMO_HOOKS=1`. (2) `POST /api/sync/inspections` exige `Content-Type: application/json`
(el cliente ya lo envía). (3) Las páginas se renderizan en cada petición para llevar el nonce de la
CSP. (4) El menú «Ajustes», que no hacía nada, ahora es «Privacidad». (5) `public/offline.html` ya no
tiene un `onclick` en línea.

**Chequeo público y lockfile.** El chequeo busca ciertas palabras en todo el repositorio. Se
reescribieron 14 líneas de documentos antiguos que las usaban y se agregó `.rgignore` para excluir
únicamente `package-lock.json`, que contiene el nombre de un paquete de terceros (el analizador de
lexemas de React) y lo genera npm.

**Auditoría de dependencias.** `npm audit --omit=dev` informa 3 vulnerabilidades (1 crítica, 2 altas),
todas por `next@14.2.35`. Se documentó, aviso por aviso, qué afecta a esta aplicación y se aceptó el
riesgo en lugar de actualizar Next (cambio mayor con React 19); ver `docs/threat-model.md`, sección 6.

### Verificación de Oscar en Windows

Se ejecutaron `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:coverage` y `npm run test:e2e` (con `E2E_BROWSER_CHANNEL=msedge`) desde Git Bash. La
revisión por mutación rompió el código de 29 maneras: la primera ronda detectó 27 y las dos que se
escaparon eran huecos de las propias pruebas (un gancho sin cubrir y una expresión que coincidía con
un comentario); se corrigieron y las 29 quedaron detectadas. La suite también encontró un fallo real
del service worker de la Semana 6 (`/\evil.example` pasaba como ruta interna).

## Flujo de trabajo del curso

1. Conserva este repositorio como tu proyecto personal y crea un repositorio privado en GitHub.
2. Completa únicamente los entregables de la actividad de la semana.
3. Haz cambios pequeños y descriptivos; no borres lo que ya funciona.
4. Ejecuta la verificación local y espera que GitHub Actions termine en verde.
5. Entrega en Classroom la URL del repositorio, el SHA exacto evaluado, el enlace a Actions y `evidence/individual.md`.

No uses datos reales de personas, laboratorios o estudiantes. Todo dato del starter es sintético.

## Estructura inicial

- `src/app/`: aplicación Next.js con App Router.
- `src/lib/data/`: datos sintéticos de inspecciones.
- `docs/`: plantillas de documentación de la Semana 1.
- `scripts/verify.mjs`: verificación reproducible local.
- `tests/`: prueba mínima del starter.

## Supuestos y decisiones
- Datos exclusivamente sintéticos: provienen de src/lib/data/inspections.ts; no se usan datos reales de personas ni de la institución.
- Conectividad intermitente (restricción dominante): el diseño debe operar sin conexión y sincronizar cuando haya red (RF-03 / RNF-02).
- Decisión de arquitectura: PWA sobre Next.js (App Router) + TypeScript; ver detalle en docs/decision-record.md (ADR-001).
- Alcance de Semana 1: solo base reproducible y documentación. Manifest, Service Worker, sincronización, notificaciones y autenticación quedan fuera hasta S2–S6.
- Nombre de la institución: «Universidad Tigres de Tehuacan» (caso académico sintético).

## Evidencia
- Verificación reproducible: `npm run verify` comprueba la estructura, ejecuta la prueba proporcionada y realiza el build; genera `reports/verification.json`.
- Check público: `bash public-tests/check.sh` ejecuta la verificación estructural; no certifica la calidad de los documentos ni la ausencia de credenciales expuestas.
- CI de Semana 1: GitHub Actions `week-01-starter-feedback.yml` usa Node 20.19.6, ejecuta `npm ci` y `npm run verify`, y publica el artefacto `starter-week-01-evidence`.
- CI de Semana 2: GitHub Actions `.github/workflows/week-02-w02-shell-manifest.yml` ejecuta una instalación limpia, el build, la comprobación de artefactos obligatorios y la suite de pruebas, y publica la evidencia disponible como `academic-evidence-w02-shell-manifest`.
- SHA final: se obtiene después del último commit con `git rev-parse HEAD` y se entrega en Classroom junto con el enlace de Actions de ese mismo SHA.

## Decisiones de arquitectura
Las decisiones de arquitectura y las nuevas carpetas se incorporan en las actividades correspondientes; no es necesario adelantarlas. Ver historial en docs/decision-record.md.
