/**
 * Listado de inspecciones renderizado en el servidor (SSR), Semana 4.
 *
 * `force-dynamic` + `revalidate = 0` obligan a Next.js a ejecutar este
 * componente en cada solicitud (no lo prerenderiza como estático, a
 * diferencia de `src/app/page.tsx`). Los datos ya están en el HTML inicial:
 * no hay una segunda petición desde el cliente para ver el contenido.
 *
 * `searchParams.fallo=1` reproduce el estado de error de forma determinista;
 * al lanzar, Next.js muestra `src/app/inspecciones/error.tsx`. Mientras la
 * consulta está pendiente, Next.js hace streaming del fallback de
 * `src/app/inspecciones/loading.tsx`.
 */

import { AppShell } from "../../components/app-shell";
import { listInspections } from "../../lib/data/inspections-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: { fallo?: string };
};

export default async function InspeccionesPage({ searchParams }: PageProps) {
  const startedAt = Date.now();
  const items = await listInspections({ simulateError: searchParams?.fallo === "1" });
  const renderMs = Date.now() - startedAt;

  return (
    <AppShell>
      <main className="page-shell">
        <section className="hero" aria-labelledby="ssr-title">
          <div>
            <p className="eyebrow">Renderizado en servidor · Semana 4</p>
            <h1 id="ssr-title">Inspecciones (SSR)</h1>
            <p className="lead">
              Esta ruta se ejecuta en el servidor en cada solicitud: los datos ya
              están en el HTML inicial, sin una segunda petición desde el cliente.
            </p>
          </div>
          <div className="hero-summary" aria-label="Resumen de la consulta">
            <strong>{items.length}</strong>
            <span>registros consultados</span>
          </div>
        </section>

        <p className="rendering-meta">Renderizado en el servidor en {renderMs} ms.</p>

        <section aria-labelledby="ssr-list-heading" className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Edificio E03 · Laboratorios UTT</p>
              <h2 id="ssr-list-heading">Listado de inspecciones</h2>
            </div>
            <span className="count" aria-label={`${items.length} inspecciones consultadas`}>
              {items.length} registros
            </span>
          </div>

          <div className="inspection-grid">
            {items.map((item) => (
              <article className={`inspection-card card-${item.status}`} key={item.id}>
                <div className="card-topline">
                  <span className={`badge badge-${item.status}`}>
                    <span aria-hidden="true">●</span> {item.statusLabel}
                  </span>
                  <span className="muted">{item.date}</span>
                </div>
                <h3>{item.location}</h3>
                <p>{item.summary}</p>
                <a className="primary-button detail-link" href={`/inspecciones/${item.id}`}>
                  Ver detalle (CSR)
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}
