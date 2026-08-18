import type { EditorState, Transaction } from "@tiptap/pm/state";

/**
 * Slash commands are part of the documented editor contract (docs/02-EDITOR-UX.md).
 *
 * The menu is driven from the ProseMirror document rather than from DOM events, so it
 * behaves correctly with IME input, undo, and programmatic edits: on every transaction we
 * ask whether the caret sits immediately after a `/query` at the start of an empty-ish
 * paragraph, and derive the menu state from the answer.
 */
export type SlashQuery = {
  /** document position of the `/` character */
  from: number;
  /** document position of the caret */
  to: number;
  /** text typed after the `/`, lowercased */
  query: string;
};

const MAX_QUERY = 24;

export function readSlashQuery(state: EditorState): SlashQuery | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $from = selection.$from;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return null;

  const offset = $from.parentOffset;
  const textBefore = parent.textBetween(0, offset, undefined, "￼");

  // the slash must open the block, or follow whitespace
  const match = /(?:^|\s)\/([^\s/]{0,24})$/.exec(textBefore);
  if (!match) return null;

  const typed = match[1] ?? "";
  if (typed.length > MAX_QUERY) return null;

  const slashOffset = offset - typed.length - 1;
  return {
    from: $from.start() + slashOffset,
    to: selection.from,
    query: typed.toLowerCase(),
  };
}

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
};

export const SLASH_ITEMS: SlashItem[] = [
  { id: "paragraph", label: "Parágrafo", hint: "Texto corrido", keywords: ["paragrafo", "texto", "p"] },
  { id: "h2", label: "Título H2", hint: "Seção", keywords: ["h2", "titulo", "secao", "heading"] },
  { id: "h3", label: "Título H3", hint: "Subseção", keywords: ["h3", "subtitulo", "heading"] },
  { id: "h4", label: "Título H4", hint: "Sub-subseção", keywords: ["h4", "heading"] },
  { id: "bullet", label: "Lista", hint: "Marcadores", keywords: ["lista", "bullet", "ul", "marcador"] },
  { id: "ordered", label: "Lista numerada", hint: "1, 2, 3…", keywords: ["numerada", "ordered", "ol", "numero"] },
  { id: "quote", label: "Citação", hint: "Bloco citado", keywords: ["citacao", "quote", "blockquote"] },
  { id: "image", label: "Imagem", hint: "Da biblioteca de mídia", keywords: ["imagem", "image", "foto", "midia"] },
  { id: "gallery", label: "Galeria", hint: "Várias imagens", keywords: ["galeria", "gallery"] },
  { id: "embed", label: "Embed", hint: "YouTube", keywords: ["embed", "video", "youtube"] },
  { id: "table", label: "Tabela", hint: "Linhas e colunas", keywords: ["tabela", "table"] },
  { id: "source", label: "Fonte", hint: "Referência externa", keywords: ["fonte", "source", "referencia"] },
];

export function filterSlashItems(query: string): SlashItem[] {
  if (!query) return SLASH_ITEMS;
  const q = query.toLowerCase();
  return SLASH_ITEMS.filter(
    (item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.startsWith(q) || k.includes(q)),
  );
}

/** Remove the `/query` text so the chosen block does not keep it. */
export function deleteSlashQuery(state: EditorState, q: SlashQuery): Transaction {
  return state.tr.delete(q.from, q.to);
}
