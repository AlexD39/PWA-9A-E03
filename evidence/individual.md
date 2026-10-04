# Evidencia individual del equipo

- Grupo y equipo: Equipo-03
- Repositorio del equipo: https://github.com/AlexD39/PWA-9A-E03
- SHA final: se obtiene después del último commit con `git rev-parse HEAD` y se entrega en Classroom.

## Integrante: Espinoza Landeta Oscar — 3523110665

- Mi contribución concreta y enlace a archivo, commit anterior o revisión: Redacté `docs/requirements.md`, `docs/decision-record.md` y `README.md`. Mi contribución documental puede revisarse en los commits `4fd17f9`, `6d0da55` y `39ace8e` de la rama `docs`.
- Decisión que puedo explicar y por qué: Elegí PWA sobre web tradicional, app nativa y multiplataforma porque responde a la conectividad intermitente mediante capacidades web progresivas, mantiene un solo código Next.js/TypeScript y evita tiendas de aplicaciones. También puedo explicar sus costos, riesgos de caché y soporte desigual del dispositivo.
- Comando o prueba proporcionada que ejecuté: `npm run verify` desde la raíz del repositorio final.
- Resultado real que observé: La verificación técnica del equipo terminó con `Verificación técnica: pass. Revisión académica: pendiente. Reporte: reports/verification.json`. Debo conservar el reporte generado sobre el mismo SHA final que se entregue.
- Qué verifica esa prueba y qué no verifica: Verifica la estructura requerida, ejecuta `starter.spec.mjs` y compila la aplicación. No califica la calidad de los documentos, no implementa ni prueba todavía el funcionamiento offline y no certifica la ausencia de secretos.
- Limitación, dificultad o riesgo que identifiqué: En Semana 1 el offline aún no existe; `src/app/page.tsx` indica `PWA aún no implementada`. Manifest, Service Worker, sincronización, notificaciones y autenticación quedan para semanas posteriores. También encontré diferencias de CRLF y ejecución de scripts Bash entre Windows, WSL y CI.
- Uso de IA: Usé opencode/Muse Spark para estructurar el ADR-001, revisar el encuadre y los requisitos, y diagnosticar problemas de entorno. Validé y ajusté la redacción contra el starter y ejecuté la verificación; puedo explicar y defender los cambios.

### Semana 2 — Espinoza Landeta Oscar — 3523110665

- Mi contribución concreta: Implementé `src/components/app-shell.tsx` con header, indicador de estado, banner de instalación y navegación inferior. Integré el shell en `src/app/page.tsx`, rediseñé la interfaz basada en las pantallas de Stitch, agregué estados de carga (`src/app/loading.tsx`), error (`src/app/error.tsx`) y vacío dentro de la página. Estilicé la interfaz con responsive mobile-first en `src/app/globals.css` y ajusté el navbar para que sea fijo en la parte inferior del viewport.
- Decisión que puedo explicar y por qué: El `AppShell` concentra la estructura global (header, footer, navegación) para evitar duplicación entre páginas. Los estados de carga y error están en archivos separados porque el App Router los maneja como segmentos de error boundary. El navbar quedó fijo porque el contrato de Semana 2 requiere una navegación principal accesible en todo momento.
- Comando o prueba proporcionada que ejecuté: `npm test`, `npm run build`, `npm run verify` y pruebas manuales de responsive (390x844 y escritorio), navegación por teclado y revisión de estados de carga, error y vacío.
- Resultado real observado: `starter.spec.mjs: PASS`, build exitoso sin errores, verificación técnica `pass`. Las pruebas manuales confirmaron responsive correcto, navegación funcional, estados visibles y navbar fijo en ambos viewports.
- Qué verifica y qué no verifica: Verifica la interfaz, la navegación, los estados de UI y la accesibilidad básica. No verifica Service Worker, funcionamiento offline, sincronización ni instalación real de la PWA.
- Limitación o riesgo: El navbar inferior es visible al final del contenido en escritorio; se resolvió con `position: fixed`. La navegación a "Nueva", "Sync" y "Ajustes" muestra un mensaje informativo porque esas funciones corresponden a semanas posteriores. El banner de instalación PWA es informativo hasta que el manifest esté activo en producción.
- Uso de IA: Utilicé opencode para diseñar la estructura del AppShell, proponer los estilos responsive, validar los estados de UI y revisar la accesibilidad. Verifiqué manualmente cada cambio antes de commitearlo.
- SHA del commit de contribución: `a99ce35` (`fix: navbar fijo en parte inferior para movil y escritorio`).
- SHA final de entrega: pendiente; se registrará después de ejecutar la validación conjunta sobre el commit final de la rama.

### Semana 3 — Espinoza Landeta Oscar — 3523110665

