# Evidencia individual


- Estudiante: Espinoza Landeta Oscar — 3523110665 (Equipo-03)

- Commit SHA evaluado: 7785061563df95c9e273fc89c41777e2f2dc2352
  · Mi commit individual de contribución (rama docs): 6d0da55

- Decisión técnica que puedo explicar: Elegí PWA sobre Next.js en lugar de web tradicional, app nativa o multiplataforma, porque es la única que cumple la restricción dominante del problema: operar con conectividad intermitente (RF-03 / RNF-02) mediante Service Worker + caché. Reutiliza el stack del curso (un solo código base, `npm ci` reproducible), es instalable sin tiendas desde el navegador y se despliega en Vercel/Docker. Asumo sus límites reales: soporte desigual en Safari y APIs de dispositivo parciales, con mitigaciones previstas para S2–S5. Descarté nativa (2 bases de código fuera del stack, inviable en 14 semanas) y multiplataforma (framework ajeno a las competencias evaluadas, distribución atada a tiendas).

- Prueba que ejecuté y resultado: `npm run verify` → `Starter verificable: PASS`
  (check estructural: verifica existencia de artefactos, no contenido ni lógica).
  `bash public-tests/check.sh` → `PUBLIC_OK` tras normalizar CRLF (`sed 's/\r$//' ... | bash`)
  e instalar ripgrep en WSL. Nota honesta: este check imprime PUBLIC_OK aunque su escaneo
  (`rg`) detecte coincidencias con palabras como "secretos"/"tokens"/"keys" presentes en la
  documentación (falsos positivos) y en el paquete `js-tokens`; por la inversión con `!` no aborta,
  por lo que PUBLIC_OK no demuestra ausencia de secretos. La garantía de privacidad la cubren el
  evaluador privado y el contenido sintético del repo.

- Limitación o fallo diagnosticado: Dos limitaciones. (1) Funcional: en Semana 1 el offline aún no existe — `src/app/page.tsx:13` declara literalmente "PWA aún no implementada". Manifest, Service Worker, caché, cola de sincronización, notificaciones y autenticación quedan explícitamente fuera hasta S2–S6, así que la decisión por PWA todavía no tiene evidencia de caché; solo se valida la base reproducible, requisitos y documentación. (2) De entorno local en Windows: los checks del starter (`make verify`/`check.sh`) sufren fricciones propias del SO — la política de ejecución de PowerShell bloqueaba `npm.ps1` (resuelto con `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`), el checkout con `autocrlf=true` genera CRLF que rompe `set -euo pipefail` en `check.sh`, y `ripgrep` instalado vía winget no queda en el PATH de Git Bash. Ninguna de estas afecta a CI/Ubuntu, pero sí al resultado reproducido localmente.

- Cambio que podría defender o modificar en vivo: Puedo modificar la tabla comparativa del ADR-001 (p. ej. agregar el criterio de costo de distribución) o reformular un requisito no funcional para hacerlo más medible (RNF-01: umbral de 3 s con Fast 3G en Chrome DevTools) y re-ejecutar `npm run verify` para demostrar que el repositorio sigue en verde. También puedo explicar la fricción CRLF/`rg` y su diferencia con el comportamiento en CI.

- Uso declarado de IA (herramienta, propósito, validación): Usé un asistente de IA (opencode/Muse Spark) principalmente como guía de estructura para el ADR-001 (bosquejo de la tabla de las 4 alternativas, matriz de riesgos y tabla de validación por semanas), para revisar el encuadre y los requisitos, y para diagnosticar los tropiezos de entorno en Windows (política de ejecución, CRLF, `rg` en Git Bash). La redacción final, los trazados a RF/RNF y la decisión propia son míos; ajusté y verifiqué el texto contra `docs/requirements.md`, el starter y el ADR publicado, y ejecuté la verificación local (`npm run verify`) antes de cerrar. Sí, la IA redactó plantillas y detectó problemas; la validación humana y la defensa en vivo son mías.

## Integrante 2 
- Estudiante: Contreras Martinez Alejandro — 3523110460 (Equipo-03)
  · Mi commit individual de contribución: 01ea8ed

- Mi contribución concreta y enlace a archivo, commit anterior o revisión: Actualicé `scripts/verify.mjs`, `public-tests/check.sh`, `public-tests/README.md` y `.github/workflows/week-01-starter-feedback.yml` desde el starter aclarado. También registré las versiones reales del entorno en `README.md` y revisé que el workflow publique `reports/verification.json` como el artefacto `starter-week-01-evidence`.
- Decisión que puedo explicar y por qué: La verificación principal debe concentrarse en `npm run verify`, porque la versión aclarada ejecuta la prueba proporcionada y el build, además de revisar la estructura. El workflow usa Node 20.19.6 y `npm ci` para mantener una ejecución reproducible en CI.
- Comando o prueba proporcionada que ejecuté: En PowerShell ejecuté `npm.cmd ci` y `npm.cmd run verify` desde la raíz del repositorio.
- Resultado real que observé: `npm.cmd ci` terminó con código 0 e instaló 28 paquetes. La prueba mostró `starter.spec.mjs: PASS`; el build de Next.js 14.2.35 compiló correctamente y generó las cuatro páginas estáticas. El resultado final fue `Verificación técnica: pass. Revisión académica: pendiente. Reporte: reports/verification.json`. Webpack mostró dos advertencias de caché (`Unable to snapshot resolve dependencies`), pero el proceso terminó con código 0.
- Qué verifica esa prueba y qué no verifica: Verifica la presencia de archivos, la prueba proporcionada y el build. No califica la calidad de los requisitos, no valida que la PWA futura ya tenga funcionamiento offline y no certifica la ausencia de secretos.
- Limitación, dificultad o riesgo que identifiqué: La actividad todavía no implementa manifest, Service Worker, funcionamiento offline, sincronización, notificaciones ni autenticación. Además, los saltos CRLF de Windows pueden afectar la ejecución local de scripts Bash; CI usa Ubuntu y el archivo versionado debe conservarse sin modificaciones manuales ocultas.
- Uso de IA: Utilicé Codex para comparar y revisar los cuatro archivos técnicos, registrar las versiones del entorno. Ademas de validar la aportación ejecutando personalmente en mi entorno `npm.cmd ci` y `npm.cmd run verify`, y revisé que la prueba, el build y el reporte terminaran correctamente.
