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
- CI de Semana 1: GitHub Actions `week-01-starter-feedback.yml` usa Node 20.19.6, ejecuta `npm ci` y `npm run verify`, y publica el artefacto `starter-week-01-evidence`.
- CI de Semana 2: GitHub Actions `.github/workflows/week-02-w02-shell-manifest.yml` ejecuta una instalación limpia, el build, la comprobación de artefactos obligatorios y la suite de pruebas, y publica la evidencia disponible como `academic-evidence-w02-shell-manifest`.
- SHA final: se obtiene después del último commit con `git rev-parse HEAD` y se entrega en Classroom junto con el enlace de Actions de ese mismo SHA.

## Decisiones de arquitectura
Las decisiones de arquitectura y las nuevas carpetas se incorporan en las actividades correspondientes; no es necesario adelantarlas. Ver historial en docs/decision-record.md.
