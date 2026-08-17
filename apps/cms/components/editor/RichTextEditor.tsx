"use client";

import { useEffect, useRef } from "react";
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

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

type Props = {
  document: ArticleDocumentV2;
  onChange: (doc: ArticleDocumentV2) => void;
};

function run(view: EditorView, command: Command) {
  command(view.state, view.dispatch, view);
  view.focus();
}

function toggleMarkCommand(markType: MarkType) {
  return (view: EditorView) => run(view, toggleMark(markType));
}

function setHeading(view: EditorView, level: number) {
  const nodeType = view.state.schema.nodes.heading;
  run(view, setBlockType(nodeType, { level }));
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

function toggleBullet(view: EditorView) {
  toggleListType(view, view.state.schema.nodes.bulletList);
}

function toggleOrdered(view: EditorView) {
  toggleListType(view, view.state.schema.nodes.orderedList);
}

function toggleBlockquote(view: EditorView) {
  run(view, wrapIn(view.state.schema.nodes.blockquote));
}

function setLink(view: EditorView) {
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

export function RichTextEditor({ document, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

  return (
    <div className="peg-editor">
      <div className="peg-editor__toolbar" role="toolbar" aria-label="Formatar texto">
        <ToolbarButton label="Negrito" onClick={() => view && toggleMarkCommand(view.state.schema.marks.bold)(view)}>B</ToolbarButton>
        <ToolbarButton label="Itálico" onClick={() => view && toggleMarkCommand(view.state.schema.marks.italic)(view)}><i>I</i></ToolbarButton>
        <ToolbarButton label="Código" onClick={() => view && toggleMarkCommand(view.state.schema.marks.code)(view)}>{"<>"}</ToolbarButton>
        <ToolbarButton label="Link" onClick={() => view && setLink(view)}>🔗</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Parágrafo" onClick={() => view && setParagraph(view)}>P</ToolbarButton>
        <ToolbarButton label="Título 2" onClick={() => view && setHeading(view, 2)}>H2</ToolbarButton>
        <ToolbarButton label="Título 3" onClick={() => view && setHeading(view, 3)}>H3</ToolbarButton>
        <ToolbarButton label="Título 4" onClick={() => view && setHeading(view, 4)}>H4</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Lista com marcadores" onClick={() => view && toggleBullet(view)}>•≡</ToolbarButton>
        <ToolbarButton label="Lista numerada" onClick={() => view && toggleOrdered(view)}>1≡</ToolbarButton>
        <ToolbarButton label="Citação" onClick={() => view && toggleBlockquote(view)}>”</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Desfazer" onClick={() => view && run(view, undo)}>↺</ToolbarButton>
        <ToolbarButton label="Refazer" onClick={() => view && run(view, redo)}>↻</ToolbarButton>
      </div>
      <div ref={hostRef} className="peg-editor__surface" />
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="peg-editor__btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
