# Capacidades del dispositivo y notificaciones — Semana 6

La aplicación permite adjuntar evidencia opcional a una inspección (una foto y una ubicación
aproximada) y avisar de cambios de sincronización, con **permisos mínimos**, **fallback
funcional** y **datos mínimos**. Implementación en `src/lib/device/` y
`src/lib/notifications/client.ts`; comportamiento verificado por `tests/capabilities.spec.ts` y
por la comprobación manual de la sección 9.

## 1. Principios

| Principio | Cómo se cumple |
|---|---|
| Permiso solo por acción del usuario | Ningún permiso se pide al cargar la página. La cámara, la ubicación y las notificaciones se piden únicamente al pulsar su botón |
| Permisos mínimos | Cámara sin audio, ubicación de baja precisión y una sola lectura (sin `watchPosition`). La cabecera `Permissions-Policy` limita cámara y ubicación a este origen y deshabilita micrófono y pagos |
| El flujo útil no depende de la capacidad | Sin API, con permiso denegado o sin hardware, se explica el motivo, se ofrece la alternativa y la inspección se guarda igual |
| Datos mínimos | La foto se reduce y se le quitan los metadatos; la ubicación se redondea; el texto de los avisos no incluye datos de la inspección ni de personas |
| Sin credenciales | No se usa push de servidor (exigiría claves VAPID). Solo avisos locales |
| Nada lanza | Cada función devuelve un resultado con `status`; los errores del navegador se traducen a un estado y un mensaje en español |

## 2. Cámara (`src/lib/device/camera.ts`)

Dos vías para obtener la foto:

1. **Cámara del navegador** (`capturePhoto`): `getUserMedia({ video, audio: false })`, un fotograma
   y liberación inmediata. **Las pistas se detienen siempre**, incluso si falla el fotograma o la
   codificación o si una pista no se deja detener, para que se apague el indicador de la cámara.
2. **Archivo** (`photoFromFile`): elegir una imagen del dispositivo. No necesita ningún permiso, y
   en móviles el atributo `capture` abre la cámara del sistema.

Reducción de datos (`PHOTO_LIMITS`): lado mayor máximo 1024 px (nunca agranda), JPEG con calidad
0,7 y presupuesto de 250 000 bytes. `shrinkToBudget` baja la calidad hasta 0,4 y, si todavía no
cabe, reduce las dimensiones; si nada cabe, devuelve `invalid` en lugar de pasarse del límite.
Como la imagen se **redibuja** en un lienzo y se recodifica, se descartan los metadatos del
original (EXIF: ubicación, modelo, fecha). Un archivo de entrada acepta JPEG, PNG y WebP de hasta
10 MB.

| Estado | Causa | Qué ve la persona |
|---|---|---|
| `ok` | Imagen obtenida y reducida | Vista previa, tamaño y botón "Quitar foto" |
| `denied` | `NotAllowedError`, `SecurityError` | "No hay permiso para usar la cámara…", con la alternativa |
| `no-device` | `NotFoundError`, `OverconstrainedError` | "No se encontró una cámara…" |
| `busy` | `NotReadableError`, `AbortError` | "La cámara está en uso por otra aplicación…" |
| `unsupported` | No hay `mediaDevices.getUserMedia` | Solo aparece el selector de archivo |
| `cancelled` | No se eligió archivo | Sin mensaje |
| `invalid` | Tipo no admitido, vacío, demasiado grande o ilegible | "El archivo no es una imagen válida…" |
| `error` | Cualquier otro fallo | "No se pudo obtener la imagen…" |

## 3. Ubicación (`src/lib/device/geolocation.ts`)

- **Una lectura**, con `enableHighAccuracy: false`, `timeout` de 8 s y `maximumAge` de 60 s. No hay
  seguimiento continuo.
- **Coordenadas redondeadas a 3 decimales** (unos 110 m, a nivel de edificio). La incertidumbre
  que se guarda nunca es menor que la del redondeo (`roundingMeters`), para no declarar más
  precisión de la que se conserva.
- **Tiempo de espera propio**: algunos navegadores nunca llaman a ninguna de las dos funciones de
  retorno; a los 9 s se resuelve `timeout`.
- **Respuestas inválidas** (no numéricas, fuera de rango) se tratan como `error`.
- `getLocationPermission` consulta el estado con la API de permisos **sin mostrar ningún aviso**;
  si el navegador no la ofrece devuelve `prompt`.

Estados: `ok`, `denied` (código 1), `unavailable` (2), `timeout` (3), `unsupported` y `error`.
Todos los mensajes ofrecen continuar sin ubicación.

## 4. Evidencia por inspección (`src/lib/device/evidence.ts`)

Una foto y una ubicación como máximo por registro, en el almacén `meta` de IndexedDB bajo
`evidence:<recordId>`. **No se sincroniza**: subir adjuntos exigiría un servicio de archivos que
este proyecto no tiene. Por eso no se tocó el esquema ni la cola de la Semana 5, y el servidor no
recibe nada de la evidencia (verificado).

- Se valida cada pieza (JPEG en base64, tamaño real ≤ 250 000 bytes, `bytes` coherente con el
  contenido, dimensiones, fecha ISO; coordenadas dentro de rango y **con a lo sumo 3 decimales**).
- Semántica de la actualización: `undefined` conserva, `null` quita, un objeto reemplaza.
- **Cuando no queda ni foto ni ubicación, la clave se borra** en lugar de guardar un registro vacío.
- Los datos dañados en el almacén se ignoran y no se arrastran.

## 5. Notificaciones (`src/lib/notifications/client.ts`)

