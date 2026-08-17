"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorView } from "@tiptap/pm/view";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from "@tiptap/pm/commands";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import type { MarkType, NodeType } from "@tiptap/pm/model";
import { buildTiptapSchema, documentToProseMirror, proseMirrorToDocument } from "@kal-el/editor";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { Menu } from "@kal-el/design-system";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

export type RichTextEditorHandle = {
  insertImage: (mediaId: string, attrs?: { caption?: string; credit?: string; altText?: string }) => void;
  insertGallery: (mediaIds: string[]) => void;
  insertEmbed: (url: string) => void;
  insertTable: () => void;
  insertSource: (label: string, url: string) => void;
};

type Props = {
  document: ArticleDocumentV2;
  onChange: (doc: ArticleDocumentV2) => void;
  onRequestImage?: () => void;
  onRequestGallery?: () => void;
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
  const node = nodeType.create(attrs);
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

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ document, onChange, onRequestImage, onRequestGallery }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [menuOpen, setMenuOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    insertImage: (mediaId, attrs) => {
      const view = viewRef.current;
      if (!view) return;
      insertAtom(view, "image", { mediaId, caption: attrs?.caption ?? null, credit: attrs?.credit ?? null, altText: attrs?.altText ?? null });
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

    const view = new EditorView(hostRef.current, {
      state,
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
      <div ref={hostRef} className="peg-editor__surface" />
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
