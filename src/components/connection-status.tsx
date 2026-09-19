"use client";

import { useEffect, useState } from "react";

type Status = "unknown" | "online" | "offline";

const labels: Record<Status, string> = {
  unknown: "Local",
  online: "En línea",
  offline: "Sin conexión"
};

/** Indicador de conectividad basado en navigator.onLine; no bloquea el render inicial. */
export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>("unknown");

  useEffect(() => {
    const update = () => setStatus(navigator.onLine ? "online" : "offline");
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <span
      className={`connection-status connection-${status}`}
      aria-label={`Estado de conexión: ${labels[status]}. Datos sintéticos locales`}
      data-status={status}
    >
      <span className="status-dot" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}
