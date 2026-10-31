/**
 * Aviso de privacidad simplificado y control de datos locales (Semana 9).
 *
 * Texto de EJEMPLO ACADÉMICO para un sujeto obligado (la universidad), organizado como pide la
 * Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados: quién es el
 * responsable, qué datos se tratan, para qué, si hay transferencias y cómo ejercer los derechos.
 * No sustituye el aviso de privacidad oficial de una institución ni es asesoría legal. El
 * inventario completo está en docs/privacy-data-inventory.md.
 */

import { AppShell } from "../../components/app-shell";
import { PrivacyPanel } from "../../components/privacy-panel";

export const metadata = { title: "Privacidad · Inspecciones de laboratorio" };

export default function PrivacidadPage() {
  return (
    <AppShell>
      <main className="page-shell">
        <section className="hero" aria-labelledby="privacy-title">
          <div>
            <p className="eyebrow">Privacidad · Semana 9</p>
            <h1 id="privacy-title">Aviso de privacidad simplificado</h1>
            <p className="lead">
              Este proyecto es un ejercicio académico y usa únicamente datos sintéticos. El texto sigue
              la estructura de un aviso de privacidad de un sujeto obligado, pero no es el aviso oficial
              de ninguna institución.
            </p>
          </div>
        </section>

        <section className="sync-panel" aria-labelledby="privacy-who">
          <h2 id="privacy-who">Quién es responsable</h2>
          <p>Universidad Tecnológica de Tehuacán (proyecto académico de Aplicaciones Web Progresivas).</p>

          <h2>Qué datos se tratan</h2>
          <ul>
            <li>Nombre de la persona que inspecciona (en este ejercicio, un nombre sintético).</li>
            <li>Laboratorio, fecha, estado, número de hallazgos y resumen de la inspección.</li>
            <li>Opcional y solo en este dispositivo: una foto reducida y una ubicación aproximada (a unos 110 m).</li>
            <li>Se rechaza guardar correos, teléfonos, CURP, RFC o tarjetas escritos en los textos libres.</li>
          </ul>

          <h2>Para qué se usan</h2>
          <p>
            Registrar y dar seguimiento a inspecciones de mantenimiento de laboratorios, y dejar
            constancia de quién la realizó. No hay finalidades adicionales: no se usan para evaluar
            personas, publicidad ni análisis de uso.
          </p>

          <h2>Con quién se comparten</h2>
          <p>
            Con nadie. No hay transferencias a terceros, ni analítica, ni cookies. Las inspecciones se
            guardan primero en este dispositivo y, cuando hay conexión, se envían solo al servidor de la
            aplicación; la foto y la ubicación nunca se envían.
          </p>

          <h2>Cómo ejercer tus derechos</h2>
          <ul>
            <li><strong>Acceso:</strong> las inspecciones guardadas se listan en <a href="/inspecciones/nueva#sincronizacion">Sync</a>.</li>
            <li><strong>Rectificación:</strong> usa «Editar» en cada registro.</li>
            <li><strong>Cancelación:</strong> «Borrar datos de este dispositivo», abajo.</li>
            <li>
              <strong>Oposición y copias en el servidor:</strong> en un despliegue real se ejercerían ante la Unidad de
              Transparencia de la institución; este ejercicio no tiene un canal real.
            </li>
          </ul>
        </section>

        <PrivacyPanel />
      </main>
    </AppShell>
  );
}
