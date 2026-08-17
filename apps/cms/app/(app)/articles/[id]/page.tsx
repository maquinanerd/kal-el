"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Input, PageHead, Textarea } from "@kal-el/design-system";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { useAuth } from "../../../../lib/auth";
import { ApiError, getArticle, listRevisions, updateArticle, type ArticleDetail, type ArticleRevision } from "../../../../lib/api";
import { RichTextEditor } from "../../../../components/editor/RichTextEditor";

const EMPTY_DOC: ArticleDocumentV2 = { version: 2, nodes: [] };

const SAVE_LABEL: Record<string, string> = {
  idle: "",
  saving: "Salvando…",
  saved: "Salvo",
  error: "Erro ao salvar",
};

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { activeSiteId } = useAuth();

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [title, setTitle] = useState("");
  const [dek, setDek] = useState("");
  const [slug, setSlug] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [featuredMediaId, setFeaturedMediaId] = useState("");
  const [doc, setDoc] = useState<ArticleDocumentV2>(EMPTY_DOC);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeSiteId) return;
    getArticle(activeSiteId, params.id)
      .then((a) => {
        setArticle(a);
        setTitle(a.title);
        setDek(a.dek ?? "");
        setSlug(a.slug ?? "");
        setSeoTitle(a.seo?.seoTitle ?? "");
        setSeoDesc(a.seo?.metaDescription ?? "");
        setFeaturedMediaId(a.featuredMediaId ?? "");
        setDoc((a.document as ArticleDocumentV2) ?? EMPTY_DOC);
        setVersion(a.version);
        loadedRef.current = true;
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Falha ao carregar"));

    listRevisions(activeSiteId, params.id)
      .then(setRevisions)
      .catch(() => {});
  }, [activeSiteId, params.id]);

  const save = useCallback(async () => {
    if (!activeSiteId || !loadedRef.current) return;
    setSaveState("saving");
    try {
      const updated = await updateArticle(
        activeSiteId,
        params.id,
        {
          title,
          dek: dek || null,
          slug: slug || null,
          document: doc,
          seo: { seoTitle: seoTitle || null, metaDescription: seoDesc || null },
          featuredMediaId: featuredMediaId || null,
        },
        version,
      );
      setVersion(updated.version);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [activeSiteId, params.id, title, dek, slug, doc, seoTitle, seoDesc, featuredMediaId, version]);

  const scheduleSave = useCallback(() => {
    setSaveState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function restore(revision: ArticleRevision) {
    setDoc((revision.document as ArticleDocumentV2) ?? EMPTY_DOC);
    setEditorKey((k) => k + 1);
    setSaveState("idle");
    void save();
  }

  if (loadError) {
    return <p className="peg-field__error">{loadError}</p>;
  }

  return (
    <>
      <PageHead
        title={article?.title ?? "Carregando…"}
        description={saveState ? SAVE_LABEL[saveState] : "Editor de artigo"}
      />

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Título" value={title} onChange={(e) => { setTitle(e.target.value); scheduleSave(); }} />
          <Input label="Subtítulo (dek)" value={dek} onChange={(e) => { setDek(e.target.value); scheduleSave(); }} />

          <RichTextEditor
            key={editorKey}
            document={doc}
            onChange={(next) => {
              setDoc(next);
              scheduleSave();
            }}
          />
        </div>

        <aside style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="peg-card">
            <div className="peg-card__body">
              <div className="peg-field__label">Status</div>
              <Badge tone="neutral">{article?.status ?? "…"}</Badge>
              <div className="peg-field__label" style={{ marginTop: 12 }}>Versão</div>
              <span className="peg-table__muted">v{version}</span>
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input label="Slug" value={slug} onChange={(e) => { setSlug(e.target.value); scheduleSave(); }} />
              <Input label="SEO — título" value={seoTitle} onChange={(e) => { setSeoTitle(e.target.value); scheduleSave(); }} />
              <Textarea label="SEO — meta descrição" rows={3} value={seoDesc} onChange={(e) => { setSeoDesc(e.target.value); scheduleSave(); }} />
              <Input label="Imagem de destaque (mediaId)" value={featuredMediaId} onChange={(e) => { setFeaturedMediaId(e.target.value); scheduleSave(); }} />
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">Revisões</h3></div>
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {revisions.length === 0 && <span className="peg-table__muted">Sem revisões</span>}
              {revisions.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    <span className="peg-table__muted">r{r.revisionNumber}</span>{" "}
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                  <Button size="xs" variant="secondary" onClick={() => restore(r)}>Restaurar</Button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
