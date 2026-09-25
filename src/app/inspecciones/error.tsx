"use client";

/**
 * Límite de error del segmento `/inspecciones` (App Router).
 *
 * En producción, Next.js redacta `error.message` de los Server Components
 * para no filtrar detalles internos al cliente; solo llega `error.digest`,
 * un identificador estable del mismo error. Por eso este componente no
 * muestra `error.message` como texto principal (en build de producción
 * llegaría vacío o genérico) y en su lugar usa un mensaje fijo en español,
 * con el `digest` como referencia técnica opcional. Ver docs/rendering-decision.md.
 */
export default function InspeccionesError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-shell state-page" role="alert">
      <div className="error-state">
        <span className="error-icon" aria-hidden="true">!</span>
        <p className="eyebrow">Estado controlado · SSR</p>
        <h1>No pudimos renderizar las inspecciones en el servidor</h1>
        <p>La consulta de datos falló. Es un dato sintético de prueba, no un fallo real de infraestructura.</p>
        {error.digest ? <p className="muted">Referencia: {error.digest}</p> : null}
        <button className="primary-button" type="button" onClick={() => reset()}>
          Intentar de nuevo
        </button>
        <p className="muted">
          <a href="/">Volver al panel principal</a>
        </p>
      </div>
    </main>
  );
}
