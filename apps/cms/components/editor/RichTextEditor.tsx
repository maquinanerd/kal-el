"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorView } from "@tiptap/pm/view";
import type { NodeView } from "@tiptap/pm/view";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from "@tiptap/pm/commands";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import type { MarkType, Node as PmNode, NodeType } from "@tiptap/pm/model";
import { buildTiptapSchema, documentToProseMirror, proseMirrorToDocument } from "@kal-el/editor";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { Menu } from "@kal-el/design-system";
import { MEDIA_ACCEPT, isUploadableImage } from "../../lib/api";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

export type RichTextEditorHandle = {
  insertImage: (mediaId: string, attrs?: { caption?: string; credit?: string; altText?: string }) => void;
  insertGallery: (mediaIds: string[]) => void;
  insertEmbed: (url: string) => void;
  insertTable: () => void;
  insertSource: (label: string, url: string) => void;
  insertLink: (href: string) => void;
};

type Props = {
  document: ArticleDocumentV2;
  onChange: (doc: ArticleDocumentV2) => void;
  /** Opens the media library picker for a single image. */
  onRequestImage?: () => void;
  /** Opens the media library picker for a multi-image gallery. */
  onRequestGallery?: () => void;
  /** Uploads a file straight from the editor and resolves to its mediaId (null on failure). */
  onUploadImage?: (file: File) => Promise<string | null>;
  /** Resolves a mediaId to a displayable URL, so inserted images render in place. */
  resolveMediaUrl?: (mediaId: string) => string | null;
};

function run(view: EditorView, command: Command) {
  command(view.state, view.dispatch, view);
  view.focus();
}

function toggleMarkCommand(markType: MarkType) {
  return (view: EditorView) => run(view, toggleMark(markType));
}

function setHeading(view: EditorView, level: number) {
  run(view, setBlockType(view.state.schema.nodes.heading, { level }));
}

function setParagraph(view: EditorView) {
  run(view, setBlockType(view.state.schema.nodes.paragraph));
}

function toggleListType(view: EditorView, listType: NodeType) {
  const { state } = view;
  let inThisList = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.type === listType) inThisList = true;
  });
  if (inThisList) run(view, lift);
  else run(view, wrapInList(listType));
}

/**
 * Inserts a block atom at `at` (default: the caret) and leaves the caret in a text block
 * right after it.
 *
 * Two things this must never do, both of which cost the author their work. It must not
 * insert over a live range selection — after a file dialog or a drag the selection can
 * cover the whole document, and replacing it would wipe the article — so the selection is
 * always collapsed to a cursor first. And it must not leave the new atom node-selected,
 * where the next keystroke would replace the image that was just added.
 */
function insertAtom(view: EditorView, typeName: string, attrs: Record<string, unknown>, at?: number) {
  const { state } = view;
  const nodeType = state.schema.nodes[typeName] as NodeType;
  const target = Math.max(0, Math.min(at ?? state.selection.to, state.doc.content.size));
  let tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(target)));
  tr = tr.replaceSelectionWith(nodeType.create(attrs));
  const after = tr.selection.to;
  const next = tr.doc.resolve(after).nodeAfter;
  if (!next?.isTextblock) tr = tr.insert(after, state.schema.nodes.paragraph.create());
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after))).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m?.[1] ?? null;
}

