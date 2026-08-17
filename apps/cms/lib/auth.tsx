"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, listMySites, login as apiLogin, logout as apiLogout, me as apiMe, type MeUser, type SiteInfo } from "./api";

type AuthContextValue = {
  user: MeUser | null;
  sites: SiteInfo[];
  activeSiteId: string | null;
  loading: boolean;
  error: string | null;
  setActiveSite: (id: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [meRes, sitesRes] = await Promise.all([apiMe(), listMySites()]);
      setUser(meRes.user);
      setSites(sitesRes);
      setActiveSiteId((prev) => prev ?? sitesRes[0]?.id ?? null);
      setError(null);
    } catch {
      setUser(null);
      setSites([]);
      setActiveSiteId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        await apiLogin(email, password);
        await refresh();
      } catch (err) {
        const message = err instanceof ApiError && err.status === 401 ? "Credenciais inválidas" : "Falha ao entrar";
        setError(message);
        throw err;
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setSites([]);
      setActiveSiteId(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, sites, activeSiteId, loading, error, setActiveSite: setActiveSiteId, signIn, signOut }),
    [user, sites, activeSiteId, loading, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
