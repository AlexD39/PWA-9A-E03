# Modelo de amenazas — Semana 9

Analiza la PWA de inspecciones de laboratorio tal como quedó al terminar la Semana 8, identifica
qué hay que proteger y de quién, y documenta los controles que se aplicaron, con la prueba que
demuestra cada uno y el riesgo que queda. El tratamiento de datos personales está en
`docs/privacy-data-inventory.md`.

> Es un análisis de un proyecto académico con datos sintéticos. No es una auditoría ni una prueba
> de intrusión, y no sustituye la revisión de seguridad de un despliegue real.

## 1. Alcance y supuestos

- **Qué se analiza:** la aplicación Next.js 14.2.35 (rutas `/`, `/inspecciones`, `/inspecciones/nueva`,
  `/privacidad`), su service worker (`public/sw.js`), el almacenamiento local (IndexedDB y
  `localStorage`) y la API simulada `/api/sync/inspections` con su servidor en memoria.
- **Datos:** únicamente sintéticos. No hay cuentas, pagos ni integraciones institucionales.
- **Quién la usa:** personal de laboratorio que inspecciona equipos, con conexión intermitente.
- **Despliegue previsto:** detrás de HTTPS en un servidor Linux o en una plataforma que lo
  ofrezca. HTTPS no se puede verificar en local (`http://localhost`); se declara como requisito.
- **No hay autenticación.** Es una decisión heredada del alcance del curso y el mayor riesgo
  residual (sección 7). El campo «responsable» es declarativo, no una identidad verificada.

## 2. Activos

| Id | Activo | Qué importa proteger |
|---|---|---|
| A-01 | Inspecciones (registros y cola de sincronización) | Integridad y disponibilidad: no perderlas ni alterarlas, no duplicarlas |
| A-02 | Nombre de quien inspecciona (dato personal) | Confidencialidad y minimización |
| A-03 | Evidencia opcional: foto reducida y ubicación aproximada | Confidencialidad; solo en el dispositivo |
| A-04 | Sesión de uso en el navegador (la página y su código) | Que nada inyectado se ejecute ni redirija a otro sitio |
| A-05 | Servidor simulado y su API | Disponibilidad; que no se pueda borrar ni saturar desde fuera |
| A-06 | Código y dependencias | Integridad de la cadena de suministro; sin credenciales expuestas |
| A-07 | Uso sin conexión (service worker y cachés) | Que sirva lo correcto y no un destino o contenido manipulado |

## 3. Quién podría atacar

| Actor | Capacidad | Interés |
|---|---|---|
| Persona externa en internet | Envía peticiones a la API y a las páginas | Borrar o alterar datos, saturar el servicio, ver registros |
| Página de otro sitio | Hace que el navegador de una persona envíe peticiones | Escribir en la API usando el navegador de la víctima |
| Persona con acceso físico a un dispositivo compartido | Abre el navegador y revisa el almacenamiento | Leer inspecciones, foto o ubicación de otra persona |
| Dependencia comprometida o vulnerable | Código de terceros dentro del build | Ejecutar código, filtrar datos |
| Persona usuaria bien intencionada | Captura datos | Escribir por costumbre un dato personal innecesario (correo, teléfono, CURP) |
| Persona usuaria malintencionada | Captura registros válidos | Texto engañoso que parezca otro (caracteres invisibles) |

## 4. Fronteras de confianza y flujos

```
 Persona ──► Navegador ──────────────► Servidor Next.js ──► Servidor simulado (memoria)
             │  ▲                       │   (middleware: CSP, cabeceras, nonce)
             │  │ aviso (sin red)       │   POST/GET /api/sync/inspections
             ▼  │                       │   (guardián: origen, tipo, tamaño, límite)
     Service worker  ◄── precaché ──────┘
     IndexedDB (inspecciones, cola, evidencia)   localStorage (preferencia de avisos)
```

Fronteras: (1) navegador ↔ servidor (HTTP; todo lo que llega es no confiable); (2) página ↔
service worker; (3) aplicación ↔ almacenamiento local (otra persona con el dispositivo); (4)
nuestro código ↔ dependencias de terceros.

## 5. Amenazas, controles y pruebas (STRIDE)

