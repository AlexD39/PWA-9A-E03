"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="page-shell state-page" role="alert">
      <div className="error-state">
        <span className="error-icon" aria-hidden="true">!</span>
        <p className="eyebrow">Estado controlado</p>
        <h1>No pudimos cargar las inspecciones</h1>
        <p>Revisa el estado de la aplicación y vuelve a intentar la operación.</p>
        <button className="primary-button" type="button" onClick={() => reset()}>
          Intentar de nuevo
        </button>
      </div>
    </main>
  );
}
