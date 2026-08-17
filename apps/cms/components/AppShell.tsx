"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  AppLayout,
  Button,
  Content,
  IconFile,
  IconHome,
  IconImage,
  IconMore,
  IconSettings,
  IconTag,
  IconUsers,
  IconWorkflow,
  Sidebar,
  Topbar,
  Workspace,
  type NavItemDef,
} from "@kal-el/design-system";

import { useAuth } from "../lib/auth";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, sites, activeSiteId, setActiveSite, signOut } = useAuth();

  const navGroups: { label?: string; items: NavItemDef[] }[] = [
    {
      label: "Editorial",
      items: [
        { id: "home", label: "Início", icon: <IconHome />, onClick: () => router.push("/") },
        { id: "articles", label: "Artigos", icon: <IconFile />, active: true, onClick: () => router.push("/articles") },
        { id: "media", label: "Mídia", icon: <IconImage /> },
        { id: "calendar", label: "Calendário", icon: <IconWorkflow /> },
      ],
    },
    {
      label: "Organização",
      items: [
        { id: "categories", label: "Categorias", icon: <IconTag /> },
        { id: "users", label: "Usuários", icon: <IconUsers /> },
        { id: "settings", label: "Configurações", icon: <IconSettings /> },
      ],
    },
  ];

  const signOutAndGo = () => void signOut().then(() => router.replace("/login"));

  return (
    <AppLayout>
      <Sidebar
        brand="Kal El"
        groups={navGroups}
        footer={
          <button type="button" className="peg-nav-item" onClick={signOutAndGo}>
            <IconMore />
            <span>{user?.name ?? "Conta"}</span>
          </button>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Topbar
          left={
            <select
              className="peg-select"
              style={{ minWidth: 180 }}
              value={activeSiteId ?? ""}
              onChange={(e) => setActiveSite(e.target.value)}
              aria-label="Selecionar site"
            >
              {sites.length === 0 && <option value="">Sem sites</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          }
          right={
            <Button size="sm" variant="secondary" onClick={signOutAndGo}>
              Sair
            </Button>
          }
        />
        <Workspace>
          <Content>{children}</Content>
        </Workspace>
      </div>
    </AppLayout>
  );
}
