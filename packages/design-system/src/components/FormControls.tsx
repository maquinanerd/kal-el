import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { IconCheck, IconSearch } from "../icons.js";

export type FieldShellProps = {
  label?: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children?: ReactNode;
};

export function FieldShell({ label, optional, hint, error, children }: FieldShellProps) {
  return (
    <label className="peg-field">
      {label && (
        <span className="peg-field__label">
          {label}
          {optional && <span className="peg-field__optional">opcional</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="peg-field__error">{error}</span>
      ) : hint ? (
        <span className="peg-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldShellProps;

export function Input({ label, optional, hint, error, className = "", id, ...rest }: InputProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <input
        id={id}
        className={`peg-input ${error ? "peg-input--error" : ""} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShellProps;

export function Textarea({ label, optional, hint, error, className = "", ...rest }: TextareaProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <textarea className={`peg-textarea ${error ? "peg-textarea--error" : ""} ${className}`} {...rest} />
    </FieldShell>
  );
}

export type SearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { placeholder?: string };

export function Search({ className = "", ...rest }: SearchProps) {
  return (
    <div className="peg-search">
      <IconSearch className="peg-search__icon" />
      <input type="search" className={`peg-input peg-search__input ${className}`} {...rest} />
    </div>
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldShellProps;

export function Select({ label, optional, hint, error, className = "", children, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <select className={`peg-select ${className}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Checkbox({ label, className = "", ...rest }: CheckboxProps) {
  return (
    <label className={`peg-checkbox ${className}`}>
      <input type="checkbox" {...rest} />
      <span className="peg-checkbox__box" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export type RadioProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Radio({ label, className = "", ...rest }: RadioProps) {
  return (
    <label className={`peg-radio ${className}`}>
      <input type="radio" {...rest} />
      <span className="peg-radio__dot" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

export type SwitchProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Switch({ label, className = "", ...rest }: SwitchProps) {
  return (
    <label className={`peg-switch ${className}`}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="peg-switch__track" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}
