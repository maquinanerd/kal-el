import { z } from "zod";
import { seoMetadataSchema } from "./seo.js";
import { timestampSchema, uuidSchema } from "./common.js";

export const articleTypeSchema = z.enum(["article", "review", "list", "video", "audio"]);

export const articleStatusSchema = z.enum(["draft", "in_review", "scheduled", "published", "blocked"]);

export const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs are allowed");

export const provenanceSourceSchema = z.object({
  provider: z.string().min(1).max(64),
  externalId: z.string().min(1).max(256),
  externalUrl: z.string().url().max(2048).nullable().optional(),
});

export const provenanceSchema = z
  .object({
    system: z.string().min(1).max(64),
    sources: z.array(provenanceSourceSchema).max(50),
    createdAt: z.string().max(64).optional(),
  })
  .nullable();

/**
 * Versioned structured document schema (editor engine).
 *
 * v1 (legacy): prose-first; text blocks carry plain strings (no inline marks).
 * v2 (canonical): text blocks carry inline content — an ordered array of text
 * nodes with optional marks (bold/italic/code/underline/strike/link) — so rich
 * text survives round-trip. Renderers on consuming frontends must only trust
 * known node types and marks.
 */

export const linkHrefSchema = z
  .string()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u) || u.startsWith("/"), "link href must be an http(s) URL or an internal path");

export const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      href: linkHrefSchema,
      title: z.string().max(500).optional(),
      internal: z.boolean().optional(),
    }),
  }),
]);

export const inlineNodeSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(10000), marks: z.array(markSchema).max(8).default([]) }),
  z.object({ type: z.literal("hardBreak") }),
]);

export const inlineContentSchema = z.array(inlineNodeSchema).max(2000);

// Shared atom nodes (identical across document versions).
const imageNodeSchema = z.object({
  type: z.literal("image"),
  attrs: z.object({
    mediaId: uuidSchema,
    caption: z.string().max(2000).optional(),
    credit: z.string().max(500).optional(),
    altText: z.string().max(500).optional(),
  }),
});
const galleryNodeSchema = z.object({ type: z.literal("gallery"), attrs: z.object({ mediaIds: z.array(uuidSchema).min(1).max(50) }) });
const embedNodeSchema = z.object({
  type: z.literal("embed"),
  attrs: z.object({
    url: httpUrlSchema,
    provider: z.string().max(64),
    id: z.string().max(128).optional(),
  }),
});
const sourceNodeSchema = z.object({
  type: z.literal("source"),
  attrs: z.object({ label: z.string().max(200), url: httpUrlSchema, kind: z.string().max(32).optional() }),
});

// ---- v1 (legacy, string content) ----
export const documentV1NodeSchema = z.union([
  z.object({ type: z.literal("paragraph"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: z.string() }),
  z.object({ type: z.literal("quote"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("list"), attrs: z.object({ ordered: z.boolean().default(false) }), content: z.array(z.string()) }),
  z.object({
    type: z.literal("table"),
    attrs: z.object({ headers: z.array(z.string()).default([]) }),
    content: z.array(z.array(z.string())),
  }),
  imageNodeSchema,
  galleryNodeSchema,
  embedNodeSchema,
  sourceNodeSchema,
]);

export const documentV1Schema = z.object({
  version: z.literal(1),
  nodes: z.array(documentV1NodeSchema),
});

// ---- v2 (canonical, inline content with marks) ----
export const documentV2NodeSchema = z.union([
  z.object({ type: z.literal("paragraph"), attrs: z.record(z.string(), z.unknown()).default({}), content: inlineContentSchema }),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: inlineContentSchema }),
  z.object({ type: z.literal("quote"), attrs: z.record(z.string(), z.unknown()).default({}), content: inlineContentSchema }),
  z.object({ type: z.literal("list"), attrs: z.object({ ordered: z.boolean().default(false) }), content: z.array(inlineContentSchema).max(500) }),
  z.object({
    type: z.literal("table"),
    attrs: z.object({ headers: z.array(z.string()).default([]) }),
    content: z.array(z.array(inlineContentSchema).max(500)).max(500),
  }),
  imageNodeSchema,
  galleryNodeSchema,
  embedNodeSchema,
  sourceNodeSchema,
]);

export const documentV2Schema = z.object({
  version: z.literal(2),
  nodes: z.array(documentV2NodeSchema),
});

export const documentSchema = z.discriminatedUnion("version", [documentV1Schema, documentV2Schema]);

