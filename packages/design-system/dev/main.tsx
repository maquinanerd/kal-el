import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/tokens.css";
import "../src/styles.css";

import {
  AccountSwitcher,
  Alert,
  AppLayout,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Content,
  EditorSurface,
  EmptyState,
  IconBell,
  IconBolt,
  IconCalendar,
  IconFile,
  IconHome,
  IconImage,
  IconMore,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTag,
  IconUsers,
  IconWorkflow,
  InlineToolbar,
  Input,
  Inspector,
  InspectorGroup,
  KpiCard,
  Menu,
  Modal,
  PageHead,
  Pagination,
  ProfileCard,
  Rail,
  Radio,
  Search,
  SegmentedControl,
  Select,
  Sidebar,
  Switch,
  Table,
  Tabs,
  Textarea,
  Toast,
  Topbar,
  Workspace,
  type Column,
} from "../src/index.js";

type ArticleRow = {
  id: string;
  title: string;
  status: "published" | "draft" | "in_review" | "scheduled";
  author: string;
  category: string;
  updated: string;
};

const articles: ArticleRow[] = [
  { id: "a1", title: "Gladiador II chega aos cinemas com recorde de bilheteria", status: "published", author: "Ana Souza", category: "Filmes", updated: "há 12 min" },
  { id: "a2", title: "Análise: o retorno de Ridley Scott à arena", status: "in_review", author: "Bruno Lima", category: "Crítica", updated: "há 34 min" },
  { id: "a3", title: "Lista: os 10 melhores filmes históricos da década", status: "draft", author: "Carla Mendes", category: "Lista", updated: "há 1 h" },
  { id: "a4", title: "Vídeo: bastidores da produção em Malta", status: "scheduled", author: "Diego Rocha", category: "Vídeo", updated: "há 2 h" },
  { id: "a5", title: "Podcast: o impacto do épico no cinema moderno", status: "draft", author: "Ana Souza", category: "Áudio", updated: "há 3 h" },
];

const statusTone = { published: "success", draft: "neutral", in_review: "warning", scheduled: "info" } as const;

