"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@kal-el/design-system";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/articles");
    } catch {
      // error surfaced by the auth context
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        onSubmit={onSubmit}
        className="peg-card"
        style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="peg-sidebar__brand">
          <span className="peg-sidebar__brand-dot">K</span>
          <span>Kal El</span>
        </div>
        <h1 className="peg-page-title">Entrar</h1>
        <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && (
          <span className="peg-field__error" role="alert">
            {error}
          </span>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
