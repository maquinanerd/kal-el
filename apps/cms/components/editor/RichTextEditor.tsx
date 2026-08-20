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
import { Button, Input, LinkDialog, Menu, Modal } from "@kal-el/design-system";
import { deleteSlashQuery, filterSlashItems, readSlashQuery, type SlashItem, type SlashQuery } from "./slash";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

/** Slash menu box, used to decide whether it fits below the caret. Mirrors the CSS. */
const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 280;

const CLOSED_LINK = { open: false, href: "", text: "", canRemove: false, from: 0, to: 0 };

export type RichTextEditorHandle = {
  insertImage: (mediaId: string, attrs?: { caption?: string; credit?: string; altText?: string }) => void;
  insertGallery: (mediaIds: string[]) => void;
  insertEmbed: (url: string) => void;
  insertTable: () => void;
  insertSource: (label: string, url: string) => void;
  insertLink: (href: string) => void;
};

type Props = {
  /** Rendered inside the focus-mode bar so autosave state stays visible there. */
  statusSlot?: ReactNode;
  document: ArticleDocumentV2;
  onChange: (doc: ArticleDocumentV2) => void;
  onRequestImage?: () => void;
  onRequestGallery?: () => void;
  /**
   * Upload a pasted/dropped file. Returning the media id inserts it directly; the article
   * page instead routes it through the alt-text dialog, so a pasted image cannot reach the
   * document with `alt=""` while a picked one has to be described.
   */
  onUploadFile?: (file: File) => Promise<string | null>;
  /**
   * Renders the internal-article search inside the link dialog. Supplied by the article
   * page, which owns the API client and the active site.
   */
  renderLinkBrowser?: (select: (href: string) => void) => ReactNode;
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

/** Whether the selection sits anywhere inside a node of this type. */
function selectionInside(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

/**
 * Bullet <-> ordered <-> no list.
 *
 * Un-listing used the generic `lift`, which lifts the list ITEM out by one level and
 * leaves the list around it; `liftListItem` is the command that knows how to take the
 * paragraph out of the list entirely. Switching between the two list types lifts first:
 * wrapping a bullet item in an ordered list would nest one list inside the other, which
 * the document contract has no way to store.
 */
function toggleListType(view: EditorView, listType: NodeType) {
  const listItem = view.state.schema.nodes.listItem as NodeType;
  const other = listType === view.state.schema.nodes.bulletList ? view.state.schema.nodes.orderedList : view.state.schema.nodes.bulletList;

  if (selectionInside(view.state, listType)) {
    run(view, liftListItem(listItem));
    return;
  }
  if (selectionInside(view.state, other)) {
    liftListItem(listItem)(view.state, view.dispatch, view);
  }
  run(view, wrapInList(listType));
}

/** Quote on/off. `wrapIn` alone could only ever add one. */
function toggleBlockquote(view: EditorView) {
  const type = view.state.schema.nodes.blockquote as NodeType;
  if (selectionInside(view.state, type)) run(view, lift);
  else run(view, wrapIn(type));
}

/**
 * The full extent of the link mark covering `pos`, or null when there is none.
 *
 * Widening matters because a link is not always one text node: bolding a word inside a
 * link splits it in two, and editing only the half under the caret would leave two
 * adjacent links with different targets.
 */
function linkRangeAt(state: EditorState, pos: number): { href: string; from: number; to: number } | null {
  const markType = state.schema.marks.link;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  let found = parent.childAfter($pos.parentOffset);
  if (!found.node || !markType.isInSet(found.node.marks)) found = parent.childBefore($pos.parentOffset);
  if (!found.node) return null;
  const mark = markType.isInSet(found.node.marks);
  if (!mark) return null;

  let startIndex = found.index;
  let from = $pos.start() + found.offset;
  let endIndex = found.index + 1;
  let to = from + found.node.nodeSize;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    from -= parent.child(startIndex).nodeSize;
  }
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    to += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }
  return { href: String(mark.attrs.href ?? ""), from, to };
}