function ArticleTable() {
  const columns: Column<ArticleRow>[] = [
    {
      key: "title",
      header: "Artigo",
      render: (r) => (
        <span className="peg-cell">
          <span className="peg-avatar">{r.author.slice(0, 1)}</span>
          <span>
            <span className="peg-cell__primary" style={{ display: "block" }}>
              {r.title}
            </span>
            <span className="peg-cell__secondary">{r.author}</span>
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={statusTone[r.status]} dot>{r.status}</Badge>,
    },
    { key: "category", header: "Categoria", render: (r) => r.category, muted: true },
    { key: "updated", header: "Atualizado", render: (r) => r.updated, muted: true },
    {
      key: "actions",
      header: "",
      align: "right",
      render: () => (
        <Button variant="tertiary" size="sm" iconOnly aria-label="Ações">
          <IconMore />
        </Button>
      ),
    },
  ];
  return <Table columns={columns} rows={articles} />;
}

function Lab() {
  const params = new URLSearchParams(location.search);
  const initialTheme = params.get("theme") === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [tab, setTab] = useState("todos");
  const [view, setView] = useState("grid");
  const menuOpen = true;
  const switcherOpen = true;
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [sw, setSw] = useState(true);
  const [radio, setRadio] = useState("b");
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="peg-body">
      <AppLayout>
        <Sidebar
          brand="Kal El"
          groups={[
            {
              items: [{ id: "dash", label: "Dashboard", icon: <IconHome />, active: true }],
            },
            {
              label: "Conteúdo",
              items: [
                { id: "artigos", label: "Artigos", icon: <IconFile />, badge: <Badge tone="accent">12</Badge> },
                { id: "paginas", label: "Páginas", icon: <IconFile /> },
                { id: "categorias", label: "Categorias", icon: <IconTag /> },
                { id: "tags", label: "Tags", icon: <IconTag /> },
              ],
            },
            {
              label: "Operação",
              items: [
                { id: "midia", label: "Mídia", icon: <IconImage /> },
                { id: "calendario", label: "Calendário editorial", icon: <IconCalendar /> },
                { id: "workflow", label: "Workflow", icon: <IconWorkflow /> },
                { id: "automacao", label: "Automação / IA", icon: <IconBolt /> },
                { id: "usuarios", label: "Usuários", icon: <IconUsers /> },
              ],
            },
            {
              label: "Sistema",
              items: [{ id: "settings", label: "Settings", icon: <IconSettings /> }],
            },
          ]}
          footer={
            <ProfileCard
              name="Pablo Eduardo"
              meta="pablo@kalel.app"
              actions={
                <Button variant="tertiary" size="sm" iconOnly aria-label="Menu da conta">
                  <IconMore />
                </Button>
              }
            />
          }
        />

        <Rail
          brand="KE"
          items={[
            { id: "dash", label: "Dashboard", icon: <IconHome />, active: true },
            { id: "artigos", label: "Artigos", icon: <IconFile /> },
            { id: "midia", label: "Mídia", icon: <IconImage /> },
            { id: "calendario", label: "Calendário", icon: <IconCalendar /> },
            { id: "settings", label: "Settings", icon: <IconSettings /> },
          ]}
        />

        <Workspace>
          <Topbar
            left={<Breadcrumb items={[{ label: "Conteúdo" }, { label: "Artigos", current: true }]} />}
            center={<Search placeholder="Buscar artigos…" aria-label="Buscar" />}
            right={
              <>
                <Button variant="tertiary" size="sm" iconOnly aria-label="Notificações">
                  <IconBell />
                </Button>
                <Button variant="secondary" size="sm">Nova página</Button>
                <Button variant="primary" size="sm" icon={<IconPlus />}>Novo artigo</Button>
              </>
            }
          />

          <Content>
            <PageHead
              title="Artigos"
              description="Gerencie as matérias do portal e o fluxo editorial."
              actions={<Button variant="secondary" icon={<IconPlus />}>Filtrar</Button>}
            />

            <div className="peg-row" style={{ justifyContent: "space-between" }}>
              <Tabs
                tabs={[
                  { id: "todos", label: "Todos", count: 120 },
                  { id: "draft", label: "Draft", count: 8 },
                  { id: "revisao", label: "Em revisão", count: 3 },
                  { id: "agendados", label: "Agendados", count: 2 },
                  { id: "publicados", label: "Publicados", count: 107 },
                ]}
                active={tab}
                onChange={setTab}
              />
              <SegmentedControl
                options={[
                  { value: "grid", label: "Grade" },
                  { value: "lista", label: "Lista" },
                ]}
                value={view}
                onChange={setView}
              />
            </div>

            <div className="peg-grid-kpis">
              <KpiCard label="Publicados hoje" value="24" delta="+12% vs ontem" />
              <KpiCard label="Em revisão" value="3" delta="-2 vs semana" deltaUp={false} />
              <KpiCard label="Tempo médio de edição" value="38 min" delta="+4% vs mês" deltaUp={false} />
              <KpiCard label="Páginas vistas / artigo" value="12,4 mil" delta="+8% vs mês" />
            </div>

            <Card title="Artigos recentes" description="Últimos 5 itens atualizados" actions={<Button variant="tertiary" size="sm">Ver todos</Button>} bodyClassName="" >
              <ArticleTable />
              <Pagination page={page} total={120} perPage={25} onChange={setPage} />
            </Card>

            <Card title="Formulários" description="Controles de formulário com estados">
              <div className="peg-stack">
                <div className="peg-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ width: 220 }}>
                    <Input label="Título" placeholder="Texto de exemplo" hint="Dica opcional" />
                  </div>
                  <div style={{ width: 220 }}>
                    <Input label="Com erro" defaultValue="valor" error="Campo inválido" />
                  </div>
                  <div style={{ width: 200 }}>
                    <Select label="Categoria" optional>
                      <option>Filmes</option>
                      <option>Crítica</option>
                      <option>Lista</option>
                    </Select>
                  </div>
                  <div style={{ width: 220 }}>
                    <Textarea label="Resumo" rows={2} />
                  </div>
                </div>
                <div className="peg-row">
                  <Checkbox label="Notificar editores" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <Radio label="Público" name="pub" checked={radio === "a"} onChange={() => setRadio("a")} />
                  <Radio label="Privado" name="pub" checked={radio === "b"} onChange={() => setRadio("b")} />
                  <Switch label="Indexação" checked={sw} onChange={(e) => setSw(e.target.checked)} />
                  <Switch label="Desabilitado" disabled />
                </div>
                <div className="peg-row" style={{ flexWrap: "wrap" }}>
                  <Button variant="primary">Salvar</Button>
                  <Button variant="secondary">Cancelar</Button>
                  <Button variant="tertiary">Descartar</Button>
                  <Button variant="destructive">Excluir</Button>
                  <Button variant="secondary" size="sm">Pequeno</Button>
                  <Button variant="secondary" size="lg">Grande</Button>
                  <Button variant="secondary" disabled>Desabilitado</Button>
                  <Button variant="primary" iconOnly aria-label="Adicionar">
                    <IconPlus />
                  </Button>
                </div>
              </div>
            </Card>

            <Card title="Menus e overlays">
              <div className="peg-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ position: "relative", paddingTop: 8 }}>
                  {menuOpen && (
                    <Menu
                      items={[
                        { label: "Duplicar artigo", icon: <IconFile /> },
                        { label: "Agendar publicação", icon: <IconCalendar /> },
                        { type: "separator" },
                        { label: "Arquivar", icon: <IconBolt /> },
                        { label: "Excluir", icon: <IconWorkflow />, danger: true },
                      ]}
                    />
                  )}
                </div>
                <div style={{ position: "relative" }}>
                  {switcherOpen && (
                    <AccountSwitcher
                      activeId="s1"
                      accounts={[
                        { id: "s1", name: "Kal El", meta: "CMS editorial" },
                        { id: "s2", name: "Commerce Wayne", meta: "CRM / Commerce" },
                      ]}
                      footer={
                        <div className="peg-menu__item">
                          <IconSettings /> Configurações
                        </div>
                      }
                    />
                  )}
                </div>
                <Button variant="secondary" onClick={() => setModalOpen(true)}>
                  Abrir modal
                </Button>
              </div>
            </Card>

            <Card title="Editor" description="Superfície de escrita + toolbar inline + inspector">
              <div className="peg-main" style={{ border: "1px solid var(--peg-border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ flex: 1, minWidth: 0, padding: "var(--peg-space-4)", background: "var(--peg-canvas)" }}>
                  <EditorSurface title="Gladiador II chega aos cinemas" />
                  <InlineToolbar open anchor="center" />
                </div>
                <Inspector>
                  <InspectorGroup
                    title="Status e publicação"
                    actions={<Badge tone="warning" dot>Em revisão</Badge>}
                  >
                    <Input label="Slug" defaultValue="gladiador-ii-cinemas" />
                    <Select label="Autor">
                      <option>Ana Souza</option>
                      <option>Bruno Lima</option>
                    </Select>
                    <Select label="Categoria">
                      <option>Filmes</option>
                      <option>Crítica</option>
                    </Select>
                    <div className="peg-row" style={{ justifyContent: "space-between" }}>
                      <Switch label="Robots index" checked={sw} onChange={(e) => setSw(e.target.checked)} />
                      <Badge tone="neutral">SEO</Badge>
                    </div>
                  </InspectorGroup>
                  <InspectorGroup title="SEO" actions={<IconSearch />}>
                    <Input label="SEO title" placeholder="Título otimizado (até 160)" />
                    <Textarea label="Meta description" rows={2} />
                  </InspectorGroup>
                  <InspectorGroup title="Revisões">
                    <div className="peg-row" style={{ justifyContent: "space-between" }}>
                      <span>r4 · há 12 min</span>
                      <Badge tone="info">Atual</Badge>
                    </div>
                    <div className="peg-row" style={{ justifyContent: "space-between" }}>
                      <span>r3 · há 1 h</span>
                    </div>
                  </InspectorGroup>
                </Inspector>
              </div>
            </Card>

            <Card title="Feedback">
              <div className="peg-stack">
                <Alert tone="success">Alterações salvas com sucesso.</Alert>
                <Alert tone="warning" title="Revisão pendente">Este artigo aguarda aprovação do editor-chefe.</Alert>
                <div style={{ position: "relative", minHeight: 90 }}>
                  <Toast>Artigo publicado e revalidado.</Toast>
                </div>
              </div>
            </Card>

            <Card title="Empty state">
              <EmptyState
                title="Nenhum artigo encontrado"
                body="Ajuste os filtros ou crie um novo artigo para começar."
                action={<Button variant="primary" icon={<IconPlus />}>Novo artigo</Button>}
              />
            </Card>
          </Content>
        </Workspace>
      </AppLayout>

      <div className="peg-row" style={{ position: "fixed", bottom: 12, left: 12, zIndex: 70 }}>
        <Button variant="secondary" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          Tema: {theme}
        </Button>
      </div>

      {modalOpen && (
        <Modal
          title="Publicar artigo"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button variant="primary">Publicar agora</Button>
            </>
          }
        >
          <Alert tone="info">A publicação dispara revalidação nas frentes conectadas.</Alert>
          <Input label="Nota de revisão" placeholder="Opcional" />
          <div className="peg-row">
            <Checkbox label="Agendar para mais tarde" />
            <Switch label="Notificar assinantes" checked={sw} onChange={(e) => setSw(e.target.checked)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
