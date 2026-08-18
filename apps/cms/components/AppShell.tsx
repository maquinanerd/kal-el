"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AppLayout,
  Button,
  Content,
  IconBolt,
  IconCalendar,
  IconFile,
  IconHome,
  IconImage,
  IconMore,
  IconSettings,
  IconTag,
  IconUsers,
  IconWorkflow,
  MenuButton,
  Sidebar,
  Topbar,
  Workspace,
  type NavItemDef,
} from "@kal-el/design-system";

import { useAuth } from "../lib/auth";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, sites, activeSiteId, setActiveSite, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  // navigating from inside the drawer must close it, otherwise the scrim covers the page
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const is = (path: string) => pathname.startsWith(path);

  const navGroups: { label?: string; items: NavItemDef[] }[] = [
    {
      label: "Editorial",
      items: [
        { id: "home", label: "Dashboard", icon: <IconHome />, active: pathname === "/", onClick: () => router.push("/") },
        { id: "articles", label: "Artigos", icon: <IconFile />, active: is("/articles"), onClick: () => router.push("/articles") },
        { id: "media", label: "Mídia", icon: <IconImage />, active: is("/media"), onClick: () => router.push("/media") },
        { id: "workflow", label: "Workflow", icon: <IconWorkflow />, active: is("/workflow"), onClick: () => router.push("/workflow") },
        { id: "calendar", label: "Calendário", icon: <IconCalendar />, active: is("/calendar"), onClick: () => router.push("/calendar") },
      ],
    },
    {
      label: "Taxonomia",
      items: [
        { id: "categories", label: "Categorias", icon: <IconTag />, active: is("/categories"), onClick: () => router.push("/categories") },
        { id: "tags", label: "Tags", icon: <IconTag />, active: is("/tags"), onClick: () => router.push("/tags") },
        { id: "entities", label: "Entidades", icon: <IconBolt />, active: is("/entities"), onClick: () => router.push("/entities") },
        { id: "authors", label: "Autores", icon: <IconUsers />, active: is("/authors"), onClick: () => router.push("/authors") },
        { id: "sources", label: "Fontes", icon: <IconWorkflow />, active: is("/sources"), onClick: () => router.push("/sources") },
      ],
    },
    {
      label: "Administração",
      items: [
        { id: "sites", label: "Sites", icon: <IconHome />, active: is("/sites"), onClick: () => router.push("/sites") },
        { id: "users", label: "Usuários", icon: <IconUsers />, active: is("/users"), onClick: () => router.push("/users") },
        { id: "roles", label: "Papéis", icon: <IconUsers />, active: is("/roles"), onClick: () => router.push("/roles") },
        { id: "tokens", label: "Service tokens", icon: <IconBolt />, active: is("/tokens"), onClick: () => router.push("/tokens") },
        { id: "audit", label: "Audit log", icon: <IconMore />, active: is("/audit"), onClick: () => router.push("/audit") },
        { id: "settings", label: "Configurações", icon: <IconSettings />, active: is("/settings"), onClick: () => router.push("/settings") },
      ],
    },
  ];

  const signOutAndGo = () => void signOut().then(() => router.replace("/login"));

  return (
    <AppLayout>
      <Sidebar
        brand="Kal El"
        groups={navGroups}
        open={navOpen}
        onClose={() => setNavOpen(false)}
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
            <>
              <MenuButton onClick={() => setNavOpen(true)} expanded={navOpen} />
              <select
                className="peg-select"
                style={{ minWidth: 140, maxWidth: 220 }}
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
            </>
          }
          right={
            <>
              <ThemeToggle />
              <Button size="sm" variant="secondary" onClick={signOutAndGo}>
                Sair
              </Button>
            </>
          }
        />
        <Workspace>
          <a className="peg-skip-link" href="#conteudo">
            Pular para o conteúdo
          </a>
          <Content>
            <div id="conteudo" tabIndex={-1}>
              {children}
            </div>
          </Content>
        </Workspace>
      </div>
    </AppLayout>
  );
}
