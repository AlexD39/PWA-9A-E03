# ADR-001 — Estrategia de aplicación

> Completa esta decisión en Semana 1. Una decisión no es solo una preferencia: relaciona restricciones, alternativas, consecuencias y una forma de validación.

## Estado

Aceptada — 2026-09-03

## Contexto y restricciones

El sistema registra inspecciones y hallazgos de mantenimiento en tres
laboratorios de la Universidad Tigres de Tehuacán (Redes, Electrónica
y Software), con dos usuarios definidos en `docs/requirements.md`: técnico
de mantenimiento (captura) y supervisor (consulta y seguimiento).

Restricciones que gobiernan la decisión:

- **Conectividad intermitente (RF-03 / RNF-02):** la red del campus es
  irregular; la consulta y la captura no pueden detenerse sin red. Es la
  restricción dominante del encuadre ("Desconectar").
- **Uso en campo y móvil:** la captura ocurre dentro de los laboratorios,
  por lo que la solución debe funcionar en navegador móvil e instalarse
  como app (hito S2 del roadmap).
- **Alcance académico de 14 semanas:** equipo de 2 personas, un solo
  repositorio acumulativo, entregas semanales verificables. No hay margen
  para mantener 2–3 bases de código.
- **Stack fijado por el curso:** Next.js (App Router) + React + TypeScript
  sobre APIs web estándar; el starter ya compila con Next 14.2.35.
- **Datos exclusivamente sintéticos:** todo proviene de
  `src/lib/data/inspections.ts` (3 registros); prohibidos PII, secretos y
  `.env` (lo verifica `public-tests/check.sh`).
- **Estado inicial honesto:** `src/app/page.tsx` declara "PWA aún no
  implementada". En S1 NO se implementan manifest, Service Worker,
  sincronización, notificaciones ni autenticación; esas capacidades llegan
  en S2–S6.

## Alternativas consideradas

### 1. PWA (Next.js + Manifest + Service Worker)

- Instalación desde el navegador, sin tiendas; actualización sin
  intervención del usuario ("Recuperar").
- Offline real: Service Worker + Cache Storage + almacenamiento local
  (hitos S2–S3 del roadmap: shell instalable, caché y recuperación).
- Un solo código base, mismo stack del starter; despliegue reproducible
  en Vercel/Docker ("Operar").
- Acceso a dispositivo progresivo (notificaciones, cámara) con límites
  explícitos y degradación segura (hito S6).
- Riesgo principal: soporte desigual entre navegadores (Safari) y APIs
  de dispositivo más limitadas que en nativo.

### 2. Web tradicional (Next.js sin capacidades PWA)

- Sin instalación ni caché de recursos; offline prácticamente nulo.
- Costo mínimo, pero **no satisface la restricción dominante** (RF-03 /
  RNF-02): ante un corte de red la consulta y captura se detienen.
- Se descarta por incumplir el requisito que gobierna el diseño.

### 3. Aplicación nativa (Kotlin/Swift)

- Offline y acceso a dispositivo excelentes.
- Exige 2 bases de código fuera del stack del curso, distribución por
  tiendas con revisión, y curva de aprendizaje ajena a la materia.
- Inviable para un equipo de 2 en 14 semanas con entregas semanales;
  se descarta por costo y desalineación con las competencias evaluadas.

### 4. Multiplataforma (React Native / Flutter)

- Buen offline y acceso a dispositivo, un solo código base.
- Introduce un framework nuevo que no desarrolla las competencias del
  curso (Manifest, Service Worker, Cache Storage) y complica la
  reproducibilidad exigida (`npm ci` + Actions + `next build`).
- Distribución igualmente atada a tiendas; se descarta.

