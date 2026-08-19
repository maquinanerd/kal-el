"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorView } from "@tiptap/pm/view";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from "@tiptap/pm/commands";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import type { MarkType, NodeType } from "@tiptap/pm/model";
import { buildTiptapSchema, documentToProseMirror, proseMirrorToDocument } from "@kal-el/editor";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { Menu } from "@kal-el/design-system";
import { deleteSlashQuery, filterSlashItems, readSlashQuery, type SlashItem, type SlashQuery } from "./slash";

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
  onRequestImage?: () => void;
  onRequestGallery?: () => void;
  /** Upload a pasted/dropped file and return the created media id. */
  onUploadFile?: (file: File) => Promise<string | null>;
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

function insertAtom(view: EditorView, typeName: string, attrs: Record<string, unknown>) {
  const nodeType = view.state.schema.nodes[typeName] as NodeType;
  // drop empty attrs: the document schema types these as optional strings, not nullable
  const clean = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined));
  const node = nodeType.create(clean);
  const tr = view.state.tr.replaceSelectionWith(node);
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

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ document, onChange, onRequestImage, onRequestGallery, onUploadFile }, ref) {
  const [focusMode, setFocusMode] = useState(false);
  const [inline, setInline] = useState<{ top: number; left: number } | null>(null);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<{ q: SlashQuery | null; index: number }>({ q: null, index: 0 });
  const uploadRef = useRef(onUploadFile);
  uploadRef.current = onUploadFile;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [menuOpen, setMenuOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    insertImage: (mediaId, attrs) => {
      const view = viewRef.current;
      if (!view) return;
      // altText is passed through verbatim: "" is a deliberate "decorative", which is
      // different from not having been asked.
      insertAtom(view, "image", {
        mediaId,
        caption: attrs?.caption,
        credit: attrs?.credit,
        altText: attrs?.altText,
      });
    },
    insertGallery: (mediaIds) => {
      const view = viewRef.current;
      if (!view) return;
      insertAtom(view, "gallery", { mediaIds });
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

  /**
   * Applies a slash command: removes the typed `/query` first so the chosen block does
   * not inherit it, then runs the same action the toolbar would.
   */
  function applySlash(item: SlashItem) {
    const view = viewRef.current;
    const q = slashRef.current.q;
    if (!view || !q) return;
    view.dispatch(deleteSlashQuery(view.state, q));
    slashRef.current.q = null;
    setSlash(null);
    setSlashIndex(0);

    switch (item.id) {
      case "paragraph": setParagraph(view); break;
      case "h2": setHeading(view, 2); break;
      case "h3": setHeading(view, 3); break;
      case "h4": setHeading(view, 4); break;
      case "bullet": toggleListType(view, view.state.schema.nodes.bulletList); break;
      case "ordered": toggleListType(view, view.state.schema.nodes.orderedList); break;
      case "quote": run(view, wrapIn(view.state.schema.nodes.blockquote)); break;
      case "table": insertTableNode(view); break;
      case "image": onRequestImage?.(); break;
      case "gallery": onRequestGallery?.(); break;
      case "embed": requestEmbedRef.current(); break;
      case "source": requestSourceRef.current(); break;
    }
    view.focus();
  }

  const applySlashRef = useRef(applySlash);
  applySlashRef.current = applySlash;

  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;

  /** Returns true when the slash menu consumed the key. */
  function slashKey(action: "up" | "down" | "enter" | "escape"): boolean {
    const q = slashRef.current.q;
    if (!q) return false;
    const items = filterSlashItems(q.query);
    if (items.length === 0) return false;

    if (action === "escape") {
      slashRef.current.q = null;
      setSlash(null);
      return true;
    }
    if (action === "down" || action === "up") {
      const delta = action === "down" ? 1 : -1;
      const next = (slashRef.current.index + delta + items.length) % items.length;
      slashRef.current.index = next;
      setSlashIndex(next);
      return true;
    }
    const chosen = items[Math.min(slashRef.current.index, items.length - 1)];
    if (chosen) applySlashRef.current(chosen);
    return true;
  }

  useEffect(() => {
    if (!hostRef.current) return;
    const schema = buildTiptapSchema();
    const listItem = schema.nodes.listItem as NodeType;
    const state = EditorState.create({
      schema,
      doc: documentToProseMirror(document),
      plugins: [
        history(),
        // ahead of every other binding: while the slash menu is open it owns
        // ArrowUp/ArrowDown/Enter/Escape
        keymap({
          ArrowDown: () => slashKey("down"),
          ArrowUp: () => slashKey("up"),
          Enter: () => slashKey("enter"),
          Escape: () => {
            if (slashKey("escape")) return true;
            if (focusModeRef.current) {
              setFocusMode(false);
              return true;
            }
            return false;
          },
        }),
        keymap({ Enter: splitListItem(listItem), Tab: sinkListItem(listItem), "Shift-Tab": liftListItem(listItem) }),
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(hostRef.current, {
      state,
      dispatchTransaction(transaction) {
        const next = viewRef.current?.state.apply(transaction) ?? state.apply(transaction);
        viewRef.current?.updateState(next);
        if (transaction.docChanged) {
          onChangeRef.current(proseMirrorToDocument(next.doc));
        }
        const q = readSlashQuery(next);
        slashRef.current.q = q;
        setSlash(q);
        if (!q) {
          slashRef.current.index = 0;
          setSlashIndex(0);
        }

        // Contextual inline toolbar: anchored to the selection, only while there IS one.
        const view = viewRef.current;
        if (!view || next.selection.empty || q) {
          setInline(null);
        } else {
          const start = view.coordsAtPos(next.selection.from);
          const end = view.coordsAtPos(next.selection.to);
          const host = hostRef.current?.getBoundingClientRect();
          if (host) {
            setInline({
              top: Math.min(start.top, end.top) - host.top - 44,
              left: Math.max(0, (start.left + end.left) / 2 - host.left - 90),
            });
          }
        }
      },

      /** Paste: an image file becomes an uploaded image node; a bare YouTube URL an embed. */
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        const file = Array.from(clipboard.files).find((f) => f.type.startsWith("image/"));
        if (file && uploadRef.current) {
          event.preventDefault();
          void uploadRef.current(file).then((mediaId) => {
            if (mediaId) insertAtom(view, "image", { mediaId, altText: null, caption: null, credit: null });
          });
          return true;
        }

        // a bare YouTube URL pasted on its own becomes a safe embed, never raw markup
        const text = clipboard.getData("text/plain").trim();
        const id = text ? youtubeId(text) : null;
        if (id && /^https?:\/\/\S+$/.test(text)) {
          event.preventDefault();
          insertAtom(view, "embed", { url: text, provider: "youtube", id });
          return true;
        }
        return false;
      },

      /** Drop an image file straight onto the writing surface. */
      handleDrop(view, event) {
        const dt = (event as DragEvent).dataTransfer;
        const file = dt ? Array.from(dt.files).find((f) => f.type.startsWith("image/")) : undefined;
        if (!file || !uploadRef.current) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        void uploadRef.current(file).then((mediaId) => {
          if (!mediaId) return;
          if (at) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
          insertAtom(view, "image", { mediaId, altText: null, caption: null, credit: null });
        });
        return true;
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

  // stable refs so the slash applier (defined above the view) can reach these
  const requestEmbedRef = useRef<() => void>(() => {});
  const requestSourceRef = useRef<() => void>(() => {});

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

  requestEmbedRef.current = requestEmbed;
  requestSourceRef.current = requestSource;

  const slashItems = slash ? filterSlashItems(slash.query) : [];

  return (
    <div className={`peg-editor ${focusMode ? "peg-editor--focus" : ""}`}>
      {focusMode && (
        <div className="peg-editor__focus-bar">
          <span className="peg-editor__focus-hint">Modo sem distrações · Esc para sair</span>
          <button type="button" className="peg-btn peg-btn--sm peg-btn--secondary" onClick={() => setFocusMode(false)}>
            Sair do modo foco
          </button>
        </div>
      )}
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
        <ToolbarButton
          label={focusMode ? "Sair do modo sem distrações" : "Modo sem distrações"}
          onClick={() => setFocusMode((f) => !f)}
        >
          {focusMode ? "◱" : "◰"}
        </ToolbarButton>
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
                  { label: "Imagem", onClick: () => { setMenuOpen(false); onRequestImage?.(); } },
                  { label: "Galeria", onClick: () => { setMenuOpen(false); onRequestGallery?.(); } },
                  { label: "Embed (YouTube)", onClick: () => { setMenuOpen(false); requestEmbed(); } },
                  { label: "Tabela", onClick: () => { if (view) insertTableNode(view); setMenuOpen(false); } },
                  { label: "Fonte / Referência", onClick: () => { setMenuOpen(false); requestSource(); } },
                ]}
              />
            </div>
          )}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        {inline && (
          <div
            className="peg-inline-toolbar"
            role="toolbar"
            aria-label="Formatação da seleção"
            style={{ top: inline.top, left: inline.left }}
          >
            <button
              type="button"
              className="peg-inline-toolbar__btn"
              aria-label="Negrito"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view && toggleMarkCommand(view.state.schema.marks.bold)(view)}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className="peg-inline-toolbar__btn"
              aria-label="Itálico"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view && toggleMarkCommand(view.state.schema.marks.italic)(view)}
            >
              <em>I</em>
            </button>
            <span className="peg-inline-toolbar__sep" />
            <button
              type="button"
              className="peg-inline-toolbar__btn"
              aria-label="Link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={setLink}
            >
              🔗
            </button>
          </div>
        )}
        <div ref={hostRef} className="peg-editor__surface" />
        {slash && slashItems.length > 0 && (
          <div className="peg-slash-menu" role="listbox" aria-label="Inserir bloco">
            {slashItems.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                className={`peg-slash-menu__item ${i === slashIndex ? "peg-slash-menu__item--active" : ""}`}
                onMouseEnter={() => {
                  slashRef.current.index = i;
                  setSlashIndex(i);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlash(item);
                }}
              >
                <span>{item.label}</span>
                <span className="peg-slash-menu__hint">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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
