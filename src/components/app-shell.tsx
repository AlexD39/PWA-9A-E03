import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

const navigation = [
  { href: "#inspections", label: "Inspecciones", icon: "▣" },
  { href: "#coming-soon", label: "Nueva", icon: "+" },
  { href: "#coming-soon", label: "Sync", icon: "↻" },
  { href: "#coming-soon", label: "Ajustes", icon: "⚙" }
];

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#inspections" aria-label="UTT Lab Inspections, inicio">
          <span className="brand-mark" aria-hidden="true">✚</span>
          <span>
            <strong>UTT Lab Inspections</strong>
            <small>U. TIGRES DE TEHUACÁN // LAB-SYS</small>
          </span>
        </a>
        <span className="connection-status" aria-label="Estado de conexión: datos sintéticos locales">
          <span className="status-dot" aria-hidden="true" />
          Local
        </span>
      </header>

      <div className="install-banner" role="status">
        <span className="install-icon" aria-hidden="true">↯</span>
        <span>
          <strong>Modo PWA en preparación</strong>
          <small>El shell se puede instalar desde el navegador cuando el manifest esté activo.</small>
        </span>
        <span className="banner-mark" aria-hidden="true">S2</span>
      </div>

      {children}

      <footer className="app-footer">
        <p>Aplicaciones Web Progresivas · Datos sintéticos versionados</p>
        <nav className="bottom-navigation" aria-label="Navegación principal">
          {navigation.map((item, index) => (
            <a
              className={`nav-item${index === 0 ? " nav-item-active" : ""}`}
              href={item.href}
              key={item.label}
              aria-current={index === 0 ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
