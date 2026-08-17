import type { InlineContent, Mark } from "@kal-el/contracts";
import { normalizeInlineContent } from "@kal-el/contracts";
import type { IntermediateNode } from "./html.js";

/**
 * Convert Payload's Lexical richtext JSON into the importer's intermediate
 * block nodes. Payload stores rich text as Lexical editor state, not HTML.
 */

type LexicalNode = {
  type: string;
  text?: string;
  format?: number;
  tag?: string;
  listType?: string;
  fields?: { url?: string };
  children?: LexicalNode[];
};

export type LexicalRoot = LexicalNode;

const FORMAT = { bold: 1, italic: 2, strikethrough: 8, underline: 16, code: 64 };

function marksFromFormat(format: number): Mark[] {
  const marks: Mark[] = [];
  if (format & FORMAT.bold) marks.push({ type: "bold" });
  if (format & FORMAT.italic) marks.push({ type: "italic" });
  if (format & FORMAT.underline) marks.push({ type: "underline" });
  if (format & FORMAT.strikethrough) marks.push({ type: "strike" });
  if (format & FORMAT.code) marks.push({ type: "code" });
  return marks;
}

function inlineFromLexical(children: LexicalNode[] | undefined, extraMarks: Mark[] = []): InlineContent {
  const out: InlineContent = [];
  for (const child of children ?? []) {
    if (child.type === "text") {
      out.push({ type: "text", text: child.text ?? "", marks: [...extraMarks, ...marksFromFormat(child.format ?? 0)] });
    } else if (child.type === "linebreak") {
      out.push({ type: "hardBreak" });
    } else if (child.type === "link") {
      const href = child.fields?.url ?? "";
      if (/^https?:\/\//i.test(href) || href.startsWith("/")) {
        out.push(...inlineFromLexical(child.children, [...extraMarks, { type: "link", attrs: { href } }]));
      } else {
        out.push(...inlineFromLexical(child.children, extraMarks));
      }
    } else {
      out.push(...inlineFromLexical(child.children, extraMarks));
    }
  }
  return normalizeInlineContent(out);
}

export function lexicalToIntermediate(root: LexicalNode): IntermediateNode[] {
  const nodes: IntermediateNode[] = [];
  for (const child of root.children ?? []) {
    switch (child.type) {
      case "paragraph":
        nodes.push({ type: "paragraph", content: inlineFromLexical(child.children) });
        break;
      case "heading": {
        const tag = child.tag ?? "h2";
        const level = tag === "h3" ? 3 : tag === "h4" ? 4 : 2;
        nodes.push({ type: "heading", attrs: { level }, content: inlineFromLexical(child.children) });
        break;
      }
      case "quote":
        nodes.push({ type: "quote", content: inlineFromLexical(child.children) });
        break;
      case "list": {
        const items = (child.children ?? []).map((li) => inlineFromLexical(li.children));
        nodes.push({ type: "list", attrs: { ordered: child.listType === "number" }, content: items });
        break;
      }
      default:
        break;
    }
  }
  return nodes;
}
