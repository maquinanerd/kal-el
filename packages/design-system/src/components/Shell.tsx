import type { ReactNode } from "react";

export type NavItemDef = {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
};

export function NavItem({ item }: { item: NavItemDef }) {
  return (
    <button
      type="button"
      className={`peg-nav-item ${item.active ? "peg-nav-item--active" : ""}`}
      onClick={item.onClick}
    >
      {item.icon}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
      {item.badge && <span className="peg-nav-item__badge">{item.badge}</span>}
    </button>
  );
}

export function Sidebar({
  brand,
  groups,
  footer,
}: {
  brand: string;
  groups: { label?: string; items: NavItemDef[] }[];
  footer?: ReactNode;
}) {
  return (
    <aside className="peg-sidebar" aria-label="Navegação principal">
      <div className="peg-sidebar__brand">
        <span className="peg-sidebar__brand-dot">K</span>
        <span>{brand}</span>
      </div>
      <nav className="peg-sidebar__nav">
        {groups.map((g, i) => (
          <div key={i}>
            {g.label && <div className="peg-sidebar__group-label">{g.label}</div>}
            {g.items.map((it) => (
              <NavItem key={it.id} item={it} />
            ))}
          </div>
        ))}
      </nav>
      {footer && <div className="peg-sidebar__footer">{footer}</div>}
    </aside>
  );
}

export type RailItemDef = {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export function Rail({ brand, items }: { brand: string; items: RailItemDef[] }) {
  return (
    <aside className="peg-rail" aria-label="Navegação compacta">
      <span className="peg-rail__brand">{brand}</span>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          title={it.label}
          aria-label={it.label}
          className={`peg-rail__item ${it.active ? "peg-rail__item--active" : ""}`}
          onClick={it.onClick}
        >
          {it.icon}
        </button>
      ))}
    </aside>
  );
}

export function Topbar({
  left,
  center,
  right,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="peg-topbar">
      {left}
      {center && <div>{center}</div>}
      <div className="peg-topbar__spacer" />
      {right}
    </header>
  );
}

export function Inspector({ open = false, children }: { open?: boolean; children: ReactNode }) {
  return (
    <aside className={`peg-inspector ${open ? "peg-inspector--open" : ""}`} aria-label="Inspector contextual">
      {children}
    </aside>
  );
}

export function InspectorGroup({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="peg-inspector__group">
      <div className="peg-inspector__title">
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return <div className="peg-app">{children}</div>;
}

export function Workspace({ children }: { children: ReactNode }) {
  return <main className="peg-workspace">{children}</main>;
}

export function Content({ children }: { children: ReactNode }) {
  return <div className="peg-content">{children}</div>;
}

export function PageHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="peg-page-head">
      <div>
        <h1 className="peg-page-title">{title}</h1>
        {description && <p className="peg-page-desc">{description}</p>}
      </div>
      {actions && <div className="peg-row">{actions}</div>}
    </div>
  );
}
