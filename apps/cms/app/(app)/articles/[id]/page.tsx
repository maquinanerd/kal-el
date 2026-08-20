"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Badge, Button, Input, Modal, PageHead, Search, Select, Textarea } from "@kal-el/design-system";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { useAuth } from "../../../../lib/auth";
import {
  ApiError,
  articleAction,
  getArticle,
  getPreviewUrl,
  listArticles,
  listAuthors,
  listCategories,
  listEntities,
  listRevisions,
  listTags,
  updateArticle,
  type ArticleDetail,
  type ArticleRevision,
  type ArticleStatus,
  type Author,
  type Category,
  type Entity,
  type Tag,
} from "../../../../lib/api";
import { RichTextEditor, type RichTextEditorHandle } from "../../../../components/editor/RichTextEditor";
import { MediaPicker } from "../../../../components/MediaPicker";

const EMPTY_DOC: ArticleDocumentV2 = { version: 2, nodes: [] };
const SAVE_LABEL: Record<string, string> = { idle: "", saving: "Salvando…", saved: "Salvo", error: "Erro ao salvar" };

function docToText(doc: { version: number; nodes: unknown[] }): string {
  const lines: string[] = [];
  for (const raw of doc.nodes ?? []) {
    const n = raw as { type: string; content?: unknown; attrs?: Record<string, unknown> };
    switch (n.type) {
      case "paragraph":
      case "heading":
      case "quote":
        lines.push(inlineToText(n.content));
        break;
      case "list": {
        for (const item of (n.content as unknown[]) ?? []) lines.push(`• ${inlineToText(item)}`);
        break;
      }
      case "image":
        lines.push(`[imagem: ${(n.attrs?.mediaId as string)?.slice(0, 8)}…]`);
        break;
      case "gallery":
        lines.push(`[galeria: ${(n.attrs?.mediaIds as string[])?.length ?? 0} imagens]`);
        break;
      case "embed":
        lines.push(`[embed: ${n.attrs?.url}]`);
        break;
      case "source":
        lines.push(`[fonte: ${n.attrs?.label}]`);
        break;
      case "table":
        lines.push("[tabela]");
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}

function inlineToText(content: unknown): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((node) => {
      const n = node as { type: string; text?: string };
      return n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : "";
    })
    .join("");
}

const WORKFLOW_ACTIONS: Partial<Record<ArticleStatus, { key: string; label: string; variant: "primary" | "secondary" | "destructive" }[]>> = {
  draft: [
    { key: "submit", label: "Enviar p/ revisão", variant: "primary" },
    { key: "publish", label: "Publicar", variant: "secondary" },
    { key: "schedule", label: "Agendar", variant: "secondary" },
  ],
  in_review: [
    { key: "approve", label: "Aprovar", variant: "primary" },
    { key: "reject", label: "Rejeitar", variant: "destructive" },
    { key: "publish", label: "Publicar", variant: "secondary" },
  ],
  scheduled: [{ key: "publish", label: "Publicar agora", variant: "primary" }],
  published: [{ key: "unpublish", label: "Despublicar", variant: "destructive" }],
  blocked: [{ key: "submit", label: "Reenviar", variant: "primary" }],
};

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { activeSiteId } = useAuth();
  const editorRef = useRef<RichTextEditorHandle>(null);

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [title, setTitle] = useState("");
  const [dek, setDek] = useState("");
  const [slug, setSlug] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [canonical, setCanonical] = useState("");
  const [robotsIndex, setRobotsIndex] = useState("index");
  const [robotsFollow, setRobotsFollow] = useState("follow");
  const [socialTitle, setSocialTitle] = useState("");
  const [socialDesc, setSocialDesc] = useState("");
  const [socialImageId, setSocialImageId] = useState("");
  const [primaryCategoryId, setPrimaryCategoryId] = useState("");
  const [featuredMediaId, setFeaturedMediaId] = useState("");
  const [doc, setDoc] = useState<ArticleDocumentV2>(EMPTY_DOC);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<ArticleStatus>("draft");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [cats, setCats] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [selTags, setSelTags] = useState<Set<string>>(new Set());
  const [selEntities, setSelEntities] = useState<Set<string>>(new Set());
  const [selAuthors, setSelAuthors] = useState<Set<string>>(new Set());

  const [mediaPicker, setMediaPicker] = useState<"image" | "gallery" | "featured" | "social" | null>(null);
  const [compareRevision, setCompareRevision] = useState<ArticleRevision | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const loadedRef = useRef(false);
  // fields the user changed while the GET was still in flight — the response must not clobber them
  const touchedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef({ title, dek, slug, seoTitle, seoDesc, canonical, robotsIndex, robotsFollow, socialTitle, socialDesc, socialImageId, primaryCategoryId, featuredMediaId, doc, selCats, selTags, selEntities, selAuthors, version });
  draftRef.current = { title, dek, slug, seoTitle, seoDesc, canonical, robotsIndex, robotsFollow, socialTitle, socialDesc, socialImageId, primaryCategoryId, featuredMediaId, doc, selCats, selTags, selEntities, selAuthors, version };

  const save = useCallback(
    async (overrides?: Partial<Record<string, unknown>>) => {
      if (!activeSiteId || !loadedRef.current) return;
      const s = draftRef.current;
      setSaveState("saving");
      try {
        const body: Record<string, unknown> = {
          title: s.title,
          dek: s.dek || null,
          slug: s.slug || null,
          document: s.doc,
          seo: {
            seoTitle: s.seoTitle || null,
            metaDescription: s.seoDesc || null,
            canonicalUrl: s.canonical || null,
            robotsIndex: s.robotsIndex,
            robotsFollow: s.robotsFollow,
            socialTitle: s.socialTitle || null,
            socialDescription: s.socialDesc || null,
            socialImageMediaId: s.socialImageId || null,
            primaryCategoryId: s.primaryCategoryId || null,
          },
          featuredMediaId: s.featuredMediaId || null,
          categories: [...s.selCats],
          tags: [...s.selTags],
          entities: [...s.selEntities],
          authors: [...s.selAuthors],
          ...overrides,
        };
        const updated = await updateArticle(activeSiteId, params.id, body, s.version);
        setVersion(updated.version);
        setSaveState("saved");
        setSaveError(null);
      } catch (err) {
        setSaveState("error");
        setSaveError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    },
    [activeSiteId, params.id],
  );

  const scheduleSave = useCallback(() => {
    setSaveState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const editField = useCallback(
    <T,>(field: string, setter: (value: T) => void, value: T) => {
      touchedRef.current.add(field);
      setter(value);
      scheduleSave();
    },
    [scheduleSave],
  );

  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    loadedRef.current = false;
    setLoaded(false);

    getArticle(activeSiteId, params.id)
      .then((a) => {
        if (cancelled) return;
        // whatever the user already typed wins over the response that just arrived
        const touched = touchedRef.current;
        const apply = <T,>(field: string, setter: (value: T) => void, value: T) => {
          if (!touched.has(field)) setter(value);
        };
        setArticle(a);
        apply("title", setTitle, a.title);
        apply("dek", setDek, a.dek ?? "");
        apply("slug", setSlug, a.slug ?? "");
        apply("seoTitle", setSeoTitle, a.seo?.seoTitle ?? "");
        apply("seoDesc", setSeoDesc, a.seo?.metaDescription ?? "");
        apply("canonical", setCanonical, a.seo?.canonicalUrl ?? "");
        apply("robotsIndex", setRobotsIndex, a.seo?.robotsIndex ?? "index");
        apply("robotsFollow", setRobotsFollow, a.seo?.robotsFollow ?? "follow");
        apply("socialTitle", setSocialTitle, a.seo?.socialTitle ?? "");
        apply("socialDesc", setSocialDesc, a.seo?.socialDescription ?? "");
        apply("socialImageId", setSocialImageId, a.seo?.socialImageMediaId ?? "");
        apply("primaryCategoryId", setPrimaryCategoryId, a.seo?.primaryCategoryId ?? "");
        apply("featuredMediaId", setFeaturedMediaId, a.featuredMediaId ?? "");
        // the body is only editable once loaded, so it can never be dirty here
        setDoc((a.document as ArticleDocumentV2) ?? EMPTY_DOC);
        setVersion(a.version);
        setStatus(a.status);
        apply("categories", setSelCats, new Set(a.categories ?? []));
        apply("tags", setSelTags, new Set(a.tags ?? []));
        apply("entities", setSelEntities, new Set(a.entities ?? []));
        apply("authors", setSelAuthors, new Set(a.authors ?? []));
        loadedRef.current = true;
        setLoaded(true);
        // autosaves debounced before this point were dropped by the loadedRef guard in save()
        if (touched.size > 0) scheduleSave();
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Falha ao carregar");
      });

    listRevisions(activeSiteId, params.id).then((r) => { if (!cancelled) setRevisions(r); }).catch(() => {});
    listCategories(activeSiteId).then((c) => { if (!cancelled) setCats(c); }).catch(() => {});
    listTags(activeSiteId).then((t) => { if (!cancelled) setTags(t); }).catch(() => {});
    listEntities(activeSiteId).then((e) => { if (!cancelled) setEntities(e); }).catch(() => {});
    listAuthors(activeSiteId).then((a) => { if (!cancelled) setAuthors(a); }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeSiteId, params.id, scheduleSave]);

  async function doAction(action: string) {
    if (!activeSiteId) return;
    setActionError(null);
    try {
      const updated = await articleAction(activeSiteId, params.id, action);
      setStatus(updated.status);
      setVersion(updated.version);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para esta ação" : err.message) : "Falha na ação");
    }
  }

  async function openPreview() {
    if (!activeSiteId) return;
    setActionError(null);
    try {
      const { url } = await getPreviewUrl(activeSiteId, params.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Falha ao abrir preview");
    }
  }

  function restore(revision: ArticleRevision) {
    setDoc((revision.document as ArticleDocumentV2) ?? EMPTY_DOC);
    setEditorKey((k) => k + 1);
    void save({ document: revision.document });
  }

  function toggleSet(field: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    touchedRef.current.add(field);
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    scheduleSave();
  }

  if (loadError) return <p className="peg-field__error">{loadError}</p>;

  return (
    <>
      <PageHead title={article?.title ?? "Carregando…"} description={saveState ? SAVE_LABEL[saveState] : "Editor"} />

      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {saveError && saveState === "error" && <Alert tone="danger">Falha ao salvar: {saveError}</Alert>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Badge tone="neutral">{status}</Badge>
        <Button size="sm" variant="secondary" onClick={() => void openPreview()}>Preview</Button>
        <Button size="sm" variant="secondary" disabled={!loaded} onClick={() => setLinkPickerOpen(true)}>Link interno</Button>
        {WORKFLOW_ACTIONS[status]?.map((a) => (
          <Button key={a.key} size="sm" variant={a.variant} onClick={() => void doAction(a.key)}>{a.label}</Button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Título" value={title} onChange={(e) => editField("title", setTitle, e.target.value)} />
          <Input label="Subtítulo (dek)" value={dek} onChange={(e) => editField("dek", setDek, e.target.value)} />

          {loaded ? (
            <RichTextEditor
              key={`${params.id}-${editorKey}`}
              ref={editorRef}
              document={doc}
              onChange={(next) => editField("doc", setDoc, next)}
              onRequestImage={() => setMediaPicker("image")}
              onRequestGallery={() => setMediaPicker("gallery")}
            />
          ) : (
            <div className="peg-editor peg-editor--loading" role="status" aria-live="polite">
              Carregando o conteúdo do artigo…
            </div>
          )}
        </div>

        <aside style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="peg-card">
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input label="Slug" value={slug} onChange={(e) => editField("slug", setSlug, e.target.value)} />
              <Input label="SEO — título" value={seoTitle} onChange={(e) => editField("seoTitle", setSeoTitle, e.target.value)} />
              <Textarea label="SEO — meta descrição" rows={3} value={seoDesc} onChange={(e) => editField("seoDesc", setSeoDesc, e.target.value)} />
              <Input label="Canonical (URL)" value={canonical} onChange={(e) => editField("canonical", setCanonical, e.target.value)} />
              <div style={{ display: "flex", gap: 8 }}>
                <Select label="Robots index" value={robotsIndex} onChange={(e) => editField("robotsIndex", setRobotsIndex, e.target.value)}>
                  <option value="index">index</option>
                  <option value="noindex">noindex</option>
                </Select>
                <Select label="Robots follow" value={robotsFollow} onChange={(e) => editField("robotsFollow", setRobotsFollow, e.target.value)}>
                  <option value="follow">follow</option>
                  <option value="nofollow">nofollow</option>
                </Select>
              </div>
              <Input label="Social — título" value={socialTitle} onChange={(e) => editField("socialTitle", setSocialTitle, e.target.value)} />
              <Textarea label="Social — descrição" rows={2} value={socialDesc} onChange={(e) => editField("socialDesc", setSocialDesc, e.target.value)} />
              <div>
                <span className="peg-field__label">Social — imagem</span>
                {socialImageId ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="peg-table__muted">{socialImageId.slice(0, 8)}…</span>
                    <Button size="xs" variant="secondary" onClick={() => setMediaPicker("social")}>Trocar</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setMediaPicker("social")}>Selecionar</Button>
                )}
              </div>
              <Select label="Categoria primária" value={primaryCategoryId} onChange={(e) => editField("primaryCategoryId", setPrimaryCategoryId, e.target.value)}>
                <option value="">—</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <div>
                <span className="peg-field__label">Imagem de destaque</span>
                {featuredMediaId ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="peg-table__muted">{featuredMediaId.slice(0, 8)}…</span>
                    <Button size="xs" variant="secondary" onClick={() => setMediaPicker("featured")}>Trocar</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setMediaPicker("featured")}>Selecionar</Button>
                )}
              </div>
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">SERP preview</h3></div>
            <div className="peg-card__body" style={{ fontFamily: "Arial, sans-serif" }}>
              <div style={{ color: "#1a0dab", fontSize: 18, lineHeight: 1.2 }}>{seoTitle || title || "Título da página"}</div>
              <div style={{ color: "#006621", fontSize: 13 }}>{canonical || `https://exemplo.com/${slug || "slug"}`}</div>
              <div style={{ color: "#545454", fontSize: 13 }}>{seoDesc || "Descrição aparece aqui."}</div>
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">Social preview</h3></div>
            <div className="peg-card__body" style={{ borderLeft: "3px solid #e5e7eb", paddingLeft: 10 }}>
              <div style={{ fontSize: 13, color: "#777", textTransform: "uppercase" }}>kalel.app</div>
              <div style={{ fontWeight: 600 }}>{socialTitle || seoTitle || title}</div>
              <div style={{ color: "#555", fontSize: 13 }}>{socialDesc || seoDesc || ""}</div>
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CheckboxGroup label="Categorias" items={cats.map((c) => ({ id: c.id, name: c.name }))} selected={selCats} onToggle={(id) => toggleSet("categories", setSelCats, id)} />
              <CheckboxGroup label="Tags" items={tags.map((t) => ({ id: t.id, name: t.name }))} selected={selTags} onToggle={(id) => toggleSet("tags", setSelTags, id)} />
              <CheckboxGroup label="Entidades" items={entities.map((e) => ({ id: e.id, name: e.name }))} selected={selEntities} onToggle={(id) => toggleSet("entities", setSelEntities, id)} />
              <CheckboxGroup label="Autores" items={authors.map((a) => ({ id: a.id, name: a.name }))} selected={selAuthors} onToggle={(id) => toggleSet("authors", setSelAuthors, id)} />
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">Revisões</h3></div>
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {revisions.length === 0 && <span className="peg-table__muted">Sem revisões</span>}
              {revisions.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    <span className="peg-table__muted">r{r.revisionNumber}</span> {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button size="xs" variant="secondary" onClick={() => setCompareRevision(r)}>Comparar</Button>
                    <Button size="xs" variant="secondary" onClick={() => restore(r)}>Restaurar</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {compareRevision && (
        <div className="peg-card" style={{ marginTop: 16 }}>
          <div className="peg-card__header">
            <h3 className="peg-card__title">Comparar r{compareRevision.revisionNumber} com o atual</h3>
            <Button size="xs" variant="secondary" onClick={() => setCompareRevision(null)}>Fechar</Button>
          </div>
          <div className="peg-card__body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span className="peg-field__label">Revisão r{compareRevision.revisionNumber}</span>
              <pre style={{ whiteSpace: "pre-wrap", font: "var(--peg-font-body)", background: "var(--peg-surface-hover, #f9fafb)", padding: 8, borderRadius: 6 }}>{docToText(compareRevision.document)}</pre>
            </div>
            <div>
              <span className="peg-field__label">Atual</span>
              <pre style={{ whiteSpace: "pre-wrap", font: "var(--peg-font-body)", background: "var(--peg-surface-hover, #f9fafb)", padding: 8, borderRadius: 6 }}>{docToText(doc)}</pre>
            </div>
          </div>
        </div>
      )}

      <MediaPicker
        open={mediaPicker !== null}
        multiple={mediaPicker === "gallery"}
        onClose={() => setMediaPicker(null)}
        onSelect={(ids) => {
          if (mediaPicker === "featured") {
            editField("featuredMediaId", setFeaturedMediaId, ids[0] ?? "");
          } else if (mediaPicker === "gallery") {
            editorRef.current?.insertGallery(ids);
          } else if (mediaPicker === "image") {
            editorRef.current?.insertImage(ids[0] ?? "");
          } else if (mediaPicker === "social") {
            editField("socialImageId", setSocialImageId, ids[0] ?? "");
          }
          setMediaPicker(null);
        }}
      />

      <InternalLinkPicker
        open={linkPickerOpen}
        onClose={() => setLinkPickerOpen(false)}
        onSelect={(href) => {
          editorRef.current?.insertLink(href);
          setLinkPickerOpen(false);
        }}
      />
    </>
  );
}

function InternalLinkPicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (href: string) => void }) {
  const { activeSiteId } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; slug: string | null }[]>([]);

  useEffect(() => {
    if (!open || !activeSiteId) return;
    listArticles(activeSiteId, { q: q || undefined }).then((p) => setResults(p.items.map((a) => ({ id: a.id, title: a.title, slug: a.slug })))).catch(() => {});
  }, [open, activeSiteId, q]);

  if (!open) return null;

  return (
    <Modal title="Link interno" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 360 }}>
        <Search placeholder="Buscar artigo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
          {results.length === 0 && <p className="peg-table__muted">Nenhum artigo.</p>}
          {results.map((r) => (
            <button key={r.id} type="button" style={{ background: "none", border: 0, textAlign: "left", padding: "6px 8px", cursor: "pointer", borderRadius: 6, font: "inherit" }} onClick={() => r.slug && onSelect(`/${r.slug}`)}>
              {r.title} <span className="peg-table__muted">/ {r.slug}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CheckboxGroup({ label, items, selected, onToggle }: { label: string; items: { id: string; name: string }[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div>
      <span className="peg-field__label">{label}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
        {items.length === 0 && <span className="peg-table__muted">—</span>}
        {items.map((it) => (
          <label key={it.id} className="peg-checkbox" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={selected.has(it.id)} onChange={() => onToggle(it.id)} />
            <span>{it.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
