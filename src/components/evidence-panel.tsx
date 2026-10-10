"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { capturePhoto, isCameraSupported, photoFromFile, type EvidencePhoto } from "../lib/device/camera";
import {
  getLocationPermission,
  isGeolocationSupported,
  requestLocation,
  type EvidenceLocation,
  type LocationPermission
} from "../lib/device/geolocation";

/**
 * Evidencia opcional de una inspección (Semana 6): una foto y una ubicación
 * aproximada. Ningún permiso se pide al cargar la página: solo al pulsar un
 * botón. Si la cámara o la ubicación no están disponibles, o se niegan, se
 * explica y la captura sigue funcionando sin ellas. Lo capturado se queda en
 * este dispositivo.
 */

export interface DraftEvidence {
  photo: EvidencePhoto | null;
  location: EvidenceLocation | null;
}

export const EMPTY_EVIDENCE: DraftEvidence = { photo: null, location: null };

export interface EvidencePanelProps {
  value: DraftEvidence;
  onChange: (next: DraftEvidence) => void;
  disabled?: boolean;
}

const PERMISSION_HINTS: Record<LocationPermission, string> = {
  granted: "Permiso de ubicación concedido.",
  denied: "El navegador tiene bloqueada la ubicación para este sitio. Puedes continuar sin ella.",
  prompt: "El navegador te pedirá permiso al pulsar el botón.",
  unsupported: "Este navegador no ofrece ubicación."
};

function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function EvidencePanel({ value, onChange, disabled }: EvidencePanelProps) {
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [locationAvailable, setLocationAvailable] = useState(false);
  const [permission, setPermission] = useState<LocationPermission | null>(null);
  const [busy, setBusy] = useState<"photo" | "location" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCameraAvailable(isCameraSupported());
    setLocationAvailable(isGeolocationSupported());
    void getLocationPermission().then(setPermission);
  }, []);

  const takePhoto = async () => {
    setBusy("photo");
    setMessage(null);
    try {
      const result = await capturePhoto();
      if (result.status === "ok") onChange({ ...value, photo: result.photo });
      else setMessage(result.message);
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files && input.files[0];
    setBusy("photo");
    setMessage(null);
    try {
      const result = await photoFromFile(file);
      if (result.status === "ok") onChange({ ...value, photo: result.photo });
      else if (result.status !== "cancelled") setMessage(result.message);
    } finally {
      input.value = "";
      setBusy(null);
    }
  };

  const addLocation = async () => {
    setBusy("location");
    setMessage(null);
    try {
      const result = await requestLocation();
      if (result.status === "ok") onChange({ ...value, location: result.location });
      else setMessage(result.message);
      void getLocationPermission().then(setPermission);
    } finally {
      setBusy(null);
    }
  };

  const inactive = Boolean(disabled) || busy !== null;

  return (
    <fieldset className="evidence-panel">
      <legend>Evidencia opcional</legend>
      <p className="muted">
        Opcional y solo en este dispositivo: la foto se reduce a un máximo de 1024 px y se quitan sus
        metadatos; la ubicación se redondea a unos 110 m. Puedes guardar la inspección sin ninguna.
      </p>

      <div className="form-actions">
        {cameraAvailable ? (
          <button className="filter-button" type="button" onClick={takePhoto} disabled={inactive}>
            {busy === "photo" ? "Abriendo cámara…" : "Tomar foto"}
          </button>
        ) : null}
        <label className="filter-button file-button" aria-disabled={inactive}>
          {cameraAvailable ? "Elegir imagen" : "Adjuntar imagen"}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={chooseFile}
            disabled={inactive}
          />
        </label>
        {locationAvailable ? (
          <button className="filter-button" type="button" onClick={addLocation} disabled={inactive}>
            {busy === "location" ? "Buscando ubicación…" : "Agregar ubicación aproximada"}
          </button>
        ) : null}
      </div>

      {!cameraAvailable ? (
        <p className="muted">
          Este navegador no ofrece cámara directa; puedes adjuntar una imagen desde el dispositivo.
        </p>
      ) : null}
      {locationAvailable && permission ? <p className="muted">{PERMISSION_HINTS[permission]}</p> : null}
      {!locationAvailable ? <p className="muted">{PERMISSION_HINTS.unsupported}</p> : null}

      <div aria-live="polite">
        {message ? <p className="form-notice form-notice-warning">{message}</p> : null}
      </div>

      {value.photo ? (
        <div className="evidence-item">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.photo.dataUrl}
            alt="Vista previa de la foto adjunta como evidencia"
            width={Math.min(value.photo.width, 240)}
          />
          <p className="muted">
            {value.photo.width}×{value.photo.height} · {kilobytes(value.photo.bytes)} ·{" "}
            {value.photo.source === "camera" ? "cámara" : "archivo"}
          </p>
          <button className="filter-button" type="button" onClick={() => onChange({ ...value, photo: null })}>
            Quitar foto
          </button>
        </div>
      ) : null}

      {value.location ? (
        <div className="evidence-item">
          <p>
            Ubicación aproximada: {value.location.latitude}, {value.location.longitude} (±
            {value.location.accuracyMeters} m)
          </p>
          <button className="filter-button" type="button" onClick={() => onChange({ ...value, location: null })}>
            Quitar ubicación
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
