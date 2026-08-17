"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppShell } from "../../components/AppShell";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div style={{ padding: 32, font: "var(--peg-font-body)" }}>Carregando…</div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
