import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  muted?: boolean;
};

/**
 * `selectable` defaults to false: the checkboxes are not wired to any bulk action, and
 * rendering them put N+1 focusable, non-functional controls into the tab order of every
 * list in the product. Opt in only where a bulk action actually exists.
 */
export function Table<T extends { id: string }>({
  columns,
  rows,
  selectable = false,
  caption,
  rowLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  selectable?: boolean;
  caption?: string;
  rowLabel?: (row: T) => string;
}) {
  return (
    <div className="peg-table-wrap">
      <table className="peg-table" aria-label={caption}>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" style={{ width: 40 }}>
                <label className="peg-checkbox">
                  <input type="checkbox" aria-label="Selecionar tudo" />
                  <span className="peg-checkbox__box" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  </span>
                </label>
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.align === "right" ? { textAlign: "right" } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {selectable && (
                <td>
                  <label className="peg-checkbox">
                    <input type="checkbox" aria-label={`Selecionar ${rowLabel ? rowLabel(row) : row.id}`} />
                    <span className="peg-checkbox__box" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    </span>
                  </label>
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={c.muted ? "peg-table__muted" : undefined} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  total,
  perPage,
  onChange,
}: {
  page: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="peg-pagination">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="peg-pagination__controls">
        <button className="peg-pagebtn" aria-label="Anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <IconChevronLeft />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} className={`peg-pagebtn ${p === page ? "peg-pagebtn--active" : ""}`} onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
        <button className="peg-pagebtn" aria-label="Próxima" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}