/**
 * The range the caret or selection actually covers, read back from the DOM.
 *
 * ProseMirror learns about a keyboard selection through its DOM observer, which flushes
 * asynchronously. `Shift+End` immediately followed by Ctrl+K therefore arrived with
 * `state.selection` still collapsed at the caret: the link dialog saw no selection and
 * inserted the URL as fresh text next to the words it should have linked. Reading the DOM
 * selection through `posAtDOM` - public API, and the same source the observer will use -
 * closes that window. Falls back to the state selection whenever the DOM one is missing
 * or lives outside the writing surface.
 */
function domSelectionRange(view: EditorView): { from: number; to: number } {
  const state = { from: view.state.selection.from, to: view.state.selection.to };
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return state;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return state;
  try {
    const a = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const b = view.posAtDOM(sel.focusNode, sel.focusOffset);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  } catch {
    return state;
  }
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

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({ document, onChange, onRequestImage, onRequestGallery, onUploadFile, statusSlot, renderLinkBrowser }, ref) {
  const [focusMode, setFocusMode] = useState(false);
  /** `link` drives the bubble toolbar state: inside a link it offers editing and removal. */
  const [inline, setInline] = useState<{ top: number; left: number; link: boolean } | null>(null);
  const [slash, setSlash] = useState<SlashQuery | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** Where the slash menu is drawn — the caret, not the top of the block. */
  const [slashAt, setSlashAt] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const [linkDialog, setLinkDialog] = useState(CLOSED_LINK);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  // Ctrl+K is bound inside the ProseMirror keymap, which is created once; the ref lets it
  // reach the dialog opener that is defined further down.
  const openLinkDialogRef = useRef<() => void>(() => {});
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
      case "quote": toggleBlockquote(view); break;
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

  // The ProseMirror keymap only fires while the writing surface has DOM focus, so after
  // clicking a toolbar button Escape was inert. This covers the whole mode.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

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
      // same schema instance as the state: see documentToProseMirror's note
      doc: documentToProseMirror(document, schema),
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
        /**
         * Writing shortcuts. `baseKeymap` carries none of these - it is Enter, Backspace,
         * Delete and friends - and `history()` is only the state plugin, so nothing was
         * bound to undo either. Ctrl+B, Ctrl+I and Ctrl+Z were all inert in the shipped
         * editor; the product review confirmed it in Chrome. An editor that needs the
         * mouse for bold is not keyboard-first.
         *
         * `Mod-` resolves to Cmd on macOS and Ctrl elsewhere, so both platforms are
         * covered by one binding. These live on the EDITOR view, not on `window`, so they
         * cannot fire while focus is in the title field or the inspector.
         */
        keymap({
          "Mod-b": toggleMark(schema.marks.bold),
          "Mod-i": toggleMark(schema.marks.italic),
          "Mod-e": toggleMark(schema.marks.code),
          "Mod-k": () => {
            openLinkDialogRef.current();
            return true;
          },
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
          "Mod-Alt-0": setBlockType(schema.nodes.paragraph),
          "Mod-Alt-2": setBlockType(schema.nodes.heading, { level: 2 }),
          "Mod-Alt-3": setBlockType(schema.nodes.heading, { level: 3 }),
          "Mod-Alt-4": setBlockType(schema.nodes.heading, { level: 4 }),
        }),
        keymap({ Enter: splitListItem(listItem), Tab: sinkListItem(listItem), "Shift-Tab": liftListItem(listItem) }),
        keymap(baseKeymap),
      ],
    });

    const dismissInline = () => setInline(null);

    const view = new EditorView(hostRef.current, {
      state,
      handleDOMEvents: {
        blur: () => {
          dismissInline();
          return false;
        },
      },
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
          setSlashAt(null);
        } else {
          /**
           * Anchor the menu to the caret. It used to be pinned by CSS to the top-left of
           * the writing surface, so typing `/` halfway down an article opened the menu
           * over paragraphs the writer had already written, nowhere near the cursor.
           *
           * `coordsAtPos` gives viewport coordinates for the slash character; they are
           * made relative to the positioned host. When there is not enough room below the
           * caret the menu flips above it, so it never runs off the bottom.
           */
          const v = viewRef.current;
          const host = hostRef.current?.getBoundingClientRect();
          if (v && host) {
            const caret = v.coordsAtPos(q.from);
            const spaceBelow = window.innerHeight - caret.bottom;
            const flip = spaceBelow < MENU_MAX_HEIGHT && caret.top > spaceBelow;
            setSlashAt({
              top: flip ? caret.top - host.top : caret.bottom - host.top + 6,
              // keep the menu inside the surface even when the caret is near its right edge
              left: Math.max(0, Math.min(caret.left - host.left, host.width - MENU_WIDTH)),
              flip,
            });
          }
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
              link: linkRangeAt(next, next.selection.from) !== null,
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
          // the handler owns insertion: it asks for alt text before the node exists
          void uploadRef.current(file);
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
        // put the caret where the file landed, then let the handler ask for alt text
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        if (at) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
        void uploadRef.current(file);
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

  /**
   * Reads the link mark the caret currently sits in, so the dialog can open pre-filled
   * and offer "remove" instead of silently creating a second overlapping link.
   *
   * This used to ask `$from.marks()`, which reports the marks of the character BEFORE the
   * position - so a caret at the first character of a link, and every selection made by
   * double-clicking the linked word (whose `from` is exactly that position), came back
   * "not a link". The dialog then opened empty with no remove action, which is what the
   * product review hit. Resolving the child node at the position and falling back to the
   * one before it covers both edges.
   */
  function currentLink(): { href: string; text: string; from: number; to: number } | null {
    const v = viewRef.current;
    if (!v) return null;
    const { from, to } = domSelectionRange(v);
    const range = linkRangeAt(v.state, from) ?? (from === to ? null : linkRangeAt(v.state, to));
    if (!range) return null;
    return { ...range, text: v.state.doc.textBetween(range.from, range.to) };
  }

  /**
   * The dialog remembers the range it was opened on.
   *
   * It cannot re-read it on apply: opening the modal moves focus out of the writing
   * surface, which collapses the DOM selection, so by the time anyone presses "Aplicar"
   * the words the writer had selected are no longer selected anywhere.
   */
  function openLinkDialog() {
    const v = viewRef.current;
    if (!v) return;
    const existing = currentLink();
    const selected = domSelectionRange(v);
    const from = existing ? existing.from : selected.from;
    const to = existing ? existing.to : selected.to;
    setLinkDialog({
      open: true,
      href: existing?.href ?? "",
      text: existing?.text ?? v.state.doc.textBetween(from, to),
      canRemove: existing !== null,
      from,
      to,
    });
  }
  openLinkDialogRef.current = openLinkDialog;

  function applyLink(href: string, text?: string) {
    const v = viewRef.current;
    if (!v) return;
    const { state } = v;
    const markType = state.schema.marks.link;
    // the range captured when the dialog opened, not the live selection
    const { from, to } = linkDialog;
    const mark = markType.create({ href, internal: href.startsWith("/") ? true : null });

    if (from === to) {
      // no selection and not inside a link: insert the URL (or the typed label) as its own
      // linked text
      const node = state.schema.text(text?.trim() || href, [mark]);
      v.dispatch(state.tr.replaceSelectionWith(node, false));
    } else if (text !== undefined && text.trim() !== "" && text !== state.doc.textBetween(from, to)) {
      // the label was edited in the dialog: replace the text, keep it linked
      v.dispatch(state.tr.replaceWith(from, to, state.schema.text(text.trim(), [mark])));
    } else {
      let tr = state.tr.removeMark(from, to, markType);
      tr = tr.addMark(from, to, mark);
      v.dispatch(tr);
    }
    setLinkDialog(CLOSED_LINK);
    v.focus();
  }

  /** Only the mark goes; `removeMark` never touches the text it covered. */
  function removeLinkRange(from: number, to: number) {
    const v = viewRef.current;
    if (!v || from === to) return;
    v.dispatch(v.state.tr.removeMark(from, to, v.state.schema.marks.link));
    setLinkDialog(CLOSED_LINK);
    v.focus();
  }

  /** From the dialog, which acts on the range it was opened on. */
  function removeLink() {
    removeLinkRange(linkDialog.from, linkDialog.to);
  }

  /** From the bubble toolbar, where the selection is still live. */
  function removeLinkAtSelection() {
    const existing = currentLink();
    if (existing) removeLinkRange(existing.from, existing.to);
  }

  // stable refs so the slash applier (defined above the view) can reach these
  const requestEmbedRef = useRef<() => void>(() => {});
  const requestSourceRef = useRef<() => void>(() => {});

  function requestEmbed() {
    setEmbedOpen(true);
  }

  function requestSource() {
    setSourceOpen(true);
  }

  requestEmbedRef.current = requestEmbed;
  requestSourceRef.current = requestSource;

  const slashItems = slash ? filterSlashItems(slash.query) : [];

  return (
    <div className={`peg-editor ${focusMode ? "peg-editor--focus" : ""}`}>
      {focusMode && (
        <div className="peg-editor__focus-bar">
          {/* the save state travels into focus mode: hiding it behind an opaque overlay
              meant a writer could keep typing for an hour into a failing autosave */}
          <div className="peg-editor__focus-status">{statusSlot}</div>
          <span className="peg-editor__focus-hint">Esc para sair</span>
          <button type="button" className="peg-btn peg-btn--sm peg-btn--secondary" onClick={() => setFocusMode(false)}>
            Sair do modo foco
          </button>
        </div>
      )}
      <div className="peg-editor__toolbar" role="toolbar" aria-label="Formatar texto">
        <ToolbarButton label="Negrito (Ctrl+B)" onClick={() => view && toggleMarkCommand(view.state.schema.marks.bold)(view)}>B</ToolbarButton>
        <ToolbarButton label="Itálico (Ctrl+I)" onClick={() => view && toggleMarkCommand(view.state.schema.marks.italic)(view)}><i>I</i></ToolbarButton>
        <ToolbarButton label="Código" onClick={() => view && toggleMarkCommand(view.state.schema.marks.code)(view)}>{"<>"}</ToolbarButton>
        <ToolbarButton label="Link (Ctrl+K)" onClick={openLinkDialog}>🔗</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Parágrafo" onClick={() => view && setParagraph(view)}>P</ToolbarButton>
        <ToolbarButton label="Título 2" onClick={() => view && setHeading(view, 2)}>H2</ToolbarButton>
        <ToolbarButton label="Título 3" onClick={() => view && setHeading(view, 3)}>H3</ToolbarButton>
        <ToolbarButton label="Título 4" onClick={() => view && setHeading(view, 4)}>H4</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Lista com marcadores" onClick={() => view && toggleListType(view, view.state.schema.nodes.bulletList)}>•≡</ToolbarButton>
        <ToolbarButton label="Lista numerada" onClick={() => view && toggleListType(view, view.state.schema.nodes.orderedList)}>1≡</ToolbarButton>
        <ToolbarButton label="Citação" onClick={() => view && toggleBlockquote(view)}>”</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton
          label={focusMode ? "Sair do modo sem distrações" : "Modo sem distrações"}
          onClick={() => setFocusMode((f) => !f)}
        >
          {focusMode ? "◱" : "◰"}
        </ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Desfazer (Ctrl+Z)" onClick={() => view && run(view, undo)}>↺</ToolbarButton>
        <ToolbarButton label="Refazer (Ctrl+Shift+Z)" onClick={() => view && run(view, redo)}>↻</ToolbarButton>
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
                  { label: "Quote", onClick: () => { if (view) toggleBlockquote(view); setMenuOpen(false); } },
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
              className={`peg-inline-toolbar__btn ${inline.link ? "peg-inline-toolbar__btn--active" : ""}`}
              aria-label={inline.link ? "Editar link" : "Link"}
              aria-pressed={inline.link}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openLinkDialog}
            >
              🔗
            </button>
            {/* removal reachable without opening the dialog, which is the common case */}
            {inline.link && (
              <button
                type="button"
                className="peg-inline-toolbar__btn"
                aria-label="Remover link"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeLinkAtSelection}
              >
                ⛔
              </button>
            )}
          </div>
        )}
        <div ref={hostRef} className="peg-editor__surface" />
        {slash && slashItems.length > 0 && (
          <div
            className="peg-slash-menu"
            role="listbox"
            aria-label="Inserir bloco"
            style={
              slashAt
                ? slashAt.flip
                  ? { top: "auto", left: slashAt.left, bottom: `calc(100% - ${slashAt.top}px + 6px)` }
                  : { top: slashAt.top, left: slashAt.left }
                : undefined
            }
          >
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

      {/* Every native prompt the editor used is now a PEG dialog: styled, validated,
          cancellable, and reachable by keyboard. `window.prompt` could not do any of it. */}
      <LinkDialog
        open={linkDialog.open}
        initialHref={linkDialog.href}
        initialText={linkDialog.text}
        canRemove={linkDialog.canRemove}
        browse={renderLinkBrowser}
        onApply={(href, text) => applyLink(href, text)}
        onRemove={removeLink}
        onClose={() => {
          setLinkDialog(CLOSED_LINK);
          viewRef.current?.focus();
        }}
      />

      <UrlDialog
        open={embedOpen}
        title="Inserir vídeo"
        label="URL do vídeo"
        placeholder="https://youtube.com/watch?v=…"
        hint="Cole o endereço do YouTube. O vídeo entra como embed, nunca como marcação bruta."
        onConfirm={(url) => {
          const v = viewRef.current;
          if (v) {
            const id = youtubeId(url);
            insertAtom(v, "embed", { url, provider: id ? "youtube" : "unknown", id: id ?? null });
          }
          setEmbedOpen(false);
        }}
        onClose={() => setEmbedOpen(false)}
      />

      <SourceDialog
        open={sourceOpen}
        onConfirm={(label, url) => {
          const v = viewRef.current;
          if (v) insertAtom(v, "source", { label, url, kind: "external" });
          setSourceOpen(false);
        }}
        onClose={() => setSourceOpen(false)}
      />
    </div>
  );
});

