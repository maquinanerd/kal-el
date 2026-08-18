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

/**
 * Lexical's TextNode format bitmask (from @lexical/core):
 *   IS_BOLD=1, IS_ITALIC=2, IS_STRIKETHROUGH=4, IS_UNDERLINE=8, IS_CODE=16,
 *   IS_SUBSCRIPT=32, IS_SUPERSCRIPT=64, IS_HIGHLIGHT=128.
 *
 * These were previously off by one bit from strikethrough onwards, which silently
 * mapped underline to strike, code to underline and superscript to code.
 */
const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16 } as const;

/** Formats Kal El's ArticleDocument V2 has no mark for; dropped, but reported. */
const UNSUPPORTED_FORMAT = { subscript: 32, superscript: 64, highlight: 128 } as const;

export function marksFromFormat(format: number): Mark[] {
  const marks: Mark[] = [];
  if (format & FORMAT.bold) marks.push({ type: "bold" });
  if (format & FORMAT.italic) marks.push({ type: "italic" });
  if (format & FORMAT.underline) marks.push({ type: "underline" });
  if (format & FORMAT.strikethrough) marks.push({ type: "strike" });
  if (format & FORMAT.code) marks.push({ type: "code" });
  return marks;
}

/** Names of formats present in the bitmask that this importer cannot represent. */
export function unsupportedFormats(format: number): string[] {
  return Object.entries(UNSUPPORTED_FORMAT)
    .filter(([, bit]) => (format & bit) !== 0)
    .map(([name]) => name);
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

/**
 * @param warnings collects every Lexical construct that could not be represented, so an
 * operator sees dropped images/blocks in the import report instead of silently losing them.
 */
export function lexicalToIntermediate(root: LexicalNode, warnings: string[] = []): IntermediateNode[] {
  const nodes: IntermediateNode[] = [];
  for (const child of root.children ?? []) {
    switch (child.type) {
      case "upload": {
        const url = child.fields?.url;
        if (url) {
          nodes.push({ type: "image", attrs: { sourceUrl: url } });
        } else {
          warnings.push("lexical upload node without a resolvable url was dropped");
        }
        break;
      }
      case "horizontalrule":
      case "linebreak":
        break;
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
        warnings.push(`unsupported lexical node dropped: ${child.type}`);
        break;
    }
  }
  return nodes;
}
