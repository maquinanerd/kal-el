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
 * v1 document model: prose-first with a small set of trusted block types.
 * Renderers on consuming frontends must only trust known node types.
 */
export const documentNodeSchema = z.union([
  z.object({ type: z.literal("paragraph"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: z.string() }),
  z.object({ type: z.literal("quote"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("list"), attrs: z.object({ ordered: z.boolean().default(false) }), content: z.array(z.string()) }),
  z.object({
    type: z.literal("table"),
    attrs: z.object({ headers: z.array(z.string()).default([]) }),
    content: z.array(z.array(z.string())),
  }),
  z.object({
    type: z.literal("image"),
    attrs: z.object({
      mediaId: uuidSchema,
      caption: z.string().max(2000).optional(),
      credit: z.string().max(500).optional(),
      altText: z.string().max(500).optional(),
    }),
  }),
  z.object({ type: z.literal("gallery"), attrs: z.object({ mediaIds: z.array(uuidSchema).min(1).max(50) }) }),
  z.object({
    type: z.literal("embed"),
    attrs: z.object({
      url: httpUrlSchema,
      provider: z.string().max(64),
      id: z.string().max(128).optional(),
    }),
  }),
  z.object({
    type: z.literal("source"),
    attrs: z.object({ label: z.string().max(200), url: httpUrlSchema, kind: z.string().max(32).optional() }),
  }),
]);

export const documentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(documentNodeSchema),
});

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
  document: documentSchema,
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
  status: articleStatusSchema.optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

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

export const createCategoryBodySchema = z.object({
  name: categorySchema.shape.name,
  slug: categorySchema.shape.slug,
  parentId: uuidSchema.nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const tagSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createTagBodySchema = z.object({
  name: tagSchema.shape.name,
  slug: tagSchema.shape.slug,
});

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

export const createEntityBodySchema = z.object({
  name: entitySchema.shape.name,
  type: entitySchema.shape.type,
  description: z.string().max(2000).nullable().optional(),
  externalRefs: entitySchema.shape.externalRefs,
});

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

export const createAuthorBodySchema = z.object({
  name: authorSchema.shape.name,
  slug: authorSchema.shape.slug,
  bio: z.string().max(2000).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export const sourceSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  url: z.string().url().max(2048).nullable(),
  kind: z.string().max(32).default("generic"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSourceBodySchema = z.object({
  name: sourceSchema.shape.name,
  url: z.string().url().max(2048).nullable().optional(),
  kind: sourceSchema.shape.kind,
});

export const articleRevisionSchema = z.object({
  id: uuidSchema,
  articleId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  document: documentSchema,
  createdBy: uuidSchema.nullable(),
  note: z.string().max(500).nullable(),
  createdAt: timestampSchema,
});

export const publishArticleBodySchema = z.object({
  note: z.string().max(500).optional(),
});

export const scheduleArticleBodySchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  note: z.string().max(500).optional(),
});

export type ArticleType = z.infer<typeof articleTypeSchema>;
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export type DocumentNode = z.infer<typeof documentNodeSchema>;
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
