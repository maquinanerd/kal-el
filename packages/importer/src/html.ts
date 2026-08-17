import type { ArticleDocumentV2, DocumentNodeV2, InlineContent, Mark } from "@kal-el/contracts";
import { normalizeInlineContent } from "@kal-el/contracts";
import { parse, type HTMLElement } from "node-html-parser";

export type IntermediateNode =
  | { type: "paragraph"; content: InlineContent }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content: InlineContent }
  | { type: "quote"; content: InlineContent }
  | { type: "list"; attrs: { ordered: boolean }; content: InlineContent[] }
  | { type: "table"; attrs: { headers: string[] }; content: InlineContent[][] }
  | { type: "image"; attrs: { sourceUrl: string; caption?: string; altText?: string; credit?: string } }
  | { type: "gallery"; attrs: { sourceUrls: string[] } }
  | { type: "embed"; attrs: { url: string; provider?: string; id?: string } }
  | { type: "source"; attrs: { label: string; url: string } };

export type HtmlParseResult = { nodes: IntermediateNode[]; warnings: string[] };

const BLOCK_ALLOWED = new Set(["p", "h2", "h3", "h4", "blockquote", "ul", "ol", "table", "img", "figure", "iframe", "video"]);
const INLINE_TEXT = new Set(["a", "strong", "em", "b", "i", "span", "br", "code", "s", "u", "mark", "del", "strike"]);

function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value.length > 2048 ? null : value;
}

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!(/^https?:\/\//i.test(value) || value.startsWith("/"))) return null;
  return value.length > 2048 ? null : value;
}

function trimInline(content: InlineContent): InlineContent {
  const result = [...content];
  const first = result[0];
  if (first && first.type === "text") {
    first.text = first.text.replace(/^\s+/, "");
  }
  const last = result[result.length - 1];
  if (last && last.type === "text") {
    last.text = last.text.replace(/\s+$/, "");
  }
  return normalizeInlineContent(result).filter((n) => (n.type === "text" ? n.text.length > 0 : true));
}

/** Walk inline markup, preserving marks (bold/italic/code/underline/strike/link). */
function extractInline(el: HTMLElement, marks: Mark[] = []): InlineContent {
  const out: InlineContent = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* text */) {
      const text = child.rawText.replace(/\s+/g, " ");
      if (text) out.push({ type: "text", text, marks: [...marks] });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as HTMLElement;
    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    if (tag === "strong" || tag === "b") {
      out.push(...extractInline(node, [...marks, { type: "bold" }]));
      continue;
    }
    if (tag === "em" || tag === "i") {
      out.push(...extractInline(node, [...marks, { type: "italic" }]));
      continue;
    }
    if (tag === "code") {
      out.push(...extractInline(node, [...marks, { type: "code" }]));
      continue;
    }
    if (tag === "u") {
      out.push(...extractInline(node, [...marks, { type: "underline" }]));
      continue;
    }
    if (tag === "s" || tag === "del" || tag === "strike") {
      out.push(...extractInline(node, [...marks, { type: "strike" }]));
      continue;
    }
    if (tag === "a") {
      const href = safeHref(node.getAttribute("href"));
      if (href) {
        const title = node.getAttribute("title");
        const linkMark: Mark = {
          type: "link",
          attrs: { href, internal: href.startsWith("/") ? true : undefined, ...(title ? { title } : {}) },
        };
        out.push(...extractInline(node, [...marks, linkMark]));
      } else {
        out.push(...extractInline(node, marks));
      }
      continue;
    }
    // other inline elements (span, mark, etc.) degrade to their text
    out.push(...extractInline(node, marks));
  }
  return trimInline(out);
}

function extractText(el: HTMLElement): string {
  return extractInline(el)
    .filter((n): n is Extract<typeof n, { type: "text" }> => n.type === "text")
    .map((n) => n.text)
    .join("")
    .trim();
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m?.[1] ?? null;
}

function parseImage(img: HTMLElement, parent?: HTMLElement): IntermediateNode {
  const src = safeUrl(img.getAttribute("src") ?? img.getAttribute("data-src"));
  if (!src) {
    return { type: "paragraph", content: [{ type: "text", text: "[imagem removida]", marks: [] }] };
  }
  const caption =
    parent?.tagName.toLowerCase() === "figure"
      ? (parent.querySelector("figcaption")?.text ?? undefined)
      : undefined;
  return {
    type: "image",
    attrs: {
      sourceUrl: src,
      caption,
      altText: img.getAttribute("alt") ?? undefined,
      credit: img.getAttribute("data-credit") ?? undefined,
    },
  };
}

