import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ArticleDocument, ArticleStatus, ArticleType, Provenance, SeoMetadata } from "@kal-el/contracts";

import { media } from "./media";
import { sites } from "./sites";
import { users } from "./identity";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    // parentId is not an FK to avoid a self-referential TS inference cycle;
    // the createCategory service validates the parent in the same site.
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_site_slug_unique").on(t.siteId, t.slug),
    index("categories_site_parent_idx").on(t.siteId, t.parentId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_site_slug_unique").on(t.siteId, t.slug)],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    externalRefs: jsonb("external_refs")
      .$type<{ provider: string; type: string; externalId: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entities_site_type_idx").on(t.siteId, t.type)],
);

export const authors = pgTable(
  "authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    bio: text("bio"),
    email: text("email"),
    /**
     * Optional link to the authenticated account behind this byline.
     *
     * An author is an editorial byline, not an account: guest contributors and imported
     * WordPress authors have no user, and one person can have a separate byline per site.
     * When the link exists, ownership checks can resolve "is the caller an author of this
     * article?" - `articleAuthors.authorId` points at `authors.id`, so comparing it to a
     * user id compares two disjoint UUID spaces and never matches.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    avatarMediaId: uuid("avatar_media_id").references(() => media.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("authors_site_slug_unique").on(t.siteId, t.slug),
    // at most one byline per account per site; NULL user_id rows are exempt
    uniqueIndex("authors_site_user_unique").on(t.siteId, t.userId),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url"),
    kind: text("kind").notNull().default("generic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_site_name_idx").on(t.siteId, t.name)],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["article", "review", "list", "video", "audio"] })
      .$type<ArticleType>()
      .notNull()
      .default("article"),
    status: text("status", { enum: ["draft", "in_review", "scheduled", "published", "blocked", "archived"] })
      .$type<ArticleStatus>()
      .notNull()
      .default("draft"),
    title: text("title").notNull(),
    dek: text("dek"),
    slug: text("slug"),
    excerpt: text("excerpt"),
    document: jsonb("document").$type<ArticleDocument>(),
    seo: jsonb("seo").$type<SeoMetadata>().notNull().default({
      seoTitle: null,
      metaDescription: null,
      canonicalUrl: null,
      robotsIndex: "index",
      robotsFollow: "follow",
      socialTitle: null,
      socialDescription: null,
    }),
    featuredMediaId: uuid("featured_media_id").references(() => media.id, { onDelete: "set null" }),
    externalKey: text("external_key"),
    provenance: jsonb("provenance").$type<Provenance>(),
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_site_slug_unique").on(t.siteId, t.slug),
    uniqueIndex("articles_site_external_key_unique").on(t.siteId, t.externalKey),
    index("articles_site_status_idx").on(t.siteId, t.status),
    index("articles_site_updated_idx").on(t.siteId, t.updatedAt),
    /**
     * The scheduler's due query is `status = 'scheduled' AND scheduled_at <= now()`
     * ordered by `scheduled_at`, and it is cross-tenant - there is no `site_id` in it.
     * `articles_site_status_idx` leads with `site_id`, so it cannot serve that query at
     * all: with POLL_INTERVAL_MS=1000 the worker ran 86,400 sequential scans of the whole
     * articles table per day.
     *
     * Partial, because `scheduled` is a vanishing fraction of rows in a real archive - the
     * index stays small enough to sit in cache, and the ordering it provides is the exact
     * ordering the query asks for, so the plan is an index scan with no sort.
     */
    index("articles_scheduled_due_idx")
      .on(t.scheduledAt)
      .where(sql`${t.status} = 'scheduled'`),
  ],
);

export const articleRevisions = pgTable(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    document: jsonb("document").$type<ArticleDocument>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_revisions_article_number_unique").on(t.articleId, t.revisionNumber)],
);

export const articleAuthors = pgTable(
  "article_authors",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.authorId] })],
);

export const articleCategories = pgTable(
  "article_categories",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.categoryId] })],
);

export const articleTags = pgTable(
  "article_tags",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.tagId] })],
);

export const articleEntities = pgTable(
  "article_entities",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.entityId] })],
);

export type ArticleRow = typeof articles.$inferSelect;
