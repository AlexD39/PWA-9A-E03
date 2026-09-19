# Estrategia de caché y ciclo de vida del service worker — Semana 3

Responde a RF-03 y RNF-02 (funcionamiento sin conexión tras la carga inicial) sin romper RNF-04 (no almacenar credenciales ni datos personales). Implementación en `public/sw.js`, registro en `src/lib/pwa/register-service-worker.ts`, integración en `src/components/service-worker-manager.tsx`. Comportamiento verificado por `tests/service-worker.spec.ts` y `tests/offline.spec.ts`.

## 1. Qué se cachea y con qué estrategia

| Recurso | Ejemplos | Estrategia | Por qué |
|---|---|---|---|
| Precaché de instalación | `/`, `/offline.html`, `/manifest.webmanifest`, `/icons/icon-192.svg`, `/icons/icon-512.svg` | `cache.addAll` en `install` | Es el mínimo para arrancar el shell sin red. Son rutas estables que no cambian de nombre entre builds. |
| Navegación (HTML) | `GET` con `request.mode === "navigate"` | **Network-first** → caché de esa URL → `/offline.html` → 503 | El HTML es lo que más cambia entre despliegues; con red se prefiere la versión fresca. Sin red, la última copia visitada sigue sirviendo. |
| Estáticos versionados | `/_next/static/**`, `/icons/**` | **Cache-first** con relleno en la primera descarga | Next.js les pone hash en el nombre: una URL nunca cambia de contenido, así que la caché no puede quedar obsoleta. |
| Datos de aplicación | `/api/**` (aún no existe) | **No se intercepta** | Evita cachear indiscriminadamente respuestas que en semanas posteriores podrían incluir datos de personas. Cuando exista la API, se decidirá caso por caso en un ADR. |
| Otros `GET` del mismo origen | payload RSC (`?_rsc=`), fuentes | Red directa, sin cachear | No aportan al arranque offline y cachearlos duplicaría lo que ya cubre la navegación. |
| Todo lo demás | `POST`, otros orígenes | No se intercepta | El worker no debe alterar mutaciones ni recursos de terceros. |

Solo se guardan respuestas con `response.ok`. Una respuesta 404 o 500 nunca entra a la caché, así un error transitorio no se vuelve permanente.

Hoy los datos de inspecciones son sintéticos y se compilan dentro del HTML (`src/lib/data/inspections.ts`), por lo que quedan cubiertos por la caché de navegación. No hay ninguna información sensible en la caché.

## 2. Versionado e invalidación

- Todas las cachés propias llevan el prefijo `inspecciones-lab-` y el sufijo de versión (`CACHE_VERSION`, hoy `v1`). La caché activa es `inspecciones-lab-v1`.
- **Invalidación por despliegue:** cambiar `CACHE_VERSION` obliga a una precaché nueva y, en `activate`, se borran las cachés con el mismo prefijo pero otra versión. Cachés de otros prefijos (por ejemplo, la cola de sincronización de la Semana 5) no se tocan.
- **Invalidación controlada desde el cliente:** el mensaje `{ type: "CLEAR_CACHES" }` borra todas las cachés propias y responde `CACHES_CLEARED`. `clearServiceWorkerCaches()` lo expone desde TypeScript. Sirve para un botón "Borrar datos locales" en Ajustes o para soporte.
- **Consulta de versión:** `{ type: "GET_VERSION" }` responde con `CACHE_VERSION` y el nombre de caché; útil para evidencia y diagnóstico.

## 3. Ciclo de vida de actualización sin servir una versión corrupta

```
navegador descarga sw.js nuevo
        │
        ▼
   install: cache.addAll(PRECACHE_URLS)   ── falla ──▶ worker "redundant"; el anterior sigue activo
        │ ok
        ▼
   estado "installed" + hay controller  ──▶ onUpdateAvailable(registration)  (aviso en UI, sin recargar)
        │
        │ usuario pulsa "Actualizar ahora"
        ▼
   postMessage({ type: "SKIP_WAITING" }) ──▶ skipWaiting()
        │
        ▼
   activate: borra inspecciones-lab-<viejas>, clients.claim()
        │
        ▼
   controllerchange (una sola vez) ──▶ window.location.reload()
```

Decisiones que sostienen la garantía:

1. **`addAll` es atómico.** Si una sola URL falla (por ejemplo 404 de `/offline.html`), `install` rechaza, el worker nuevo queda `redundant` y el usuario sigue con la versión anterior completa. Nunca existe una caché a medias sirviendo tráfico.
2. **Sin `skipWaiting()` automático.** Activar de inmediato mezclaría HTML viejo (ya en pantalla) con chunks nuevos y podría dejar la página rota hasta recargar. La versión nueva espera y el cliente decide cuándo, mediante un aviso visible con botón.
3. **Limpieza solo en `activate`.** Las cachés viejas se borran cuando la nueva ya es la activa, nunca antes.
4. **Recarga única.** `onControllerChange` se desuscribe tras el primer disparo para evitar bucles de recarga.
5. **Errores registrados.** Todos los fallos (precaché, activación, navegación sin red, estático ausente) se registran en consola con el prefijo `[sw v1]` o `[pwa]`, y el registro expone `onError`.

## 4. Supuestos

- La aplicación se sirve desde el origen raíz (`scope: "/"`), igual que el manifest de la Semana 2.
- El service worker solo se registra en producción (`NODE_ENV === "production"`). En `next dev`, el HMR emite chunks sin hash y la estrategia cache-first los dejaría obsoletos. La verificación offline se hace con `npm run build && npm run start`.
- Los navegadores objetivo son Chromium y Firefox actuales; Safari soporta service workers pero tiene límites de almacenamiento más agresivos.
- No existe todavía API de datos; la fila `/api/**` queda reservada.

## 5. Límites y riesgos conocidos

| Límite o riesgo | Impacto | Mitigación |
|---|---|---|
| La primera visita necesita red | Sin ella no hay nada que cachear | Es inherente al modelo; el aviso de instalación lo explica. |
| Una ruta nunca visitada no existe en caché | Offline muestra `/offline.html` en vez de contenido | Aceptado en S3; en S4 se evaluará precachear rutas de detalle. |
| Cuota de almacenamiento del navegador | El navegador puede vaciar la caché | La app se degrada a "solo en línea" y vuelve a precachear en la siguiente visita. |
| `cache.match` con cabeceras `Vary` de Next.js | Podría no coincidir la copia de `/` | Se usa `ignoreVary: true` en la navegación. |
| Las pruebas corren en Node con globales simulados | No prueban un navegador real ni HTTPS | Se complementa con la verificación manual en DevTools documentada en `README.md`. |
| Un `sw.js` con error de sintaxis | El navegador rechaza el registro | `registerServiceWorker` captura el error, lo registra y devuelve `null`; la app sigue en línea. |

## 6. Cómo verificarlo a mano

1. `npm run build && npm run start`, abrir `http://localhost:3000`.
2. DevTools → Application → Service Workers: debe aparecer `sw.js` activado. Cache Storage debe listar `inspecciones-lab-v1` con las cinco URLs precacheadas.
3. Marcar **Offline** en DevTools y recargar: el panel de inspecciones sigue visible y el indicador del header cambia a "Sin conexión".
4. Navegar a `http://localhost:3000/no-existe` en modo offline: se muestra `/offline.html`.
5. Cambiar `CACHE_VERSION` a `v2`, reconstruir, recargar: aparece el aviso "Hay una versión nueva disponible"; al pulsar **Actualizar ahora** la página recarga y Cache Storage solo conserva `inspecciones-lab-v2`.
