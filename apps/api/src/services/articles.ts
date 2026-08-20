import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import {
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articles,
  articleTags,
  categories,
  outboxEvents,
} from "@kal-el/db/schema";
import type { Article, ArticleDocumentV2, ArticleStatus, ArticleSummary, CreateArticleBody, SeoMetadata, UpdateArticleBody } from "@kal-el/contracts";
import { migrateDocumentToV2 } from "@kal-el/contracts";

import { badRequest, conflict, forbidden, isUniqueViolation, notFound, pgConstraint } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { upsertSlugRedirect } from "./redirects.js";
import { assertMediaInSite, collectDocumentMediaIds } from "./media.js";

export type ActorRef = {
  kind: "user" | "service";
  userId?: string;
  actorKey: string;
  name: string;
  ip?: string;
  requestId?: string;
};

const DEFAULT_DOCUMENT: ArticleDocumentV2 = { version: 2, nodes: [] };

const WORKFLOW_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ["in_review", "scheduled", "published", "archived"],
  in_review: ["draft", "blocked", "scheduled", "published", "archived"],
  scheduled: ["published", "scheduled", "draft", "archived"],
  published: ["draft"],
  blocked: ["in_review", "draft", "archived"],
  archived: [],
};

function assertTransition(from: ArticleStatus, to: ArticleStatus): void {
  const allowed = WORKFLOW_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw conflict(`cannot transition article from "${from}" to "${to}"`);
  }
}

async function assertPrimaryCategoryInSite(db: Db, siteId: string, categoryId?: string | null): Promise<void> {
  if (!categoryId) return;
  const row = await db.query.categories.findFirst({ where: and(eq(categories.id, categoryId), eq(categories.siteId, siteId)) });
  if (!row) throw badRequest("primary category does not belong to this site", { categoryId });
}

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

const SLUG_UNIQUE_INDEX = "articles_site_slug_unique";

/**
 * How many times a writer may lose the slug race before giving up. Each retry
 * means another writer claimed the candidate in the microseconds between the
 * probe and the write, so a handful is already generous.
 */
const MAX_SLUG_RETRIES = 5;

/** First `base`, `base-2`, `base-3`, ... not currently taken in this site. */
async function nextFreeSlug(db: Db, siteId: string, base: string, from: number): Promise<{ slug: string; next: number }> {
  let i = from;
  for (;;) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const taken = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.slug, slug)),
    });
    i += 1;
    if (!taken) return { slug, next: i };
  }
}

/**
 * Run `attempt` with a slug derived from `base`, retrying on the next suffix
 * when it loses a race. Probing for a free slug is a TOCTOU: two concurrent
 * writers both see the candidate free and one hits articles_site_slug_unique.
 * The caller never chose this slug, so the loser moves on to the next suffix
 * instead of surfacing a 409 it cannot act on.
 *
 * Callers that pass a slug the client chose explicitly must NOT route it
 * through here -- that collision is a real conflict, not something to
 * silently de-duplicate.
 */
async function withUniqueSlug<T>(db: Db, siteId: string, base: string, attempt: (slug: string) => Promise<T>): Promise<T> {
  let from = 1;
  for (let retries = 0; retries < MAX_SLUG_RETRIES; retries += 1) {
    const { slug, next } = await nextFreeSlug(db, siteId, base, from);
    from = next;
    try {
      return await attempt(slug);
    } catch (err) {
      if (!isUniqueViolation(err) || pgConstraint(err) !== SLUG_UNIQUE_INDEX) throw err;
    }
  }
  throw conflict(`could not allocate a unique slug for "${base}"`, { field: "slug" });
}