/** Single-URL dialog, for the embed block. */
function UrlDialog({
  open,
  title,
  label,
  placeholder,
  hint,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  hint?: string;
  onConfirm: (url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl("");
      setTouched(false);
    }
  }, [open]);

  if (!open) return null;

  const valid = /^https?:\/\/\S+$/.test(url.trim());
  const submit = () => {
    setTouched(true);
    if (valid) onConfirm(url.trim());
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={touched && !valid}>Inserir</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input
          label={label}
          autoFocus
          value={url}
          placeholder={placeholder}
          hint={hint}
          error={touched && !valid ? "Informe uma URL http(s) completa." : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** Label + URL, for the linked-source block. Two chained prompts before this. */
function SourceDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean;
  onConfirm: (label: string, url: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel("");
      setUrl("");
      setTouched(false);
    }
  }, [open]);

  if (!open) return null;

  const labelOk = label.trim().length > 0;
  const urlOk = url.trim() === "" || /^https?:\/\/\S+$/.test(url.trim());
  const submit = () => {
    setTouched(true);
    if (labelOk && urlOk) onConfirm(label.trim(), url.trim());
  };

  return (
    <Modal
      title="Fonte / referência"
      onClose={onClose}
      width={460}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={touched && (!labelOk || !urlOk)}>Inserir</Button>
        </>
      }
    >
      <form className="peg-stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input
          label="Fonte"
          autoFocus
          value={label}
          placeholder="IMDb, Reuters, assessoria…"
          error={touched && !labelOk ? "Informe o nome da fonte." : undefined}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          label="URL"
          optional
          value={url}
          placeholder="https://…"
          hint="Deixe em branco para uma fonte sem link público."
          error={touched && !urlOk ? "Informe uma URL http(s) completa ou deixe em branco." : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="peg-editor__btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
