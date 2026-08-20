"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Button,
  CharacterCounter,
  DateTimeDialog,
  Input,
  InspectorSection,
  SaveState,
  Search,
  SegmentedControl,
  Select,
  StatusLabel,
  Textarea,
  TokenPicker,
  WorkflowCommentDialog,
  statusLabel,
} from "@kal-el/design-system";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { useAuth } from "../../../../lib/auth";
import { useShellChrome } from "../../../../lib/chrome";
import { slugIsLocked, slugify } from "../../../../lib/slug";
import { DocumentRepair } from "../../../../components/DocumentRepair";
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
  scheduleArticle,
  updateArticle,
  uploadMedia,
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
import { ImageDetailsDialog, type ImageDetails } from "../../../../components/ImageDetailsDialog";

const EMPTY_DOC: ArticleDocumentV2 = { version: 2, nodes: [] };

/** Google truncates around these; they are targets, not rules. */
const SEO_TITLE_MAX = 60;
const SEO_DESC_MIN = 120;
const SEO_DESC_MAX = 160;

type InspectorTab = "document" | "seo" | "qa";

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

function countWords(doc: { nodes: unknown[] }): number {
  const text = docToText(doc as { version: number; nodes: unknown[] });
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Actions available in each state, in the order an editor works through them.
 *
 * Only `primary` is ink; everything else is secondary or tertiary. The product review
 * found Publicar reading as the loudest control on a draft simply because it was the one
 * variant that rendered - once the primary button was fixed, the hierarchy had to say
 * what the daily action actually is. On a draft that is "send for review", not "publish".
 *
 * Actions the backend would refuse are not offered: the API stays the authority, and this
 * mirrors its transition table rather than inventing one.
 */
const WORKFLOW_ACTIONS: Partial<
  Record<ArticleStatus, { key: string; label: string; variant: "primary" | "secondary" | "destructive"; comment?: "require" | "optional" }[]>
> = {
  draft: [
    { key: "submit", label: "Enviar p/ revisão", variant: "primary", comment: "optional" },
    { key: "schedule", label: "Agendar", variant: "secondary" },
    { key: "publish", label: "Publicar", variant: "secondary" },
  ],
  in_review: [
    { key: "approve", label: "Aprovar", variant: "primary", comment: "optional" },
    { key: "reject", label: "Solicitar alterações", variant: "destructive", comment: "require" },
    { key: "schedule", label: "Agendar", variant: "secondary" },
    { key: "publish", label: "Publicar", variant: "secondary" },
  ],
  scheduled: [
    { key: "publish", label: "Publicar agora", variant: "primary" },
    { key: "schedule", label: "Reagendar", variant: "secondary" },
  ],
  published: [{ key: "unpublish", label: "Despublicar", variant: "destructive", comment: "optional" }],
  blocked: [{ key: "submit", label: "Reenviar p/ revisão", variant: "primary", comment: "optional" }],
  archived: [],
};

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { activeSiteId, sites } = useAuth();
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
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [workflowNote, setWorkflowNote] = useState<ArticleDetail["workflowNote"]>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("document");
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [cats, setCats] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [selTags, setSelTags] = useState<Set<string>>(new Set());
  const [selEntities, setSelEntities] = useState<Set<string>>(new Set());
  const [selAuthors, setSelAuthors] = useState<Set<string>>(new Set());

  const [mediaPicker, setMediaPicker] = useState<"image" | "gallery" | "featured" | "social" | null>(null);
  const [pendingImage, setPendingImage] = useState<{ id: string; filename: string; url: string; altText: string | null; caption: string | null; credit: string | null } | null>(null);
  const [compareRevision, setCompareRevision] = useState<ArticleRevision | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [commentFor, setCommentFor] = useState<{ key: string; label: string; require: boolean } | null>(null);
  const [preview, setPreview] = useState<{ url: string } | null>(null);

  const loadedRef = useRef(false);
  const docTouchedRef = useRef(false);
  /**
   * Whether the slug has stopped following the title. Seeded from the loaded article, so
   * a deliberate slug set in an earlier session survives; set on the first manual edit.
   *
   * State, not a ref: the field's hint and its reset action describe this, and a ref
   * changes nothing on screen — the inspector kept saying "Definido manualmente" (or the
   * opposite) until some unrelated render happened to correct it. The ref mirrors it for
   * the save callback, which must not re-run when it flips.
   */
  const [slugLocked, setSlugLocked] = useState(false);
  const slugLockedRef = useRef(slugLocked);
  slugLockedRef.current = slugLocked;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef({ title, dek, slug, seoTitle, seoDesc, canonical, robotsIndex, robotsFollow, socialTitle, socialDesc, socialImageId, primaryCategoryId, featuredMediaId, doc, selCats, selTags, selEntities, selAuthors, version });
  draftRef.current = { title, dek, slug, seoTitle, seoDesc, canonical, robotsIndex, robotsFollow, socialTitle, socialDesc, socialImageId, primaryCategoryId, featuredMediaId, doc, selCats, selTags, selEntities, selAuthors, version };

  const site = sites.find((s) => s.id === activeSiteId);
  const domain = site?.primaryDomain ?? null;

  // The topbar owns the trail and the save state. The H1 below is the article title and
  // tracks local state, so it is live from the first keystroke - no reload, no remount.
  useShellChrome(
    useMemo(() => [{ label: "Artigos", href: "/articles" }, { label: title.trim() || "Novo artigo" }], [title]),
    <SaveState state={saveState} error={saveError} />,
  );

  useEffect(() => {
    if (!activeSiteId) return;
    getArticle(activeSiteId, params.id)
      .then((a) => {
        setArticle(a);
        setTitle(a.title);
        setDek(a.dek ?? "");
        setSlug(a.slug ?? "");
        setSlugLocked(slugIsLocked(a.title, a.slug, a.status));
        setSeoTitle(a.seo?.seoTitle ?? "");
        setSeoDesc(a.seo?.metaDescription ?? "");
        setCanonical(a.seo?.canonicalUrl ?? "");
        setRobotsIndex(a.seo?.robotsIndex ?? "index");
        setRobotsFollow(a.seo?.robotsFollow ?? "follow");
        setSocialTitle(a.seo?.socialTitle ?? "");
        setSocialDesc(a.seo?.socialDescription ?? "");
        setSocialImageId(a.seo?.socialImageMediaId ?? "");
        setPrimaryCategoryId(a.seo?.primaryCategoryId ?? "");
        setFeaturedMediaId(a.featuredMediaId ?? "");
        setDoc((a.document as ArticleDocumentV2) ?? EMPTY_DOC);
        setVersion(a.version);
        setStatus(a.status);
        setScheduledAt(a.scheduledAt ?? null);
        setWorkflowNote(a.workflowNote ?? null);
        setSelCats(new Set(a.categories ?? []));
        setSelTags(new Set(a.tags ?? []));
        setSelEntities(new Set(a.entities ?? []));
        setSelAuthors(new Set(a.authors ?? []));
        loadedRef.current = true;
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Falha ao carregar"));

    listRevisions(activeSiteId, params.id).then(setRevisions).catch(() => {});
    listCategories(activeSiteId).then(setCats).catch(() => {});
    listTags(activeSiteId).then(setTags).catch(() => {});
    listEntities(activeSiteId).then(setEntities).catch(() => {});
    listAuthors(activeSiteId).then(setAuthors).catch(() => {});
  }, [activeSiteId, params.id]);

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
          ...(docTouchedRef.current ? { document: s.doc } : {}),
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
        // Only the version moves. Nothing here replaces the document, remounts the editor
        // or refreshes the route, so the caret, the selection and the scroll position all
        // survive an autosave - the product review watched saves throw it back to the top.
        setVersion(updated.version);
        /*
         * The server appends `-2`, `-3`… when the slug is taken (`uniqueSlug`). That is
         * the server disambiguating, not the writer choosing, so an automatic slug follows
         * it and STAYS automatic — otherwise the field would keep showing a URL the
         * article does not have. Skipped once the slug is the writer's, and skipped if
         * they typed again while the request was in flight; the next save settles it.
         */
        if (!slugLockedRef.current && updated.slug && updated.slug !== s.slug && draftRef.current.slug === s.slug) {
          setSlug(updated.slug);
        }
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
    // "Salvando…" from the first keystroke, not once the request leaves. `idle` renders an
    // empty slot, so every edit blanked the indicator for the whole debounce window and
    // the writer's only evidence of an autosave was that it had already finished.
    setSaveState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /**
   * A status whose URL is public, or about to be.
   *
   * `slugIsLocked` decides this at LOAD time, from the status the article had then. It was
   * never re-asked afterwards, so publishing without leaving the editor left the slug in
   * automatic mode: the next character typed into the title silently rewrote the address
   * of a piece that was already live. Locking is applied on the transition and is
   * one-way - it never unlocks, because a slug the writer claimed by hand stays claimed.
   */
  function lockSlugIfPublic(nextStatus: string) {
    if (nextStatus === "published" || nextStatus === "scheduled" || nextStatus === "archived") {
      setSlugLocked(true);
    }
  }

  /** Title edits carry the slug along until someone claims it. */
  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugLockedRef.current) setSlug(slugify(next));
    scheduleSave();
  }

  function onSlugChange(next: string) {
    setSlugLocked(true);
    setSlug(next);
    scheduleSave();
  }

  /**
   * Back to automatic, explicitly. Clearing the field was the only way back before, which
   * is not a mechanism anyone can discover — and it read as "delete the URL", not "let the
   * title drive it again".
   */
  function resetSlugToTitle() {
    setSlugLocked(false);
    setSlug(slugify(title));
    scheduleSave();
  }

  async function doSchedule(when: Date) {
    if (!activeSiteId || pendingAction) return;
    setScheduleOpen(false);
    setActionError(null);
    setPendingAction("schedule");
    const key = `cms.${params.id}.schedule.v${version}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
    try {
      const updated = await scheduleArticle(activeSiteId, params.id, when.toISOString(), key);
      setStatus(updated.status);
      lockSlugIfPublic(updated.status);
      setVersion(updated.version);
      setScheduledAt(updated.scheduledAt ?? when.toISOString());
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para esta ação" : err.message) : "Falha ao agendar");
    } finally {
      setPendingAction(null);
    }
  }

  async function doAction(action: string, note?: string) {
    if (!activeSiteId || pendingAction) return;
    setActionError(null);
    setPendingAction(action);
    // One key per click, keyed by the version, so a double click collapses but a second
    // legitimate approval on the same day is not replayed as the first one.
    const key = `cms.${params.id}.${action}.v${version}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
    try {
      const updated = await articleAction(activeSiteId, params.id, action, key, note);
      setStatus(updated.status);
      lockSlugIfPublic(updated.status);
      setVersion(updated.version);
      setScheduledAt(updated.scheduledAt ?? null);
      // the response already carries the note this transition just wrote
      setWorkflowNote(updated.workflowNote ?? null);
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para esta ação" : err.message) : "Falha na ação");
    } finally {
      setPendingAction(null);
    }
  }

  function startAction(a: { key: string; comment?: "require" | "optional"; label: string }) {
    if (a.key === "schedule") {
      setScheduleOpen(true);
      return;
    }
    if (a.comment) {
      setCommentFor({ key: a.key, label: a.label, require: a.comment === "require" });
      return;
    }
    void doAction(a.key);
  }

  /**
   * Preview opens in a drawer over the editor rather than a popup.
   *
   * The old flow called `window.open` AFTER awaiting the POST, so the call had lost its
   * user gesture and Chrome blocked it silently: the request returned 200 and nothing
   * appeared. Rendering the preview in-app removes the popup from the path entirely, and
   * it is what the spec asks for anyway - the writer never leaves the editor. The drawer
   * still offers a real anchor to open it in a tab, which is user-initiated and therefore
   * never blocked.
   */
  async function openPreview() {
    if (!activeSiteId) return;
    setActionError(null);
    try {
      const { url } = await getPreviewUrl(activeSiteId, params.id);
      setPreview({ url });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Falha ao gerar o preview");
    }
  }

  function restore(revision: ArticleRevision) {
    const target = (revision.document as ArticleDocumentV2) ?? EMPTY_DOC;
    if (target.nodes.length === 0) {
      const ok = window.confirm(
        `A revisão ${revision.revisionNumber} está vazia. Restaurá-la deixa o artigo sem conteúdo. Continuar?`,
      );
      if (!ok) return;
    }
    docTouchedRef.current = true;
    setDoc(target);
    setEditorKey((k) => k + 1);
    void save({ document: target });
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    scheduleSave();
  }

  const words = useMemo(() => countWords(doc), [doc]);
  const readingMinutes = Math.max(1, Math.round(words / 200));

  /** The editorial checklist from the package inspector: five concrete, checkable items. */
  const qa = [
    { ok: title.trim().length > 0, label: "Título preenchido" },
    { ok: selCats.size > 0, label: "Ao menos uma categoria" },
    { ok: selAuthors.size > 0, label: "Autor atribuído" },
    { ok: featuredMediaId !== "", label: "Imagem destacada" },
    { ok: seoDesc.trim().length >= SEO_DESC_MIN && seoDesc.trim().length <= SEO_DESC_MAX, label: "Meta descrição na faixa" },
  ];
  const qaDone = qa.filter((q) => q.ok).length;

  const actions = WORKFLOW_ACTIONS[status] ?? [];
  const serpUrl = canonical || `https://${domain ?? "seu-dominio.com.br"}/${slug || "slug-do-artigo"}`;

  if (loadError) {
    return (
      <Alert tone="danger" title="Não foi possível abrir o artigo">
        {loadError}
      </Alert>
    );
  }

  return (
    <div className="kalel-editor">
      <div className="kalel-editor__main">
        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {saveError && saveState === "error" && <Alert tone="danger">Falha ao salvar: {saveError}</Alert>}

        {/*
          * Why the article is blocked, at the top of the screen that has to act on it.
          *
          * The reviewer's comment was persisted and shown in the workflow queue, but the
          * author opening the article saw only "Bloqueado" and "Reenviar p/ revisão" —
          * the state and the way out, never the reason. Sending it back unchanged was the
          * only thing they could do with what was on screen.
          */}
        {status === "blocked" && workflowNote && (
          <Alert tone="warning" title="Alterações solicitadas">
            <p className="kalel-workflow-note__text">{workflowNote.note}</p>
            <p className="kalel-workflow-note__meta">
              {workflowNote.actorLabel ? `${workflowNote.actorLabel} · ` : ""}
              {new Date(workflowNote.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </Alert>
        )}

        {activeSiteId && article?.qualityFlags?.includes("document_unreadable") && (
          <DocumentRepair
            siteId={activeSiteId}
            articleId={params.id}
            version={version}
            onRepaired={() => window.location.reload()}
          />
        )}

        {/* Action bar. Publish is deliberately not the loudest thing on a draft. */}
        <div className="kalel-editor__actions">
          <StatusLabel status={status} />
          {status === "scheduled" && scheduledAt && (
            <span className="kalel-editor__scheduled">
              {new Date(scheduledAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span className="kalel-editor__actions-spacer" />
          <Button size="sm" variant="secondary" onClick={() => void openPreview()}>
            Preview
          </Button>
          {actions.map((a) => (
            <Button
              key={a.key}
              size="sm"
              variant={a.variant}
              disabled={pendingAction !== null}
              onClick={() => startAction(a)}
            >
              {pendingAction === a.key ? "…" : a.label}
            </Button>
          ))}
          <button
            type="button"
            className="peg-btn peg-btn--secondary peg-btn--sm kalel-editor__inspector-toggle"
            onClick={() => setInspectorOpen(true)}
          >
            Documento
          </button>
        </div>

        {/* The article canvas: 820px of prose, exactly as the executable design has it. */}
        <article className="kalel-canvas">
          <p className="kalel-canvas__kicker">
            {statusLabel(status)} · {words} {words === 1 ? "palavra" : "palavras"} · {readingMinutes} min de leitura
          </p>
          <textarea
            className="kalel-canvas__title"
            rows={1}
            value={title}
            placeholder="Novo artigo"
            aria-label="Título do artigo"
            onChange={(e) => onTitleChange(e.target.value)}
            ref={(el) => {
              // the title is a heading that happens to be editable: it grows with its
              // content instead of scrolling inside a fixed box
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
          />
          <textarea
            className="kalel-canvas__dek"
            rows={1}
            value={dek}
            placeholder="Subtítulo (dek)"
            aria-label="Subtítulo"
            onChange={(e) => {
              setDek(e.target.value);
              scheduleSave();
            }}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
          />

          <RichTextEditor
            key={`${article?.id ?? "loading"}-${editorKey}`}
            ref={editorRef}
            document={doc}
            onChange={(next) => {
              docTouchedRef.current = true;
              setDoc(next);
              scheduleSave();
            }}
            statusSlot={<SaveState state={saveState} error={saveError} />}
            renderLinkBrowser={(select) => <InternalLinkBrowser onSelect={select} />}
            onRequestImage={() => setMediaPicker("image")}
            onRequestGallery={() => setMediaPicker("gallery")}
            onUploadFile={async (file) => {
              if (!activeSiteId) return null;
              try {
                const created = await uploadMedia(activeSiteId, file);
                setPendingImage({
                  id: created.id,
                  filename: created.filename,
                  url: created.url,
                  altText: created.altText ?? null,
                  caption: created.caption ?? null,
                  credit: created.credit ?? null,
                });
                return null;
              } catch (err) {
                setActionError(err instanceof Error ? err.message : "falha ao enviar a imagem");
                return null;
              }
            }}
          />
        </article>

        {compareRevision && (
          <div className="peg-card">
            <div className="peg-card__header">
              <h3 className="peg-card__title">Comparar r{compareRevision.revisionNumber} com o atual</h3>
              <Button size="xs" variant="secondary" onClick={() => setCompareRevision(null)}>
                Fechar
              </Button>
            </div>
            <div className="peg-card__body kalel-diff">
              <div>
                <span className="peg-field__label">Revisão r{compareRevision.revisionNumber}</span>
                <pre className="kalel-diff__pane">{docToText(compareRevision.document)}</pre>
              </div>
              <div>
                <span className="peg-field__label">Atual</span>
                <pre className="kalel-diff__pane">{docToText(doc)}</pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inspector: 336px rail on desktop, bottom sheet on mobile. */}
      {inspectorOpen && <div className="peg-scrim kalel-inspector-scrim" onClick={() => setInspectorOpen(false)} aria-hidden="true" />}
      <aside className={`kalel-inspector ${inspectorOpen ? "kalel-inspector--open" : ""}`} aria-label="Inspector do artigo">
        <div className="kalel-inspector__head">
          <SegmentedControl
            options={[
              { value: "document", label: "Documento" },
              { value: "seo", label: "SEO" },
              { value: "qa", label: "QA" },
            ]}
            value={inspectorTab}
            onChange={(v) => setInspectorTab(v as InspectorTab)}
          />
          <button type="button" className="peg-btn peg-btn--icon kalel-inspector__close" aria-label="Fechar inspector" onClick={() => setInspectorOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="kalel-inspector__body">
          {inspectorTab === "document" && (
            <>
              <InspectorSection title="Publicação">
                <div className="peg-row">
                  <StatusLabel status={status} />
                  {status === "scheduled" && scheduledAt && (
                    <span className="peg-table__muted">
                      {new Date(scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  )}
                </div>
                <Input
                  label="Slug"
                  value={slug}
                  hint={
                    slugLocked
                      ? "Definido manualmente — o título não altera mais este endereço."
                      : "Gerado a partir do título. Editar aqui congela o valor."
                  }
                  onChange={(e) => onSlugChange(e.target.value)}
                />
                {slugLocked && status !== "published" && status !== "scheduled" && status !== "archived" && (
                  <button type="button" className="peg-btn peg-btn--sm peg-btn--secondary kalel-slug-reset" onClick={resetSlugToTitle}>
                    Gerar a partir do título
                  </button>
                )}
                {domain && (
                  <p className="peg-field__hint kalel-url-preview">
                    {domain}/{slug || "…"}
                  </p>
                )}
              </InspectorSection>

              <InspectorSection title="Autores">
                <TokenPicker
                  label="Autores"
                  options={authors.map((a) => ({ id: a.id, name: a.name }))}
                  selected={selAuthors}
                  onToggle={(id) => toggleSet(setSelAuthors, id)}
                  placeholder="Buscar autor…"
                />
              </InspectorSection>

              <InspectorSection title="Editoria">
                <TokenPicker
                  label="Categorias"
                  options={cats.map((c) => ({ id: c.id, name: c.name }))}
                  selected={selCats}
                  onToggle={(id) => toggleSet(setSelCats, id)}
                  placeholder="Buscar categoria…"
                />
                <Select
                  label="Categoria primária"
                  hint="A editoria sob a qual o artigo é catalogado e que define sua URL canônica. As demais categorias continuam valendo para navegação."
                  value={primaryCategoryId}
                  onChange={(e) => {
                    setPrimaryCategoryId(e.target.value);
                    scheduleSave();
                  }}
                >
                  <option value="">—</option>
                  {cats
                    .filter((c) => selCats.size === 0 || selCats.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </InspectorSection>

              <InspectorSection title="Tags e entidades">
                <TokenPicker
                  label="Tags"
                  options={tags.map((t) => ({ id: t.id, name: t.name }))}
                  selected={selTags}
                  onToggle={(id) => toggleSet(setSelTags, id)}
                  placeholder="Buscar tag…"
                />
                <TokenPicker
                  label="Entidades"
                  options={entities.map((e) => ({ id: e.id, name: e.name }))}
                  selected={selEntities}
                  onToggle={(id) => toggleSet(setSelEntities, id)}
                  placeholder="Buscar entidade…"
                />
              </InspectorSection>

              <InspectorSection
                title="Imagem destacada"
                actions={
                  featuredMediaId ? (
                    <Button size="xs" variant="tertiary" onClick={() => { setFeaturedMediaId(""); scheduleSave(); }}>
                      Remover
                    </Button>
                  ) : undefined
                }
              >
                {featuredMediaId ? (
                  <div className="peg-row">
                    <span className="peg-table__muted">{featuredMediaId.slice(0, 8)}…</span>
                    <Button size="xs" variant="secondary" onClick={() => setMediaPicker("featured")}>
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setMediaPicker("featured")}>
                    Selecionar imagem
                  </Button>
                )}
              </InspectorSection>

              <InspectorSection title="Revisões">
                <RevisionList revisions={revisions} onCompare={setCompareRevision} onRestore={restore} />
              </InspectorSection>
            </>
          )}

          {inspectorTab === "seo" && (
            <>
              <InspectorSection title="Busca">
                <Input
                  label="Título SEO"
                  value={seoTitle}
                  placeholder={title}
                  hint="Usado pelo Google no lugar do título editorial quando preenchido."
                  onChange={(e) => {
                    setSeoTitle(e.target.value);
                    scheduleSave();
                  }}
                />
                <CharacterCounter value={seoTitle || title} max={SEO_TITLE_MAX} />
                <Textarea
                  label="Meta descrição"
                  rows={3}
                  value={seoDesc}
                  hint="O resumo que aparece sob o título no resultado de busca."
                  onChange={(e) => {
                    setSeoDesc(e.target.value);
                    scheduleSave();
                  }}
                />
                <CharacterCounter value={seoDesc} min={SEO_DESC_MIN} max={SEO_DESC_MAX} />
              </InspectorSection>

              <InspectorSection title="Prévia do resultado">
                <SerpPreview url={serpUrl} title={seoTitle || title} description={seoDesc} />
              </InspectorSection>

              <InspectorSection
                title="Endereço canônico"
                hint="Quando o mesmo conteúdo existe em mais de um endereço, o canônico diz ao Google qual é o original. Deixe vazio para usar o endereço deste artigo."
              >
                <Input
                  label="Canonical"
                  optional
                  value={canonical}
                  placeholder={domain ? `https://${domain}/${slug || "slug"}` : "https://…"}
                  onChange={(e) => {
                    setCanonical(e.target.value);
                    scheduleSave();
                  }}
                />
              </InspectorSection>

              <InspectorSection title="Indexação">
                <Select
                  label="Aparecer na busca"
                  hint={robotsIndex === "index" ? "O artigo pode ser listado nos resultados de busca." : "O artigo fica fora dos resultados de busca."}
                  value={robotsIndex}
                  onChange={(e) => {
                    setRobotsIndex(e.target.value);
                    scheduleSave();
                  }}
                >
                  <option value="index">Sim — indexar</option>
                  <option value="noindex">Não — manter fora da busca</option>
                </Select>
                <Select
                  label="Seguir links"
                  hint={robotsFollow === "follow" ? "Buscadores seguem os links do texto e passam autoridade a eles." : "Buscadores não seguem os links deste artigo."}
                  value={robotsFollow}
                  onChange={(e) => {
                    setRobotsFollow(e.target.value);
                    scheduleSave();
                  }}
                >
                  <option value="follow">Sim — seguir</option>
                  <option value="nofollow">Não — ignorar os links</option>
                </Select>
              </InspectorSection>

              <InspectorSection title="Compartilhamento">
                <Input
                  label="Título social"
                  optional
                  value={socialTitle}
                  placeholder={seoTitle || title}
                  onChange={(e) => {
                    setSocialTitle(e.target.value);
                    scheduleSave();
                  }}
                />
                <Textarea
                  label="Descrição social"
                  optional
                  rows={2}
                  value={socialDesc}
                  placeholder={seoDesc}
                  onChange={(e) => {
                    setSocialDesc(e.target.value);
                    scheduleSave();
                  }}
                />
                <div>
                  <span className="peg-field__label">Imagem social</span>
                  {socialImageId ? (
                    <div className="peg-row">
                      <span className="peg-table__muted">{socialImageId.slice(0, 8)}…</span>
                      <Button size="xs" variant="secondary" onClick={() => setMediaPicker("social")}>
                        Trocar
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setMediaPicker("social")}>
                      Selecionar
                    </Button>
                  )}
                </div>
                <SocialPreview
                  domain={domain}
                  title={socialTitle || seoTitle || title}
                  description={socialDesc || seoDesc}
                />
              </InspectorSection>
            </>
          )}

          {inspectorTab === "qa" && (
            <InspectorSection title="Checklist editorial">
              <div className="kalel-qa">
                <div className="kalel-qa__count">
                  {qaDone} de {qa.length}
                </div>
                <div className="kalel-qa__bar" aria-hidden="true">
                  {qa.map((q, i) => (
                    <span key={i} className={`kalel-qa__seg ${q.ok ? "kalel-qa__seg--on" : ""}`} />
                  ))}
                </div>
              </div>
              <ul className="kalel-qa__list">
                {qa.map((q) => (
                  <li key={q.label} className={q.ok ? "kalel-qa__item kalel-qa__item--ok" : "kalel-qa__item"}>
                    <span aria-hidden="true">{q.ok ? "✓" : "!"}</span>
                    {q.label}
                  </li>
                ))}
              </ul>
            </InspectorSection>
          )}
        </div>
      </aside>

      <DateTimeDialog
        open={scheduleOpen}
        title={status === "scheduled" ? "Reagendar publicação" : "Agendar publicação"}
        confirmLabel={status === "scheduled" ? "Reagendar" : "Agendar"}
        initial={scheduledAt ? new Date(scheduledAt) : null}
        onConfirm={(when) => void doSchedule(when)}
        onClose={() => setScheduleOpen(false)}
      />

      <WorkflowCommentDialog
        open={commentFor !== null}
        title={commentFor?.label ?? ""}
        confirmLabel={commentFor?.label ?? ""}
        tone={commentFor?.require ? "destructive" : "primary"}
        require={commentFor?.require ?? false}
        hint={
          commentFor?.require
            ? "O comentário volta para quem escreveu, junto com o artigo. Diga o que precisa mudar."
            : "Opcional. Fica registrado no histórico do artigo."
        }
        onConfirm={(comment) => {
          const key = commentFor?.key;
          setCommentFor(null);
          if (key) void doAction(key, comment || undefined);
        }}
        onClose={() => setCommentFor(null)}
      />

      {preview && <PreviewDrawer url={preview.url} onClose={() => setPreview(null)} />}

      <MediaPicker
        open={mediaPicker !== null}
        multiple={mediaPicker === "gallery"}
        onClose={() => setMediaPicker(null)}
        onSelect={(ids, picked) => {
          if (mediaPicker === "featured") {
            setFeaturedMediaId(ids[0] ?? "");
            scheduleSave();
          } else if (mediaPicker === "gallery") {
            editorRef.current?.insertGallery(ids);
          } else if (mediaPicker === "image") {
            const first = picked[0];
            if (first) {
              setPendingImage({
                id: first.id,
                filename: first.filename,
                url: first.url,
                altText: first.altText ?? null,
                caption: first.caption ?? null,
                credit: first.credit ?? null,
              });
            }
          } else if (mediaPicker === "social") {
            setSocialImageId(ids[0] ?? "");
            scheduleSave();
          }
          setMediaPicker(null);
        }}
      />

      <ImageDetailsDialog
        open={pendingImage !== null}
        filename={pendingImage?.filename}
        previewUrl={pendingImage?.url}
        initial={
          pendingImage
            ? { altText: pendingImage.altText, caption: pendingImage.caption, credit: pendingImage.credit }
            : undefined
        }
        onCancel={() => setPendingImage(null)}
        onConfirm={(details: ImageDetails) => {
          if (pendingImage) {
            editorRef.current?.insertImage(pendingImage.id, {
              altText: details.altText ?? undefined,
              caption: details.caption ?? undefined,
              credit: details.credit ?? undefined,
            });
          }
          setPendingImage(null);
        }}
      />
    </div>
  );
}

/**
 * Revision list.
 *
 * Autosave files a revision on a cadence, so an hour of writing produces a wall of
 * indistinguishable rows. Consecutive autosaves by the same actor within the same hour
 * collapse into one entry that says how many there were; the individual revisions are
 * still restorable through it, so nothing becomes unrecoverable in exchange for the
 * tidier list.
 */
/**
 * Notes the API writes for itself: `created` on the first revision, `updated` on every
 * autosave, `published` when an article goes live. They are markers, not editorial names.
 *
 * Treating them as names had two consequences. Every autosave counted as "named", so the
 * grouping below never grouped anything and the panel listed eleven consecutive rows
 * labelled `updated`. And those rows printed a raw system token on screen, which the
 * visual sweep flags: no surface in this product prints an enum.
 *
 * Returning null means "this revision has no name of its own" — the caller then describes
 * it by what it is. Every revision stays listed and stays restorable; only the label
 * changes.
 */
const SYSTEM_REVISION_NOTES: Record<string, string | null> = {
  created: "Criação",
  updated: null,
  published: "Publicação",
};

function revisionName(note: string | null): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  return trimmed in SYSTEM_REVISION_NOTES ? SYSTEM_REVISION_NOTES[trimmed] ?? null : trimmed;
}

function RevisionList({
  revisions,
  onCompare,
  onRestore,
}: {
  revisions: ArticleRevision[];
  onCompare: (r: ArticleRevision) => void;
  onRestore: (r: ArticleRevision) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(() => {
    const out: { lead: ArticleRevision; items: ArticleRevision[]; name: string | null }[] = [];
    for (const r of revisions) {
      const name = revisionName(r.note);
      const named = name !== null;
      const prev = out[out.length - 1];
      const sameHour =
        prev &&
        !named &&
        prev.name === null &&
        Math.abs(new Date(prev.lead.createdAt).getTime() - new Date(r.createdAt).getTime()) < 60 * 60 * 1000;
      if (sameHour && prev) prev.items.push(r);
      else out.push({ lead: r, items: [r], name });
    }
    return out;
  }, [revisions]);

  if (revisions.length === 0) return <p className="peg-table__muted">Sem revisões ainda.</p>;

  return (
    <ul className="kalel-revisions">
      {groups.map((g) => {
        const open = expanded === g.lead.id;
        return (
          <li key={g.lead.id} className="kalel-revisions__group">
            <div className="kalel-revisions__row">
              <div className="kalel-revisions__meta">
                <span className="kalel-revisions__label">
                  {g.name ?? (g.items.length > 1 ? `${g.items.length} salvamentos automáticos` : "Salvamento automático")}
                </span>
                <span className="kalel-revisions__time">
                  r{g.lead.revisionNumber} · {new Date(g.lead.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <div className="kalel-revisions__actions">
                <Button size="xs" variant="tertiary" onClick={() => onCompare(g.lead)}>
                  Comparar
                </Button>
                <Button size="xs" variant="tertiary" onClick={() => onRestore(g.lead)}>
                  Restaurar
                </Button>
              </div>
            </div>
            {g.items.length > 1 && (
              <button type="button" className="kalel-revisions__toggle" onClick={() => setExpanded(open ? null : g.lead.id)}>
                {open ? "Ocultar" : `Ver as ${g.items.length} versões`}
              </button>
            )}
            {open && (
              <ul className="kalel-revisions__nested">
                {g.items.map((r) => (
                  <li key={r.id}>
                    <span className="kalel-revisions__time">
                      r{r.revisionNumber} · {new Date(r.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Button size="xs" variant="tertiary" onClick={() => onRestore(r)}>
                      Restaurar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** SERP preview using the site's real domain and realistic truncation. */
function SerpPreview({ url, title, description }: { url: string; title: string; description: string }) {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  return (
    <div className="kalel-serp">
      <div className="kalel-serp__url">{clip(url.replace(/^https?:\/\//, ""), 70)}</div>
      <div className="kalel-serp__title">{clip(title || "Título da página", SEO_TITLE_MAX)}</div>
      <div className="kalel-serp__desc">
        {clip(description || "A meta descrição aparece aqui. Sem ela, o Google escolhe um trecho do texto.", SEO_DESC_MAX)}
      </div>
    </div>
  );
}

function SocialPreview({ domain, title, description }: { domain: string | null; title: string; description: string }) {
  return (
    <div className="kalel-social">
      <div className="kalel-social__domain">{(domain ?? "seu-dominio.com.br").toUpperCase()}</div>
      <div className="kalel-social__title">{title || "Título do compartilhamento"}</div>
      <div className="kalel-social__desc">{description || "Descrição usada por redes sociais e mensageiros."}</div>
    </div>
  );
}

const PREVIEW_DEVICES = [
  { value: "desktop", label: "Desktop", width: 1280 },
  { value: "tablet", label: "Tablet", width: 768 },
  { value: "mobile", label: "Mobile", width: 390 },
] as const;

/**
 * Preview without leaving the editor.
 *
 * The previous flow awaited the POST and then called `window.open`, by which point the
 * user gesture was gone and Chrome blocked the popup silently - 200 from the API and
 * nothing on screen. An iframe removes the popup from the path; the "abrir em nova aba"
 * control is a real anchor, so it carries its own gesture and is never blocked.
 */
function PreviewDrawer({ url, onClose }: { url: string; onClose: () => void }) {
  const [device, setDevice] = useState<string>("desktop");
  const width = PREVIEW_DEVICES.find((d) => d.value === device)?.width ?? 1280;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="peg-overlay kalel-preview" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="kalel-preview__frame" role="dialog" aria-modal="true" aria-label="Prévia do artigo">
        <header className="kalel-preview__bar">
          <SegmentedControl
            options={PREVIEW_DEVICES.map((d) => ({ value: d.value, label: d.label }))}
            value={device}
            onChange={setDevice}
          />
          <span className="kalel-preview__spacer" />
          <a className="peg-btn peg-btn--secondary peg-btn--sm" href={url} target="_blank" rel="noopener noreferrer">
            Abrir em nova aba
          </a>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </header>
        <div className="kalel-preview__stage">
          <iframe className="kalel-preview__iframe" style={{ width }} src={url} title="Prévia do artigo" />
        </div>
      </div>
    </div>
  );
}

/** Internal-article search, rendered inside the editor's link dialog. */
function InternalLinkBrowser({ onSelect }: { onSelect: (href: string) => void }) {
  const { activeSiteId } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; slug: string | null }[]>([]);

  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    const t = setTimeout(() => {
      listArticles(activeSiteId, { q: q || undefined, limit: 8 })
        .then((p) => {
          if (!cancelled) setResults(p.items.map((a) => ({ id: a.id, title: a.title, slug: a.slug })));
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeSiteId, q]);

  return (
    <div className="kalel-linkbrowser">
      <span className="peg-field__label">Ou escolha um artigo deste site</span>
      <Search placeholder="Buscar artigo…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="kalel-linkbrowser__list">
        {results.length === 0 && <p className="peg-table__muted">Nenhum artigo encontrado.</p>}
        {results
          .filter((r) => r.slug)
          .map((r) => (
            <button key={r.id} type="button" className="kalel-linkbrowser__item" onClick={() => onSelect(`/${r.slug}`)}>
              <span>{r.title}</span>
              <span className="peg-table__muted">/{r.slug}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