function parseTable(table: HTMLElement): IntermediateNode {
  const rows: InlineContent[][] = [];
  const headerCells: string[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells: InlineContent[] = [];
    for (const cell of tr.childNodes) {
      if (cell.nodeType !== 1) continue;
      const el = cell as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "th" || tag === "td") {
        const content = extractInline(el);
        if (tag === "th" && rows.length === 0) headerCells.push(extractText(el));
        cells.push(content);
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { type: "table", attrs: { headers: headerCells }, content: rows };
}

function parseChildren(el: HTMLElement, warnings: string[], out: IntermediateNode[]): void {
  for (const child of el.childNodes) {
    if (child.nodeType !== 1) continue;
    const node = child as HTMLElement;
    const tag = node.tagName.toLowerCase();

    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    if (tag === "h1") {
      out.push({ type: "paragraph", content: extractInline(node) });
      continue;
    }
    if (tag === "h2" || tag === "h3" || tag === "h4") {
      out.push({ type: "heading", attrs: { level: Number(tag.slice(1)) as 2 | 3 | 4 }, content: extractInline(node) });
      continue;
    }
    if (tag === "p") {
      out.push({ type: "paragraph", content: extractInline(node) });
      continue;
    }
    if (tag === "blockquote") {
      out.push({ type: "quote", content: extractInline(node) });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items = node.querySelectorAll("li").map((li) => extractInline(li));
      out.push({ type: "list", attrs: { ordered: tag === "ol" }, content: items });
      continue;
    }
    if (tag === "table") {
      out.push(parseTable(node));
      continue;
    }
    if (tag === "img") {
      out.push(parseImage(node));
      continue;
    }
    if (tag === "figure") {
      const img = node.querySelector("img");
      if (img) {
        out.push(parseImage(img as HTMLElement, node));
      } else {
        out.push({ type: "paragraph", content: extractInline(node) });
      }
      continue;
    }
    if (tag === "iframe" || tag === "video") {
      const src = safeUrl(node.getAttribute("src"));
      if (src) {
        const id = youtubeId(src);
        out.push({ type: "embed", attrs: { url: src, provider: id ? "youtube" : node.getAttribute("data-provider") ?? undefined, id: id ?? undefined } });
      }
      continue;
    }
    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      parseChildren(node, warnings, out);
      continue;
    }
    // any other block-ish element degrades to its text
    const text = extractText(node);
    if (text) {
      out.push({ type: "paragraph", content: [{ type: "text", text, marks: [] }] });
    }
  }
}

/**
 * Deterministic, allow-listed conversion of WordPress classic HTML into the
 * intermediate document model. Scripts, styles, unknown elements and unsafe
 * URLs are dropped; inline marks (bold/italic/code/link/…) are preserved; image
 * URLs are kept as `sourceUrl` until import resolves media.
 */
export function htmlToIntermediate(html: string): HtmlParseResult {
  const warnings: string[] = [];
  const root = parse(html, { comment: true });
  const nodes: IntermediateNode[] = [];
  parseChildren(root, warnings, nodes);
  return { nodes, warnings };
}

/**
 * Resolve intermediate image/gallery source URLs to created media UUIDs,
 * producing a schema-valid v2 ArticleDocument (marks preserved).
 */
export function finalizeDocument(
  intermediate: IntermediateNode[],
  urlToMediaId: Map<string, string>,
  warnings: string[],
): ArticleDocumentV2 {
  const nodes: DocumentNodeV2[] = [];
  for (const node of intermediate) {
    if (node.type === "image") {
      const mediaId = urlToMediaId.get(node.attrs.sourceUrl);
      if (!mediaId) {
        warnings.push(`media not imported: ${node.attrs.sourceUrl}`);
        continue;
      }
      nodes.push({
        type: "image",
        attrs: {
          mediaId,
          caption: node.attrs.caption,
          credit: node.attrs.credit,
          altText: node.attrs.altText,
        },
      });
    } else if (node.type === "gallery") {
      const ids = node.attrs.sourceUrls.map((u) => urlToMediaId.get(u)).filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        warnings.push("gallery dropped: no media imported");
        continue;
      }
      nodes.push({ type: "gallery", attrs: { mediaIds: ids } });
    } else if (node.type === "embed") {
      nodes.push({ type: "embed", attrs: { url: node.attrs.url, provider: node.attrs.provider ?? "unknown", id: node.attrs.id } });
    } else if (node.type === "source") {
      nodes.push({ type: "source", attrs: { label: node.attrs.label, url: node.attrs.url, kind: "external" } });
    } else if (node.type === "paragraph") {
      nodes.push({ type: "paragraph", attrs: {}, content: node.content });
    } else if (node.type === "heading") {
      nodes.push({ type: "heading", attrs: { level: node.attrs.level }, content: node.content });
    } else if (node.type === "quote") {
      nodes.push({ type: "quote", attrs: {}, content: node.content });
    } else if (node.type === "list") {
      nodes.push({ type: "list", attrs: { ordered: node.attrs.ordered }, content: node.content });
    } else {
      nodes.push({ type: "table", attrs: { headers: node.attrs.headers }, content: node.content });
    }
  }
  return { version: 2, nodes };
}
