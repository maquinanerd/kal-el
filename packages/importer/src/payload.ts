import type { ArticleStatus, ArticleType } from "@kal-el/contracts";
import { emptyBatch, type ImportBatch, type NormalizedArticle, type NormalizedMedia, type NormalizedTaxonomy } from "./types.js";
import { htmlToIntermediate } from "./html.js";
import { lexicalToIntermediate } from "./lexical.js";
import type { LexicalRoot } from "./lexical.js";

/**
 * Payload importer framework (ADR-0006). Payload exports are project-specific,
 * so this adapter maps a documented JSON shape into the same neutral
 * `ImportBatch` that the WordPress adapter produces. Field names can be
 * overridden with `fieldMap` to match a real Payload project.
 */

export type PayloadFieldMap = {
  id?: string;
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  status?: string;
  publishedAt?: string;
  author?: string;
  categories?: string;
  tags?: string;
  seo?: { title?: string; description?: string; canonical?: string };
};

export type PayloadExport = {
  docs: Record<string, unknown>[];
  media?: Record<string, unknown>[];
  categories?: Record<string, unknown>[];
  tags?: Record<string, unknown>[];
};

const defaultFieldMap: Required<PayloadFieldMap> = {
  id: "id",
  title: "title",
  slug: "slug",
  excerpt: "excerpt",
  content: "content",
  status: "status",
  publishedAt: "publishedAt",
  author: "author",
  categories: "categories",
  tags: "tags",
  seo: { title: "meta.title", description: "meta.description", canonical: "meta.canonical" },
};

function at(obj: Record<string, unknown> | undefined, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "untitled"
  );
}

function idsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" && v ? String((v as Record<string, unknown>).id ?? (v as Record<string, unknown>).value ?? "") : String(v))).filter(Boolean);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  if (typeof value === "number") return [String(value)];
  return [];
}

export class PayloadAdapter {
  constructor(private readonly fieldMap: PayloadFieldMap = defaultFieldMap) {}

  readPayloadExport(exported: PayloadExport): ImportBatch {
    const fm = { ...defaultFieldMap, ...this.fieldMap };
    const batch = emptyBatch("payload");

    const idOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

    batch.categories = (exported.categories ?? []).map((c, i) => {
      const name = str(at(c, fm.title)) ?? `Categoria ${i}`;
      return { externalId: `pl:cat:${idOf(at(c, fm.id)) || i}`, kind: "category", name, slug: str(at(c, fm.slug)) ?? slugify(name) } satisfies NormalizedTaxonomy;
    });
    batch.tags = (exported.tags ?? []).map((t, i) => {
      const name = str(at(t, fm.title)) ?? `Tag ${i}`;
      return { externalId: `pl:tag:${idOf(at(t, fm.id)) || i}`, kind: "tag", name, slug: str(at(t, fm.slug)) ?? slugify(name) } satisfies NormalizedTaxonomy;
    });
    batch.media = (exported.media ?? []).map((m, i) => {
      const url = str(at(m, "url")) ?? str(at(m, "filename")) ?? "";
      return {
        externalId: `pl:media:${idOf(at(m, fm.id)) || i}`,
        filename: str(at(m, "filename")) ?? "untitled",
        url,
        mimeType: str(at(m, "mimeType")) ?? "application/octet-stream",
      } satisfies NormalizedMedia;
    });

    for (const doc of exported.docs) {
      const id = idOf(at(doc, fm.id));
      const title = str(at(doc, fm.title));
      if (!title) continue;
      const contentRaw = at(doc, fm.content);
      const statusRaw = str(at(doc, fm.status)) ?? "draft";
      const publishedAt = str(at(doc, fm.publishedAt));
      const status: ArticleStatus = statusRaw === "published" ? "published" : statusRaw === "scheduled" ? "scheduled" : "draft";
      const typeRaw = str(at(doc, "type"));
      const type: ArticleType = typeRaw === "review" ? "review" : typeRaw === "list" ? "list" : "article";
      const seoMap = fm.seo;
      const seoTitle = typeof at(doc, seoMap?.title) === "string" ? (at(doc, seoMap?.title) as string) : undefined;
      const seoDesc = typeof at(doc, seoMap?.description) === "string" ? (at(doc, seoMap?.description) as string) : undefined;

      // Payload richtext is Lexical JSON; fall back to HTML when a string is given.
      const isLexical = typeof contentRaw === "object" && contentRaw !== null;
      const intermediateNodes = isLexical
        ? lexicalToIntermediate((contentRaw as { root?: LexicalRoot }).root ?? (contentRaw as LexicalRoot), batch.warnings)
        : htmlToIntermediate(typeof contentRaw === "string" ? contentRaw : "").nodes;

      const author = at(doc, fm.author);
      const authorIds = idsOf(author).map((x) => `pl:author:${x}`);
      const categoryIds = idsOf(at(doc, fm.categories)).map((x) => `pl:cat:${x}`);
      const tagIds = idsOf(at(doc, fm.tags)).map((x) => `pl:tag:${x}`);

      const article: NormalizedArticle = {
        externalId: `pl:post:${id || title}`,
        type,
        title,
        slug: str(at(doc, fm.slug)) ?? slugify(title),
        excerpt: str(at(doc, fm.excerpt)),
        intermediateNodes,
        status,
        publishedAt,
        authorExternalIds: authorIds,
        categoryExternalIds: categoryIds,
        tagExternalIds: tagIds,
        seo: { seoTitle, metaDescription: seoDesc },
        externalUrl: "",
      };
      batch.articles.push(article);
    }

    return batch;
  }
}
