"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, EmptyState, PageHead, Table, type BadgeTone, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, articleAction, listArticles, type ArticleStatus, type ArticleSummary } from "../../../lib/api";

const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", in_review: "info", scheduled: "warning", published: "success", blocked: "danger", archived: "neutral" };

const TABS: { id: ArticleStatus; label: string }[] = [
  { id: "in_review", label: "Em revisão" },
  { id: "draft", label: "Rascunhos" },
  { id: "scheduled", label: "Agendados" },
  { id: "published", label: "Publicados" },
  { id: "blocked", label: "Bloqueados" },
  { id: "archived", label: "Arquivados" },
];

const ACTIONS: Record<ArticleStatus, { key: string; label: string; variant: "primary" | "secondary" | "destructive" }[]> = {
  draft: [
    { key: "submit", label: "Enviar p/ revisão", variant: "primary" },
    { key: "publish", label: "Publicar", variant: "secondary" },
    { key: "schedule", label: "Agendar", variant: "secondary" },
    { key: "archive", label: "Arquivar", variant: "secondary" },
  ],
  in_review: [
    { key: "approve", label: "Aprovar", variant: "primary" },
    { key: "reject", label: "Rejeitar", variant: "destructive" },
    { key: "publish", label: "Publicar", variant: "secondary" },
    { key: "schedule", label: "Agendar", variant: "secondary" },
  ],
  scheduled: [
    { key: "publish", label: "Publicar agora", variant: "primary" },
    { key: "unpublish", label: "Voltar p/ rascunho", variant: "secondary" },
  ],
  published: [{ key: "unpublish", label: "Despublicar", variant: "destructive" }],
  blocked: [
    { key: "submit", label: "Reenviar", variant: "primary" },
    { key: "archive", label: "Arquivar", variant: "secondary" },
  ],
  archived: [],
};

export default function WorkflowPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [active, setActive] = useState<ArticleStatus>("in_review");
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (siteId: string, status: ArticleStatus) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listArticles(siteId, { status });
      setItems(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId, active);
    else setItems([]);
  }, [activeSiteId, active, load]);

  async function act(articleId: string, action: string) {
    if (!activeSiteId) return;
    setError(null);
    try {
      await articleAction(activeSiteId, articleId, action);
      await load(activeSiteId, active);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para esta ação" : err.message) : "Falha na ação");
    }
  }

  const columns: Column<ArticleSummary>[] = [
    {
      key: "title",
      header: "Título",
      render: (a) => (
        <button type="button" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => router.push(`/articles/${a.id}`)}>
          {a.title}
        </button>
      ),
    },
    { key: "status", header: "Status", render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
    {
      key: "actions",
      header: "Ações",
      render: (a) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ACTIONS[a.status].map((action) => (
            <Button key={action.key} size="xs" variant={action.variant} onClick={() => void act(a.id, action.key)}>
              {action.label}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHead title="Workflow" description="Fila editorial por estado." />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <Button key={t.id} size="sm" variant={active === t.id ? "primary" : "secondary"} onClick={() => setActive(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site" />
      ) : items.length === 0 ? (
        <EmptyState title="Nada aqui" body={`Nenhum artigo em "${TABS.find((t) => t.id === active)?.label}".`} />
      ) : (
        <Table columns={columns} rows={items} selectable={false} />
      )}
    </>
  );
}