- Mi contribución concreta: Implementé el service worker `public/sw.js` (precaché atómica, navegación network-first con respaldo en caché y `public/offline.html`, estáticos cache-first, exclusión de `/api/`, mensajes `SKIP_WAITING`, `CLEAR_CACHES` y `GET_VERSION`), el módulo `src/lib/pwa/register-service-worker.ts` (registro con detección de soporte, contenedor inyectable, avisos `onReady`/`onUpdateAvailable`, activación explícita y recarga única), el componente cliente `src/components/service-worker-manager.tsx` montado en `src/app/layout.tsx` con el aviso "Hay una versión nueva disponible", el indicador `src/components/connection-status.tsx` en el shell, y la documentación `docs/cache-strategy.md` y la sección de Semana 3 del `README.md`.
- Decisión que puedo explicar y por qué: No uso `skipWaiting()` automático. La versión nueva se precachea completa con `cache.addAll` (si una URL falla, la instalación se descarta y la anterior sigue activa) y queda en espera hasta que la persona pulsa "Actualizar ahora"; solo entonces se activa, se borran las cachés `inspecciones-lab-*` anteriores y la página recarga una vez. Así nunca se mezcla HTML viejo con chunks nuevos. Elegí network-first para HTML porque es lo que cambia entre despliegues, y cache-first solo para recursos con hash en el nombre, que no pueden quedar obsoletos. `/api/` no se intercepta para no cachear datos que en semanas posteriores podrían ser sensibles.
- Comando o prueba que ejecuté: `node node_modules/typescript/bin/tsc --noEmit`, `npm run build`, `npm run verify`, y una comprobación en navegador con `npm run build && npm run start`: consulté `navigator.serviceWorker.getRegistration()` y `caches.keys()` desde la consola, luego detuve el servidor y recargué `/` y `/no-existe`. Después de integrar la rama de Alejandro en `main`, ejecuté `npm ci`, `npm test`, `npm run test -- --run`, `npm run build`, `npm run verify` y `node scripts/verify.mjs --structure` sobre `aae4b6c`. Además probé el flujo de actualización en el navegador integrado: con `v1` activa cambié temporalmente `CACHE_VERSION` a `v2` sin commitearlo, reconstruí, reinicié el servidor, ejecuté `registration.update()`, pulsé "Actualizar ahora" y consulté la versión del worker activo con el mensaje `GET_VERSION`. Por último apagué el servidor y recargué `/` y una ruta inexistente.
- Resultado real observado: `tsc` sin errores; build de Next.js 14.2.35 correcto con dos rutas estáticas; `npm run verify` terminó en `Verificación técnica: pass`. En el navegador, `sw.js` quedó `activated` con alcance `http://localhost:3000/` y controlando la página; la caché `inspecciones-lab-v1` contenía las cinco URLs precacheadas y, tras una recarga, 13 entradas (8 chunks de `/_next/static/`). Con el servidor detenido (`curl` devolvía código 000), `/` se renderizó completo desde caché con las 3 inspecciones sintéticas y `/no-existe` mostró `offline.html` con el título "Sin conexión · Inspecciones de laboratorio". Sobre `aae4b6c`, las cuatro pruebas dieron `PASS` con `npm test` y con `npm run test -- --run`, el build compiló con dos rutas estáticas, `npm run verify` terminó en `pass`, la estructura estuvo presente y GitHub Actions terminó en verde en los tres workflows de ese commit. En la actualización, antes de `update()` solo existía `inspecciones-lab-v1` y no había aviso. Después, `v2` quedó en estado `installed` en espera, `v1` siguió activa y respondió `GET_VERSION` con `v1`, ambas cachés coexistieron y apareció el aviso "Hay una versión nueva disponible" sin recargar la página. Tras pulsar el botón, la página recargó una sola vez, `GET_VERSION` respondió `v2`, `caches.keys()` devolvió solo `inspecciones-lab-v2`, el aviso desapareció y se mostraron las 3 inspecciones. Con el servidor apagado, `/` cargó desde la caché `v2` y `/ruta-que-no-existe` mostró `offline.html`.
- Qué verifica y qué no verifica: Verifica registro, precaché, respaldo offline del shell y de rutas desconocidas, y que el build sigue limpio. El flujo de actualización sí se verificó a mano en el navegador Chromium integrado, como se describe arriba, pero no está automatizado en un navegador. No se verificó HTTPS, ni cuota de almacenamiento, ni otros navegadores como Safari o Firefox. Las pruebas automatizadas `tests/service-worker.spec.ts` y `tests/offline.spec.ts` corresponden a Alejandro y prueban el mismo contrato en Node.
- Limitación o riesgo: El indicador del encabezado depende de `navigator.onLine`: con el servidor caído pero red disponible seguía diciendo "En línea" aunque el contenido venía de caché; es una limitación conocida de esa API. El service worker solo se registra en producción porque en `next dev` los chunks no llevan hash y la caché los dejaría obsoletos. Una ruta nunca visitada solo puede mostrar `offline.html`.
- Uso de IA: Utilicé Claude Code, con los modelos Claude Fable 5.1 y Claude Sonnet 5, para diseñar el contrato entre `sw.js` y el módulo de registro, redactar `docs/cache-strategy.md`, preparar las instrucciones de pruebas para Alejandro, revisar sus pruebas con mutaciones en `sw.js` y en el módulo de registro, y ejecutar la verificación en el navegador integrado. Detectó que las pruebas iniciales no fallaban si el registro activaba la versión nueva sin confirmación, y Alejandro lo corrigió en `a46f051`. Validé cada archivo ejecutando `tsc`, el build, la verificación y la comprobación manual en navegador descrita arriba; puedo explicar y modificar el ciclo de vida completo.
- SHA del commit de contribución: `d471f93` (`feat: service worker con precaché, fallback offline y actualización segura - Semana 3`), integrado en `main` por el PR #5.
- SHA final de entrega: el código de la semana quedó validado en el merge `aae4b6c` del PR #6, con Actions en verde. El commit que se entrega en Classroom es el último de `main`, que solo agrega documentación y evidencia; su SHA no puede escribirse dentro de este archivo y se indica en la entrega.

