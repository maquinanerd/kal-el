"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, EmptyState, PageHead, Table, type BadgeTone, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, articleAction, getArticle, listArticles, type ArticleStatus, type ArticleSummary } from "../../../lib/api";

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
    { key: "archive", label: "Arquivar", variant: "secondary" },
  ],
  in_review: [
    { key: "approve", label: "Aprovar", variant: "primary" },
    { key: "reject", label: "Rejeitar", variant: "destructive" },
    { key: "publish", label: "Publicar", variant: "secondary" },
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

const PAGE_SIZE = 50;

export default function WorkflowPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [active, setActive] = useState<ArticleStatus>("in_review");
  const [items, setItems] = useState<ArticleSummary[]>([]);
  // the API pages at 25 by default and this page never asked for more, so a queue with
  // more than 25 articles in review simply ended there - no control, no indication
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // one action at a time: a double click used to fire two POSTs and surface the second
  // as a raw INVALID_TRANSITION in a Portuguese UI
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (siteId: string, status: ArticleStatus) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listArticles(siteId, { status, limit: PAGE_SIZE });
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (!activeSiteId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listArticles(activeSiteId, { status: active, limit: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar mais");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId, active);
    else setItems([]);
  }, [activeSiteId, active, load]);

  async function act(row: ArticleSummary, action: string) {
    if (!activeSiteId || pending) return;
    setError(null);
    setNotice(null);
    setPending(`${row.id}:${action}`);
    try {
      // The idempotency key is scoped to the version the action was issued against, and
      // this list can be arbitrarily stale - another tab, another editor, a queue left
      // open. A stale version means a stale key, and a stale key replays the stored
      // response: 200, no transition, no audit row, and a UI that reports success. The
      // server-side version predicate cannot catch it because the replay happens before
      // the handler runs. So re-read, and act only on what is actually there.
      const fresh = await getArticle(activeSiteId, row.id);
      if (fresh.status !== row.status || fresh.version !== row.version) {
        await load(activeSiteId, active);
        setNotice(`"${row.title}" mudou desde que a fila foi carregada (${row.status} → ${fresh.status}). Nada foi alterado; a fila está atualizada.`);
        return;
      }
      const key = `cms.${row.id}.${action}.v${fresh.version}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
      await articleAction(activeSiteId, row.id, action, key);
      await load(activeSiteId, active);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError("Sem permissão para esta ação");
      else if (err instanceof ApiError && err.status === 409) {
        setError("O artigo mudou durante a ação. A fila foi atualizada.");
        if (activeSiteId) await load(activeSiteId, active);
      } else setError(err instanceof ApiError ? err.message : "Falha na ação");
    } finally {
      setPending(null);
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
            <Button
              key={action.key}
              size="xs"
              variant={action.variant}
              disabled={pending !== null}
              onClick={() => void act(a, action.key)}
            >
              {pending === `${a.id}:${action.key}` ? "…" : action.label}
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
      {notice && <Alert tone="warning">{notice}</Alert>}

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site" />
      ) : items.length === 0 ? (
        <EmptyState title="Nada aqui" body={`Nenhum artigo em "${TABS.find((t) => t.id === active)?.label}".`} />
      ) : (
        <>
          <Table columns={columns} rows={items} selectable={false} />
          {cursor && (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
