import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import {
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articles,
  articleTags,
  outboxEvents,
} from "@kal-el/db/schema";
import type { Article, ArticleDocument, ArticleSummary, CreateArticleBody, SeoMetadata, UpdateArticleBody } from "@kal-el/contracts";

import { badRequest, conflict, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { upsertSlugRedirect } from "./redirects.js";

export type ActorRef = {
  kind: "user" | "service";
  userId?: string;
  actorKey: string;
  name: string;
  ip?: string;
  requestId?: string;
};

const DEFAULT_DOCUMENT: ArticleDocument = { version: 1, nodes: [] };

export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "untitled"
  );
}

async function uniqueSlug(db: Db, siteId: string, base: string): Promise<string> {
  let slug = base;
  let i = 2;
  for (;;) {
    const exists = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.slug, slug)),
    });
    if (!exists) return slug;
    slug = `${base}-${i++}`;
  }
}

type ArticleRow = typeof articles.$inferSelect;

async function relationIds(db: Db, articleId: string) {
  const [authors, categories, tags, entities] = await Promise.all([
    db
      .select({ id: articleAuthors.authorId })
      .from(articleAuthors)
      .where(eq(articleAuthors.articleId, articleId))
      .orderBy(asc(articleAuthors.position)),
    db.select({ id: articleCategories.categoryId }).from(articleCategories).where(eq(articleCategories.articleId, articleId)),
    db.select({ id: articleTags.tagId }).from(articleTags).where(eq(articleTags.articleId, articleId)),
    db.select({ id: articleEntities.entityId }).from(articleEntities).where(eq(articleEntities.articleId, articleId)),
  ]);
  return {
    authors: authors.map((a) => a.id),
    categories: categories.map((c) => c.id),
    tags: tags.map((t) => t.id),
    entities: entities.map((e) => e.id),
  };
}

async function articleDto(db: Db, row: ArticleRow): Promise<Article> {
  const rel = await relationIds(db, row.id);
  return {
    id: row.id,
    siteId: row.siteId,
    type: row.type,
    status: row.status,
    title: row.title,
    dek: row.dek ?? null,
    slug: row.slug,
    excerpt: row.excerpt ?? null,
    version: row.version,
    featuredMediaId: row.featuredMediaId ?? null,
    document: row.document ?? DEFAULT_DOCUMENT,
    seo: row.seo,
    provenance: row.provenance ?? null,
    ...rel,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    qualityFlags: [],
  };
}

function summaryDto(row: ArticleRow): ArticleSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    type: row.type,
    status: row.status,
    title: row.title,
    dek: row.dek ?? null,
    slug: row.slug,
    excerpt: row.excerpt ?? null,
    version: row.version,
    featuredMediaId: row.featuredMediaId ?? null,
    authors: [],
    categories: [],
    tags: [],
    entities: [],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    qualityFlags: [],
  };
}

async function replaceRelations(db: Db, articleId: string, body: CreateArticleBody | UpdateArticleBody) {
  if (body.authors) {
    await db.delete(articleAuthors).where(eq(articleAuthors.articleId, articleId));
    if (body.authors.length > 0) {
      await db.insert(articleAuthors).values(body.authors.map((id, i) => ({ articleId, authorId: id, position: i })));
    }
  }
  if (body.categories) {
    await db.delete(articleCategories).where(eq(articleCategories.articleId, articleId));
    if (body.categories.length > 0) {
      await db.insert(articleCategories).values(body.categories.map((id) => ({ articleId, categoryId: id })));
    }
  }
  if (body.tags) {
    await db.delete(articleTags).where(eq(articleTags.articleId, articleId));
    if (body.tags.length > 0) {
      await db.insert(articleTags).values(body.tags.map((id) => ({ articleId, tagId: id })));
    }
  }
  if (body.entities) {
    await db.delete(articleEntities).where(eq(articleEntities.articleId, articleId));
    if (body.entities.length > 0) {
      await db.insert(articleEntities).values(body.entities.map((id) => ({ articleId, entityId: id })));
    }
  }
}

