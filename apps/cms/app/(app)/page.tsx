"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, IconPlus, KpiCard, PageHead, type BadgeTone } from "@kal-el/design-system";
import { useAuth } from "../../lib/auth";
import { ApiError, createArticle, listArticles, stats, type ArticleSummary, type SiteStats } from "../../lib/api";
import { OperationalStatus } from "../../components/OperationalStatus";

const STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", in_review: "info", scheduled: "warning", published: "success", blocked: "danger", archived: "neutral" };

export default function DashboardPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [data, setData] = useState<SiteStats | null>(null);
  const [recent, setRecent] = useState<ArticleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeSiteId) return;
    stats(activeSiteId)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar"));
    listArticles(activeSiteId)
      .then((p) => setRecent(p.items.slice(0, 5)))
      .catch(() => {});
  }, [activeSiteId]);

  async function newArticle() {
    if (!activeSiteId) return;
    setCreating(true);
    try {
      const a = await createArticle(activeSiteId, { title: "Novo artigo" });
      router.push(`/articles/${a.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHead
        title="Dashboard"
        description="Visão geral do site selecionado."
        actions={<Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating || !activeSiteId}>{creating ? "Criando…" : "Novo artigo"}</Button>}
      />

      {error && <p className="peg-field__error">{error}</p>}

      {!activeSiteId ? (
        <EmptyState title="Nenhum site" body="Selecione ou crie um site para começar." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            <KpiCard label="Artigos" value={String(data?.articles.total ?? 0)} />
            <KpiCard label="Publicados" value={String(data?.articles.byStatus.published ?? 0)} />
            <KpiCard label="Em revisão" value={String(data?.articles.byStatus.in_review ?? 0)} />
            <KpiCard label="Agendados" value={String(data?.articles.byStatus.scheduled ?? 0)} />
            <KpiCard label="Mídia" value={String(data?.media ?? 0)} />
            <KpiCard label="Categorias" value={String(data?.categories ?? 0)} />
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">Artigos recentes</h3></div>
            <div className="peg-card__body">
              {recent.length === 0 ? (
                <p className="peg-table__muted">Nenhum artigo ainda.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {recent.map((a) => (
                    <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <button type="button" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", textAlign: "left" }} onClick={() => router.push(`/articles/${a.id}`)}>
                        {a.title}
                      </button>
                      <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Renders nothing for a role without audit.read: an editorial user should see
              the editorial dashboard, not a broken platform panel. */}
          <OperationalStatus siteId={activeSiteId} />
        </>
      )}
    </>
  );
}