Probabilidad e impacto son una estimación cualitativa (B baja, M media, A alta) para este
proyecto con datos sintéticos. «Prueba» enlaza con un caso de `tests/security.spec.ts`
(grupo `C-nn`) o de `tests/e2e/security.spec.ts`.

| Id | Amenaza | STRIDE | Activo | P / I | Control | Prueba | Riesgo residual |
|---|---|---|---|---|---|---|---|
| T-01 | Script inyectado en la página (XSS) | Elevación | A-04 | M / A | **C-02** CSP con nonce por respuesta; **C-03** el middleware sobrescribe la CSP entrante | C-02, C-03; E2E «controlador de evento inyectado NO se ejecuta» y «sin violaciones de CSP» | `style-src` admite estilos en línea (sección 7) |
| T-02 | Redirección abierta desde el aviso (`/\evil.example` se vuelve `//evil.example`) | Suplantación | A-07 | B / M | **C-08** solo rutas internas, en el módulo y en `public/sw.js` | C-08 (incluida la equivalencia ejecutando el service worker real) | Ninguno conocido |
| T-03 | Escritura en la API desde otro sitio (CSRF) | Manipulación | A-01, A-05 | M / M | **C-04** rechaza `cross-site`, `Origin` ajeno y tipos distintos de JSON | C-04 (módulo y ruta real) | No hay sesión que robar; peticiones sin `Origin` (curl) se aceptan |
| T-04 | Cuerpo gigante o ráfaga de peticiones (denegación de servicio) | Negación de servicio | A-05 | M / M | **C-04** tope de 16 KB y límite de 300 por minuto por cliente | C-04 | Límite en memoria de una instancia; la cabecera de reenvío es falsificable sin proxy propio |
| T-05 | Vaciar el servidor o forzar errores con los ganchos de demostración | Manipulación / Negación | A-05 | A / M | **C-05** ganchos apagados por omisión (`ENABLE_DEMO_HOOKS=1` para activarlos) | C-05 (ruta y repositorio) | Con la variable activa el riesgo vuelve: nunca activarla en un despliegue |
| T-06 | Dato personal innecesario en texto libre | Divulgación | A-02 | A / M | **C-06** se rechaza correo, teléfono, CURP, RFC o tarjeta, en el cliente y en el servidor, sin repetir el valor | C-06; E2E «dato personal rechazado en pantalla» | Detección por patrón: no encuentra nombres propios y puede dar falsos positivos |
| T-07 | Texto que engaña (dirección bidireccional, ancho cero) o que cambia por normalización | Manipulación | A-01 | B / B | **C-07** saneamiento y normalización NFC | C-07 | Ninguno conocido |
| T-08 | Leer datos de otra persona en un dispositivo compartido | Divulgación | A-01, A-03 | M / M | **C-09** «Borrar datos de este dispositivo» (base, preferencias y cachés) | C-09; E2E «vacía el almacenamiento local» | IndexedDB no está cifrada; no hay expiración automática; no revoca permisos del navegador |
| T-09 | Fuga de foto o ubicación | Divulgación | A-03 | M / M | Minimización (Semana 6): foto a 1024 px sin metadatos, ubicación a 3 decimales, solo local; **C-01** `Permissions-Policy` | `tests/capabilities.spec.ts`; C-01 | Quien tenga el dispositivo desbloqueado las ve |
| T-10 | Incrustar la aplicación en otra página (clickjacking) | Manipulación | A-04 | B / M | **C-01** `frame-ancestors 'none'` y `X-Frame-Options: DENY` | C-01, C-02; E2E de cabeceras reales | Ninguno conocido |
| T-11 | Servir contenido desactualizado o manipulado desde el service worker | Manipulación | A-07 | B / M | El service worker no guarda `/api/`; páginas «primero la red»; versión de caché; **C-10** `offline.html` sin scripts en línea | `tests/service-worker.spec.ts`, `tests/offline.spec.ts`; C-10 | Una página guardada conserva el nonce de su respuesta (sección 7) |
| T-12 | Dependencia con vulnerabilidades conocidas | Elevación | A-06 | A / M | Lockfile + `npm ci`; auditoría `npm run audit:deps`; análisis de exposición (sección 6); optimizador de imágenes desactivado | Reporte de auditoría en CI | **Riesgo aceptado**: no se actualizó Next (sección 6) |
| T-13 | Credenciales o llaves en el repositorio | Divulgación | A-06 | B / A | **C-11** análisis del repositorio, `.env*` ignorados, plantilla sin valores sensibles | C-11 | Solo detecta formas conocidas; no revisa el historial de Git |
| T-14 | Indexación de una herramienta interna por buscadores | Divulgación | A-01 | M / B | `public/robots.txt` y `X-Robots-Tag: noindex` | C-10, C-01; E2E | `robots.txt` es una petición de cortesía, **no** un control de acceso |
| T-15 | Interceptar el tráfico (sin TLS) | Divulgación | A-01, A-02 | M / M | Requisito de despliegue con HTTPS; **C-01** HSTS cuando la petición llegó por HTTPS; `upgrade-insecure-requests` opcional | C-01, C-03 (HSTS condicional) | No verificable en local; depende del despliegue |
| T-16 | Alguien declara ser otra persona inspectora | Suplantación / Repudio | A-02 | A / M | Ninguno técnico: el campo es declarativo | — | **Aceptado** por el alcance (sin autenticación) |
| T-17 | Listar todos los registros con `GET /api/sync/inspections` | Divulgación | A-01, A-02 | A / M | Los navegadores de otros sitios no pueden leerla (sin CORS) y **C-04** rechaza `cross-site` | C-04 | Cualquiera con acceso directo a la URL la lee; con datos reales exigiría autenticación |

