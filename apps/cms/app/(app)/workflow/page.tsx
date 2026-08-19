"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  EmptyState,
  PageHead,
  StatusLabel,
  Tabs,
  WorkflowCommentDialog,
  statusLabel,
} from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import {
  ApiError,
  articleAction,
  getArticle,
  listArticles,
  listAuthors,
  listObjectAudit,
  type ArticleStatus,
  type ArticleSummary,
  type Author,
} from "../../../lib/api";

/** Review first: the queue exists to answer "what is waiting on me". */
const TABS: ArticleStatus[] = ["in_review", "draft", "scheduled", "published", "blocked", "archived"];

/**
 * `comment` marks the transitions that carry an editorial note.
 *
 * Rejection requires one - sending work back without saying why is the most expensive
 * thing an editor can do to a writer, and the queue previously did it with a bare button.
 */
const ACTIONS: Record<ArticleStatus, { key: string; label: string; variant: "primary" | "secondary" | "destructive"; comment?: "require" | "optional" }[]> = {
  draft: [
    { key: "submit", label: "Enviar p/ revisão", variant: "primary", comment: "optional" },
    { key: "publish", label: "Publicar", variant: "secondary" },
    { key: "archive", label: "Arquivar", variant: "secondary" },
  ],
  in_review: [
    { key: "approve", label: "Aprovar", variant: "primary", comment: "optional" },
    { key: "reject", label: "Solicitar alterações", variant: "destructive", comment: "require" },
    { key: "publish", label: "Publicar", variant: "secondary" },
  ],
  scheduled: [
    { key: "publish", label: "Publicar agora", variant: "primary" },
    { key: "unpublish", label: "Voltar p/ rascunho", variant: "secondary" },
  ],
  published: [{ key: "unpublish", label: "Despublicar", variant: "destructive", comment: "optional" }],
  blocked: [
    { key: "submit", label: "Reenviar", variant: "primary", comment: "optional" },
    { key: "archive", label: "Arquivar", variant: "secondary" },
  ],
  archived: [],
};