### Semana 4 — Espinoza Landeta Oscar — 3523110665

- Mi contribución concreta: Implementé la ruta SSR `src/app/inspecciones/page.tsx` (Server
  Component con `dynamic = "force-dynamic"`), su `src/app/inspecciones/loading.tsx` y
  `src/app/inspecciones/error.tsx`; la ruta CSR `src/app/inspecciones/[id]/page.tsx`; el
  Route Handler `src/app/api/inspections/[id]/route.ts`; el repositorio compartido
  `src/lib/data/inspections-repository.ts`; la lógica extraída y comprobable
  `src/lib/rendering/fetch-inspection-client.ts`; el componente compartido
  `src/components/loading-state.tsx`; actualicé la navegación de `src/components/app-shell.tsx`
  para apuntar a `/inspecciones`; y escribí `docs/rendering-decision.md` y esta sección del
  `README.md`.
- Decisión que puedo explicar y por qué: Asigné SSR al listado porque es la primera pantalla
  y no debe mostrar un salto de contenido; asigné CSR al detalle porque se llega por
  interacción y ahí vale la pena pagar una segunda petición a cambio de poder reintentar sin
  recargar la página. Extraje `fetchInspectionClient` fuera del componente React, con
  `fetchImpl` inyectable, siguiendo el mismo patrón que `register-service-worker.ts` de la
  Semana 3: nunca lanza, siempre resuelve un estado (`ok`/`not-found`/`error`). Evité el
  hydration mismatch manteniendo el primer render del componente cliente siempre igual
  (`status: "loading"`, fijo, sin leer reloj ni `window` antes del primer `useEffect`).
- Comando o prueba que ejecuté: `tsc --noEmit`, `npm run build`, `npm run verify`, y una
  compilación aislada de los módulos de esta semana con `--jsx react-jsx --module commonjs
  --target es2020 --lib es2020,dom` para validar el contrato antes de dárselo a Alejandro
  (15 aserciones reales: repositorio, Route Handler, `fetchInspectionClient` y renderizado
  del Server Component vía `react-dom/server`). En navegador, con `npm run build && npm run
  start`, visité `/inspecciones`, `/inspecciones?fallo=1`,
  `/inspecciones/inspection-002`, `/inspecciones/inspection-002?fallo=1` y
  `/inspecciones/no-existe`, y medí la latencia con `curl -w`.
