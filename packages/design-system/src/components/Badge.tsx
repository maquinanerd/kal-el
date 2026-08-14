import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export function Badge({ tone = "neutral", dot = false, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`peg-badge peg-badge--${tone}`}>
      {dot && <span className="peg-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