function insertTableNode(view: EditorView) {
  const schema = view.state.schema;
  const text = (t: string) => schema.text(t);
  const cell = (content: string, header: boolean) => schema.nodes.tableCell.create({ header }, content ? [text(content)] : []);
  const row = (cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow.create({}, cells);
  const table = schema.nodes.table.create({}, [row([cell("Coluna 1", true), cell("Coluna 2", true)]), row([cell("", false), cell("", false)])]);
  const tr = view.state.tr.replaceSelectionWith(table);
  view.dispatch(tr);
  view.focus();
}

// ---- node views -------------------------------------------------------------
// Block atoms carry only ids in the document schema, so without node views the
// editor would show an empty box where the author just inserted an image.

type MediaUrlResolver = (mediaId: string) => string | null;

function control(label: string, onClick: () => void): HTMLButtonElement {
  const btn = window.document.createElement("button");
  btn.type = "button";
  btn.className = "peg-editor__atom-btn";
  btn.textContent = label;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return btn;
}

function atomShell(modifier: string): { dom: HTMLElement; body: HTMLElement; bar: HTMLElement } {
  const dom = window.document.createElement("div");
  dom.className = `peg-editor__atom peg-editor__atom--${modifier}`;
  const body = window.document.createElement("div");
  body.className = "peg-editor__atom-body";
  const bar = window.document.createElement("div");
  bar.className = "peg-editor__atom-bar";
  bar.contentEditable = "false";
  dom.append(body, bar);
  return { dom, body, bar };
}

/** Shared plumbing: controls must not steal editing events, and our own DOM is not editable content. */
function atomViewBase(dom: HTMLElement, bar: HTMLElement) {
  return {
    dom,
    stopEvent: (event: Event) => bar.contains(event.target as globalThis.Node),
    ignoreMutation: () => true,
    selectNode: () => dom.classList.add("peg-editor__atom--selected"),
    deselectNode: () => dom.classList.remove("peg-editor__atom--selected"),
  };
}

function removeNodeAt(view: EditorView, getPos: () => number | undefined) {
  const pos = getPos();
  if (pos == null) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
  view.focus();
}

function patchAttrsAt(view: EditorView, getPos: () => number | undefined, patch: Record<string, unknown>) {
  const pos = getPos();
  if (pos == null) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

function imageView(node: PmNode, view: EditorView, getPos: () => number | undefined, resolve: MediaUrlResolver): NodeView {
  const { dom, body, bar } = atomShell("image");
  const figure = window.document.createElement("figure");
  const img = window.document.createElement("img");
  const caption = window.document.createElement("figcaption");
  figure.append(img, caption);
  body.append(figure);

  function render(n: PmNode) {
    const mediaId = n.attrs.mediaId as string;
    const url = resolve(mediaId);
    img.src = url ?? "";
    img.alt = (n.attrs.altText as string | null) ?? "";
    img.hidden = !url;
    const parts = [n.attrs.caption as string | null, n.attrs.credit as string | null].filter(Boolean);
    caption.textContent = parts.join(" · ") || (url ? "" : `Imagem ${mediaId.slice(0, 8)}…`);
    caption.hidden = caption.textContent === "";
  }

  bar.append(
    control("Legenda", () => {
      const value = window.prompt("Legenda da imagem", (view.state.doc.nodeAt(getPos() ?? 0)?.attrs.caption as string | null) ?? "");
      if (value != null) patchAttrsAt(view, getPos, { caption: value || null });
    }),
    control("Crédito", () => {
      const value = window.prompt("Crédito da imagem", (view.state.doc.nodeAt(getPos() ?? 0)?.attrs.credit as string | null) ?? "");
      if (value != null) patchAttrsAt(view, getPos, { credit: value || null });
    }),
    control("Alt", () => {
      const value = window.prompt("Texto alternativo (acessibilidade e SEO)", (view.state.doc.nodeAt(getPos() ?? 0)?.attrs.altText as string | null) ?? "");
      if (value != null) patchAttrsAt(view, getPos, { altText: value || null });
    }),
    control("Remover", () => removeNodeAt(view, getPos)),
  );

  render(node);
  return {
    ...atomViewBase(dom, bar),
    update(updated) {
      if (updated.type.name !== "image") return false;
      render(updated);
      return true;
    },
  };
}

function galleryView(node: PmNode, view: EditorView, getPos: () => number | undefined, resolve: MediaUrlResolver): NodeView {
  const { dom, body, bar } = atomShell("gallery");
  const strip = window.document.createElement("div");
  strip.className = "peg-editor__atom-strip";
  body.append(strip);

  function render(n: PmNode) {
    const ids = (n.attrs.mediaIds as string[]) ?? [];
    strip.replaceChildren();
    for (const id of ids) {
      const url = resolve(id);
      const thumb = window.document.createElement("img");
      thumb.src = url ?? "";
      thumb.alt = "";
      strip.append(thumb);
    }
    if (ids.length === 0) strip.textContent = "Galeria vazia";
  }

  bar.append(control("Remover", () => removeNodeAt(view, getPos)));
  render(node);
  return {
    ...atomViewBase(dom, bar),
    update(updated) {
      if (updated.type.name !== "gallery") return false;
      render(updated);
      return true;
    },
  };
}

function embedView(node: PmNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const { dom, body, bar } = atomShell("embed");
  function render(n: PmNode) {
    const url = n.attrs.url as string;
    const id = n.attrs.id as string | null;
    body.replaceChildren();
    if (id) {
      const thumb = window.document.createElement("img");
      thumb.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
      thumb.alt = "";
      body.append(thumb);
    }
    const label = window.document.createElement("span");
    label.className = "peg-editor__atom-label";
    label.textContent = `▶ ${url}`;
    body.append(label);
  }
  bar.append(control("Remover", () => removeNodeAt(view, getPos)));
  render(node);
  return {
    ...atomViewBase(dom, bar),
    update(updated) {
      if (updated.type.name !== "embed") return false;
      render(updated);
      return true;
    },
  };
}

function sourceView(node: PmNode, view: EditorView, getPos: () => number | undefined): NodeView {
  const { dom, body, bar } = atomShell("source");
  function render(n: PmNode) {
    body.textContent = `Fonte: ${n.attrs.label as string}${n.attrs.url ? ` — ${n.attrs.url as string}` : ""}`;
  }
  bar.append(control("Remover", () => removeNodeAt(view, getPos)));
  render(node);
  return {
    ...atomViewBase(dom, bar),
    update(updated) {
      if (updated.type.name !== "source") return false;
      render(updated);
      return true;
    },
  };
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { document, onChange, onRequestImage, onRequestGallery, onUploadImage, resolveMediaUrl },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickPosRef = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onUploadImageRef = useRef(onUploadImage);
  onUploadImageRef.current = onUploadImage;
  const resolveMediaUrlRef = useRef(resolveMediaUrl);
  resolveMediaUrlRef.current = resolveMediaUrl;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Uploads dropped/pasted/picked files and inserts each one, in order, at the position
   * the author asked for. `at` is captured when the gesture happens, not when the upload
   * finishes — by then focus may have gone through a file dialog and back.
   */
  const uploadFilesRef = useRef(async (files: File[], at?: number) => {
    const view = viewRef.current;
    const upload = onUploadImageRef.current;
    if (!view || !upload) return;
    const images = files.filter(isUploadableImage);
    if (images.length === 0) {
      setUploadError("Formato não suportado. Use JPG, PNG, WebP, GIF ou AVIF.");
      return;
    }
    setUploadError(images.length < files.length ? `${files.length - images.length} arquivo(s) ignorado(s) — formato não suportado.` : null);
    setPending((n) => n + images.length);
    let target = at;
    for (const file of images) {
      try {
        const mediaId = await upload(file);
        if (mediaId) {
          insertAtom(view, "image", { mediaId, caption: null, credit: null, altText: null }, target);
          target = view.state.selection.to; // keep a run of images in the order they were picked
        } else {
          setUploadError(`Falha ao enviar ${file.name}`);
        }
      } catch {
        setUploadError(`Falha ao enviar ${file.name}`);
      } finally {
        setPending((n) => n - 1);
      }
    }
  });

  useImperativeHandle(ref, () => ({
    insertImage: (mediaId, attrs) => {
      const view = viewRef.current;
      if (!view) return;
      // Same reason as pickFiles: the library modal owned focus in between.
      insertAtom(view, "image", { mediaId, caption: attrs?.caption ?? null, credit: attrs?.credit ?? null, altText: attrs?.altText ?? null }, pickPosRef.current);
    },
    insertGallery: (mediaIds) => {
      const view = viewRef.current;
      if (!view) return;
      insertAtom(view, "gallery", { mediaIds }, pickPosRef.current);
    },
    insertEmbed: (url) => {
      const view = viewRef.current;
      if (!view) return;
      const id = youtubeId(url);
      insertAtom(view, "embed", { url, provider: id ? "youtube" : "unknown", id: id ?? null });
    },
    insertTable: () => {
      const view = viewRef.current;
      if (view) insertTableNode(view);
    },
    insertSource: (label, url) => {
      const view = viewRef.current;
      if (!view) return;
      insertAtom(view, "source", { label, url, kind: "external" });
    },
    insertLink: (href) => {
      const view = viewRef.current;
      if (!view) return;
      const { state } = view;
      const markType = state.schema.marks.link;
      const { from, to } = state.selection;
      let tr = state.tr.removeMark(from, to, markType);
      tr = tr.addMark(from, to, markType.create({ href }));
      view.dispatch(tr);
      view.focus();
    },
  }));

  useEffect(() => {
    if (!hostRef.current) return;
    const schema = buildTiptapSchema();
    const listItem = schema.nodes.listItem as NodeType;
    const state = EditorState.create({
      schema,
      doc: documentToProseMirror(document),
      plugins: [
        history(),
        keymap({ Enter: splitListItem(listItem), Tab: sinkListItem(listItem), "Shift-Tab": liftListItem(listItem) }),
        keymap(baseKeymap),
      ],
    });

    const resolve: MediaUrlResolver = (mediaId) => resolveMediaUrlRef.current?.(mediaId) ?? null;

    const view = new EditorView(hostRef.current, {
      state,
      nodeViews: {
        image: (node, editorView, getPos) => imageView(node, editorView, getPos as () => number | undefined, resolve),
        gallery: (node, editorView, getPos) => galleryView(node, editorView, getPos as () => number | undefined, resolve),
        embed: (node, editorView, getPos) => embedView(node, editorView, getPos as () => number | undefined),
        source: (node, editorView, getPos) => sourceView(node, editorView, getPos as () => number | undefined),
      },
      handlePaste: (editorView, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0 || !onUploadImageRef.current) return false;
        event.preventDefault();
        void uploadFilesRef.current(files, editorView.state.selection.to);
        return true;
      },
      handleDrop: (editorView, event) => {
        const dragEvent = event as DragEvent;
        const files = [...(dragEvent.dataTransfer?.files ?? [])];
        if (files.length === 0 || !onUploadImageRef.current) return false;
        event.preventDefault();
        // Drop the images where the pointer is, not where the caret happened to be.
        const at = editorView.posAtCoords({ left: dragEvent.clientX, top: dragEvent.clientY });
        void uploadFilesRef.current(files, at?.pos ?? editorView.state.selection.to);
        return true;
      },
      dispatchTransaction(transaction) {
        const next = viewRef.current?.state.apply(transaction) ?? state.apply(transaction);
        viewRef.current?.updateState(next);
        if (transaction.docChanged) {
          onChangeRef.current(proseMirrorToDocument(next.doc));
        }
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const view = viewRef.current;

  function setLink() {
    if (!view) return;
    const href = window.prompt("URL do link (https://… ou /slug-interno)");
    if (href == null) return;
    const { state } = view;
    const markType = state.schema.marks.link;
    const { from, to } = state.selection;
    let tr = state.tr.removeMark(from, to, markType);
    tr = tr.addMark(from, to, markType.create({ href }));
    view.dispatch(tr);
    view.focus();
  }

  function requestEmbed() {
    if (!view) return;
    const url = window.prompt("URL do vídeo (YouTube)");
    if (!url) return;
    const id = youtubeId(url);
    insertAtom(view, "embed", { url, provider: id ? "youtube" : "unknown", id: id ?? null });
  }

  function requestSource() {
    if (!view) return;
    const label = window.prompt("Fonte (ex: IMDb)");
    if (!label) return;
    const url = window.prompt("URL da fonte") ?? "";
    insertAtom(view, "source", { label, url, kind: "external" });
  }

  /** Opens the media library, remembering where the image should land. */
  function requestLibrary(open?: () => void) {
    pickPosRef.current = viewRef.current?.state.selection.to;
    open?.();
  }

  function pickFiles() {
    const view = viewRef.current;
    view?.focus();
    // Remember the caret now: the file dialog takes focus, and the selection the editor
    // reports once it comes back can no longer be trusted.
    pickPosRef.current = view?.state.selection.to;
    fileRef.current?.click();
  }

  return (
    <div className="peg-editor">
      <div className="peg-editor__toolbar" role="toolbar" aria-label="Formatar texto">
        <ToolbarButton label="Negrito" onClick={() => view && toggleMarkCommand(view.state.schema.marks.bold)(view)}>B</ToolbarButton>
        <ToolbarButton label="Itálico" onClick={() => view && toggleMarkCommand(view.state.schema.marks.italic)(view)}><i>I</i></ToolbarButton>
        <ToolbarButton label="Código" onClick={() => view && toggleMarkCommand(view.state.schema.marks.code)(view)}>{"<>"}</ToolbarButton>
        <ToolbarButton label="Link" onClick={setLink}>🔗</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Parágrafo" onClick={() => view && setParagraph(view)}>P</ToolbarButton>
        <ToolbarButton label="Título 2" onClick={() => view && setHeading(view, 2)}>H2</ToolbarButton>
        <ToolbarButton label="Título 3" onClick={() => view && setHeading(view, 3)}>H3</ToolbarButton>
        <ToolbarButton label="Título 4" onClick={() => view && setHeading(view, 4)}>H4</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Lista com marcadores" onClick={() => view && toggleListType(view, view.state.schema.nodes.bulletList)}>•≡</ToolbarButton>
        <ToolbarButton label="Lista numerada" onClick={() => view && toggleListType(view, view.state.schema.nodes.orderedList)}>1≡</ToolbarButton>
        <ToolbarButton label="Citação" onClick={() => view && run(view, wrapIn(view.state.schema.nodes.blockquote))}>”</ToolbarButton>
        <span className="peg-editor__sep" />
        {onUploadImage && (
          <ToolbarButton label="Inserir imagem do computador" onClick={pickFiles}>🖼</ToolbarButton>
        )}
        <ToolbarButton label="Inserir imagem da biblioteca" onClick={() => requestLibrary(onRequestImage)}>🗂</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Desfazer" onClick={() => view && run(view, undo)}>↺</ToolbarButton>
        <ToolbarButton label="Refazer" onClick={() => view && run(view, redo)}>↻</ToolbarButton>
        <span className="peg-editor__sep" />
        <div style={{ position: "relative" }}>
          <ToolbarButton label="Inserir" onClick={() => setMenuOpen((o) => !o)}>+</ToolbarButton>
          {menuOpen && (
            <div style={{ position: "absolute", top: 32, left: 0, zIndex: 20 }}>
              <Menu
                items={[
                  { label: "Texto", onClick: () => { if (view) setParagraph(view); setMenuOpen(false); } },
                  { label: "H2", onClick: () => { if (view) setHeading(view, 2); setMenuOpen(false); } },
                  { label: "H3", onClick: () => { if (view) setHeading(view, 3); setMenuOpen(false); } },
                  { label: "H4", onClick: () => { if (view) setHeading(view, 4); setMenuOpen(false); } },
                  { label: "Lista", onClick: () => { if (view) toggleListType(view, view.state.schema.nodes.bulletList); setMenuOpen(false); } },
                  { label: "Lista numerada", onClick: () => { if (view) toggleListType(view, view.state.schema.nodes.orderedList); setMenuOpen(false); } },
                  { label: "Quote", onClick: () => { if (view) run(view, wrapIn(view.state.schema.nodes.blockquote)); setMenuOpen(false); } },
                  { type: "separator" },
                  ...(onUploadImage ? [{ label: "Imagem — enviar do computador", onClick: () => { setMenuOpen(false); pickFiles(); } }] : []),
                  { label: "Imagem — da biblioteca", onClick: () => { setMenuOpen(false); requestLibrary(onRequestImage); } },
                  { label: "Galeria", onClick: () => { setMenuOpen(false); requestLibrary(onRequestGallery); } },
                  { label: "Embed (YouTube)", onClick: () => { setMenuOpen(false); requestEmbed(); } },
                  { label: "Tabela", onClick: () => { if (view) insertTableNode(view); setMenuOpen(false); } },
                  { label: "Fonte / Referência", onClick: () => { setMenuOpen(false); requestSource(); } },
                ]}
              />
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length > 0) void uploadFilesRef.current(files, pickPosRef.current);
          }}
        />
      </div>

      {(pending > 0 || uploadError) && (
        <div className="peg-editor__status" role="status" aria-live="polite">
          {pending > 0 ? `Enviando ${pending} imagem(ns)…` : null}
          {uploadError && <span className="peg-editor__status--error">{uploadError}</span>}
        </div>
      )}

      <div ref={hostRef} className="peg-editor__surface" />

      {onUploadImage && (
        <p className="peg-editor__hint">Arraste imagens para o texto ou cole com Ctrl+V — o envio é automático.</p>
      )}
    </div>
  );
});

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="peg-editor__btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