function actorUserId(actor: ActorRef): string | null {
  return actor.kind === "user" ? (actor.userId ?? null) : null;
}

export async function createArticle(
  db: Db,
  siteId: string,
  actor: ActorRef,
  body: CreateArticleBody,
): Promise<{ article: Article; created: boolean }> {
  if (body.externalKey) {
    const existing = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.externalKey, body.externalKey)),
    });
    if (existing) {
      return { article: await articleDto(db, existing), created: false };
    }
  }

  const slug = body.slug ?? (await uniqueSlug(db, siteId, slugify(body.title)));
  const document = body.document ?? DEFAULT_DOCUMENT;
  const seo: SeoMetadata = {
    seoTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    robotsIndex: "index",
    robotsFollow: "follow",
    socialTitle: null,
    socialDescription: null,
    ...(body.seo ?? {}),
  };

  const createdBy = actorUserId(actor);

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(articles)
      .values({
        siteId,
        type: body.type,
        title: body.title,
        slug,
        dek: body.dek ?? null,
        excerpt: body.excerpt ?? null,
        document,
        seo,
        provenance: body.provenance ?? null,
        externalKey: body.externalKey ?? null,
        createdBy,
        updatedBy: createdBy,
        version: 0,
      })
      .returning();
    if (!inserted) throw new Error("createArticle returned no row");

    await tx.insert(articleRevisions).values({
      articleId: inserted.id,
      revisionNumber: 1,
      document,
      createdBy,
      note: "created",
    });

    await replaceRelations(tx as unknown as Db, inserted.id, body);

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actorUserId(actor),
      action: "articles.create",
      objectType: "article",
      objectId: inserted.id,
      details: { title: body.title, slug, externalKey: body.externalKey ?? null, provenance: body.provenance ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return inserted;
  });

  return { article: await articleDto(db, row), created: true };
}

export async function getArticle(db: Db, siteId: string, articleId: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  return articleDto(db, row);
}

export async function updateArticle(
  db: Db,
  siteId: string,
  articleId: string,
  actor: ActorRef,
  body: UpdateArticleBody,
  expectedVersion?: number,
) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");

  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw conflict("version mismatch: the article was modified by another actor", {
      currentVersion: row.version,
      expectedVersion,
      code: "VERSION_CONFLICT",
    });
  }

  let slug = row.slug;
  if (body.slug && body.slug !== row.slug) {
    const previousSlug = row.slug;
    slug = await uniqueSlug(db, siteId, body.slug);
    if (previousSlug) {
      await upsertSlugRedirect(db, siteId, previousSlug, slug);
    }
  }

  const document = body.document ?? row.document ?? DEFAULT_DOCUMENT;
  const seo = body.seo ? { ...row.seo, ...body.seo } : row.seo;
  const updatedBy = actorUserId(actor);

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        type: body.type ?? row.type,
        title: body.title ?? row.title,
        slug,
        dek: body.dek !== undefined ? body.dek : row.dek,
        excerpt: body.excerpt !== undefined ? body.excerpt : row.excerpt,
        document,
        seo,
        provenance: body.provenance !== undefined ? body.provenance : row.provenance,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    if (body.document && JSON.stringify(body.document) !== JSON.stringify(row.document)) {
      const maxRev = await tx
        .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, articleId));
      await tx.insert(articleRevisions).values({
        articleId,
        revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
        document,
        createdBy: updatedBy,
        note: "updated",
      });
    }

    await replaceRelations(tx as unknown as Db, articleId, body);

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.update",
      objectType: "article",
      objectId: articleId,
      details: { version: result.version, changedFields: Object.keys(body) },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}

