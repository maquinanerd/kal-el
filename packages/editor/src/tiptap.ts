import type { ArticleDocumentV2, DocumentNodeV2, InlineContent, Mark } from "@kal-el/contracts";
import { inlineContentToText, normalizeInlineContent, textToInline } from "@kal-el/contracts";
import { Node, Schema, type Mark as ProseMirrorMark, type MarkSpec, type NodeSpec } from "@tiptap/pm/model";

/**
 * ProseMirror schema mirroring the Kal El versioned document schema
 * (packages/contracts/src/editorial.ts). The schema is the sanitizer: unknown
 * node types / marks are rejected by `Node.fromJSON` instead of being stored.
 */
export function buildTiptapSchema(): Schema {
  const text: NodeSpec = { group: "inline" };
  const hardBreak: NodeSpec = { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] };
  const paragraph: NodeSpec = { group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] };
  const heading: NodeSpec = {
    group: "block",
    content: "inline*",
    attrs: { level: { default: 2 } },
    parseDOM: [{ tag: "h2", attrs: { level: 2 } }, { tag: "h3", attrs: { level: 3 } }, { tag: "h4", attrs: { level: 4 } }],
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  };
  const blockquote: NodeSpec = { group: "block", content: "inline*", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] };
  const bulletList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] };
  const orderedList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ol" }], toDOM: () => ["ol", 0] };
  const listItem: NodeSpec = { content: "inline*", parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] };
  const image: NodeSpec = {
    group: "block",
    atom: true,
    attrs: { mediaId: {}, caption: { default: null }, credit: { default: null }, altText: { default: null } },
    parseDOM: [{ tag: "img[src]" }],
    toDOM: () => ["img"],
  };
  const gallery: NodeSpec = { group: "block", atom: true, attrs: { mediaIds: { default: [] } }, toDOM: () => ["div", 0] };
  const embed: NodeSpec = { group: "block", atom: true, attrs: { url: {}, provider: {}, id: { default: null } }, toDOM: () => ["div", 0] };
  const source: NodeSpec = { group: "block", atom: true, attrs: { label: {}, url: {}, kind: { default: null } }, toDOM: () => ["div", 0] };
  const table: NodeSpec = { group: "block", content: "tableRow+", toDOM: () => ["table", 0] };
  const tableRow: NodeSpec = { content: "tableCell+", toDOM: () => ["tr", 0] };
  const tableCell: NodeSpec = { content: "inline*", attrs: { header: { default: false } }, toDOM: (n) => [n.attrs.header ? "th" : "td", 0] };

  const bold: MarkSpec = { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] };
  const italic: MarkSpec = { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] };
  const code: MarkSpec = { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] };
  const underline: MarkSpec = { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] };
  const strike: MarkSpec = { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }], toDOM: () => ["s", 0] };
  const link: MarkSpec = {
    attrs: { href: {}, title: { default: null }, internal: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const el = dom as { getAttribute(name: string): string | null };
          const href = el.getAttribute("href") ?? "";
          return { href, title: el.getAttribute("title") ?? null, internal: href.startsWith("/") ? true : null };
        },
      },
    ],
    toDOM: (mark) => {
      const { href, title } = mark.attrs as { href: string; title: string | null };
      return ["a", { href, ...(title ? { title } : {}) }, 0];
    },
  };

  return new Schema({
    nodes: {
      doc: { content: "block+" },
      text,
      hardBreak,
      paragraph,
      heading,
      blockquote,
      bulletList,
      orderedList,
      listItem,
      image,
      gallery,
      embed,
      source,
      table,
      tableRow,
      tableCell,
    },
    marks: { bold, italic, code, underline, strike, link },
  });
}

function attrsFor(node: DocumentNodeV2): Record<string, unknown> {
  switch (node.type) {
    case "heading":
      return { level: node.attrs.level };
    case "image":
      return { mediaId: node.attrs.mediaId, caption: node.attrs.caption ?? null, credit: node.attrs.credit ?? null, altText: node.attrs.altText ?? null };
    case "gallery":
      return { mediaIds: node.attrs.mediaIds };
    case "embed":
      return { url: node.attrs.url, provider: node.attrs.provider, id: node.attrs.id ?? null };
    case "source":
      return { label: node.attrs.label, url: node.attrs.url, kind: node.attrs.kind ?? null };
    case "list":
      return { ordered: node.attrs.ordered };
    case "table":
      return { headers: node.attrs.headers };
    default:
      return {};
  }
}

function markToPmJson(mark: Mark): Record<string, unknown> {
  if (mark.type === "link") {
    return { type: "link", attrs: { href: mark.attrs.href, title: mark.attrs.title ?? null, internal: mark.attrs.internal ?? null } };
  }
  return { type: mark.type };
}

function inlineToPmJson(content: InlineContent): Record<string, unknown>[] {
  return content.map((n) => {
    if (n.type === "hardBreak") return { type: "hardBreak" };
    return { type: "text", text: n.text, marks: n.marks.map(markToPmJson) };
  });
}