/** Relative "entered this state" reading, from the article's last update. */
function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [authors, setAuthors] = useState<Author[]>([]);
  /** The transition waiting on its editorial comment. */
  const [commentFor, setCommentFor] = useState<{ row: ArticleSummary; key: string; label: string; require: boolean } | null>(null);
  /** Last review note per article, read from the audit trail. */
  const [notes, setNotes] = useState<Record<string, { text: string; actor: string | null }>>({});
  // Every fetch carries the sequence number of the state it was issued for. Without it,
  // switching tabs while a "Carregar mais" was in flight appended in-review rows into the
  // drafts list and left the drafts cursor pointing at the in-review query.
  const generation = useRef(0);

  const load = useCallback(async (siteId: string, status: ArticleStatus) => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    // a staleness warning about a row in another tab is noise over this list
    setNotice(null);
    try {
      const page = await listArticles(siteId, { status, limit: PAGE_SIZE });
      if (mine !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (!activeSiteId || !cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await listArticles(activeSiteId, { status: active, limit: PAGE_SIZE, cursor });
      if (mine !== generation.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err.message : "Falha ao carregar mais");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId, active);
    else setItems([]);
  }, [activeSiteId, active, load]);

  useEffect(() => {
    if (!activeSiteId) return;
    listAuthors(activeSiteId).then(setAuthors).catch(() => {});
  }, [activeSiteId]);

  /** Queue depth per state, so the tabs say where the work actually is. */
  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    Promise.all(
      TABS.map((s) =>
        listArticles(activeSiteId, { status: s, limit: 100 })
          .then((r) => [s, r.items.length] as const)
          .catch(() => [s, 0] as const),
      ),
    )
      .then((pairs) => {
        if (!cancelled) setCounts(Object.fromEntries(pairs));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSiteId, items]);

  /**
   * The note attached to the last workflow transition, per row.
   *
   * Stored on the audit trail, which is where the API has always written it. Reading it
   * needs `audit.read`, so a role without it simply sees no note rather than an error -
   * the queue still works, it just says less.
   */
  useEffect(() => {
    if (!activeSiteId || items.length === 0) return;
    let cancelled = false;
    const wanted = items.filter((i) => i.status === "blocked" || i.status === "in_review").slice(0, 25);
    if (wanted.length === 0) return;
    Promise.all(
      wanted.map((row) =>
        listObjectAudit(activeSiteId, "article", row.id)
          .then((entries) => {
            const hit = entries.find((e) => {
              const d = e.details as { note?: string | null } | null;
              return e.action.startsWith("articles.") && d && typeof d.note === "string" && d.note.trim().length > 0;
            });
            const d = hit?.details as { note?: string } | undefined;
            return hit && d?.note ? ([row.id, { text: d.note, actor: hit.actorLabel }] as const) : null;
          })
          .catch(() => null),
      ),
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Record<string, { text: string; actor: string | null }> = {};
        for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
        setNotes(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSiteId, items]);

  function startAction(row: ArticleSummary, action: { key: string; label: string; comment?: "require" | "optional" }) {
    if (action.comment) {
      setCommentFor({ row, key: action.key, label: action.label, require: action.comment === "require" });
      return;
    }
    void act(row, action.key);
  }

  async function act(row: ArticleSummary, action: string, note?: string) {
    if (!activeSiteId || pending) return;
    setError(null);
    setNotice(null);
    setPending(`${row.id}:${action}`);
    // `activeSiteId` and `active` are captured here. If either changes while the action is
    // in flight the effect issues its own load, and reloading with the captured pair would
    // win the generation race and paint the old site's rows under the new selection.
    const issuedAt = generation.current;
    // Returns false when the user has already moved to another tab or site: the message
    // that follows would then be about a list nobody is looking at, and its "a fila está
    // atualizada" would be a claim about the wrong tab.
    const reload = async () => {
      if (generation.current !== issuedAt) return false;
      await load(activeSiteId, active);
      return true;
    };
    try {
      // The idempotency key is scoped to the version the action was issued against, and
      // this list can be arbitrarily stale - another tab, another editor, a queue left
      // open. A stale version means a stale key, and a stale key replays the stored
      // response: 200, no transition, no audit row, and a UI that reports success. The
      // server-side version predicate cannot catch it because the replay happens before
      // the handler runs. So re-read, and act only on what is actually there.
      const fresh = await getArticle(activeSiteId, row.id).catch((err) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      });
      if (!fresh) {
        if (await reload()) setNotice(`"${row.title}" não existe mais. A fila foi atualizada.`);
        return;
      }
      // Only the status decides. The key at the next line is built from `fresh.version`,
      // so a version that moved is already unspent - and reporting "in_review → in_review"
      // because a writer edited the text would be a message about nothing.
      if (fresh.status !== row.status) {
        if (await reload()) {
          setNotice(`"${row.title}" mudou desde que a fila foi carregada (${row.status} → ${fresh.status}). Nada foi alterado; a fila está atualizada.`);
        }
        return;
      }
      const key = `cms.${row.id}.${action}.v${fresh.version}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
      await articleAction(activeSiteId, row.id, action, key, note);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError("Sem permissão para esta ação");
      else if (err instanceof ApiError && err.status === 409) {
        if (await reload()) setError("O artigo mudou durante a ação. A fila foi atualizada.");
      } else setError(err instanceof ApiError ? err.message : "Falha na ação");
    } finally {
      setPending(null);
    }
  }

  const authorName = new Map(authors.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHead title="Workflow" description="A fila editorial, por estado. O que está em revisão vem primeiro." />

      <Tabs
        tabs={TABS.map((t) => ({ id: t, label: statusLabel(t), count: counts[t] }))}
        active={active}
        onChange={(id) => setActive(id as ArticleStatus)}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="warning">{notice}</Alert>}

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site" />
      ) : items.length === 0 ? (
        <EmptyState
          title={active === "in_review" ? "Nada aguardando revisão" : "Nada aqui"}
          body={active === "in_review" ? "A fila está limpa." : `Nenhum artigo em "${statusLabel(active)}".`}
        />
      ) : (
        <>
          <div className="peg-table-wrap">
            <table className="peg-table">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Status</th>
                  <th>Autor</th>
                  <th>Atualizado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const note = notes[a.id];
                  return (
                    <tr key={a.id}>
                      <td>
                        <button type="button" className="kalel-articles__title" onClick={() => router.push(`/articles/${a.id}`)}>
                          <span className="kalel-articles__name">{a.title || "Sem título"}</span>
                          {/* the reason it came back, where the person acting on it will read it */}
                          {note && (
                            <span className="kalel-queue__note" title={note.text}>
                              “{note.text}”{note.actor ? ` — ${note.actor}` : ""}
                            </span>
                          )}
                        </button>
                      </td>
                      <td>
                        <StatusLabel status={a.status} />
                      </td>
                      <td className="peg-table__muted">
                        {a.authors.length === 0 ? "—" : (authorName.get(a.authors[0] as string) ?? "—")}
                      </td>
                      <td className="peg-table__muted" title={new Date(a.updatedAt).toLocaleString("pt-BR")}>
                        {relativeTime(a.updatedAt)}
                      </td>
                      <td>
                        <div className="kalel-queue__actions">
                          {ACTIONS[a.status].map((action) => (
                            <Button
                              key={action.key}
                              size="xs"
                              variant={action.variant}
                              disabled={pending !== null}
                              onClick={() => startAction(a, action)}
                            >
                              {pending === `${a.id}:${action.key}` ? "…" : action.label}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cursor && (
            <div className="peg-row">
              <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </>
      )}

      <WorkflowCommentDialog
        open={commentFor !== null}
        title={commentFor ? `${commentFor.label} — ${commentFor.row.title}` : ""}
        confirmLabel={commentFor?.label ?? ""}
        tone={commentFor?.require ? "destructive" : "primary"}
        require={commentFor?.require ?? false}
        hint={
          commentFor?.require
            ? "O comentário volta para quem escreveu, junto com o artigo. Diga o que precisa mudar."
            : "Opcional. Fica registrado no histórico do artigo."
        }
        onConfirm={(comment) => {
          const target = commentFor;
          setCommentFor(null);
          if (target) void act(target.row, target.key, comment || undefined);
        }}
        onClose={() => setCommentFor(null)}
      />
    </>
  );
}
