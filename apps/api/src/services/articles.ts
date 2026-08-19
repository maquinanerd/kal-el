import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import {
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articles,
  articleTags,
  authors,
  categories,
  entities,
  outboxEvents,
  tags,
} from "@kal-el/db/schema";
import type { Article, ArticleDocumentV2, ArticleStatus, ArticleSummary, CreateArticleBody, SeoMetadata, UpdateArticleBody } from "@kal-el/contracts";
import { migrateDocumentToV2 } from "@kal-el/contracts";

import { badRequest, conflict, forbidden, invalidTransition, notFound, versionConflict } from "../plugins/errors.js";
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
    throw invalidTransition(`cannot transition article from "${from}" to "${to}"`, { from, to });
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

/**
 * @param excludeArticleId the article being updated, which must not count as a collision
 * with itself. Without it a repeated sync of the same source slug oscillated: the article
 * at `foo-2` asked for `foo`, found `foo` taken and `foo-2` taken (by itself), moved to
 * `foo-3`; the next run found `foo-2` free and moved back - leaving redirects in both
 * directions, i.e. a permanent 301 loop on the public site.
 */
async function uniqueSlug(db: Db, siteId: string, base: string, excludeArticleId?: string): Promise<string> {
  let slug = base;
  let i = 2;
  for (;;) {
    const exists = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.slug, slug)),
    });
    if (!exists || exists.id === excludeArticleId) return slug;
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

/**
 * Every id an article points at must live in the same site. Without this a caller could
 * attach another tenant's taxonomy - which both plants a cross-tenant FK (site B deleting
 * its own tag would cascade into site A's article) and turns the endpoint into an
 * existence oracle for other tenants' ids: a real id returns 201, an invented one 400.
 *
 * Mirrors `assertMediaInSite`; kept next to the write so no route can forget it.
 */
async function assertRelationsInSite(
  db: Db,
  siteId: string,
  body: CreateArticleBody | UpdateArticleBody,
): Promise<void> {
  const checks: { ids: string[] | undefined; label: string; table: typeof authors | typeof categories | typeof tags | typeof entities }[] = [
    { ids: body.authors, label: "author", table: authors },
    { ids: body.categories, label: "category", table: categories },
    { ids: body.tags, label: "tag", table: tags },
    { ids: body.entities, label: "entity", table: entities },
  ];

  for (const { ids, label, table } of checks) {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (unique.length === 0) continue;
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, unique), eq(table.siteId, siteId)));
    const found = new Set(rows.map((r) => r.id));
    for (const id of unique) {
      if (!found.has(id)) {
        // Same message whether the row is missing or belongs to another site: telling
        // them apart is exactly the oracle we are closing.
        throw badRequest(`referenced ${label} does not belong to this site`, { [`${label}Id`]: id });
      }
    }
  }
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

    await assertRelationsInSite(tx as unknown as Db, siteId, body);
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
    // `articleAuthors.authorId` is an FK to `authors.id` - an editorial byline, not an
    // account. Comparing it directly to a user id compares two disjoint UUID spaces and
    // can never match, so a legitimately credited co-author was always refused. The join
    // has to go through `authors.userId`.
    const isListedAuthor =
      userId != null &&
      (
        await db
          .select({ id: articleAuthors.authorId })
          .from(articleAuthors)
          .innerJoin(authors, eq(authors.id, articleAuthors.authorId))
          .where(and(eq(articleAuthors.articleId, articleId), eq(authors.userId, userId)))
          .limit(1)
      ).length > 0;
    if (!isCreator && !isListedAuthor) {
      throw forbidden("you can only edit your own articles");
    }
  }

  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw versionConflict("version mismatch: the article was modified by another actor", {
      currentVersion: row.version,
      expectedVersion,
    });
  }

  const document = body.document ? migrateDocumentToV2(body.document) : row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT;
  const seo = body.seo ? { ...row.seo, ...body.seo } : row.seo;
  const updatedBy = actorUserId(actor);
  const featuredMediaId = body.featuredMediaId !== undefined ? body.featuredMediaId : row.featuredMediaId;

  await assertMediaInSite(db, siteId, [...collectDocumentMediaIds(document), ...(featuredMediaId ? [featuredMediaId] : []), ...(seo.socialImageMediaId ? [seo.socialImageMediaId] : [])]);
  await assertPrimaryCategoryInSite(db, siteId, seo.primaryCategoryId);

  const updated = await db.transaction(async (tx) => {
    const inner = tx as unknown as Db;

    let slug = row.slug;
    if (body.slug && body.slug !== row.slug) {
      slug = await uniqueSlug(inner, siteId, body.slug, articleId);
      if (row.slug && slug !== row.slug) {
        await upsertSlugRedirect(inner, siteId, row.slug, slug);
      }
    }

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

    await assertRelationsInSite(tx as unknown as Db, siteId, body);
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

  /*
   * Retry safety, but only where the target state is unambiguous.
   *
   * A pipeline whose response was lost re-sends the same transition, and answering 409
   * "cannot transition from in_review to in_review" reports a hard failure for a write
   * that succeeded. So re-applying a transition the article already reached is a no-op.
   *
   * That reasoning does NOT hold for `draft`, which is the target of both `approve` and
   * `unpublish`. Treating status equality as a retry there turned `approve` on an article
   * that was never submitted into a silent 200 with no audit entry: the editorial gate
   * became a no-op while the caller was told it had approved. Those two rely on
   * `Idempotency-Key` for retry safety instead, which is what it is for.
   */
  const AMBIGUOUS_TARGET: ArticleStatus[] = ["draft"];
  if (row.status === to && !AMBIGUOUS_TARGET.includes(to)) {
    return articleDto(db, row);
  }

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

/**
 * Approve returns the article to `draft` for final editing.
 *
 * It must not double as an unpublish. `approve` and `unpublish` share the target
 * `draft`, and `published -> draft` is a legal transition - so an `editor` (who holds
 * `articles.approve` and deliberately NOT `articles.publish`) could withdraw a live
 * article through `/approve`, and `clearDates` would destroy its original `publishedAt`
 * with no way to recover it. Approving is only meaningful from a review state.
 */
const APPROVABLE_FROM: ArticleStatus[] = ["in_review", "blocked"];

export async function approveArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (!APPROVABLE_FROM.includes(row.status)) {
    throw invalidTransition(`cannot approve an article in "${row.status}"`, {
      from: row.status,
      to: "draft",
      expected: APPROVABLE_FROM,
    });
  }
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