## 6. Dependencias: auditoría y riesgo aceptado

`npm audit --omit=dev` (consulta del 31 de octubre de 2026) informa **3 vulnerabilidades en
dependencias de producción: 1 crítica y 2 altas**, todas por `next@14.2.35` y sus dependencias.

| Paquete | Gravedad | Qué reporta | ¿Nos afecta? |
|---|---|---|---|
| `next` 14.2.35 | Crítica (agrupa 25 avisos) | Corregidos en 15.5.x y 16 | Ver análisis por aviso abajo |
| `postcss` 8.4.31 (de Next) | Alta | Lectura de archivos y XSS al **procesar CSS** | No en ejecución: solo se usa al compilar, con CSS propio |
| `source-map-js` (de `postcss`) | Alta | Denegación de servicio con mapas de origen manipulados | No en ejecución: solo al compilar |

**Exposición por aviso de Next** (se leyeron los avisos originales; lo que se puede afirmar de
esta aplicación):

| Aviso | Resumen | Exposición y decisión |
|---|---|---|
| GHSA-ffhc-5mcf-pf4q (medio) | Un nonce tomado de la cabecera de la **petición** puede reflejarse sin sanear en el HTML | **Afecta a nuestro diseño y se mitiga:** `src/middleware.ts` sobrescribe siempre la CSP de la petición con la propia (es la mitigación documentada). Lo comprueba una prueba (C-03). Además las respuestas llevan `Cache-Control: no-store` |
| GHSA-p293-qw3h-jr36 (crítico) | Ejecución remota de código en servidores alojados en **Windows** | El despliegue previsto es Linux. En Windows solo se ejecuta local, en `localhost`, sin exposición a internet. **Si se desplegara en Windows habría que actualizar antes** |
| GHSA-2464-fhr4-w9xw / GHSA-2xp9-vwfh-vxw4 (críticos) | Ejecución remota de código en el **optimizador de imágenes** | La aplicación no usa `next/image` y `next.config.mjs` fija `images.unoptimized: true`; `/_next/image` queda fuera del middleware y no se usa |
| GHSA-m99w-x7hq-7vfj, GHSA-p3m5-59mp-jv5r y otros de **Server Actions** | Denegación de servicio y SSRF | La aplicación no declara ninguna Server Action (`"use server"`) |
| GHSA-gx5p-jg67-6x7h (medio) | XSS en scripts `beforeInteractive` con datos no confiables | No se usa `next/script` |
| GHSA-wfc6-r584-vfw7 y otros de caché | Envenenamiento de cachés compartidas con respuestas RSC | No hay una caché compartida (CDN) delante en este proyecto; si se añadiera, debe respetar `Vary` y las cabeceras de RSC |
| Avisos de `rewrites`, i18n del Pages Router, SSRF de WebSockets | Requieren esas funciones | La aplicación no configura `rewrites` ni i18n y no usa el Pages Router |

