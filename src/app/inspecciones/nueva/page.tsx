"use client";

/**
 * Captura de inspecciones con persistencia local y sincronización (Semana 5).
 *
 * Guardar escribe en IndexedDB (vía la cola) y responde de inmediato: no
 * espera a la red. La sincronización ocurre en segundo plano cuando hay
 * conexión. Cada formulario nuevo lleva un id propio (`draftId`); volver a
 * enviar el mismo formulario reutiliza ese id, así que un doble clic edita el
 * mismo registro en vez de crear un duplicado.
 *
 * Para evitar un hydration mismatch, el primer render es siempre el estado de
 * carga; la cola, el id del borrador y la fecha por omisión se calculan en el
 * efecto, solo en el cliente.
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "../../../components/app-shell";
import { LoadingState } from "../../../components/loading-state";
import { EMPTY_EVIDENCE, EvidencePanel, type DraftEvidence } from "../../../components/evidence-panel";
import { NotificationPanel } from "../../../components/notification-panel";
import { SyncPanel } from "../../../components/sync-panel";
import { loadEvidence, saveEvidence } from "../../../lib/device/evidence";
import { inspections } from "../../../lib/data/inspections";
import { getSyncRuntime, startAutoSync, type SyncRuntime } from "../../../lib/sync/client";
import { LIMITS, type InspectionStatus, type LocalRecord } from "../../../lib/storage/schema";

type FormState = {
  location: string;
  date: string;
  inspector: string;
  status: InspectionStatus;
  findings: string;
  summary: string;
};

const KNOWN_LOCATIONS = Array.from(new Set(inspections.map((item) => item.location)));

function newDraftId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : undefined;
  const raw =
    cryptoApi && typeof cryptoApi.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `insp-${raw}`.toLowerCase();
}

function emptyForm(): FormState {
  return {
    location: KNOWN_LOCATIONS[0] || "",
    date: new Date().toISOString().slice(0, 10),
    inspector: "",
    status: "ok",
    findings: "0",
    summary: ""
  };
}

export default function NuevaInspeccionPage() {
  const [runtime, setRuntime] = useState<SyncRuntime | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [evidence, setEvidence] = useState<DraftEvidence>(EMPTY_EVIDENCE);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void getSyncRuntime().then((ready) => {
      if (cancelled) return;
      setRuntime(ready);
      setDraftId(newDraftId());
      setForm(emptyForm());
      if (ready.schemaError === null) stop = startAutoSync(ready.queue);
    });
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }, []);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === "status") {
        if (value === "ok") next.findings = "0";
        else if (Number(next.findings) < 1) next.findings = "1";
      }
      return next;
    });
  }, []);

  const loadForEdit = useCallback((record: LocalRecord) => {
    setDraftId(record.id);
    setForm({
      location: record.fields.location,
      date: record.fields.date,
      inspector: record.fields.inspector,
      status: record.fields.status,
      findings: String(record.fields.findings),
      summary: record.fields.summary
    });
    setErrors([]);
    setEditing(true);
    setNotice(`Editando el registro ${record.id}. Al guardar se actualiza el mismo registro.`);
    setEvidence(EMPTY_EVIDENCE);
    if (runtime) {
      void loadEvidence(runtime.storage, record.id).then((stored) => {
        if (stored) setEvidence({ photo: stored.photo, location: stored.location });
      });
    }
  }, [runtime]);

  const resetForm = useCallback(() => {
    setDraftId(newDraftId());
    setForm(emptyForm());
    setEditing(false);
    setEvidence(EMPTY_EVIDENCE);
  }, []);

  if (!runtime || !form || !draftId) {
    return <LoadingState label="Preparando el almacenamiento local…" hint="Abriendo IndexedDB" />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const result = await runtime.queue.saveInspection({
        id: draftId,
        fields: {
          location: form.location,
          date: form.date,
          inspector: form.inspector,
          status: form.status,
          findings: Number(form.findings),
          summary: form.summary
        }
      });
      if (!result.ok) {
        setErrors(result.errors);
        setNotice(null);
        return;
      }
      let evidenceNote = "";
      if (editing || evidence.photo || evidence.location) {
        const saved = await saveEvidence(runtime.storage, result.record.id, {
          photo: evidence.photo,
          location: evidence.location
        });
        if (saved.status !== "ok") {
          evidenceNote = " La evidencia no se pudo guardar; la inspección sí.";
        } else if (saved.evidence) {
          evidenceNote = " La evidencia se guardó solo en este dispositivo.";
        }
      }
      setNotice(
        (result.unchanged
          ? "No hubo cambios: no se creó otra operación."
          : `Guardado en este dispositivo (${result.record.id}). Se sincronizará cuando haya conexión.`) +
          evidenceNote
      );
      void runtime.queue.flush();
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const blocked = runtime.schemaError !== null;

  return (
    <AppShell>
      <main className="page-shell">
        <section className="hero" aria-labelledby="nueva-title">
          <div>
            <p className="eyebrow">Captura offline · Semana 5</p>
            <h1 id="nueva-title">Nueva inspección</h1>
            <p className="lead">
              El registro se guarda primero en este dispositivo y se sincroniza solo cuando hay conexión,
              sin duplicados. Todos los datos son sintéticos.
            </p>
          </div>
        </section>

        {blocked ? (
          <p className="form-errors" role="alert">
            No se puede usar el almacenamiento local: {runtime.schemaError}
          </p>
        ) : (
          <form className="sync-form" onSubmit={onSubmit} noValidate>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="location">Laboratorio</label>
                <input
                  id="location"
                  name="location"
                  list="known-locations"
                  value={form.location}
                  maxLength={LIMITS.locationMax}
                  onChange={(e) => update("location", e.target.value)}
                  required
                />
                <datalist id="known-locations">
                  {KNOWN_LOCATIONS.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="date">Fecha</label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={(e) => update("date", e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="inspector">Responsable</label>
                <input
                  id="inspector"
                  name="inspector"
                  value={form.inspector}
                  maxLength={LIMITS.inspectorMax}
                  onChange={(e) => update("inspector", e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="status">Estado</label>
                <select
                  id="status"
                  name="status"
                  value={form.status}
                  onChange={(e) => update("status", e.target.value as InspectionStatus)}
                >
                  <option value="ok">Sin incidencias</option>
                  <option value="attention">Requiere atención</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="findings">Hallazgos</label>
                <input
                  id="findings"
                  name="findings"
                  type="number"
                  min={0}
                  max={LIMITS.findingsMax}
                  value={form.findings}
                  onChange={(e) => update("findings", e.target.value)}
                />
              </div>
              <div className="field field-wide">
                <label htmlFor="summary">Resumen</label>
                <textarea
                  id="summary"
                  name="summary"
                  rows={3}
                  value={form.summary}
                  maxLength={LIMITS.summaryMax}
                  onChange={(e) => update("summary", e.target.value)}
                />
              </div>
            </div>

            <EvidencePanel value={evidence} onChange={setEvidence} disabled={saving} />

            {errors.length > 0 ? (
              <ul className="form-errors" role="alert">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            {notice ? (
              <p className="form-notice" role="status">
                {notice}
              </p>
            ) : null}

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Guardar inspección"}
              </button>
              {editing ? (
                <button
                  className="filter-button"
                  type="button"
                  onClick={() => {
                    resetForm();
                    setNotice(null);
                  }}
                >
                  Cancelar edición
                </button>
              ) : null}
            </div>
          </form>
        )}

        {blocked ? null : <NotificationPanel queue={runtime.queue} />}

        {blocked ? null : (
          <SyncPanel queue={runtime.queue} persistent={runtime.persistent} onEdit={loadForEdit} />
        )}
      </main>
    </AppShell>
  );
}