- Resultado real observado: Las 15 aserciones del contrato pasaron. El build compiló sin
  advertencias (`/inspecciones` y `/inspecciones/[id]` quedaron marcadas `ƒ` dinámicas,
  `/api/inspections/[id]` como Route Handler dinámico). En navegador: SSR mostró los 3
  registros con "Renderizado en el servidor en 359 ms"; con `?fallo=1` mostró el límite de
  error de la ruta; CSR mostró primero "Cargando inspección en el cliente…" y luego el
  contenido con "Renderizado en el cliente en 486 ms"; con `?fallo=1` mostró "HTTP 500" con
  botón Reintentar; con un id inexistente mostró "No encontramos esa inspección". La consola
  no mostró ninguna advertencia de hydration. Medí con `curl`: en `/inspecciones`,
  `time_starttransfer` fue de apenas 0.02–0.13 s pero `time_total` de 0.38–0.46 s en tres
  muestras, porque Next.js hace streaming del `loading.tsx` como primer byte y el contenido
  resuelto llega después en la misma respuesta; en `/api/inspections/inspection-001`,
  `time_starttransfer` y `time_total` coincidieron en 0.37–0.43 s porque el Route Handler no
  hace streaming. Repetí la instalación y las mediciones sobre el merge final `ccf9538`
  (integración del PR #9 de Alejandro): `npm ci` desde cero, `npm test` (5 specs en `PASS`),
  `npm run build`, `npm run verify` y la comprobación de estructura, todos en código 0. Las
  tres muestras de `curl` sobre ese mismo commit dieron resultados equivalentes a los
  anteriores. En navegador, con el servidor sirviendo ese commit, confirmé que
  `/inspecciones?fallo=1` sigue mostrando el mensaje fijo en español con la referencia
  técnica (no el texto redactado por Next.js), que `/inspecciones/inspection-003` mostró
  primero el estado de carga y luego el contenido real, y que la consola no mostró ninguna
  advertencia de hidratación.
- Qué verifica y qué no verifica: El contrato de 15 casos verifica comportamiento real del
  repositorio, del Route Handler, de `fetchInspectionClient` y del HTML que produce el
  Server Component, no solo la existencia de los archivos. No verifica el streaming visual
  de `loading.tsx` ni la hidratación de React en un navegador real dentro de una prueba
  automatizada; esa parte quedó cubierta por la verificación manual descrita arriba, no por
  `tests/rendering.spec.ts` (que es responsabilidad de Alejandro).
- Limitación o riesgo: Descubrí que Next.js redacta `error.message` de los Server Components
  en producción (solo entrega un `digest`); mi primer borrador de `error.tsx` mostraba ese
  mensaje directamente y en producción habría salido un texto genérico en inglés. Lo corregí
  para usar un mensaje fijo en español y mostrar el `digest` solo como referencia técnica.
  Documenté en `docs/rendering-decision.md` que el query param `?fallo=1` es un gancho de
  prueba que queda accesible en producción tal como está; sería necesario retirarlo o
  protegerlo detrás de una bandera de entorno antes de un despliegue real. El listado no
  tiene paginación: alcanza para los 3 registros sintéticos actuales.
- Uso de IA: Utilicé Claude Code (Claude Fable 5.1) para diseñar el contrato entre las rutas
  SSR/CSR y sus módulos de apoyo, redactar `docs/rendering-decision.md`, validar el contrato
  con pruebas reales antes de escribir las instrucciones para Alejandro, y verificar en
  navegador con mediciones de `curl`. La IA detectó por sí misma, al revisar la salida real
  del navegador en modo producción, que el mensaje de error se redactaba y no lo que yo había
  escrito en el primer borrador; corregí el archivo a partir de esa observación. Validé cada
  resultado ejecutando los comandos descritos arriba; puedo explicar y modificar tanto las
  rutas como los módulos compartidos.
- SHA del commit de contribución: `d51a284` (`feat: renderizado CSR/SSR con estados
  verificables - Semana 4`), integrado en `main` por el PR #8.
- SHA final de entrega: el código de la semana quedó validado en el merge `ccf9538` del
  PR #9, con Actions en verde en los cuatro workflows del repositorio. El commit que se
  entrega en Classroom es el último de `main`; su SHA no puede escribirse dentro de este
  archivo y se indica en la entrega.

### Semana 5 — Espinoza Landeta Oscar — 3523110665

- Mi contribución concreta: Implementé el esquema y la validación local `src/lib/storage/schema.ts`,
  los adaptadores `memory-storage.ts` e `indexeddb-storage.ts`, la cola de sincronización
  `src/lib/sync/queue.ts`, la política de conflictos `conflict-policy.ts`, el transporte
  `transport.ts`, el servidor simulado `server-store.ts` con su ruta
  `src/app/api/sync/inspections/route.ts`, el cableado de navegador `client.ts`, la página de captura
  `src/app/inspecciones/nueva/page.tsx` con su panel `src/components/sync-panel.tsx`, el enlace en
  `app-shell.tsx`, `docs/sync-policy.md` y la sección de la Semana 5 del `README.md`.
- Decisión que puedo explicar y por qué: Cada operación lleva el estado completo del registro y
  una `idempotencyKey` que no cambia en ningún reintento; la revisión base se fija en el primer envío.
  Así el reintento es idéntico byte a byte y el servidor puede deduplicar. Los fallos de red no
  consumen el presupuesto de reintentos porque estar sin conexión no es un error de la operación;
  los del servidor sí, y al agotarse la operación pasa a `failed`. Para el cierre de pestaña, la
  operación queda `syncing` con un lease y se recupera al vencer; para las respuestas tardías, cada
  envío lleva un identificador de lease y una respuesta con otro identificador se descarta. Los
  conflictos se resuelven en el cliente con una fusión de tres vías por campo, con reglas explícitas:
  `attention` gana sobre `ok`, los hallazgos toman el máximo, el cambio más reciente gana el resto y
  el servidor gana los empates. Elegí fusionar por campo y no "gana el último" completo porque este
  pierde cambios que no chocaban.
- Comando o prueba que ejecuté: `tsc --noEmit` con el `tsconfig.json` estricto del proyecto y, aparte,
  la compilación sin `--strict` con las banderas de `scripts/run-tests.mjs`; `npm run build`; una
  batería temporal de 45 casos de comportamiento sobre la cola, la política, el servidor simulado, el
  transporte HTTP y el almacenamiento, y otra de 10 casos sobre el manejador de la ruta (no se
  commitean: son la base del contrato que le pasé a Alejandro para `tests/sync.spec.ts`); pruebas con
  `curl` de la API; y una verificación manual con `npm run build && npm run start` en el navegador.
- Resultado real observado: Las baterías dieron 45 y 10 casos en `PASS`. En el navegador: guardar sin
  responsable fue rechazado con "inspector: obligatorio" y no creó ningún registro; un registro válido
  quedó "Sincronizado" con una revisión en el servidor y una clave procesada. Con el servidor apagado,
  la conexión no respondió hasta el tiempo de espera de 10 s y la operación quedó pendiente con
  `network: Failed to fetch`, sin gastar reintentos (`failures: 0`) y con backoff creciente (+4400 ms
  en el tercer intento). Al volver el servidor, la página abierta entregó el registro sola. Tras
  recargar, los registros seguían en IndexedDB. Con `?perder=1` el servidor aplicó el registro de
  "Tecnica C" pero respondió 503; después de 5 envíos con la misma clave (4 con la respuesta perdida)
  la operación cerró como `duplicate` y el servidor conservó una sola revisión 1 y 2 claves procesadas
  (no 6). Para el conflicto, otro dispositivo subió el registro a la revisión 2 con `attention` y 2
  hallazgos; al editar el resumen desde la página, la política devolvió `status` y `findings` del
  remoto y el resumen local, y el servidor quedó en la revisión 3 con los tres cambios. La consola
  solo mostró los errores provocados a propósito (conexión rechazada, 503 y 409) y ninguna
  advertencia de hidratación. Después de integrar la rama de Alejandro repetí sobre `9e412f2`:
  `npm ci` desde cero, `npm test` (6 specs, con `sync.spec.ts` en 69 casos), `npm run build`,
  `npm run verify` y la estructura, todo en código 0, y revisé su suite rompiendo el código de
  30 maneras: las detectó todas.
- Qué verifica y qué no verifica: Las baterías y la prueba manual verifican idempotencia, reintentos,
  recuperación tras un cierre, respuestas tardías, conflictos y persistencia real en IndexedDB. No
  verifica el adaptador de IndexedDB de forma automatizada (no corre en Node), ni varias pestañas a la
  vez, ni Safari, ni un backend real. `tests/sync.spec.ts` es responsabilidad de Alejandro.
- Limitación o riesgo: Al compilar sin `--strict`, como lo hace `scripts/run-tests.mjs`, `tsc` perdía el
  estrechamiento de los tipos `ok: true | false` y marcaba errores que el `tsc` estricto del proyecto no
  veía; lo resolví en el tipo `ValidationResult` para que compile en ambos modos. El campo que
  identifica el envío en curso se llamaba de una forma que habría dado falso positivo en cualquier
  escáner de credenciales, así que lo renombré a `leaseId`. El servidor simulado vive en memoria: tras reiniciarlo, el primer registro seguía marcado
  como sincronizado en el dispositivo pero ya no estaba en el servidor. Los ganchos `?fallo=1`,
  `?perder=1` y `DELETE` quedan accesibles. Todo está documentado en `docs/sync-policy.md`.
- Uso de IA: Utilicé Claude Code (Claude Sonnet 5.5) para diseñar el modelo de operaciones y las
  garantías de la cola, escribir los módulos y `docs/sync-policy.md`, validar el contrato con las
  baterías antes de escribir las instrucciones para Alejandro, y ejecutar la verificación en el
  navegador integrado. Validé el resultado ejecutando los comandos descritos arriba y los escenarios
  manuales; puedo explicar y modificar la cola, la política de conflictos y el servidor simulado.
- SHA del commit de contribución: `5383fcb` (`feat: persistencia local y sincronización idempotente - Semana 5`),
  integrado en `main` por el PR #11.
- SHA final de entrega: el código de la semana quedó validado en el merge `9e412f2` del
  PR #12, con Actions en verde en los cinco workflows del repositorio. El commit que se
  entrega en Classroom es el último de `main`; su SHA no puede escribirse dentro de este
  archivo y se indica en la entrega.

## Integrante: Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta y enlace a archivo, commit anterior o revisión: Actualicé `scripts/verify.mjs`, `public-tests/check.sh`, `public-tests/README.md` y `.github/workflows/week-01-starter-feedback.yml` desde el starter aclarado. Mi cambio principal está en el commit `01ea8ed`.
- Decisión que puedo explicar y por qué: La verificación principal debe concentrarse en `npm run verify`, porque la versión aclarada ejecuta la prueba proporcionada y el build, además de revisar la estructura. El workflow usa Node 20.19.6 y `npm ci` para mantener una ejecución reproducible en CI.
- Comando o prueba proporcionada que ejecuté: En PowerShell ejecuté `npm.cmd ci` y `npm.cmd run verify` desde la raíz del repositorio.
- Resultado real que observé: `npm.cmd ci` terminó con código 0 e instaló 28 paquetes. La prueba mostró `starter.spec.mjs: PASS`; el build de Next.js 14.2.35 compiló correctamente y generó las cuatro páginas estáticas. El resultado final fue `Verificación técnica: pass. Revisión académica: pendiente. Reporte: reports/verification.json`. Webpack mostró dos advertencias de caché, pero el proceso terminó con código 0.
- Qué verifica esa prueba y qué no verifica: Verifica la presencia de archivos, la prueba proporcionada y el build. No califica la calidad de los requisitos, no valida que la PWA futura ya tenga funcionamiento offline y no certifica la ausencia de secretos.
- Limitación, dificultad o riesgo que identifiqué: La actividad todavía no implementa manifest, Service Worker, funcionamiento offline, sincronización, notificaciones ni autenticación. Además, los saltos CRLF de Windows pueden afectar la ejecución local de scripts Bash; CI usa Ubuntu.
- Uso de IA: Utilicé Codex para comparar y revisar los cuatro archivos técnicos y registrar las versiones del entorno. Validé personalmente la aportación ejecutando `npm.cmd ci` y `npm.cmd run verify`, y revisé que la prueba, el build y el reporte terminaran correctamente.

### Semana 2 — Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta: Incorporé `public/manifest.webmanifest`, los iconos y sus rutas públicas, los metadatos PWA de `src/app/layout.tsx`, la prueba `tests/manifest.spec.ts` y la configuración de `npm test` para comprobar el manifest con TypeScript. También documenté técnicamente la Semana 2 en `README.md`. El workflow proporcionado de Semana 2 se conservó sin modificaciones.
- Decisión que puedo explicar y por qué: El manifest declara rutas absolutas dentro de un mismo alcance (`/`), modo `standalone`, colores coherentes con la interfaz e iconos de 192 y 512 píxeles con propósito `any maskable`. Esto cubre los metadatos instalables sin adelantar el Service Worker de la Semana 3.
- Comando o prueba proporcionada que ejecuté: `npm ci`, `npm test`, `npm run build` y `npm run verify` desde la raíz del repositorio. También ejecuté `node scripts/verify.mjs --structure`, equivalente directo del contenido de `public-tests/check.sh`.
- Resultado real observado: `npm ci`, `npm test`, `npm run test -- --run` y `npm run build` terminaron con código 0; ambas pruebas mostraron `starter.spec.mjs: PASS` y `manifest.spec.ts: PASS`. Después de ampliar la verificación conjunta, `npm run verify` y `node scripts/verify.mjs --structure` detectaron únicamente la ausencia de `src/components/app-shell.tsx`, entregable asignado a Oscar que todavía no está integrado en esta rama. En este equipo Windows, `make` no está instalado y WSL denegó el inicio de Bash.
- Prueba del manifest en navegador: La aplicación respondió con código 200 para la página, el manifest y ambos iconos. DevTools de Edge/Chromium encontró `/manifest.webmanifest` con cero errores de análisis y cero errores de instalabilidad, por lo que se conservaron los SVG de 192 y 512 píxeles.
- Qué verifica y qué no verifica: La prueba comprueba el contenido esencial del manifest, que las rutas de iconos existen y que el layout lo enlaza. No comprueba instalación real en todos los navegadores, funcionamiento offline ni Service Worker.
- Limitación o riesgo: La instalabilidad completa también depende de servir la aplicación mediante HTTPS y, para el comportamiento offline, de implementar el Service Worker en una semana posterior. La evaluación conjunta de CI depende además de los artefactos de interfaz asignados a Oscar.
- Uso de IA: Utilicé Codex para revisar el alcance asignado, estructurar el manifest, preparar los iconos SVG, configurar la ejecución de la prueba TypeScript y contrastar los comandos de verificación. Revisé los cambios y validé personalmente los resultados registrados.
- SHA del commit de contribución: `a3cc1232a8ba3b25e27c88ac20b50802d3d74b47` (`feat: implementar manifest y pruebas PWA de Semana 2`).
- SHA final de entrega: pendiente; se registrará después de integrar las ramas de Alejandro y Oscar y ejecutar la validación conjunta sobre ese mismo commit.

### Semana 3 — Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta: Incorporé `tests/service-worker.spec.ts` y `tests/offline.spec.ts`, amplié `scripts/run-tests.mjs` para compilar y ejecutar los tres specs TypeScript, y actualicé `scripts/verify.mjs` con los artefactos obligatorios de la Semana 3. También incorporé sin modificaciones el workflow `.github/workflows/week-03-w03-service-worker-offline.yml` y documenté la verificación de Alejandro en `README.md`. No modifiqué la implementación del service worker realizada por Oscar.
- Decisión que puedo explicar y por qué: `public/sw.js` se ejecuta realmente dentro de `node:vm` con `self`, cachés, red y eventos simulados; buscar cadenas en el archivo solo demostraría que cierto texto existe, mientras que la ejecución comprueba el comportamiento de `install`, `activate`, `fetch` y `message`. El `ServiceWorkerContainer` es inyectable para probar de forma determinista primera instalación, actualizaciones y errores en Node, sin depender de `navigator` ni de un navegador disponible.
- Comandos ejecutados: Desde la raíz del repositorio en PowerShell ejecuté `npm.cmd ci`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run verify` y `node scripts/verify.mjs --structure`. También ejecuté `public-tests/check.sh` mediante Git Bash.
- Resultado real observado:

  ```text
  added 28 packages
  starter.spec.mjs: PASS
  manifest.spec.ts: PASS
  service-worker.spec.ts: PASS
  offline.spec.ts: PASS
  Compiled successfully
  Verificación técnica: pass
  Estructura presente. No valida contenido, pruebas, build ni secretos.
  ```

  Todos los comandos terminaron con código 0. Next.js 14.2.35 generó cuatro páginas estáticas y el reporte quedó en `reports/verification.json`. Webpack mostró advertencias de caché, pero no impidieron la compilación.
- Qué verifica y qué no verifica: Las pruebas comprueban la precaché, el fallo atómico de instalación, la limpieza de versiones propias, las estrategias network-first y cache-first, las solicitudes excluidas, los mensajes de control y el ciclo de registro y actualización. No prueban el service worker dentro de un navegador real, la instalación de la PWA, HTTPS ni todas las diferencias de las API de caché entre navegadores.
- Limitación o riesgo: Los dobles de prueba reproducen solo la superficie de las API que utiliza el proyecto. El comando `bash` de Windows intentó iniciar WSL y fue denegado, por lo que el check público se ejecutó correctamente con `C:\Program Files\Git\bin\bash.exe`. La comprobación final del workflow todavía depende de GitHub Actions después del push.
- Uso de IA: Utilicé Codex para revisar el contrato de la actividad, preparar los dobles de las API del service worker, detectar incompatibilidades de compilación entre el `tsconfig` general y CommonJS, y organizar la evidencia. Revisé los cambios y validé los resultados ejecutando personalmente la instalación limpia, las pruebas, el build y la verificación estructural.
- SHA del commit de contribución: `dc467b05bd882739c6ab5d259f5c284c548b1b3e` (`test: agregar pruebas y CI de service worker - Semana 3`). Corrección posterior de cobertura en `a46f051` (`test: cubrir activación no confirmada y exclusiones PWA`).
- SHA final de entrega: el código de la semana quedó validado en el merge `aae4b6c` del PR #6, con Actions en verde. El commit que se entrega en Classroom es el último de `main`, que solo agrega documentación y evidencia; su SHA no puede escribirse dentro de este archivo y se indica en la entrega.

### Semana 4 — Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta: Incorporé `tests/rendering.spec.ts` para comprobar el repositorio de inspecciones, el Route Handler, la lógica CSR extraída, el Server Component SSR y `LoadingState`. Amplié `scripts/run-tests.mjs` con la compilación JSX `react-jsx`, la emisión de los módulos bajo prueba y la resolución de dependencias desde el directorio temporal; actualicé `scripts/verify.mjs` con los diez artefactos de Semana 4 y `docs/rendering-decision.md`; e incorporé el workflow `.github/workflows/week-04-w04-csr-ssr.yml` sin modificar su contenido.
- Decisión que puedo explicar y por qué: `src/app/inspecciones/page.tsx` se puede invocar directamente en Node porque su exportación predeterminada es una función `async` que devuelve un elemento React. No necesita iniciar un servidor Next.js para esta prueba: se espera la función y el elemento resultante se convierte a HTML con `renderToStaticMarkup`. En cambio, no se prueba directamente `src/app/inspecciones/[id]/page.tsx` porque usa `useSearchParams` y otros hooks que requieren el contexto del App Router; su lógica de negocio se extrajo a `fetchInspectionClient`, donde puede probarse de forma determinista con `fetch` y reloj inyectables.
- Comandos ejecutados: Desde la raíz del repositorio en PowerShell ejecuté `npm.cmd ci`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run verify` y `node scripts/verify.mjs --structure`. Ejecuté además `public-tests/check.sh` mediante `C:\Program Files\Git\bin\bash.exe`.
- Resultado real observado:

  ```text
  added 28 packages in 40s
  starter.spec.mjs: PASS
  manifest.spec.ts: PASS
  service-worker.spec.ts: PASS
  offline.spec.ts: PASS
  rendering.spec.ts: PASS
  Compiled successfully
  Verificación técnica: pass
  Estructura presente. No valida contenido, pruebas, build ni secretos.
  ```

  Todos los comandos terminaron con código 0. Next.js 14.2.35 generó `/inspecciones`, `/inspecciones/[id]` y `/api/inspections/[id]` como rutas dinámicas. Webpack mostró advertencias al crear su caché, pero no impidieron la compilación. El reporte se generó en `reports/verification.json`.
- Qué verifica y qué no verifica: La suite comprueba que el repositorio devuelve tres inspecciones, respeta una espera real y distingue error de ausencia; que la API responde 200, 404 y 500; que `fetchInspectionClient` construye las URL y resuelve los estados `ok`, `not-found` y `error` sin lanzar; que el Server Component produce HTML con los registros y propaga el fallo simulado; y que `LoadingState` conserva sus atributos accesibles. No comprueba el streaming visual de `loading.tsx`, la hidratación, el botón de reintento ni la navegación en un navegador real.
- Limitación o riesgo: Los dobles de `fetch` cubren el contrato que consume la aplicación, pero no reproducen todas las condiciones de una red o navegador reales. Como los specs usan `require` de CommonJS, TypeScript no descubre esos módulos como dependencias de compilación; por eso el runner enumera explícitamente los módulos bajo prueba y define `NODE_PATH` para que el código emitido en la carpeta temporal encuentre React y Next.js. La validación de GitHub Actions seguirá pendiente hasta publicar la rama.
- Uso de IA: Utilicé Codex para analizar las instrucciones, implementar y revisar las pruebas, diagnosticar la resolución de módulos desde el directorio temporal y organizar la evidencia. Verifiqué los resultados ejecutando personalmente la instalación limpia, la suite, el build, la verificación integral y el check público; revisé que todos terminaran con código 0.
- SHA del commit de contribución: `11286f5482b55801e61902ba3b6a1b6b03aa2e31` (`test: agregar pruebas y CI de renderizado - Semana 4`).
- SHA final de entrega: el código de la semana quedó validado en el merge `ccf9538` del
  PR #9, con Actions en verde en los cuatro workflows del repositorio. El commit que se
  entrega en Classroom es el último de `main`; su SHA no puede escribirse dentro de este
  archivo y se indica en la entrega.

### Semana 5 — Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta: Incorporé `tests/sync.spec.ts` con 69 casos, actualicé
  `scripts/run-tests.mjs` para compilar y ejecutar la suite junto con todos sus módulos, amplié
  `scripts/verify.mjs` con los artefactos y el documento de sincronización, conservé el workflow
  de Semana 5 agregado al repositorio y documenté la verificación en el `README.md`.
- Decisión que puedo explicar y por qué: La cola se prueba con `MemoryStorage` porque cumple el
  mismo contrato asíncrono y permite controlar de forma determinista lotes, fallos y datos
  persistidos. Esto aísla la lógica de la cola, pero no prueba el adaptador IndexedDB real. El
  cierre de una pestaña se simula creando una segunda cola sobre el mismo almacén: se pierde el
  estado en memoria de la primera, pero sobreviven el registro, la operación y su lease. Para la
  idempotencia, el servidor falso aplica una operación y después simula la pérdida de la respuesta;
  el reintento conserva la misma clave, cuerpo y revisión base, por lo que el servidor responde
  como duplicado sin incrementar la revisión. Los fallos de red no consumen el presupuesto porque
  estar sin conexión no vuelve inválida la operación; los fallos del servidor sí lo consumen.
- Comandos ejecutados: `npm.cmd ci`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run verify`,
  `node scripts/verify.mjs --structure` y
  `C:\Program Files\Git\bin\bash.exe public-tests/check.sh` desde la raíz del repositorio.
- Resultado real observado: `npm.cmd ci` agregó 28 paquetes con código 0. Las suites
  `starter`, `manifest`, `service-worker`, `offline`, `rendering` y `sync` pasaron; la última mostró
  `sync.spec.ts: PASS (69 casos)`. Next.js 14.2.35 compiló correctamente y generó seis páginas. La
  verificación técnica terminó en `pass`, y los dos checks estructurales informaron
  `Estructura presente`. Las advertencias de caché de Webpack no impidieron el build.
- Revisión por mutación: Cambié temporalmente tres condiciones y restauré cada una. Al hacer que
  los fallos de red consumieran presupuesto falló `fallo de red no consume presupuesto`; al hacer
  que el cambio local ganara un empate falló `el servidor gana empates`; y al quitar la comparación
  del identificador de lease falló `descarta una respuesta tardia`. Esta última mutación ayudó a
  fortalecer el escenario para mantener simultáneamente dos envíos con leases distintos.
- Qué verifica y qué no verifica: La suite cubre validación y esquema, atomicidad, guardado y
  coalescencia, sincronización, idempotencia, backoff, recuperación, respuestas obsoletas,
  conflictos, servidor simulado, transporte HTTP, observabilidad y Route Handler. No ejecuta
  IndexedDB real, varias pestañas reales al mismo tiempo ni un backend persistente.
- Limitación o riesgo: El servidor de la actividad vive en memoria y sus datos se pierden al
  reiniciarse. Los dobles de prueba reproducen el contrato usado por la cola, no todas las
  diferencias de red y navegador. La validación final de GitHub Actions queda pendiente hasta
  publicar la rama. Nota del cierre: ya se publicó y los cinco workflows terminaron en verde
  sobre el merge `9e412f2`.
- Uso de IA: Utilicé Codex para analizar el contrato, preparar el arnés determinista, implementar y
  revisar los casos, ejecutar las verificaciones y fortalecer la detección de mutaciones. Revisé
  los cambios y validé el resultado con los comandos registrados.
- SHA del commit de contribución: `a934c77` (`test: agregar pruebas y CI de sincronizacion - Semana 5`), integrado en `main` por el PR #12.
- SHA final de entrega: el código de la semana quedó validado en el merge `9e412f2` del
  PR #12, con Actions en verde en los cinco workflows del repositorio. El commit que se
  entrega en Classroom es el último de `main`; su SHA no puede escribirse dentro de este
  archivo y se indica en la entrega.
