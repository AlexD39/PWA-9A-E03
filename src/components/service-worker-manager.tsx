"use client";

import { useCallback, useEffect, useState } from "react";
import {
  activateWaitingServiceWorker,
  onControllerChange,
  registerServiceWorker
} from "../lib/pwa/register-service-worker";

/**
 * Registra el service worker al montar y muestra un aviso cuando hay una
 * versión nueva en espera. La activación requiere un clic explícito: así una
 * versión a medio instalar nunca reemplaza a la activa sin control del usuario.
 *
 * En desarrollo no se registra: el HMR de Next.js sirve chunks no versionados
 * y la caché estática los dejaría obsoletos. Verificar offline con
 * `npm run build && npm run start`.
 */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorkerRegistration | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    void registerServiceWorker({
      onUpdateAvailable: (registration) => {
        if (!cancelled) setWaiting(registration);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    setActivating(true);
    onControllerChange(() => window.location.reload());
    if (!activateWaitingServiceWorker(waiting)) {
      setActivating(false);
      setWaiting(null);
    }
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="install-icon" aria-hidden="true">↻</span>
      <span>
        <strong>Hay una versión nueva disponible</strong>
        <small>Se instaló en segundo plano. Actualiza cuando termines de consultar.</small>
      </span>
      <button className="update-button" type="button" onClick={applyUpdate} disabled={activating}>
        {activating ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </div>
  );
}
