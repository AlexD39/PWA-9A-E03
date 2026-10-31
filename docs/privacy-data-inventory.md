# Inventario de datos personales y finalidades — Semana 9

Documenta qué datos trata la PWA de inspecciones, para qué, dónde viven, quién los ve, cuánto
tiempo se conservan y con qué medidas se protegen. Es la base del aviso de privacidad
(`/privacidad`) y complementa `docs/threat-model.md`.

> Proyecto académico con **datos exclusivamente sintéticos**. El marco legal citado es una
> referencia de diseño: no es asesoría jurídica y no sustituye la revisión de la Unidad de
> Transparencia de una institución real.

## 1. Marco de referencia

La Universidad Tecnológica de Tehuacán es una institución pública y, como tal, un **sujeto
obligado** de la **Ley General de Protección de Datos Personales en Posesión de Sujetos
Obligados** (LGPDPPSO), además de la normativa estatal que corresponda. El diseño toma de ella:

| Principio o deber | Cómo se refleja en la aplicación |
|---|---|
| **Licitud y lealtad** | Solo se tratan datos para la función de inspección; no hay usos ocultos ni analítica |
| **Finalidad** | Una sola finalidad principal, declarada en la sección 3 y en `/privacidad` |
| **Proporcionalidad / minimización** | Solo los datos necesarios; lo opcional (foto, ubicación) es voluntario, reducido y local; un dato personal en texto libre se **rechaza** |
| **Información** | Aviso de privacidad simplificado en `/privacidad`, accesible desde el menú |
| **Calidad** | Validación de cada campo antes de guardarse (`src/lib/storage/schema.ts`) |
| **Responsabilidad** | Este inventario, el modelo de amenazas y pruebas automáticas de los controles |
| **Deber de seguridad** | Medidas técnicas de la sección 7, con su prueba |
| **Deber de confidencialidad** | Sin transferencias; la evidencia no sale del dispositivo |
| **Derechos de acceso, rectificación, cancelación y oposición (ARCO)** | Sección 6 |

## 2. Inventario

| Dato | ¿Personal? | Origen | Finalidad | Dónde se guarda | Quién accede | Conservación | Transferencia |
|---|---|---|---|---|---|---|---|
| Nombre de quien inspecciona (`inspector`) | **Sí** (identifica a una persona) | La persona lo escribe | Trazabilidad: saber quién hizo la inspección | IndexedDB del dispositivo; copia en el servidor al sincronizar | La propia persona y quien administre el servidor | Local: hasta que la persona lo borre. Servidor simulado: hasta reiniciarlo | Ninguna |
| Laboratorio (`location`) | No | La persona lo elige o escribe | Identificar dónde se hizo la inspección | Igual que el anterior | Igual | Igual | Ninguna |
| Fecha, estado y número de hallazgos | No | La persona | Seguimiento del mantenimiento | Igual | Igual | Igual | Ninguna |
| Resumen (`summary`, texto libre) | **Riesgo**: podría contener datos personales escritos por error | La persona | Describir la inspección | Igual | Igual | Igual | Ninguna |
| Foto (opcional) | **Posible** (una persona o su imagen podría salir) | Cámara o archivo; reducida a 1024 px y sin metadatos | Evidencia visual del estado del equipo | **Solo** IndexedDB, bajo `evidence:<id>`; **nunca** se envía | La propia persona | Hasta que la quite o borre los datos | Ninguna |
| Ubicación aproximada (opcional) | **Sí** (ubicación de una persona) | Geolocalización con permiso; redondeada a 3 decimales (~110 m) | Contexto de dónde se hizo la inspección | **Solo** IndexedDB; **nunca** se envía | La propia persona | Hasta que la quite o borre los datos | Ninguna |
| Identificadores técnicos (`id` del registro, clave de idempotencia) | No (aleatorios, sin relación con la persona) | Los genera la aplicación | Evitar duplicados al sincronizar | IndexedDB y servidor | La aplicación | Con el registro | Ninguna |
| Preferencia de avisos | No | La persona | Recordar si quiere avisos del sistema | `localStorage` | La propia persona | Hasta que la borre | Ninguna |
| Dirección de red de quien llama | **Sí** (puede identificar a una persona) | Cabeceras de la petición | Limitar abusos (límite de peticiones) | **Solo en memoria** de la aplicación, por la ventana de un minuto; no se escribe en disco ni en bitácoras propias. El proveedor de alojamiento puede registrarla por separado: queda fuera del alcance de este ejercicio | La aplicación | 1 minuto | Ninguna |
| Bitácora de sincronización | No (eventos técnicos sin datos de la inspección) | La aplicación | Depuración y observabilidad | Memoria de la pestaña; no persiste | La propia persona | Hasta cerrar la pestaña | Ninguna |

**Datos personales sensibles:** ninguno, por diseño (no hay salud, biometría, religión ni origen
étnico). Una foto podría mostrar el rostro de una persona; la aplicación no la analiza ni
extrae rasgos, y por eso la finalidad de la foto es el **equipo**, no las personas.

**Lo que NO se recolecta:** correo, teléfono, CURP, RFC, domicilio, datos de pago, cuentas de
usuario, cookies, identificadores de publicidad ni analítica.

## 3. Finalidades

