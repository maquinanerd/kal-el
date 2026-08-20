import { useEffect, useRef, type ReactNode } from "react";

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

/**
 * Below 1024px the sidebar is a drawer (PEG Shell F). It is translated off-canvas by
 * default, so `open`/`onClose` are what make navigation reachable at all on mobile -
 * without them the nav is simply unreachable, not merely inconvenient.
 */
export function Sidebar({
  brand,
  groups,
  footer,
  open = false,
  onClose,
  id = "peg-sidebar",
}: {
  brand: ReactNode;
  groups: { label?: string; items: NavItemDef[] }[];
  footer?: ReactNode;
  open?: boolean;
  onClose?: () => void;
  id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;
    // move focus into the drawer so keyboard users land on the navigation
    const first = ref.current?.querySelector<HTMLElement>("button, a[href]");
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open && <div className="peg-scrim" onClick={onClose} aria-hidden="true" />}
      <aside
        id={id}
        ref={ref}
        className={`peg-sidebar ${open ? "peg-sidebar--open" : ""}`}
        aria-label="Navegação principal"
      >
        <div className="peg-sidebar__brand">
          {brand}
          {onClose && (
            <button
              type="button"
              className="peg-sidebar__close"
              aria-label="Fechar navegação"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
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
    </>
  );
}

/** Hamburger that reveals the mobile drawer. Hidden at >= 1024px by CSS. */
export function MenuButton({
  onClick,
  controls = "peg-sidebar",
  expanded = false,
}: {
  onClick: () => void;
  controls?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="peg-menu-button"
      aria-label="Abrir navegação"
      aria-controls={controls}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
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