**Decisión: riesgo aceptado, con fecha de revisión.** Pasar a una versión corregida (Next 15.5.24 o
superior, o la 16) implica React 19 y cambios de API del App Router, con riesgo de romper las ocho
semanas previas, y cae fuera del alcance de esta actividad. Las mitigaciones anteriores reducen la
exposición real. **Plan:** actualizar Next en una rama propia, ejecutar `npm test`, `npm run test:e2e`
y la auditoría, y revisar de nuevo antes de cualquier despliegue real. Hasta entonces la
auditoría debe repetirse en cada entrega: `npm run audit:deps`.

## 7. Decisiones, trade-offs y riesgos residuales

| Decisión | Por qué | Costo o riesgo |
|---|---|---|
| CSP con **nonce por respuesta** y `strict-dynamic` en vez de `'unsafe-inline'` | Un script inyectado no se ejecuta aunque llegue al HTML | Las páginas se generan en cada petición; con Next 14.2.35 ya lo eran al usar el middleware, y `layout.tsx` lo declara de forma explícita |
| `style-src` conserva `'unsafe-inline'` | `public/offline.html` y los estilos de Next son en línea y no pueden llevar un nonce por petición | Inyección de CSS posible solo si ya existiera un punto de inyección; menor que un script |
| Página guardada por el service worker **reutiliza el nonce** de su respuesta | Es necesario para que la página funcione sin conexión | Quien ya pudiera inyectar HTML en esa página conocería el nonce; mitigado porque React escapa el contenido y no hay `innerHTML` |
| Ganchos de demostración **apagados** por omisión | Mínimo privilegio: un despliegue no debe poder vaciarse con un `DELETE` | Las pruebas y la demostración deben activar `ENABLE_DEMO_HOOKS=1`; está documentado y en `playwright.config.ts` |
| `checkOrigin` compara el **host**, no el esquema | Detrás de un proxy que termina TLS el servidor ve `http` aunque el navegador use `https`; comparar el esquema rechazaría peticiones legítimas | Una petición de `https://host` hacia `http://host` pasaría; se compensa porque no hay sesión que abusar y también se revisa `Sec-Fetch-Site` |
| Límite de peticiones **en memoria** | Es simple y no necesita infraestructura | No se comparte entre instancias; un despliegue real usaría un servicio externo |
| Rechazar datos personales por **patrón** | Cumple minimización sin un clasificador | Falsos positivos (un inventario de 10 dígitos parece un teléfono) y no detecta nombres. Al revisar el detector se vio que una fecha con hora («2026-10-20 15:30») se tomaba por teléfono; ahora se exige la agrupación habitual y el mismo separador, y esos casos quedaron como pruebas |
| `robots.txt` con `Disallow: /` | La herramienta es interna | No protege nada por sí solo; la protección real son las demás capas |
| Sin autenticación | Alcance del curso | T-16 y T-17: con datos reales sería lo primero a resolver |
| IndexedDB sin cifrar | El navegador no ofrece una llave que el usuario no tenga ya | T-08: mitigado por el borrado manual; una expiración automática queda pendiente |

**No se hizo:** autenticación y autorización, cifrado en reposo, expiración automática de datos
locales, `report-uri` de la CSP, prueba de intrusión, revisión del historial de Git ni escaneo de
dependencias transitivas más allá de `npm audit`.

## 8. Cómo verificarlo

```bash
npm run test:security     # 61 casos de seguridad y privacidad (tests/security.spec.ts)
npm run test:e2e          # incluye tests/e2e/security.spec.ts en un navegador real
npm run audit:deps        # auditoría de dependencias de producción
curl -I http://localhost:3100/inspecciones/nueva   # cabeceras reales (con la app compilada)
```

Hallazgo de esta semana que las pruebas encontraron: la verificación de rutas de
`public/sw.js` (Semana 6) solo comprobaba la primera barra y aceptaba `/\evil.example`, que el
navegador interpreta como `//evil.example`. La prueba que ejecuta el service worker real con las
mismas entradas hostiles que el módulo nuevo lo detectó y se corrigió.