- **Finalidad principal (necesaria):** registrar y dar seguimiento a inspecciones de
  mantenimiento de laboratorios, dejando constancia de quién las realizó.
- **Finalidades secundarias:** ninguna. No se usan para evaluar el desempeño de personas,
  publicidad, perfilado ni investigación. Si se quisiera añadir una, requeriría informarlo en el
  aviso y, cuando corresponda, pedir el consentimiento.

## 4. Pruebas de proporcionalidad (por qué cada dato)

| Dato | ¿Es necesario? | Alternativa menos invasiva | Decisión |
|---|---|---|---|
| Nombre de quien inspecciona | Sí: la inspección es una constancia | Un identificador interno en lugar del nombre (en un despliegue real con autenticación) | Se conserva; es el único dato personal imprescindible |
| Foto | No: es opcional | Describir por texto | Opcional, reducida y local |
| Ubicación | No: es opcional | Elegir el laboratorio de una lista | Opcional, a ~110 m y local |
| Datos personales en el resumen | No | Describir el equipo | **Se rechazan** (`C-06`) |

## 5. Flujo y ubicación de los datos

1. La persona captura en el formulario. **Antes de guardar**, cada texto se sanea y se rechaza si
   contiene un dato personal (`src/lib/storage/schema.ts`, `src/lib/security/`).
2. Se guarda en el dispositivo (IndexedDB) y se responde de inmediato, sin red.
3. Cuando hay conexión, **solo** los campos de la inspección viajan al servidor (por HTTPS en un
   despliegue real), con una clave de idempotencia. La foto y la ubicación se quedan en el
   dispositivo.
4. El servidor simulado guarda los registros en memoria; se pierden al reiniciarlo.
5. La **CSP** (`connect-src 'self'`, `img-src 'self' data: blob:`) impide que la página haga
   peticiones a dominios de terceros (datos, imágenes o scripts): no habría fuga hacia analítica
   o anuncios aunque alguien añadiera código por error. No controla los enlaces que una persona
   decida pulsar.

## 6. Ejercicio de los derechos ARCO

| Derecho | Cómo se ejerce hoy | Límite |
|---|---|---|
| **Acceso** | Lista de registros en «Sync» (`/inspecciones/nueva#sincronizacion`) | Muestra lo guardado en este dispositivo; no lo que haya en el servidor de otro |
| **Rectificación** | Botón «Editar» en cada registro | Solo registros de este dispositivo |
| **Cancelación** | «Borrar datos de este dispositivo» en `/privacidad`: elimina IndexedDB, la preferencia y las cachés | **No** borra la copia ya sincronizada en el servidor; no revoca los permisos del navegador |
| **Oposición** | No capturar los datos opcionales; no activar los avisos | En un despliegue real se ejercería ante la Unidad de Transparencia |

La **copia en el servidor** es el hueco principal: no existe un canal para pedir su borrado. En un
despliegue real se necesitaría un procedimiento con identificación de la persona titular, plazos
y un registro de la solicitud.

## 7. Medidas de seguridad (resumen de `docs/threat-model.md`)

| Medida | Qué protege | Prueba |
|---|---|---|
| CSP con nonce y cabeceras de seguridad (`C-01`, `C-02`, `C-03`) | Que no se ejecute código inyectado ni se incruste la página | `tests/security.spec.ts` |
| Guardián de la API: origen, tipo, tamaño y límite (`C-04`) | Escrituras desde otros sitios y abuso | `tests/security.spec.ts` |
| Ganchos de demostración apagados (`C-05`) | Borrado o alteración del servidor desde fuera | `tests/security.spec.ts` |
| Minimización de datos personales (`C-06`) y saneamiento (`C-07`) | Que entren datos que no tienen finalidad | `tests/security.spec.ts` |
| Borrado de datos locales (`C-09`) | Dispositivos compartidos | `tests/security.spec.ts` |
| Permisos mínimos (`Permissions-Policy`) y evidencia solo local | Cámara, ubicación y foto | `tests/capabilities.spec.ts` |
| Sin credenciales en el repositorio (`C-11`) | Fuga de llaves | `tests/security.spec.ts` |

## 8. Aviso de privacidad

Se publica una versión **simplificada** en `/privacidad` (responsable, datos, finalidades,
transferencias, derechos). Es un texto de ejemplo académico. Un aviso **integral** completo
(con base legal, plazos, domicilio y la unidad responsable) no se redactó porque no existe una
unidad responsable real en este ejercicio.

## 9. Limitaciones y pendientes

- **Sin plazo de conservación automático:** los datos locales se quedan hasta que la persona los
  borre. Una política real fijaría un plazo (por ejemplo, depurar lo sincronizado tras cierto
  tiempo).
- **IndexedDB sin cifrar:** quien tenga el dispositivo desbloqueado puede leer lo guardado.
- **Sin documento de seguridad formal**, sin designación de una unidad responsable y sin
  procedimiento de aviso de vulneraciones: son obligaciones de un sujeto obligado real.
- **Sin evaluación de impacto** en protección de datos: no aplica a datos sintéticos, pero sería
  necesaria con datos reales.
- **Detección por patrón** de datos personales: no encuentra nombres propios y puede dar falsos
  positivos (ver `docs/threat-model.md`, sección 7).
- **Nombre de la persona que inspecciona** declarado, no verificado: no hay autenticación.
