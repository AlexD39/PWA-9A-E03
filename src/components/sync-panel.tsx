"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { statusLabelFor, type LocalRecord } from "../lib/storage/schema";
import type {
  RecordSyncState,
  RecordView,
  SyncEvent,
  SyncEventType,
  SyncQueue,
  SyncStats
} from "../lib/sync/queue";

/**
 * Panel de observabilidad de la cola (Semana 5): cuántas operaciones hay en
 * cada estado, el estado de sincronización de cada registro local, la
 * bitácora de eventos y cuántos registros tiene el servidor simulado. Todo se
 * calcula después de montar, así que el primer render es siempre el mismo en
 * servidor y cliente (sin hydration mismatch).
 */

const STATE_LABELS: Record<RecordSyncState, string> = {
  synced: "Sincronizado",
  pending: "Pendiente de sincronizar",
  syncing: "Sincronizando…",
  failed: "Falló la sincronización"
};

const EVENT_LABELS: Record<SyncEventType, string> = {
  enqueued: "Guardado en este dispositivo",
  coalesced: "Edición unida a la operación pendiente",
  unchanged: "Sin cambios: no se creó otra operación",
  "rejected-input": "Datos rechazados por la validación",
  "storage-error": "Error de almacenamiento local",
  "corrupt-entry-skipped": "Entrada dañada omitida",
  "flush-start": "Inicio de sincronización",
  send: "Enviando al servidor",
  acked: "Confirmado por el servidor",
  duplicate: "El servidor ya lo tenía: duplicado evitado",
  "conflict-resolved": "Conflicto resuelto con la política",
  "retry-scheduled": "Reintento programado",
  failed: "Operación fallida",
  "stale-response-ignored": "Respuesta obsoleta descartada",
  recovered: "Operación recuperada tras un cierre",
  "retried-failed": "Operación fallida reencolada",
  "flush-end": "Fin de sincronización"
};

type ServerInfo = { records: number; processedKeys: number } | "unavailable" | null;

export interface SyncPanelProps {
  queue: SyncQueue;
  persistent: boolean;
  onEdit?: (record: LocalRecord) => void;
}

export function SyncPanel({ queue, persistent, onEdit }: SyncPanelProps) {
  const [views, setViews] = useState<RecordView[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [server, setServer] = useState<ServerInfo>(null);
  const [busy, setBusy] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const refreshServer = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/inspections", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { records: unknown[]; processedKeys: number };
      setServer({ records: data.records.length, processedKeys: data.processedKeys });
    } catch {
      setServer("unavailable");
    }
  }, []);

  const refresh = useCallback(async () => {
    const [nextViews, nextStats] = await Promise.all([queue.getRecordViews(), queue.getStats()]);
    nextViews.sort((a, b) => (a.record.updatedAt < b.record.updatedAt ? 1 : -1));
    setViews(nextViews);
    setStats(nextStats);
    setEvents(queue.getLog().slice(-8).reverse());
  }, [queue]);

  useEffect(() => {
    void refresh();
    void refreshServer();
    const unsubscribe = queue.subscribe((event) => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void refresh();
        if (event.type === "flush-end") void refreshServer();
      }, 60);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [queue, refresh, refreshServer]);

  const syncNow = async () => {
    setBusy(true);
    try {
      await queue.flush({ ignoreBackoff: true });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const retryFailed = async () => {
    await queue.retryFailed();
    await syncNow();
  };

  return (
    <section className="sync-panel" id="sincronizacion" aria-labelledby="sync-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Persistencia local · Semana 5</p>
          <h2 id="sync-heading">Estado de sincronización</h2>
        </div>
      </div>

      {!persistent ? (
        <p className="form-errors" role="alert">
          Este navegador no ofrece IndexedDB: los registros se guardan solo en memoria y se perderán al
          cerrar la pestaña.
        </p>
      ) : null}

      <dl className="sync-stats" aria-live="polite">
        <div>
          <dt>Pendientes</dt>
          <dd>{stats ? stats.pending + stats.syncing : "…"}</dd>
        </div>
        <div>
          <dt>Confirmadas</dt>
          <dd>{stats ? stats.done : "…"}</dd>
        </div>
        <div>
          <dt>Fallidas</dt>
          <dd>{stats ? stats.failed : "…"}</dd>
        </div>
        <div>
          <dt>En el servidor</dt>
          <dd>
            {server === null ? "…" : server === "unavailable" ? "sin conexión" : server.records}
          </dd>
        </div>
      </dl>

      <div className="form-actions">
        <button className="primary-button" type="button" onClick={syncNow} disabled={busy}>
          {busy ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
        {stats && stats.failed > 0 ? (
          <button className="filter-button" type="button" onClick={retryFailed} disabled={busy}>
            Reintentar fallidas
          </button>
        ) : null}
      </div>

      <h3>Registros en este dispositivo</h3>
      {views.length === 0 ? (
        <p className="muted">Todavía no hay registros guardados localmente.</p>
      ) : (
        <ul className="sync-records">
          {views.map(({ record, state, lastError }) => (
            <li className="sync-record" key={record.id}>
              <div className="card-topline">
                <span className={`badge badge-${state}`}>{STATE_LABELS[state]}</span>
                <span className="muted">rev. {record.revision}</span>
              </div>
              <strong>{record.fields.location}</strong>
              <p>
                {record.fields.date} · {record.fields.inspector} · {statusLabelFor(record.fields.status)}
                {record.fields.findings > 0 ? ` (${record.fields.findings} hallazgos)` : ""}
              </p>
              {lastError ? <p className="muted">Último error: {lastError}</p> : null}
              {onEdit ? (
                <button className="filter-button" type="button" onClick={() => onEdit(record)}>
                  Editar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3>Bitácora reciente</h3>
      {events.length === 0 ? (
        <p className="muted">Sin eventos todavía.</p>
      ) : (
        <ol className="sync-log">
          {events.map((event, index) => (
            <li key={`${event.at}-${event.type}-${index}`}>
              <span>{EVENT_LABELS[event.type]}</span>
              {event.detail ? <small className="muted"> — {event.detail}</small> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
