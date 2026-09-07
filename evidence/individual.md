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

## Integrante: Contreras Martinez Alejandro — 3523110460

- Mi contribución concreta y enlace a archivo, commit anterior o revisión: Actualicé `scripts/verify.mjs`, `public-tests/check.sh`, `public-tests/README.md` y `.github/workflows/week-01-starter-feedback.yml` desde el starter aclarado. Mi cambio principal está en el commit `01ea8ed`.
- Decisión que puedo explicar y por qué: La verificación principal debe concentrarse en `npm run verify`, porque la versión aclarada ejecuta la prueba proporcionada y el build, además de revisar la estructura. El workflow usa Node 20.19.6 y `npm ci` para mantener una ejecución reproducible en CI.
- Comando o prueba proporcionada que ejecuté: En PowerShell ejecuté `npm.cmd ci` y `npm.cmd run verify` desde la raíz del repositorio.
- Resultado real que observé: `npm.cmd ci` terminó con código 0 e instaló 28 paquetes. La prueba mostró `starter.spec.mjs: PASS`; el build de Next.js 14.2.35 compiló correctamente y generó las cuatro páginas estáticas. El resultado final fue `Verificación técnica: pass. Revisión académica: pendiente. Reporte: reports/verification.json`. Webpack mostró dos advertencias de caché, pero el proceso terminó con código 0.
- Qué verifica esa prueba y qué no verifica: Verifica la presencia de archivos, la prueba proporcionada y el build. No califica la calidad de los requisitos, no valida que la PWA futura ya tenga funcionamiento offline y no certifica la ausencia de secretos.
- Limitación, dificultad o riesgo que identifiqué: La actividad todavía no implementa manifest, Service Worker, funcionamiento offline, sincronización, notificaciones ni autenticación. Además, los saltos CRLF de Windows pueden afectar la ejecución local de scripts Bash; CI usa Ubuntu.
- Uso de IA: Utilicé Codex para comparar y revisar los cuatro archivos técnicos y registrar las versiones del entorno. Validé personalmente la aportación ejecutando `npm.cmd ci` y `npm.cmd run verify`, y revisé que la prueba, el build y el reporte terminaran correctamente.