function findByExternalKey(db: Db, siteId: string, externalKey: string) {
  return db.query.articles.findFirst({
    where: and(eq(articles.siteId, siteId), eq(articles.externalKey, externalKey)),
  });
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
    externalKey: row.externalKey ?? null,
    featuredMediaId: row.featuredMediaId ?? null,
    document: row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT,
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
    externalKey: row.externalKey ?? null,
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
    const existing = await findByExternalKey(db, siteId, body.externalKey);
    if (existing) {
      return { article: await articleDto(db, existing), created: false };
    }
  }

  const document = body.document ? migrateDocumentToV2(body.document) : DEFAULT_DOCUMENT;
  const seo: SeoMetadata = {
    seoTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    robotsIndex: "index",
    robotsFollow: "follow",
    socialTitle: null,
    socialDescription: null,
    socialImageMediaId: null,
    primaryCategoryId: null,
    ...(body.seo ?? {}),
  };

  const createdBy = actorUserId(actor);

  const status = body.status ?? "draft";
  const publishedAt = body.publishedAt ? new Date(body.publishedAt) : status === "published" ? new Date() : null;
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const featuredMediaId = body.featuredMediaId ?? null;

  await assertMediaInSite(db, siteId, [...collectDocumentMediaIds(document), ...(featuredMediaId ? [featuredMediaId] : []), ...(seo.socialImageMediaId ? [seo.socialImageMediaId] : [])]);
  await assertPrimaryCategoryInSite(db, siteId, seo.primaryCategoryId);

  const attemptCreate = async (slug: string): Promise<{ article: Article; created: boolean }> => {
    try {
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
            featuredMediaId,
            status,
            publishedAt,
            scheduledAt,
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

        // imported/published articles still emit the revalidation event (exactly-once)
        if (status === "published" && publishedAt) {
          await tx
            .insert(outboxEvents)
            .values({
              siteId,
              aggregateType: "article",
              aggregateId: inserted.id,
              eventType: "article.published",
              payload: { articleId: inserted.id, slug, publishedAt: publishedAt.toISOString(), version: 0 },
              idempotencyKey: `article:${inserted.id}:publish:${publishedAt.getTime()}`,
            })
            .onConflictDoNothing();
        }

        await replaceRelations(tx as unknown as Db, inserted.id, body);

        await writeAudit(tx, {
          siteId,
          actorType: actor.kind,
          actorId: actorUserId(actor),
          action: "articles.create",
          objectType: "article",
          objectId: inserted.id,
          details: { title: body.title, slug, status, publishedAt: publishedAt?.toISOString() ?? null, externalKey: body.externalKey ?? null, provenance: body.provenance ?? null },
          ip: actor.ip ?? null,
          requestId: actor.requestId ?? null,
        });

        return inserted;
      });
      return { article: await articleDto(db, row), created: true };
    } catch (err) {
      // The externalKey pre-check above is a TOCTOU: two concurrent importers
      // both find the key free and race into the INSERT. The loser hits a
      // unique index, and an importer replaying the same item deserves the
      // idempotent answer instead of a 409 it cannot act on -- so re-read the
      // winner's row. Whether Postgres reported the externalKey index or the
      // slug index does not matter: if the key is now taken, that row IS the
      // answer. (db.transaction() rolled back to its savepoint, so `db` is
      // usable here even when the caller handed us an enclosing transaction.)
      if (!isUniqueViolation(err)) throw err;
      const existing = body.externalKey ? await findByExternalKey(db, siteId, body.externalKey) : undefined;
      // Not an externalKey replay: let withUniqueSlug retry a lost slug race.
      if (!existing) throw err;
      return { article: await articleDto(db, existing), created: false };
    }
  };

  // A slug the client chose explicitly is not ours to de-duplicate: let the
  // collision surface as a 409. A slug we derived from the title is.
  return body.slug ? attemptCreate(body.slug) : withUniqueSlug(db, siteId, slugify(body.title), attemptCreate);
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
  opts: { requireOwnership?: boolean } = {},
) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");

  if (opts.requireOwnership && actor.kind === "user") {
    const userId = actor.userId ?? null;
    const isCreator = row.createdBy === userId;
    const isListedAuthor =
      userId != null &&
      (await db.query.articleAuthors.findFirst({ where: and(eq(articleAuthors.articleId, articleId), eq(articleAuthors.authorId, userId)) })) != null;
    if (!isCreator && !isListedAuthor) {
      throw forbidden("you can only edit your own articles");
    }
  }

  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw conflict("version mismatch: the article was modified by another actor", {
      currentVersion: row.version,
      expectedVersion,
      code: "VERSION_CONFLICT",
    });
  }

  const previousSlug = row.slug;
  const wantsNewSlug = body.slug != null && body.slug !== row.slug;

  const document = body.document ? migrateDocumentToV2(body.document) : row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT;
  const seo = body.seo ? { ...row.seo, ...body.seo } : row.seo;
  const updatedBy = actorUserId(actor);
  const featuredMediaId = body.featuredMediaId !== undefined ? body.featuredMediaId : row.featuredMediaId;

  await assertMediaInSite(db, siteId, [...collectDocumentMediaIds(document), ...(featuredMediaId ? [featuredMediaId] : []), ...(seo.socialImageMediaId ? [seo.socialImageMediaId] : [])]);
  await assertPrimaryCategoryInSite(db, siteId, seo.primaryCategoryId);

  const attemptUpdate = (slug: string | null) =>
    db.transaction(async (tx) => {
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
          featuredMediaId,
          updatedBy,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
        .returning();
      if (!result) throw conflict("article changed concurrently");

      // Inside the transaction: a retried attempt must not leave behind a 301 to
      // a slug that was never used (docs/03-SEO.md).
      if (previousSlug && slug && slug !== previousSlug) {
        await upsertSlugRedirect(tx as unknown as Db, siteId, previousSlug, slug);
      }

      if (body.document && JSON.stringify(document) !== JSON.stringify(row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT)) {
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

  // Unlike create, an explicit new slug is still de-duplicated with a suffix
  // here, so it goes through withUniqueSlug; an untouched slug does not.
  const updated = wantsNewSlug
    ? await withUniqueSlug(db, siteId, body.slug as string, attemptUpdate)
    : await attemptUpdate(row.slug);

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
    externalKey?: string;
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
  if (q.externalKey) conditions.push(eq(articles.externalKey, q.externalKey));
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
    document: migrateDocumentToV2(r.document),
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
  assertTransition(row.status, "published");

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
    document: row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT,
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
  assertTransition(row.status, "scheduled");

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


async function applyStatusTransition(
  db: Db,
  siteId: string,
  articleId: string,
  actor: ActorRef,
  to: ArticleStatus,
  action: string,
  note?: string,
  clearDates = false,
) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  assertTransition(row.status, to);

  const updatedBy = actorUserId(actor);
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: to,
        publishedAt: clearDates ? null : row.publishedAt,
        scheduledAt: clearDates ? null : row.scheduledAt,
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
      action,
      objectType: "article",
      objectId: articleId,
      details: { from: row.status, to, note: note ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return result;
  });

  return articleDto(db, updated);
}

export async function submitArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "in_review", "articles.submit", note);
}

export async function approveArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "draft", "articles.approve", note, true);
}

export async function rejectArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "blocked", "articles.reject", note, true);
}

export async function unpublishArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "draft", "articles.unpublish", note, true);
}

export async function archiveArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "archived", "articles.archive", note, true);
}
