"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox } from "@kal-el/design-system";
import { useAuth } from "../../lib/auth";
import "./login.css";

const REMEMBERED_EMAIL_KEY = "kal-el.login.email";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetHint, setShowResetHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
      if (remember) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      router.replace("/articles");
    } catch {
      // error surfaced by the auth context
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="peg-login">
      <div className="peg-login__hero" aria-hidden="true" />

      <section className="peg-login__panel">
        <div className="peg-login__content">
          <header>
            <p className="peg-login__brand peg-wordmark">cms Kal-el</p>
            <p className="peg-login__tagline">Content Management System</p>
          </header>

          <div>
            <h1 className="peg-login__title">Bem-vindo de volta</h1>
            <p className="peg-login__subtitle">Entre para continuar no seu painel.</p>
          </div>

          <form className="peg-login__form" onSubmit={onSubmit}>
            <div className="peg-field peg-login__field">
              <label className="peg-field__label" htmlFor="login-email">
                E-mail
              </label>
              <div className="peg-login__control">
                <span className="peg-login__icon" aria-hidden="true">
                  <IconPerson />
                </span>
                <input
                  id="login-email"
                  className="peg-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@kalel.dev"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="peg-field peg-login__field">
              <label className="peg-field__label" htmlFor="login-password">
                Senha
              </label>
              <div className="peg-login__control peg-login__control--password">
                <span className="peg-login__icon" aria-hidden="true">
                  <IconLock />
                </span>
                <input
                  id="login-password"
                  className="peg-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="peg-login__reveal"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div className="peg-login__options">
              <Checkbox
                label="Lembrar meu e-mail"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <button
                type="button"
                className="peg-login__link"
                onClick={() => setShowResetHint((v) => !v)}
                aria-expanded={showResetHint}
              >
                Esqueceu a senha?
              </button>
            </div>

            {showResetHint && (
              <p className="peg-login__subtitle">
                A redefinição de senha é feita pelo administrador do site, em Usuários.
              </p>
            )}

            {error && (
              <p className="peg-login__error" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" className="peg-login__submit" disabled={submitting}>
              {submitting ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <p className="peg-login__footer">Acesso restrito à equipe editorial do Kal El.</p>
        </div>
      </section>
    </main>
  );
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconPerson() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="10" cy="7" r="3.25" />
      <path d="M4 16.5c0-2.6 2.7-4.25 6-4.25s6 1.65 6 4.25" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <rect x="4.25" y="8.5" width="11.5" height="8" rx="2" />
      <path d="M7 8.5V6.25a3 3 0 0 1 6 0V8.5" />
      <path d="M10 11.75v1.75" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M1.75 10S4.75 4.75 10 4.75 18.25 10 18.25 10 15.25 15.25 10 15.25 1.75 10 1.75 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M8.2 5c.58-.16 1.18-.25 1.8-.25 5.25 0 8.25 5.25 8.25 5.25a15 15 0 0 1-2.5 3.1" />
      <path d="M13.9 13.9A7.7 7.7 0 0 1 10 15.25C4.75 15.25 1.75 10 1.75 10a15 15 0 0 1 3.6-4" />
      <path d="M8.2 8.2a2.5 2.5 0 0 0 3.5 3.5" />
      <path d="m3 3 14 14" />
    </svg>
  );
}