| Criterio | PWA | Web tradicional | Nativa | Multiplataforma |
|---|---|---|---|---|
| Opera sin conexión (RF-03) | ✅ SW + caché (S3) | ❌ | ✅ | ✅ |
| Instalable sin tiendas (S2) | ✅ Manifest | ❌ | ❌ (store) | ❌ (store) |
| Un solo código base | ✅ | ✅ | ❌ (2) | ✅ |
| Costo en 14 sem. / eq. de 2 | Bajo | Bajo | Alto | Medio |
| Acceso a dispositivo | Parcial, progresivo | Muy limitado | Completo | Bueno |
| Alineación con stack y roadmap | ✅ total | Parcial | ❌ | ❌ |
| Despliegue reproducible | ✅ Vercel/Docker | ✅ | ❌ | Parcial |

## Decisión

Se adopta **PWA sobre Next.js (App Router) + React + TypeScript**, servida
como aplicación web e instalable mediante Web App Manifest y Service
Worker en las semanas correspondientes.

Justificación: es la única alternativa que satisface a la vez la
restricción dominante (operar con conectividad intermitente), el alcance
académico (14 semanas, 2 personas, un repo acumulativo) y la
reproducibilidad exigida (`npm ci`, `next build`, Actions en verde), sin
pasar por tiendas y reutilizando el starter que ya muestra las 3
inspecciones sintéticas.

**Qué NO resuelve todavía (declaración explícita de S1):** manifest,
Service Worker, caché offline, cola de sincronización e idempotencia
(S5), notificaciones push y permisos (S6), autenticación y roles. El estado
actual es solo shell web verificable; cada capacidad se agrega en su
semana sin reescribir la app.

## Consecuencias y riesgos

**Consecuencias positivas:**

- Una base de código para escritorio y móvil; el flujo crítico
  (consultar inspecciones) existe desde S1 con datos sintéticos.
- Entrega auditable: URL + SHA + corrida verde de Actions + artefacto
  `reports/verification.json`.
- Las semanas S2–S6 agregan instalación, caché, renderizado, sync y
  dispositivo de forma incremental y trazable.

**Costos:**

- Implementar caché, versionado del SW, cola de sincronización y
  estrategia de actualización agrega complejidad que la web tradicional
  no tiene; exige pruebas deterministas (responsabilidad compartida con
  el trabajo de workflow/tests de Alejandro).

| Riesgo | Impacto | Mitigación (ligada al roadmap) |
|---|---|---|
| Caché obsoleta tras update | Usuario ve versión vieja | Estrategia de actualización del SW + prueba de recuperación (S3) |
| Safari con soporte limitado de SW/install prompt | Instalación desigual | Pruebas en Chrome y Safari; fallback informativo si no hay prompt (S2–S3) |
| APIs de dispositivo insuficientes | Funcionalidad degradada | Diseño con degradación segura y permisos mínimos declarados (S6) |
| Pérdida de capturas si el navegador limpia storage | Datos no sincronizados se pierden | Cola persistente con reintentos e idempotencia (S5) |
| Alcance desbordado antes de tiempo | No se cierra el cuatrimestre | Regla del curso: cada semana solo su hito; lo futuro va a ADRs posteriores |

## Validación

| Afirmación | Evidencia | Comando / artefacto |
|---|---|---|
| Base reproducible (S1) | Build y checks en verde | `npm ci`, `npm run build`, `make verify`, `bash public-tests/check.sh`, `reports/verification.json` |
| Instalable (S2) | Manifest + shell instalable | Auditoría Lighthouse PWA + prueba de instalación |
| Offline real (S3) | Contenido visible sin red tras carga inicial | Prueba automatizada del SW (caché + recuperación) |
| Sync confiable (S5) | Capturas offline se sincronizan sin duplicados | Prueba de cola e idempotencia con datos sintéticos |
| Dispositivo con fallback (S6) | Permisos mínimos o degradación declarada | Prueba de permisos + fallback |

**Criterio de reversión:** si hacia S6 el offline no puede demostrarse de
forma determinista en CI, se documenta la falla en un ADR nuevo y se
reevalúa la estrategia. La calidad se demuestra bajo condiciones
imperfectas, no solo en la demo ideal.