function proseJson(node: DocumentNodeV2): Record<string, unknown> {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: inlineToPmJson(node.content) };
    case "heading":
      return { type: "heading", attrs: { level: node.attrs.level }, content: inlineToPmJson(node.content) };
    case "quote":
      return { type: "blockquote", content: inlineToPmJson(node.content) };
    case "list":
      return {
        type: node.attrs.ordered ? "orderedList" : "bulletList",
        content: node.content.map((item) => ({ type: "listItem", content: inlineToPmJson(item) })),
      };
    case "table":
      return {
        type: "table",
        content: node.content.map((row, ri) => ({
          type: "tableRow",
          content: row.map((cell) => ({
            type: "tableCell",
            attrs: { header: ri === 0 && node.attrs.headers.includes(inlineContentToText(cell)) },
            content: inlineToPmJson(cell),
          })),
        })),
      };
    case "image":
      return { type: "image", attrs: attrsFor(node) };
    case "gallery":
      return { type: "gallery", attrs: attrsFor(node) };
    case "embed":
      return { type: "embed", attrs: attrsFor(node) };
    case "source":
      return { type: "source", attrs: attrsFor(node) };
  }
}

/** Validate + convert a Kal El v2 document into a ProseMirror doc node. Throws on unknown/invalid nodes. */
export function documentToProseMirror(document: ArticleDocumentV2): Node {
  const schema = buildTiptapSchema();
  const json = { type: "doc", content: document.nodes.map(proseJson) };
  return Node.fromJSON(schema, json);
}

function markFromPm(mark: ProseMirrorMark): Mark {
  if (mark.type.name === "link") {
    const attrs = mark.attrs as { href: string; title?: string | null; internal?: boolean | null };
    return {
      type: "link",
      attrs: {
        href: attrs.href,
        ...(attrs.title ? { title: attrs.title } : {}),
        ...(attrs.internal != null ? { internal: attrs.internal } : {}),
      },
    };
  }
  return { type: mark.type.name as "bold" | "italic" | "code" | "underline" | "strike" };
}

function inlineFromPm(node: Node): InlineContent {
  const out: InlineContent = [];
  node.forEach((child) => {
    if (child.isText) {
      out.push({ type: "text", text: child.text ?? "", marks: child.marks.map(markFromPm) });
    } else if (child.type.name === "hardBreak") {
      out.push({ type: "hardBreak" });
    }
  });
  return normalizeInlineContent(out);
}

/** Convert a ProseMirror doc node back into a Kal El v2 document (round-trip). */
export function proseMirrorToDocument(node: Node): ArticleDocumentV2 {
  const nodes: DocumentNodeV2[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case "paragraph":
        nodes.push({ type: "paragraph", attrs: {}, content: inlineFromPm(child) });
        break;
      case "heading":
        nodes.push({ type: "heading", attrs: { level: child.attrs.level as 2 | 3 | 4 }, content: inlineFromPm(child) });
        break;
      case "blockquote":
        nodes.push({ type: "quote", attrs: {}, content: inlineFromPm(child) });
        break;
      case "bulletList":
      case "orderedList": {
        const items: InlineContent[] = [];
        child.forEach((li) => items.push(inlineFromPm(li)));
        nodes.push({ type: "list", attrs: { ordered: child.type.name === "orderedList" }, content: items });
        break;
      }
      case "table": {
        const rows: InlineContent[][] = [];
        const headers: string[] = [];
        let first = true;
        child.forEach((tr) => {
          const cells: InlineContent[] = [];
          tr.forEach((td) => {
            const content = inlineFromPm(td);
            if (first && td.attrs.header) headers.push(inlineContentToText(content));
            cells.push(content);
          });
          first = false;
          rows.push(cells);
        });
        nodes.push({ type: "table", attrs: { headers }, content: rows });
        break;
      }
      case "image":
        nodes.push({ type: "image", attrs: { mediaId: child.attrs.mediaId as string, caption: child.attrs.caption as string | undefined, credit: child.attrs.credit as string | undefined, altText: child.attrs.altText as string | undefined } });
        break;
      case "gallery":
        nodes.push({ type: "gallery", attrs: { mediaIds: child.attrs.mediaIds as string[] } });
        break;
      case "embed":
        nodes.push({ type: "embed", attrs: { url: child.attrs.url as string, provider: child.attrs.provider as string, id: child.attrs.id as string | undefined } });
        break;
      case "source":
        nodes.push({ type: "source", attrs: { label: child.attrs.label as string, url: child.attrs.url as string, kind: child.attrs.kind as string | undefined } });
        break;
    }
  });
  return { version: 2, nodes };
}

export function serializeDeterministic(node: Node): string {
  return JSON.stringify(node.toJSON());
}

// re-export for convenience (deterministic serialization of a v2 document)
export { inlineContentToText, normalizeInlineContent, textToInline };
