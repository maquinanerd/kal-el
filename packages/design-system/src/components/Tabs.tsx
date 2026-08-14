import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Tab = { id: string; label: string; count?: number };

export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="peg-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`peg-tab ${active === t.id ? "peg-tab--active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === "number" && ` · ${t.count}`}
        </button>
      ))}
    </div>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="peg-segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          className={`peg-segmented__btn ${value === o.value ? "peg-segmented__btn--active" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  active?: boolean;
  onClick?: () => void;
  separatorAfter?: boolean;
};

type MenuRow = MenuItem | { type: "separator" };

function isSeparator(item: MenuRow): item is { type: "separator" } {
  return (item as { type?: string }).type === "separator";
}

export function Menu({ items }: { items: MenuRow[] }) {
  return (
    <ul className="peg-menu" role="menu">
      {items.map((item, i) =>
        isSeparator(item) ? (
          <li key={i} className="peg-menu__separator" role="separator" />
        ) : (
          <li key={i}>
            <button
              type="button"
              role="menuitem"
              className={`peg-menu__item ${item.danger ? "peg-menu__item--danger" : ""} ${item.active ? "peg-menu__item--active" : ""}`}
              onClick={item.onClick}
            >
              {item.icon}
              {item.label}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export function MenuShell({ children, top }: { children: ReactNode; top?: number }) {
  return (
    <div style={{ position: "relative" }}>
      <div className="peg-menu" style={{ position: "absolute", top: top ?? 0, left: 0 }}>
        {children}
      </div>
    </div>
  );
}

export type ButtonWithMenuProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  items: (MenuItem | { type: "separator" })[];
  open?: boolean;
  menuTop?: number;
};

export function ButtonWithMenu({ items, open = false, className = "", ...rest }: ButtonWithMenuProps) {
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} {...rest} />
      {open && <Menu items={items} />}
    </div>
  );
}
