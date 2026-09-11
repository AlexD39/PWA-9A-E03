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
