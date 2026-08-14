import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  icon,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "peg-btn",
    `peg-btn--${variant}`,
    size !== "md" ? `peg-btn--${size}` : "",
    iconOnly ? "peg-btn--icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {!iconOnly && children}
    </button>
  );
}