Qué se avisa (`buildChangeNotification`): registro sincronizado (`acked`, `duplicate`), conflicto
resuelto y operación fallida. El resto de eventos de la cola no genera aviso. El texto es fijo y
**no incluye identificadores, nombres ni datos del registro**.

Decisión de canal (`createNotifier().notify`):

| Condición | Canal | Motivo |
|---|---|---|
| Preferencia desactivada | aviso interno | `disabled` |
| Sin API | aviso interno | `unsupported` |
| Permiso denegado | aviso interno | `permission-denied` |
| Permiso sin decidir | aviso interno | `permission-default` |
| Permiso concedido y la app está a la vista | aviso interno | `app-visible` |
| Permiso concedido y la app en segundo plano | **sistema** | `delivered` |
| Falla la entrega del sistema | aviso interno | `error` |
| Misma etiqueta dentro de 4 s | ninguno | `deduplicated` |

- **Nunca pide permiso por su cuenta**: `requestPermission` solo se llama desde el botón "Activar
  avisos del sistema", y no vuelve a preguntar si ya hay una decisión. Admite la forma con promesa
  y la forma antigua con función de retorno.
- **Entrega del sistema** por `registration.showNotification` (la vía que funciona en Android, donde
  `new Notification` no existe) y, sin service worker, por el constructor. La etiqueta (`tag`)
  hace que un aviso nuevo reemplace al anterior del mismo tipo en lugar de acumularse.
- **Clic en la notificación**: `public/sw.js` cierra la notificación y **enfoca** la ventana de la
  aplicación si ya hay una; si no, abre `/inspecciones/nueva#sincronizacion`. Solo acepta rutas del
  propio sitio: un destino externo (`https://…`, `//host`, `javascript:`) se ignora y se usa el
  predeterminado.

## 6. Interfaz

`/inspecciones/nueva` agrega el panel **Evidencia opcional** (foto, imagen, ubicación y quitarlas)
y **Avisos de cambios** (activar, probar, preferencia y lista de avisos internos, con
`aria-live`). Ambos paneles se montan después de abrir el almacenamiento, por lo que el primer
render sigue siendo el estado de carga (sin *hydration mismatch*).

## 7. Supuestos

- Un solo dispositivo por persona; sin autenticación.
- La evidencia es voluntaria y local; no forma parte del registro que se sincroniza.
- Los datos de prueba son sintéticos (imágenes generadas y coordenadas de ejemplo).

## 8. Límites y riesgos conocidos

| Límite o riesgo | Impacto | Estado |
|---|---|---|
| La evidencia no se sincroniza | No viaja a otro dispositivo ni al servidor | Fuera de alcance: requiere un servicio de archivos |
| No hay vista previa en vivo de la cámara | No se puede encuadrar antes de capturar; se toma un fotograma tras ~600 ms | La vía de archivo con `capture` en móvil abre la cámara del sistema con vista previa |
| No hay push de servidor | Un aviso del sistema solo sale mientras la app tiene un service worker vivo y el cambio ocurre en este dispositivo | Push real exigiría claves VAPID (credenciales) y un servidor; fuera de alcance |
| La cabecera `Permissions-Policy` no controla las notificaciones | No existe esa característica en la política | El permiso de notificaciones se pide solo por acción del usuario |
| Safari exige que la solicitud de permiso nazca de un gesto y su soporte de `Permissions` es parcial | Puede devolver `prompt` aunque ya haya decisión | Se trata como "sin decidir" y se vuelve a leer al enfocar la ventana |
| La imagen y la ubicación viven en IndexedDB sin cifrar | Cualquiera con acceso al navegador del dispositivo las puede leer | Datos mínimos (reducidos y redondeados) y voluntarios; el cifrado queda como mejora |
| El clic en una notificación enfoca pero no navega a la ruta indicada si ya hay una ventana abierta | La persona queda donde estaba | Aceptado; `client.navigate` no está disponible en todos los navegadores |
| Las pruebas automatizadas usan dependencias simuladas | No ejercitan hardware real ni la entrega real de un aviso del sistema | Se complementa con la verificación manual de la sección 9 |

## 9. Cómo verificarlo

Automatizado: `npm test` y `npm run verify` (incluye `tests/capabilities.spec.ts`).

Manual, con `npm run build && npm run start`, en `http://localhost:3000/inspecciones/nueva`:

1. **Ningún permiso al cargar.** Abrir la página: no aparece ningún aviso del navegador.
2. **Cabecera de permisos.** `curl -I http://localhost:3000/inspecciones/nueva` muestra
   `Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=()`.
3. **Imagen por archivo.** "Adjuntar imagen" con una imagen grande: la vista previa indica un
   máximo de 1024 px y un peso por debajo de 250 KB, siempre como JPEG.
4. **Con permiso denegado.** Con la cámara o la ubicación bloqueadas, "Tomar foto" y "Agregar
   ubicación aproximada" muestran un mensaje claro y la inspección se guarda igual.
5. **Evidencia solo local.** Tras guardar, `GET /api/sync/inspections` no contiene la imagen ni la
   ubicación; en IndexedDB aparece la clave `evidence:<id>` en `meta`. Editar el registro la
   recupera; al quitar la última pieza la clave desaparece.
6. **Avisos.** Con el permiso de notificaciones sin decidir o denegado, al sincronizar aparece
   "Inspección sincronizada" dentro de la aplicación. Con "Activar avisos del sistema" concedido y
   la pestaña en segundo plano, el mismo cambio sale como notificación del sistema; al pulsarla se
   enfoca la aplicación. "Probar aviso" lo comprueba sin esperar a un cambio real.
