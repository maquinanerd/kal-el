import type { ReactNode } from "react";

export function Card({
  title,
  description,
  actions,
  children,
  bodyClassName = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="peg-card">
      {(title || actions) && (
        <header className="peg-card__header">
          <div>
            {title && <h3 className="peg-card__title">{title}</h3>}
            {description && <p className="peg-card__desc">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={`peg-card__body ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  deltaUp = true,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
}) {
  return (
    <div className="peg-kpi">
      <span className="peg-kpi__label">{label}</span>
      <span className="peg-kpi__value">{value}</span>
      {delta && (
        <span className={`peg-kpi__delta ${deltaUp ? "peg-kpi__delta--up" : "peg-kpi__delta--down"}`}>
          {deltaUp ? "▲" : "▼"} {delta}
        </span>
      )}
    </div>
  );
}

export function ProfileCard({
  name,
  meta,
  avatar,
  actions,
}: {
  name: string;
  meta: string;
  avatar?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="peg-profile-card">
      <span className="peg-avatar peg-avatar--lg">{avatar ?? name.slice(0, 2).toUpperCase()}</span>
      <div>
        <div className="peg-profile-card__name">{name}</div>
        <div className="peg-profile-card__meta">{meta}</div>
      </div>
      {actions && <div className="peg-profile-card__actions">{actions}</div>}
    </div>
  );
}
