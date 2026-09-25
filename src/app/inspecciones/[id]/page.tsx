"use client";

/**
 * Detalle de una inspección renderizado en el cliente (CSR), Semana 4.
 *
 * El HTML inicial no trae los datos: llega vacío (solo el estado de carga) y
 * `fetchInspectionClient` (src/lib/rendering/fetch-inspection-client.ts) pide
 * el JSON a `src/app/api/inspections/[id]/route.ts` después de montar. Ese
 * contraste con `src/app/inspecciones/page.tsx` (SSR) es intencional: aquí se
 * paga una segunda petición a cambio de poder reintentar sin recargar la
 * página completa.
 *
 * Para evitar un hydration mismatch, el render inicial (antes del primer
 * `useEffect`) es siempre el mismo estado "loading" tanto en servidor como en
 * cliente: no se lee `Date.now()`, `Math.random()` ni nada dependiente del
 * entorno antes de que el efecto corra.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { LoadingState } from "../../../components/loading-state";
import {
  fetchInspectionClient,
  type FetchInspectionResult
} from "../../../lib/rendering/fetch-inspection-client";

type PageProps = {
  params: { id: string };
};

export default function InspectionDetailPage({ params }: PageProps) {
  const searchParams = useSearchParams();
  const simulateError = searchParams?.get("fallo") === "1";
  const [result, setResult] = useState<FetchInspectionResult>({ status: "error", message: "" } as FetchInspectionResult);
  const [status, setStatus] = useState<"loading" | "done">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchInspectionClient(params.id, { simulateError }).then((outcome) => {
      if (cancelled) return;
      setResult(outcome);
      setStatus("done");
    });
    return () => {
      cancelled = true;
    };
  }, [params.id, simulateError, attempt]);

  if (status === "loading") {
    return <LoadingState label="Cargando inspección en el cliente…" hint={`Consultando ${params.id}`} />;
  }

  if (result.status === "not-found") {
    return (
      <AppShell>
        <main className="page-shell state-page" role="status">
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">□</span>
            <h3>No encontramos esa inspección</h3>
            <p>El identificador «{params.id}» no corresponde a un registro sintético existente.</p>
            <a className="primary-button" href="/inspecciones">
              Volver al listado (SSR)
            </a>
          </div>
        </main>
      </AppShell>
    );
  }

  if (result.status === "error") {
    return (
      <AppShell>
        <main className="page-shell state-page" role="alert">
          <div className="error-state">
            <span className="error-icon" aria-hidden="true">!</span>
            <p className="eyebrow">Estado controlado · CSR</p>
            <h1>No pudimos cargar esta inspección</h1>
            <p>{result.message}</p>
            <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
              Reintentar
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  const { inspection, fetchedMs } = result;

  return (
    <AppShell>
      <main className="page-shell">
        <section className="hero" aria-labelledby="csr-title">
          <div>
            <p className="eyebrow">Renderizado en cliente · Semana 4</p>
            <h1 id="csr-title">{inspection.location}</h1>
            <p className="lead">
              Esta ruta pide sus datos desde el navegador después de cargar: el HTML
              inicial no los incluye.
            </p>
          </div>
        </section>

        <p className="rendering-meta">Renderizado en el cliente en {fetchedMs} ms.</p>

        <section aria-labelledby="csr-detail-heading" className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Edificio E03 · Laboratorios UTT</p>
              <h2 id="csr-detail-heading">Detalle de la inspección</h2>
            </div>
          </div>

          <article className={`inspection-card card-${inspection.status}`}>
            <div className="card-topline">
              <span className={`badge badge-${inspection.status}`}>
                <span aria-hidden="true">●</span> {inspection.statusLabel}
              </span>
              <span className="muted">{inspection.date}</span>
            </div>
            <p>{inspection.summary}</p>
            <dl>
              <div>
                <dt>Responsable</dt>
                <dd>{inspection.inspector}</dd>
              </div>
              <div>
                <dt>Hallazgos</dt>
                <dd>{inspection.findings}</dd>
              </div>
            </dl>
          </article>

          <p className="muted">
            <a href="/inspecciones">Volver al listado (SSR)</a>
          </p>
        </section>
      </main>
    </AppShell>
  );
}
