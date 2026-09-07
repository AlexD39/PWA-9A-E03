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
- Check público: `bash public-tests/check.sh` ejecuta la verificación estructural; no certifica la calidad de los documentos ni la ausencia de secretos.
- CI: GitHub Actions `week-01-starter-feedback.yml` usa Node 20.19.6, ejecuta `npm ci` y `npm run verify`, y publica el artefacto `starter-week-01-evidence`.
- SHA final: se obtiene después del último commit con `git rev-parse HEAD` y se entrega en Classroom junto con el enlace de Actions de ese mismo SHA.

## Decisiones de arquitectura
Las decisiones de arquitectura y las nuevas carpetas se incorporan en las actividades correspondientes; no es necesario adelantarlas. Ver historial en docs/decision-record.md.