export const articleSummarySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  type: articleTypeSchema,
  status: articleStatusSchema,
  title: z.string().max(400),
  dek: z.string().max(600).nullable(),
  slug: z.string().max(300).nullable(),
  excerpt: z.string().max(2000).nullable(),
  version: z.number().int().nonnegative(),
  externalKey: z.string().max(256).nullable(),
  featuredMediaId: uuidSchema.nullable(),
  authors: z.array(uuidSchema),
  categories: z.array(uuidSchema),
  tags: z.array(uuidSchema),
  entities: z.array(uuidSchema),
  publishedAt: timestampSchema.nullable(),
  scheduledAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  createdAt: timestampSchema,
  qualityFlags: z.array(z.string()).default([]),
});

export const articleSchema = articleSummarySchema.extend({
  dek: z.string().max(600).nullable(),
  document: documentV2Schema,
  seo: seoMetadataSchema,
  provenance: provenanceSchema,
});

export const createArticleBodySchema = z.object({
  type: articleTypeSchema.default("article"),
  title: z.string().min(1).max(400),
  slug: z.string().min(1).max(300).nullable().optional(),
  dek: z.string().max(600).nullable().optional(),
  excerpt: z.string().max(2000).nullable().optional(),
  document: documentSchema.optional(),
  seo: seoMetadataSchema.partial().optional(),
  authors: z.array(uuidSchema).default([]),
  categories: z.array(uuidSchema).default([]),
  tags: z.array(uuidSchema).default([]),
  entities: z.array(uuidSchema).default([]),
  externalKey: z.string().max(256).optional(),
  provenance: provenanceSchema.optional(),
  // Import/automation path: allow setting status and original timestamps.
  // Enforced by articles.publish / articles.schedule at the route level.
  status: articleStatusSchema.optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export const updateArticleBodySchema = z
  .object({
    type: articleTypeSchema.optional(),
    title: z.string().min(1).max(400).optional(),
    slug: z.string().min(1).max(300).nullable().optional(),
    dek: z.string().max(600).nullable().optional(),
    excerpt: z.string().max(2000).nullable().optional(),
    document: documentSchema.optional(),
    seo: seoMetadataSchema.partial().optional(),
    authors: z.array(uuidSchema).optional(),
    categories: z.array(uuidSchema).optional(),
    tags: z.array(uuidSchema).optional(),
    entities: z.array(uuidSchema).optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const articleListQuerySchema = z.object({
  status: articleStatusSchema.optional(),
  type: articleTypeSchema.optional(),
  authorId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  externalKey: z.string().max(256).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const categorySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140),
  description: z.string().max(1000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createCategoryBodySchema = z
  .object({
    name: categorySchema.shape.name,
    slug: categorySchema.shape.slug,
    parentId: uuidSchema.nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const tagSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createTagBodySchema = z
  .object({
    name: tagSchema.shape.name,
    slug: tagSchema.shape.slug,
  })
  .strict();

export const entitySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(64),
  description: z.string().max(2000).nullable(),
  externalRefs: z
    .array(
      z.object({
        provider: z.string().min(1).max(64),
        type: z.string().min(1).max(64),
        externalId: z.string().min(1).max(256),
      }),
    )
    .max(20)
    .default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createEntityBodySchema = z
  .object({
    name: entitySchema.shape.name,
    type: entitySchema.shape.type,
    description: z.string().max(2000).nullable().optional(),
    externalRefs: entitySchema.shape.externalRefs,
  })
  .strict();

export const authorSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140),
  bio: z.string().max(2000).nullable(),
  email: z.string().email().nullable(),
  avatarMediaId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createAuthorBodySchema = z
  .object({
    name: authorSchema.shape.name,
    slug: authorSchema.shape.slug,
    bio: z.string().max(2000).nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .strict();

export const sourceSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  url: z.string().url().max(2048).nullable(),
  kind: z.string().max(32).default("generic"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSourceBodySchema = z
  .object({
    name: sourceSchema.shape.name,
    url: z.string().url().max(2048).nullable().optional(),
    kind: sourceSchema.shape.kind,
  })
  .strict();

export const articleRevisionSchema = z.object({
  id: uuidSchema,
  articleId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  document: documentV2Schema,
  createdBy: uuidSchema.nullable(),
  note: z.string().max(500).nullable(),
  createdAt: timestampSchema,
});

export const publishArticleBodySchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

export const scheduleArticleBodySchema = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }),
    note: z.string().max(500).optional(),
  })
  .strict();

export type ArticleType = z.infer<typeof articleTypeSchema>;
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export type Mark = z.infer<typeof markSchema>;
export type InlineNode = z.infer<typeof inlineNodeSchema>;
export type InlineContent = z.infer<typeof inlineContentSchema>;
export type DocumentNodeV1 = z.infer<typeof documentV1NodeSchema>;
export type DocumentNodeV2 = z.infer<typeof documentV2NodeSchema>;
export type DocumentNode = DocumentNodeV2;
export type ArticleDocumentV1 = z.infer<typeof documentV1Schema>;
export type ArticleDocumentV2 = z.infer<typeof documentV2Schema>;
export type ArticleDocument = z.infer<typeof documentSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type Article = z.infer<typeof articleSchema>;
export type ArticleSummary = z.infer<typeof articleSummarySchema>;
export type CreateArticleBody = z.infer<typeof createArticleBodySchema>;
export type CreateArticleInput = z.input<typeof createArticleBodySchema>;
export type UpdateArticleBody = z.infer<typeof updateArticleBodySchema>;
export type UpdateArticleInput = z.input<typeof updateArticleBodySchema>;
export type Category = z.infer<typeof categorySchema>;
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type Tag = z.infer<typeof tagSchema>;
export type CreateTagBody = z.infer<typeof createTagBodySchema>;
export type Entity = z.infer<typeof entitySchema>;
export type CreateEntityBody = z.infer<typeof createEntityBodySchema>;
export type Author = z.infer<typeof authorSchema>;
export type CreateAuthorBody = z.infer<typeof createAuthorBodySchema>;
export type Source = z.infer<typeof sourceSchema>;
export type CreateSourceBody = z.infer<typeof createSourceBodySchema>;
export type ArticleRevision = z.infer<typeof articleRevisionSchema>;

// ---- document migration (v1 <-> v2) ----

/** Wrap plain text into a single markless text node. */
export function textToInline(text: string): InlineContent {
  return [{ type: "text", text, marks: [] }];
}

/** Flatten inline content back to plain text (hard breaks become newlines). */
export function inlineContentToText(content: InlineContent): string {
  return content.map((n) => (n.type === "text" ? n.text : "\n")).join("");
}

function canonicalMarkKey(m: Mark): string {
  if (m.type === "link") {
    return `link:${m.attrs.href}:${m.attrs.title ?? ""}:${m.attrs.internal ?? ""}`;
  }
  return m.type;
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const la = (a ?? []).map(canonicalMarkKey).sort();
  const lb = (b ?? []).map(canonicalMarkKey).sort();
  if (la.length !== lb.length) return false;
  return la.every((k, i) => k === lb[i]);
}

/**
 * Canonicalize inline content for deterministic serialization: sort marks into
 * a stable order and merge adjacent text nodes carrying identical marks.
 */
export function normalizeInlineContent(content: InlineContent): InlineContent {
  const out: InlineContent = [];
  for (const node of content) {
    if (node.type === "hardBreak") {
      out.push(node);
      continue;
    }
    const marks = [...(node.marks ?? [])].sort((a, b) => canonicalMarkKey(a).localeCompare(canonicalMarkKey(b)));
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && sameMarks(prev.marks, marks)) {
      prev.text += node.text;
    } else {
      out.push({ type: "text", text: node.text, marks });
    }
  }
  return out;
}

/** Normalize every text-bearing node of a v2 document. */
export function normalizeDocumentV2(document: ArticleDocumentV2): ArticleDocumentV2 {
  return {
    version: 2,
    nodes: document.nodes.map((node) => {
      switch (node.type) {
        case "paragraph":
        case "heading":
        case "quote":
          return { ...node, content: normalizeInlineContent(node.content) };
        case "list":
          return { ...node, content: node.content.map(normalizeInlineContent) };
        case "table":
          return { ...node, content: node.content.map((row) => row.map(normalizeInlineContent)) };
        default:
          return node;
      }
    }),
  };
}

function migrateNodeToV2(node: DocumentNodeV1): DocumentNodeV2 {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return { ...node, content: textToInline(node.content) };
    case "list":
      return { ...node, content: node.content.map(textToInline) };
    case "table":
      return { ...node, content: node.content.map((row) => row.map(textToInline)) };
    default:
      return node;
  }
}

/** Upgrade a legacy v1 document (or already-v2) to the canonical v2 form. */
export function migrateDocumentToV2(document: ArticleDocument): ArticleDocumentV2 {
  if (document.version === 2) return normalizeDocumentV2(document);
  return { version: 2, nodes: document.nodes.map(migrateNodeToV2) };
}

function migrateNodeToV1(node: DocumentNodeV2): DocumentNodeV1 {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return { ...node, content: inlineContentToText(node.content) };
    case "list":
      return { ...node, content: node.content.map(inlineContentToText) };
    case "table":
      return { ...node, content: node.content.map((row) => row.map(inlineContentToText)) };
    default:
      return node;
  }
}

/** Downgrade a v2 document to v1. Lossy: inline marks are flattened away. */
export function migrateDocumentToV1(document: ArticleDocumentV2): ArticleDocumentV1 {
  return { version: 1, nodes: document.nodes.map(migrateNodeToV1) };
}
