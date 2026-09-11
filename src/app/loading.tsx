export default function Loading() {
  return (
    <main className="page-shell state-page" aria-busy="true" aria-live="polite">
      <div className="loading-state">
        <span className="loading-spinner" aria-hidden="true" />
        <h1>Cargando inspecciones</h1>
        <p>Preparando el panel de laboratorio.</p>
      </div>
    </main>
  );
}
