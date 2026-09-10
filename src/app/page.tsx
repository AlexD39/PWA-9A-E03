import { inspections } from "../lib/data/inspections";
import { AppShell } from "../components/app-shell";

export default function HomePage() {
  return (
    <AppShell>
      <main className="page-shell">
        <section className="hero" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Panel operativo · Semana 2</p>
            <h1 id="page-title">Inspecciones de laboratorio</h1>
            <p className="lead">
              Consulta el estado de mantenimiento con una interfaz preparada para
              conectividad intermitente. Todos los registros son sintéticos.
            </p>
          </div>
          <div className="hero-summary" aria-label="Resumen de la jornada">
            <strong>{inspections.length}</strong>
            <span>registros disponibles</span>
          </div>
        </section>

        <section aria-labelledby="inspections-heading" className="content-section" id="inspections">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Edificio E03 · Laboratorios UTT</p>
              <h2 id="inspections-heading">Inspecciones recientes</h2>
            </div>
            <span className="count" aria-label={`${inspections.length} inspecciones activas`}>
              {inspections.length} activas
            </span>
          </div>

          <div className="list-toolbar" aria-label="Herramientas de consulta">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Buscar inspecciones</span>
              <input type="search" placeholder="Buscar por laboratorio o responsable" />
            </label>
            <button className="filter-button" type="button" disabled>
              ≡ Filtros
            </button>
          </div>

          {inspections.length === 0 ? (
            <div className="empty-state" role="status">
              <span className="empty-icon" aria-hidden="true">□</span>
              <h3>No hay inspecciones disponibles</h3>
              <p>Los registros sintéticos aparecerán aquí cuando estén disponibles.</p>
            </div>
          ) : (
            <div className="inspection-grid">
              {inspections.map((inspection) => (
                <article className={`inspection-card card-${inspection.status}`} key={inspection.id}>
                  <div className="card-topline">
                    <span className={`badge badge-${inspection.status}`}>
                      <span aria-hidden="true">●</span> {inspection.statusLabel}
                    </span>
                    <span className="muted">{inspection.date}</span>
                  </div>
                  <h3>{inspection.location}</h3>
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
              ))}
            </div>
          )}
        </section>

        <section className="coming-soon" id="coming-soon" aria-labelledby="coming-soon-heading">
          <p className="eyebrow">Próximamente</p>
          <h2 id="coming-soon-heading">Más herramientas del laboratorio</h2>
          <p>
            La captura de inspecciones, la sincronización offline y los ajustes se
            incorporarán en los siguientes hitos del proyecto.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
