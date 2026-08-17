import type { ReactNode } from "react";
import { IconCheck } from "../icons";

export type Account = {
  id: string;
  name: string;
  meta: string;
  avatar?: string;
};

export function AccountSwitcher({
  accounts,
  activeId,
  footer,
}: {
  accounts: Account[];
  activeId: string;
  footer?: ReactNode;
}) {
  return (
    <div className="peg-account-switcher">
      <div className="peg-menu__label">Conta</div>
      {accounts.map((a) => (
        <div key={a.id} className={`peg-account-switcher__row ${a.id === activeId ? "peg-account-switcher__row--active" : ""}`}>
          <span className="peg-avatar">{a.avatar ?? a.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="peg-account-switcher__name">{a.name}</div>
            <div className="peg-account-switcher__meta">{a.meta}</div>
          </div>
          {a.id === activeId && <IconCheck className="peg-account-switcher__check" />}
        </div>
      ))}
      {footer && (
        <>
          <div className="peg-menu__separator" />
          {footer}
        </>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="peg-overlay" role="presentation">
      <div className="peg-modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <header className="peg-modal__header">
          <h3 className="peg-modal__title">{title}</h3>
          <button className="peg-btn peg-btn--icon" aria-label="Fechar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="peg-modal__body">{children}</div>
        {footer && <footer className="peg-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Toast({ tone = "success", children }: { tone?: "success" | "error"; children: ReactNode }) {
  return (
    <div className="peg-toast" aria-live="polite">
      <div className={`peg-toast__item ${tone === "error" ? "peg-toast__item--error" : ""}`}>{children}</div>
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`peg-alert peg-alert--${tone}`} role="alert">
      <div>
        {title && <div className="peg-alert__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="peg-empty">
      <div className="peg-empty__title">{title}</div>
      {body && <div className="peg-empty__body">{body}</div>}
      {action && <div className="peg-row">{action}</div>}
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; current?: boolean }[] }) {
  return (
    <nav className="peg-breadcrumb" aria-label="Trilha">
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <span className="peg-breadcrumb__sep">/</span>}
          <span className={it.current ? "peg-breadcrumb__current" : ""}>{it.label}</span>
        </span>
      ))}
    </nav>
  );
}
