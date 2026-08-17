"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (siteId: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listArticles(siteId);
      setArticles(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar artigos");
    } finally {
      setLoading(false);
    }
  }, []);

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
        <Table columns={columns} rows={articles} />
      )}
    </>
  );
}
