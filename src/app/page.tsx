import { inspections } from "../lib/data/inspections";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Proyecto base · Semana 1</p>
        <h1>Inspecciones de laboratorio</h1>
        <p className="lead">
          Registro de mantenimiento para trabajar con conectividad intermitente.
          Los datos mostrados son sintéticos.
        </p>
        <span className="status">Estado del starter: ejecutable · PWA aún no implementada</span>
      </header>

      <section aria-labelledby="inspections-heading" className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Datos de demostración</p>
            <h2 id="inspections-heading">Inspecciones recientes</h2>
          </div>
          <span className="count">{inspections.length} registros</span>
        </div>

        <div className="inspection-grid">
          {inspections.map((inspection) => (
            <article className="inspection-card" key={inspection.id}>
              <div className="card-topline">
                <span className={`badge badge-${inspection.status}`}>{inspection.statusLabel}</span>
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
      </section>

      <footer className="footer">
        <p>Aplicaciones Web Progresivas · Universidad Tecnológica de Tehuacán</p>
      </footer>
    </main>
  );
}
