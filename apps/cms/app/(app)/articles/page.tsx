"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  EmptyState,
  FilterBar,
  IconPlus,
  PageHead,
  STATUS_ORDER,
  Search,
  Select,
  StatusLabel,
  Tabs,
  statusLabel,
  type FilterChip,
} from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import {
  ApiError,
  createArticle,
  listArticles,
  listAuthors,
  listCategories,
  type ArticleStatus,
  type ArticleSummary,
  type Author,
  type Category,
} from "../../../lib/api";

const PER_PAGE = 25;

type SortKey = "updated" | "title";

/**
 * Relative time for the "updated" column.
 *
 * An editorial list is read for recency; a full timestamp on every row is noise that has
 * to be parsed. The exact value stays in the `title` attribute.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} d`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

function scheduleCell(a: ArticleSummary): { text: string; title: string } | null {
  const iso = a.status === "scheduled" ? a.scheduledAt : a.publishedAt;
  if (!iso) return null;
  return {
    text: new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
    title: new Date(iso).toLocaleString("pt-BR"),
  };
}

export default function ArticlesPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [tab, setTab] = useState<"all" | ArticleStatus>("all");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");

  const [authors, setAuthors] = useState<Author[]>([]);
  const [cats, setCats] = useState<Category[]>([]);

  // switching the active site mid-request used to append the other site's articles into
  // this list, and clicking one routed to an id that 404s under the current site
  const generation = useRef(0);

  // debounce the search box: one request per pause, not per keystroke
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  useEffect(() => {
    if (!activeSiteId) return;
    listAuthors(activeSiteId).then(setAuthors).catch(() => {});
    listCategories(activeSiteId).then(setCats).catch(() => {});
  }, [activeSiteId]);

  // any change to the query resets to the first page: keeping page 3 of a filter that no
  // longer applies is how a list shows "nothing found" for a filter that has results
  useEffect(() => {
    setPage(0);
    setCursors([null]);
  }, [tab, query, authorId, categoryId, activeSiteId]);

  const load = useCallback(
    async (siteId: string, pageIndex: number, cursor: string | null) => {
      const mine = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const res = await listArticles(siteId, {
          limit: PER_PAGE,
          cursor: cursor ?? undefined,
          status: tab === "all" ? undefined : tab,
          q: query || undefined,
          authorId: authorId || undefined,
          categoryId: categoryId || undefined,
        });
        if (mine !== generation.current) return;
        setArticles(res.items);
        setCursors((prev) => {
          const next = [...prev];
          next[pageIndex + 1] = res.nextCursor;
          return next;
        });
      } catch (err) {
        if (mine !== generation.current) return;
        setError(err instanceof ApiError ? err.message : "Falha ao carregar artigos");
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [tab, query, authorId, categoryId],
  );

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId, page, cursors[page] ?? null);
    else setArticles([]);
    // `cursors` is written by `load`; depending on it would re-run the effect on its own
    // result. The cursor for the current page is read at call time instead.
  }, [activeSiteId, page, load]);

  /**
   * Per-status counts for the tabs.
   *
   * One cheap request per status rather than a dedicated aggregate endpoint: the API
   * reports no total, and inventing a counting route for a tab strip is more platform
   * than this round should build. Counts follow the active search and filters so a tab
   * never promises rows the current query would not return.
   */
  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    const shared = { q: query || undefined, authorId: authorId || undefined, categoryId: categoryId || undefined };
    Promise.all(
      STATUS_ORDER.map((s) =>
        listArticles(activeSiteId, { ...shared, status: s as ArticleStatus, limit: 100 })
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
  }, [activeSiteId, query, authorId, categoryId]);

  async function newArticle() {
    if (!activeSiteId) return;
    setCreating(true);
    try {
      const article = await createArticle(activeSiteId, { title: "Novo artigo" });
      router.push(`/articles/${article.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar artigo");
      setCreating(false);
    }
  }

  const authorName = useMemo(() => new Map(authors.map((a) => [a.id, a.name])), [authors]);
  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);

  const rows = useMemo(() => {
    if (sort === "title") return [...articles].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    return articles;
  }, [articles, sort]);

  const chips: FilterChip[] = [];
  if (query) chips.push({ id: "q", label: `Busca: ${query}`, onRemove: () => setRawQuery("") });
  if (authorId) chips.push({ id: "author", label: `Autor: ${authorName.get(authorId) ?? authorId}`, onRemove: () => setAuthorId("") });
  if (categoryId) chips.push({ id: "cat", label: `Categoria: ${catName.get(categoryId) ?? categoryId}`, onRemove: () => setCategoryId("") });

  const totalKnown = STATUS_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const hasNext = Boolean(cursors[page + 1]);

  return (
    <>
      <PageHead
        title="Artigos"
        description="Tudo que o site publica, em produção e no ar."
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating || !activeSiteId}>
            {creating ? "Criando…" : "Novo artigo"}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Tabs
        tabs={[
          { id: "all", label: "Todos", count: totalKnown || undefined },
          ...STATUS_ORDER.map((s) => ({ id: s, label: statusLabel(s), count: counts[s] })),
        ]}
        active={tab}
        onChange={(id) => setTab(id as "all" | ArticleStatus)}
      />

      <FilterBar
        search={<Search placeholder="Buscar por título…" value={rawQuery} onChange={(e) => setRawQuery(e.target.value)} aria-label="Buscar artigos" />}
        controls={
          <>
            <Select value={authorId} onChange={(e) => setAuthorId(e.target.value)} aria-label="Filtrar por autor">
              <option value="">Todos os autores</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </>
        }
        trailing={
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar">
            <option value="updated">Mais recentes</option>
            <option value="title">Título A–Z</option>
          </Select>
        }
        chips={chips}
        onClearAll={() => {
          setRawQuery("");
          setAuthorId("");
          setCategoryId("");
        }}
      />

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site disponível" body="Crie um site ou solicite acesso a um administrador." />
      ) : rows.length === 0 ? (
        <EmptyState
          title={chips.length > 0 || tab !== "all" ? "Nenhum artigo com esses filtros" : "Nenhum artigo ainda"}
          body={
            chips.length > 0 || tab !== "all"
              ? "Ajuste a busca ou limpe os filtros para ver mais."
              : "Comece criando o primeiro artigo deste site."
          }
          action={
            chips.length > 0 || tab !== "all" ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setRawQuery("");
                  setAuthorId("");
                  setCategoryId("");
                  setTab("all");
                }}
              >
                Limpar filtros
              </Button>
            ) : (
              <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating}>
                Novo artigo
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="peg-table-wrap">
            <table className="peg-table kalel-articles">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Status</th>
                  <th>Autor</th>
                  <th>Categoria</th>
                  <th>Atualizado</th>
                  <th>Publicação</th>
                  <th className="peg-table__actions"><span className="peg-sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const when = scheduleCell(a);
                  return (
                    <tr key={a.id}>
                      <td>
                        <button type="button" className="kalel-articles__title" onClick={() => router.push(`/articles/${a.id}`)}>
                          <span className="kalel-articles__name">{a.title || "Sem título"}</span>
                          {a.slug && <span className="kalel-articles__slug">/{a.slug}</span>}
                        </button>
                      </td>
                      <td>
                        <StatusLabel status={a.status} />
                      </td>
                      <td className="peg-table__muted">
                        {a.authors.length === 0
                          ? "—"
                          : a.authors
                              .map((id) => authorName.get(id) ?? "—")
                              .slice(0, 2)
                              .join(", ")}
                      </td>
                      <td className="peg-table__muted">
                        {a.categories.length === 0 ? "—" : (catName.get(a.categories[0] as string) ?? "—")}
                      </td>
                      <td className="peg-table__muted" title={new Date(a.updatedAt).toLocaleString("pt-BR")}>
                        {relativeTime(a.updatedAt)}
                      </td>
                      <td className="peg-table__muted" title={when?.title}>
                        {when ? when.text : "—"}
                      </td>
                      <td className="peg-table__actions">
                        <button
                          type="button"
                          className="peg-btn peg-btn--icon peg-btn--sm"
                          aria-label={`Abrir ${a.title}`}
                          onClick={() => router.push(`/articles/${a.id}`)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cursor pagination: the API pages forward by cursor, so the control offers
              the moves that are actually possible rather than a page-number strip it
              cannot honour. Visited cursors are kept so "anterior" is real. */}
          <div className="peg-pagination">
            <span>
              {rows.length} {rows.length === 1 ? "artigo" : "artigos"}
              {page > 0 && ` · página ${page + 1}`}
            </span>
            <div className="peg-pagination__controls">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
