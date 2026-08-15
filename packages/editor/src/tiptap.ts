import type { ArticleDocument, DocumentNode } from "@kal-el/contracts";
import { Node, Schema, type NodeSpec } from "@tiptap/pm/model";

/**
 * ProseMirror schema mirroring the Kal El versioned document schema
 * (packages/contracts/src/editorial.ts). The schema is the sanitizer: unknown
 * node types / attrs are rejected by `Node.fromJSON` instead of being stored.
 */
export function buildTiptapSchema(): Schema {
  const text: NodeSpec = { group: "inline" };
  const paragraph: NodeSpec = { group: "block", content: "text*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] };
  const heading: NodeSpec = {
    group: "block",
    content: "text*",
    attrs: { level: { default: 2 } },
    parseDOM: [{ tag: "h2", attrs: { level: 2 } }, { tag: "h3", attrs: { level: 3 } }, { tag: "h4", attrs: { level: 4 } }],
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  };
  const blockquote: NodeSpec = { group: "block", content: "text*", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] };
  const bulletList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] };
  const orderedList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ol" }], toDOM: () => ["ol", 0] };
  const listItem: NodeSpec = { content: "text*", parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] };
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
  const tableCell: NodeSpec = { content: "text*", attrs: { header: { default: false } }, toDOM: (n) => [n.attrs.header ? "th" : "td", 0] };

  return new Schema({
    nodes: { doc: { content: "block+" }, text, paragraph, heading, blockquote, bulletList, orderedList, listItem, image, gallery, embed, source, table, tableRow, tableCell },
  });
}

function attrsFor(node: DocumentNode): Record<string, unknown> {
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

function proseJson(node: DocumentNode): Record<string, unknown> {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: [{ type: "text", text: node.content }] };
    case "heading":
      return { type: "heading", attrs: { level: node.attrs.level }, content: [{ type: "text", text: node.content }] };
    case "quote":
      return { type: "blockquote", content: [{ type: "text", text: node.content }] };
    case "list":
      return {
        type: node.attrs.ordered ? "orderedList" : "bulletList",
        content: node.content.map((item) => ({ type: "listItem", content: [{ type: "text", text: item }] })),
      };
    case "table":
      return {
        type: "table",
        content: node.content.map((row, ri) => ({
          type: "tableRow",
          content: row.map((cell, _ci) => ({
            type: "tableCell",
            attrs: { header: ri === 0 && node.attrs.headers.includes(cell) },
            content: [{ type: "text", text: cell }],
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

/** Validate + convert a Kal El document into a ProseMirror doc node. Throws on unknown/invalid nodes. */
export function documentToProseMirror(document: ArticleDocument): Node {
  const schema = buildTiptapSchema();
  const json = { type: "doc", content: document.nodes.map(proseJson) };
  return Node.fromJSON(schema, json);
}

/** Convert a ProseMirror doc node back into a Kal El document (round-trip). */
export function proseMirrorToDocument(node: Node): ArticleDocument {
  const nodes: DocumentNode[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case "paragraph":
        nodes.push({ type: "paragraph", attrs: {}, content: child.textContent });
        break;
      case "heading":
        nodes.push({ type: "heading", attrs: { level: child.attrs.level as 2 | 3 | 4 }, content: child.textContent });
        break;
      case "blockquote":
        nodes.push({ type: "quote", attrs: {}, content: child.textContent });
        break;
      case "bulletList":
      case "orderedList": {
        const items: string[] = [];
        child.forEach((li) => items.push(li.textContent));
        nodes.push({ type: "list", attrs: { ordered: child.type.name === "orderedList" }, content: items });
        break;
      }
      case "table": {
        const rows: string[][] = [];
        const headers: string[] = [];
        let first = true;
        child.forEach((tr) => {
          const cells: string[] = [];
          tr.forEach((td) => {
            if (first && td.attrs.header) headers.push(td.textContent);
            cells.push(td.textContent);
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
  return { version: 1, nodes };
}

export function serializeDeterministic(node: Node): string {
  return JSON.stringify(node.toJSON());
}
