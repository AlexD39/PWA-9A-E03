# Requisitos del producto — completar en Semana 1

> Conserva estos encabezados y reemplaza las instrucciones por tu análisis. No uses datos reales.

## 1. Problema y contexto

La Universidad Tigres Tecnicos necesita registrar inspecciones de mantenimiento en tres laboratorios: Redes, Electrónica y Software. Actualmente los técnicos dependen de conectividad a internet para consultar o registrar hallazgos, pero la red es irregular en varias áreas del campus y se pierde información por la inestabilidad de la conexión. En ocasiones dos técnicos intentan resolver el mismo hallazgo por falta de organización y registro centralizado.

Se requiere una aplicación que permita operar sin conexión y sincronizar cuando la red esté disponible, garantizando que cada inspección quede registrada de forma confiable.

Alcance del producto:
- Inspecciones de laboratorio
- Hallazgos y seguimiento
- Consulta con conectividad intermitente
- Evidencia opcional de dispositivo
- Notificaciones y degradación segura
- Datos sintéticos versionados

Fuera del alcance: datos reales de estudiantes o personal, integraciones institucionales reales, secretos o llaves personales, servicios de pago obligatorios.

## 2. Usuarios y escenarios

- **Técnico de mantenimiento:** Registra inspecciones y hallazgos en los laboratorios.
- **Supervisor de laboratorio:** Consulta inspecciones, revisa hallazgos y da seguimiento.

### Escenario 1: Registrar inspección (conectividad normal)

Como técnico de mantenimiento, quiero registrar una inspección del Laboratorio de Redes 
indicando la ubicación, fecha, responsable y hallazgos encontrados, para que quede un 
registro confiable del estado actual del laboratorio.

Criterio de éxito: La inspección se guarda exitosamente y aparece en la lista de 
inspecciones recientes.

### Escenario 2: Consultar inspecciones previas (sin conexión)

Como técnico de mantenimiento, quiero consultar las inspecciones previas del Laboratorio 
de Electrónica cuando estoy en un área sin señal de internet, para saber qué hallazgos 
pendientes hay antes de iniciar el mantenimiento.

Criterio de éxito: La app muestra las inspecciones previamente cargadas aunque no haya 
conexión a internet.

## 3. Requisitos funcionales

**RF-01:** El sistema mostrará una lista de inspecciones de laboratorio.
- Aceptación: Se muestran al menos 3 inspecciones de datos sintéticos en la pantalla principal.

**RF-02:** El sistema mostrará el detalle de cada inspección.
- Aceptación: Al seleccionar una inspección se muestra ubicación, fecha, responsable, 
  cantidad de hallazgos y estado (ok/atención).

**RF-03:** El sistema funcionará sin conexión a internet.
- Aceptación: La aplicación carga y muestra datos previamente cacheados cuando no hay red.

**RF-04:** El sistema permitirá registrar hallazgos en una inspección.
- Aceptación: El técnico puede agregar una descripción de evidencia a un hallazgo y 
  guardar localmente.

**RF-05:** El sistema mostrará notificaciones de estado.
- Aceptación: Si falla la conexión, se muestra un mensaje informativo al usuario.

**RF-06:** El sistema usará únicamente datos sintéticos versionados.
- Aceptación: Todos los datos provienen del archivo src/lib/data/inspections.ts.

## 4. Requisitos no funcionales

**RNF-01 (Rendimiento):** La aplicación mostrará contenido visible en menos de 3 segundos bajo una conexión Fast 3G simulada con Chrome DevTools (Network Throttling).

**RNF-02 (Offline):** Después de la carga inicial de la página, la aplicación funcionará sin conexión a internet mostrando datos previamente cacheados.

**RNF-03 (Reproducibilidad):** Cualquier persona que clone el repositorio y ejecute `npm ci && npm run build` obtendrá una compilación exitosa sin errores.

**RNF-04 (Seguridad y privacidad):** No se almacenarán ni transmitirán secretos, tokens, contraseñas ni datos personales reales.

**RNF-05 (Accesibilidad):** La aplicación será navegable completamente por teclado y incluirá atributos ARIA para lectores de pantalla.

**RNF-06 (Mantenibilidad):** El código TypeScript compilará sin errores y seguirá los estándares de estilo del proyecto.

## 5. Datos sintéticos y límites

### Datos sintéticos

Se utilizarán datos sintéticos de inspecciones de mantenimiento de tres laboratorios:

- **Laboratorio de Redes:** Inspecciones de cableado, estaciones de trabajo y ventilación.
- **Laboratorio de Electrónica:** Inspecciones de componentes, herramientas y señalización.
- **Laboratorio de Software:** Inspecciones de equipo, disponibilidad y espacio.

Cada registro contiene: id, ubicación, fecha, responsable, estado (ok/atención), 
cantidad de hallazgos y resumen descriptivo.

Los datos se almacenan en `src/lib/data/inspections.ts` y no dependen de servicios externos.

### Información prohibida

Está estrictamente prohibido incluir en el repositorio:

- Datos reales de estudiantes o personal de la UTT
- Nombres reales, matrículas, correos o teléfono
- Secretos, tokens, contraseñas o API keys
- Archivos `.env` con credenciales
- Integraciones con servicios de pago o institucionales reales

## 6. Criterios de aceptación de la Semana 1

| Entrega | Criterio | Comando de verificación |
|---------|----------|------------------------|
| Repositorio reproducible | El proyecto instala desde cero sin errores | `npm ci` |
| Aplicación funcional | Se muestran 3 inspecciones sintéticas | `npm run dev` → localhost:3000 |
| Build exitoso | La compilación de producción completa sin errores | `npm run build` |
| Verificación de estructura | Todos los archivos requeridos existen | `make verify` (código 0) |
| Check público | No hay secretos ni archivos faltantes | `bash public-tests/check.sh` → PUBLIC_OK |
| Documentación | Requisitos y decisión técnica están completos | Inspección manual de `docs/` |
| Evidencia individual | Contribución, SHA, prueba y limitación documentados | Inspección manual de `evidence/individual.md` |