export function encodeCursor(row: ArticleRow): string {
  return Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!iso || !id || Number.isNaN(Date.parse(iso))) {
    throw badRequest("invalid cursor");
  }
  return { updatedAt: new Date(iso), id };
}

export async function listArticles(
  db: Db,
  siteId: string,
  q: {
    status?: string;
    type?: string;
    authorId?: string;
    categoryId?: string;
    tagId?: string;
    q?: string;
    cursor?: string;
    limit: number;
  },
) {
  const conditions: (ReturnType<typeof eq> | ReturnType<typeof ilike> | ReturnType<typeof inArray> | ReturnType<typeof or> | undefined)[] = [
    eq(articles.siteId, siteId),
  ];
  if (q.status) conditions.push(eq(articles.status, q.status as never));
  if (q.type) conditions.push(eq(articles.type, q.type as never));
  if (q.q) conditions.push(ilike(articles.title, `%${q.q}%`));

  if (q.authorId) {
    const ids = await db.select({ articleId: articleAuthors.articleId }).from(articleAuthors).where(eq(articleAuthors.authorId, q.authorId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }
  if (q.categoryId) {
    const ids = await db.select({ articleId: articleCategories.articleId }).from(articleCategories).where(eq(articleCategories.categoryId, q.categoryId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }
  if (q.tagId) {
    const ids = await db.select({ articleId: articleTags.articleId }).from(articleTags).where(eq(articleTags.tagId, q.tagId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }

  if (q.cursor) {
    const { updatedAt, id } = decodeCursor(q.cursor);
    conditions.push(
      or(
        sql`(${articles.updatedAt}, ${articles.id}) < (${updatedAt}, ${id})`,
        sql`(${articles.updatedAt} = ${updatedAt} AND ${articles.id} < ${id})`,
      ),
    );
  }

  const rows = await db
    .select()
    .from(articles)
    .where(and(...conditions))
    .orderBy(desc(articles.updatedAt), desc(articles.id))
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1] as ArticleRow) : null;

  return {
    items: items.map(summaryDto),
    nextCursor,
    total: undefined,
  };
}

export async function listRevisions(db: Db, siteId: string, articleId: string) {
  await getArticle(db, siteId, articleId);
  const rows = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(desc(articleRevisions.revisionNumber));
  return rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    revisionNumber: r.revisionNumber,
    document: r.document,
    createdBy: r.createdBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function publishArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (row.status === "published" && row.publishedAt) {
    return articleDto(db, row);
  }

  const publishedAt = row.publishedAt ?? new Date();
  const updatedBy = actorUserId(actor);

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: "published",
        publishedAt,
        scheduledAt: null,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    const maxRev = await tx
      .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
      .from(articleRevisions)
      .where(eq(articleRevisions.articleId, articleId));
    await tx.insert(articleRevisions).values({
      articleId,
      revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
      document: row.document ?? DEFAULT_DOCUMENT,
      createdBy: updatedBy,
      note: note ?? "published",
    });

    await tx
      .insert(outboxEvents)
      .values({
        siteId,
        aggregateType: "article",
        aggregateId: articleId,
        eventType: "article.published",
        payload: { articleId, slug: row.slug, publishedAt: publishedAt.toISOString(), version: result.version },
        idempotencyKey: `article:${articleId}:publish:${publishedAt.getTime()}`,
      })
      .onConflictDoNothing();

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.publish",
      objectType: "article",
      objectId: articleId,
      details: { publishedAt: publishedAt.toISOString(), version: result.version },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}

export async function scheduleArticle(db: Db, siteId: string, articleId: string, scheduledAt: Date, actor: ActorRef, note?: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (scheduledAt <= new Date()) throw conflict("scheduledAt must be in the future");

  const updatedBy = actorUserId(actor);
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: "scheduled",
        scheduledAt,
        publishedAt: null,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.schedule",
      objectType: "article",
      objectId: articleId,
      details: { scheduledAt: scheduledAt.toISOString(), note: note ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}
