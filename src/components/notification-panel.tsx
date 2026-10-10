"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBrowserNotifierDeps,
  createNotifier,
  getPermissionState,
  requestPermission,
  type ChangeNotification,
  type Notifier,
  type PermissionState
} from "../lib/notifications/client";
import type { SyncQueue } from "../lib/sync/queue";

/**
 * Avisos de cambios de sincronización (Semana 6). El permiso del sistema solo
 * se pide al pulsar "Activar avisos". Mientras no haya permiso, o la
 * aplicación esté a la vista, los avisos se muestran aquí mismo, así que el
 * flujo no depende de la capacidad. El texto no incluye datos de la inspección.
 */

const STATE_TEXT: Record<PermissionState, string> = {
  granted: "Avisos del sistema activados. Se usan cuando la aplicación está en segundo plano.",
  denied:
    "Bloqueaste los avisos del sistema. Seguirás viendo los avisos aquí. Puedes cambiarlo en la configuración del sitio del navegador.",
  default: "Los avisos del sistema están sin activar. Mientras tanto verás los avisos aquí.",
  unsupported: "Este navegador no ofrece avisos del sistema. Verás los avisos aquí."
};

const PREFERENCE_KEY = "avisos-del-sistema";

interface Notice extends ChangeNotification {
  id: number;
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    /* sin almacenamiento: la preferencia vale solo para esta sesión */
  }
}

export interface NotificationPanelProps {
  queue: SyncQueue;
}

export function NotificationPanel({ queue }: NotificationPanelProps) {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const enabledRef = useRef(true);
  const notifierRef = useRef<Notifier | null>(null);
  const counter = useRef(0);

  const addNotice = useCallback((notification: ChangeNotification) => {
    counter.current += 1;
    const notice: Notice = { ...notification, id: counter.current };
    setNotices((current) => [notice, ...current].slice(0, 4));
  }, []);

  useEffect(() => {
    const stored = readPreference();
    enabledRef.current = stored;
    setEnabled(stored);
    setPermission(getPermissionState());

    const notifier = createNotifier(createBrowserNotifierDeps(addNotice, () => enabledRef.current));
    notifierRef.current = notifier;
    const unsubscribe = queue.subscribe((event) => {
      void notifier.handleSyncEvent(event);
    });
    const refresh = () => setPermission(getPermissionState());
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      notifierRef.current = null;
    };
  }, [queue, addNotice]);

  const activate = async () => {
    setFeedback(null);
    setPermission(await requestPermission());
  };

  const sendTest = async () => {
    const notifier = notifierRef.current;
    if (!notifier) return;
    const result = await notifier.notify(
      {
        kind: "info",
        tag: "aviso-de-prueba",
        title: "Aviso de prueba",
        body: "Así se ve un aviso de cambio. No contiene datos de inspecciones."
      },
      { forceSystem: true }
    );
    setFeedback(
      result.channel === "system"
        ? "Se envió un aviso del sistema."
        : result.reason === "deduplicated"
          ? "Espera unos segundos antes de probar de nuevo."
          : "El aviso del sistema no está disponible; se muestra dentro de la aplicación."
    );
  };

  return (
    <section className="notification-panel" aria-labelledby="notif-heading">
      <h3 id="notif-heading">Avisos de cambios</h3>
      <p className="muted">{permission ? STATE_TEXT[permission] : "Comprobando avisos…"}</p>

      <div className="form-actions">
        {permission === "default" ? (
          <button className="filter-button" type="button" onClick={activate}>
            Activar avisos del sistema
          </button>
        ) : null}
        <button className="filter-button" type="button" onClick={sendTest}>
          Probar aviso
        </button>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              enabledRef.current = event.target.checked;
              setEnabled(event.target.checked);
              writePreference(event.target.checked);
            }}
          />
          Usar avisos del sistema en segundo plano
        </label>
      </div>
      {feedback ? <p className="muted">{feedback}</p> : null}

      <ul className="notice-list" aria-live="polite">
        {notices.map((notice) => (
          <li className={`notice notice-${notice.kind}`} key={notice.id}>
            <div>
              <strong>{notice.title}</strong>
              <span className="muted"> {notice.body}</span>
            </div>
            <button
              className="filter-button"
              type="button"
              onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
            >
              Cerrar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
