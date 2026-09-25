/**
 * Estado de carga compartido entre la ruta SSR (como fallback de Suspense en
 * `src/app/inspecciones/loading.tsx`, renderizado en el servidor mientras la
 * consulta se resuelve) y la ruta CSR (como estado de React en
 * `src/app/inspecciones/[id]/page.tsx`, renderizado en el cliente mientras
 * `fetch` está pendiente). Es un componente sin estado ni hooks: se puede
 * renderizar igual en el servidor y en el cliente sin provocar un
 * hydration mismatch.
 */

export interface LoadingStateProps {
  label?: string;
  hint?: string;
}

export function LoadingState({ label = "Cargando…", hint }: LoadingStateProps) {
  return (
    <main className="page-shell state-page" aria-busy="true" aria-live="polite">
      <div className="loading-state" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <h1>{label}</h1>
        {hint ? <p>{hint}</p> : null}
      </div>
    </main>
  );
}
