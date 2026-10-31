"use client";

/**
 * Control de privacidad de la persona (Semana 9): borrar todo lo que este dispositivo guardó.
 *
 * Dos pasos a propósito (pedir y confirmar): borrar es irreversible y las inspecciones aún no
 * sincronizadas se perderían. Después del borrado se invita a volver a cargar la aplicación,
 * porque la conexión abierta a IndexedDB se cerró.
 */

import { useState } from "react";
import { purgeLocalData, type PurgeReport } from "../lib/security/data-lifecycle";

type Phase = "idle" | "confirm" | "working" | "done";

export function PrivacyPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<PurgeReport | null>(null);

  const confirm = async () => {
    setPhase("working");
    setReport(await purgeLocalData());
    setPhase("done");
  };

  return (
    <section className="sync-panel" aria-labelledby="purge-heading">
      <h2 id="purge-heading">Borrar los datos de este dispositivo</h2>
      <p className="muted">
        Elimina las inspecciones guardadas aquí (también las que aún no se sincronizaron), la evidencia
        opcional, la preferencia de avisos y las páginas guardadas para uso sin conexión. No cambia los
        permisos del navegador: cámara, ubicación y avisos se gestionan en la configuración del sitio.
      </p>

      {phase === "idle" ? (
        <div className="form-actions">
          <button className="filter-button" type="button" onClick={() => setPhase("confirm")}>
            Borrar datos de este dispositivo
          </button>
        </div>
      ) : null}

      {phase === "confirm" ? (
        <div role="alertdialog" aria-labelledby="purge-confirm">
          <p id="purge-confirm" className="form-errors">
            Esta acción no se puede deshacer. Se perderán las inspecciones que todavía no se hayan
            sincronizado. ¿Borrar todo?
          </p>
          <div className="form-actions">
            <button className="primary-button" type="button" onClick={confirm}>
              Sí, borrar todo
            </button>
            <button className="filter-button" type="button" onClick={() => setPhase("idle")}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {phase === "working" ? <p role="status">Borrando…</p> : null}

      {phase === "done" && report ? (
        <div role="status" className="form-notice">
          <p>
            {report.errors.length === 0
              ? "Listo: los datos de este dispositivo se borraron."
              : "El borrado terminó con avisos; revisa el detalle."}
          </p>
          <ul>
            <li>Base de datos local: {report.database === "deleted" ? "borrada" : report.database === "unavailable" ? "no disponible en este navegador" : "con error"}</li>
            <li>Preferencias borradas: {report.preferences}</li>
            <li>Cachés borradas: {report.caches}</li>
            {report.errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            <a href="/inspecciones/nueva">Volver a la captura</a> (se recarga la aplicación con el almacenamiento vacío).
          </p>
        </div>
      ) : null}
    </section>
  );
}
