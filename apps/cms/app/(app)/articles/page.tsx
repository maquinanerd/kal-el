"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, EmptyState, IconPlus, PageHead, Table, type BadgeTone, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createArticle, listArticles, type ArticleSummary } from "../../../lib/api";

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  in_review: "info",
  scheduled: "warning",
  published: "success",
  blocked: "danger",
  archived: "neutral",
};

export default function ArticlesPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  // the list stopped at the API default of 25 with no control and no indication
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // switching the active site mid-request used to append the other site's articles into
  // this list, and clicking one routed to an id that 404s under the current site
  const generation = useRef(0);

  const load = useCallback(async (siteId: string) => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listArticles(siteId, { limit: 50 });
      if (mine !== generation.current) return;
      setArticles(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err.message : "Falha ao carregar artigos");
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (!activeSiteId || !cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await listArticles(activeSiteId, { limit: 50, cursor });
      if (mine !== generation.current) return;
      setArticles((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err.message : "Falha ao carregar mais");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId);
    else setArticles([]);
  }, [activeSiteId, load]);

  async function newArticle() {
    if (!activeSiteId) return;
    setCreating(true);
    try {
      const article = await createArticle(activeSiteId, { title: "Novo artigo" });
      router.push(`/articles/${article.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar artigo");
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<ArticleSummary>[] = [
    {
      key: "title",
      header: "Título",
      render: (a) => (
        <button type="button" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--peg-accent, #2563eb)" }} onClick={() => router.push(`/articles/${a.id}`)}>
          {a.title}
        </button>
      ),
    },
    { key: "status", header: "Status", render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
    { key: "updated", header: "Atualizado", render: (a) => new Date(a.updatedAt).toLocaleString("pt-BR"), muted: true },
  ];

  return (
    <>
      <PageHead
        title="Artigos"
        description="Lista de artigos do site selecionado."
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating || !activeSiteId}>
            {creating ? "Criando…" : "Novo artigo"}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site disponível" body="Crie um site ou solicite acesso a um administrador." />
      ) : articles.length === 0 ? (
        <EmptyState
          title="Nenhum artigo ainda"
          body="Comece criando o primeiro artigo deste site."
          action={
            <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating}>
              Novo artigo
            </Button>
          }
        />
      ) : (
        <>
          <Table columns={columns} rows={articles} />
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
