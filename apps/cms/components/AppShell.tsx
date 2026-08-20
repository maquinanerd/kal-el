"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AppLayout,
  Breadcrumb,
  Button,
  Content,
  IconBolt,
  IconCalendar,
  IconFile,
  IconHome,
  IconImage,
  IconMore,
  IconSettings,
  IconSignOut,
  IconTag,
  IconUsers,
  IconWorkflow,
  MenuButton,
  Sidebar,
  Topbar,
  Workspace,
  type NavItemDef,
} from "@kal-el/design-system";

import { BrandLogo } from "./BrandLogo";
import { useAuth } from "../lib/auth";
import { ShellStatus, useChrome, type Crumb } from "../lib/chrome";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Fallback trail for a page that has not published its own. Derived from the path so a
 * screen is never breadcrumb-less, which is what makes the topbar slot stable.
 */
const SECTION_LABELS: Record<string, string> = {
  articles: "Artigos",
  media: "Mídia",
  workflow: "Workflow",
  calendar: "Calendário",
  categories: "Categorias",
  tags: "Tags",
  entities: "Entidades",
  authors: "Autores",
  sources: "Fontes",
  sites: "Sites",
  users: "Usuários",
  roles: "Papéis",
  tokens: "Service tokens",
  webhooks: "Webhooks",
  audit: "Audit log",
  settings: "Configurações",
};

const ADMIN_SECTIONS = new Set(["sites", "users", "roles", "tokens", "webhooks", "audit", "settings"]);

function fallbackCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const head = segments[0];
  if (!head) return [{ label: "Dashboard" }];
  const label = SECTION_LABELS[head] ?? head;
  const trail: Crumb[] = [];
  if (ADMIN_SECTIONS.has(head)) trail.push({ label: "Administração" });
  trail.push(segments.length > 1 ? { label, href: `/${head}` } : { label });
  return trail;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, sites, activeSiteId, setActiveSite, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const chrome = useChrome();
  const crumbs = (chrome.breadcrumb.length > 0 ? chrome.breadcrumb : fallbackCrumbs(pathname)).map((c, i, all) => ({
    ...c,
    current: i === all.length - 1,
    onNavigate: c.href ? () => router.push(c.href as string) : undefined,
  }));

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
        { id: "webhooks", label: "Webhooks", icon: <IconWorkflow />, active: is("/webhooks"), onClick: () => router.push("/webhooks") },
        { id: "audit", label: "Audit log", icon: <IconMore />, active: is("/audit"), onClick: () => router.push("/audit") },
        { id: "settings", label: "Configurações", icon: <IconSettings />, active: is("/settings"), onClick: () => router.push("/settings") },
      ],
    },
  ];

  const signOutAndGo = () => void signOut().then(() => router.replace("/login"));

  return (
    <AppLayout>
      <Sidebar
        brand={<BrandLogo />}
        groups={navGroups}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        /*
         * Identity and sign-out, separated.
         *
         * This was a single `peg-nav-item` button labelled with the user's name whose
         * action was logout. On desktop the topbar carries an explicit "Sair" so nobody
         * ever pressed it; at 390px the drawer footer is the only account surface, and
         * tapping "Owner" — the row that reads as "my profile" — ended the session with
         * no warning and no label saying it would. The product review lost its session to
         * it mid-sweep.
         *
         * The identity row is now text, not a control. Signing out is a labelled action
         * with its own icon. No confirmation: logout is reversible and destroys nothing,
         * so a modal would only add a step.
         */
        footer={
          <div className="peg-account">
            <div className="peg-account__identity">
              <span className="peg-account__avatar" aria-hidden="true">
                {(user?.name ?? "?").trim().charAt(0)}
              </span>
              <span className="peg-account__text">
                <span className="peg-account__name">{user?.name ?? "Conta"}</span>
                {user?.email && <span className="peg-account__email">{user.email}</span>}
              </span>
            </div>
            <button type="button" className="peg-account__signout" onClick={signOutAndGo}>
              <IconSignOut />
              <span>Sair</span>
            </button>
          </div>
        }
      />
      {/* minHeight:0 is load-bearing — see the shell scroll note in the design system.
          Without it this column refuses to shrink below its content and the workspace
          scroll container below never receives a bounded height. */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <Topbar
          left={
            <>
              <MenuButton onClick={() => setNavOpen(true)} expanded={navOpen} />
              {/* PEG topbar: breadcrumb on the left, so every screen says where it is */}
              <Breadcrumb items={crumbs} />
            </>
          }
          right={
            <>
              {/* Fixed-height slot. The autosave indicator lives HERE, not under the
                  article H1 where it grew and collapsed the page on every cycle. */}
              <div className="peg-topbar__status">
                <ShellStatus />
              </div>
              <select
                className="peg-select peg-topbar__site"
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
