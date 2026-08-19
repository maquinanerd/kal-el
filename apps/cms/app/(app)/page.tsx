"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, EmptyState, IconPlus, PageHead, StatusLabel } from "@kal-el/design-system";
import { useAuth } from "../../lib/auth";
import {
  ApiError,
  createArticle,
  listArticles,
  listAuthors,
  stats,
  type ArticleStatus,
  type ArticleSummary,
  type Author,
  type SiteStats,
} from "../../lib/api";
import { OperationalStatus } from "../../components/OperationalStatus";

/** What the person looking at this row should do next, given where it sits. */
const NEXT_ACTION: Record<ArticleStatus, string> = {
  draft: "Continuar escrevendo",
  in_review: "Revisar",
  scheduled: "Aguardando horário",
  published: "No ar",
  blocked: "Corrigir e reenviar",
  archived: "Arquivado",
};

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function DashboardPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [data, setData] = useState<SiteStats | null>(null);
  const [recent, setRecent] = useState<ArticleSummary[]>([]);
  const [review, setReview] = useState<ArticleSummary[]>([]);
  const [scheduled, setScheduled] = useState<ArticleSummary[]>([]);
  const [blocked, setBlocked] = useState<ArticleSummary[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    stats(activeSiteId)
      .then((s) => !cancelled && setData(s))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Falha ao carregar"));
    listAuthors(activeSiteId)
      .then((a) => !cancelled && setAuthors(a))
      .catch(() => {});
    listArticles(activeSiteId, { limit: 8 })
      .then((p) => !cancelled && setRecent(p.items))
      .catch(() => {});
    listArticles(activeSiteId, { status: "in_review", limit: 8 })
      .then((p) => !cancelled && setReview(p.items))
      .catch(() => {});
    listArticles(activeSiteId, { status: "scheduled", limit: 20 })
      .then((p) => !cancelled && setScheduled(p.items))
      .catch(() => {});
    listArticles(activeSiteId, { status: "blocked", limit: 8 })
      .then((p) => !cancelled && setBlocked(p.items))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSiteId]);

  async function newArticle() {
    if (!activeSiteId) return;
    setCreating(true);
    try {
      const a = await createArticle(activeSiteId, { title: "Novo artigo" });
      router.push(`/articles/${a.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar");
      setCreating(false);
    }
  }

  const authorName = useMemo(() => new Map(authors.map((a) => [a.id, a.name])), [authors]);
  const todayScheduled = scheduled.filter((a) => isToday(a.scheduledAt));
  /** Scheduled, but the moment has passed and it is still not out. */
  const overdue = scheduled.filter((a) => a.scheduledAt && new Date(a.scheduledAt).getTime() < Date.now());

  return (
    <>
      <PageHead
        title="Dashboard"
        description="O estado editorial do site, agora."
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating || !activeSiteId}>
            {creating ? "Criando…" : "Novo artigo"}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {!activeSiteId ? (
        <EmptyState title="Nenhum site" body="Selecione ou crie um site para começar." />
      ) : (
        <>
          {overdue.length > 0 && (
            <Alert tone="warning" title={`${overdue.length} ${overdue.length === 1 ? "publicação atrasada" : "publicações atrasadas"}`}>
              O horário agendado passou e o artigo continua na fila. Verifique o worker de publicação.
            </Alert>
          )}

          {/* Operational counters, not analytics: each one is a queue you can open. */}
          <div className="kalel-dash__counters">
            <QueueCounter
              label="Aguardando revisão"
              value={data?.articles.byStatus.in_review ?? review.length}
              tone={review.length > 0 ? "attention" : "calm"}
              onClick={() => router.push("/workflow")}
            />
            <QueueCounter label="Sai hoje" value={todayScheduled.length} tone="calm" onClick={() => router.push("/calendar")} />
            <QueueCounter
              label="Precisa de correção"
              value={data?.articles.byStatus.blocked ?? blocked.length}
              tone={blocked.length > 0 ? "attention" : "calm"}
              onClick={() => router.push("/workflow")}
            />
            <QueueCounter label="Rascunhos" value={data?.articles.byStatus.draft ?? 0} tone="calm" onClick={() => router.push("/articles")} />
            <QueueCounter label="No ar" value={data?.articles.byStatus.published ?? 0} tone="calm" onClick={() => router.push("/articles")} />
          </div>

          <div className="kalel-dash__cols">
            <ArticleQueue
              title="Aguardando revisão"
              empty="A fila de revisão está limpa."
              rows={review}
              authorName={authorName}
              onOpen={(id) => router.push(`/articles/${id}`)}
              action={<Button size="xs" variant="secondary" onClick={() => router.push("/workflow")}>Abrir fila</Button>}
            />
            <ArticleQueue
              title="Sai hoje"
              empty="Nada programado para hoje."
              rows={todayScheduled}
              authorName={authorName}
              showTime
              onOpen={(id) => router.push(`/articles/${id}`)}
              action={<Button size="xs" variant="secondary" onClick={() => router.push("/calendar")}>Ver calendário</Button>}
            />
          </div>

          {blocked.length > 0 && (
            <ArticleQueue
              title="Precisa de correção"
              empty=""
              rows={blocked}
              authorName={authorName}
              onOpen={(id) => router.push(`/articles/${id}`)}
            />
          )}

          <ArticleQueue
            title="Atividade recente"
            empty="Nenhum artigo ainda."
            rows={recent}
            authorName={authorName}
            showNextAction
            onOpen={(id) => router.push(`/articles/${id}`)}
            action={<Button size="xs" variant="secondary" onClick={() => router.push("/articles")}>Ver todos</Button>}
          />

          {/* Renders nothing for a role without audit.read: an editorial user should see
              the editorial dashboard, not a broken platform panel. Praised by the product
              review and deliberately left as it is. */}
          <OperationalStatus siteId={activeSiteId} />
        </>
      )}
    </>
  );
}

function QueueCounter({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "calm" | "attention";
  onClick: () => void;
}) {
  return (
    <button type="button" className={`kalel-counter kalel-counter--${tone}`} onClick={onClick}>
      <span className="kalel-counter__value">{value}</span>
      <span className="kalel-counter__label">{label}</span>
    </button>
  );
}

function ArticleQueue({
  title,
  empty,
  rows,
  authorName,
  onOpen,
  action,
  showTime = false,
  showNextAction = false,
}: {
  title: string;
  empty: string;
  rows: ArticleSummary[];
  authorName: Map<string, string>;
  onOpen: (id: string) => void;
  action?: React.ReactNode;
  showTime?: boolean;
  showNextAction?: boolean;
}) {
  return (
    <section className="peg-card kalel-dash__card">
      <div className="peg-card__header">
        <h3 className="peg-card__title">{title}</h3>
        {action}
      </div>
      <div className="peg-card__body kalel-dash__list">
        {rows.length === 0 ? (
          <p className="peg-table__muted">{empty}</p>
        ) : (
          rows.map((a) => (
            <button key={a.id} type="button" className="kalel-dash__row" onClick={() => onOpen(a.id)}>
              <span className="kalel-dash__title" title={a.title}>
                {a.title || "Sem título"}
              </span>
              <StatusLabel status={a.status} />
              <span className="kalel-dash__author">{a.authors.length ? (authorName.get(a.authors[0] as string) ?? "—") : "—"}</span>
              <span className="kalel-dash__time">
                {showTime && a.scheduledAt
                  ? new Date(a.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                  : relativeTime(a.updatedAt)}
              </span>
              {showNextAction && <span className="kalel-dash__next">{NEXT_ACTION[a.status]}</span>}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
