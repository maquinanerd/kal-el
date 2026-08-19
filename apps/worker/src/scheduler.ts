import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articleRevisions, articles, auditLog, outboxEvents } from "@kal-el/db/schema";
import { migrateDocumentToV2 } from "@kal-el/contracts";

export type PromoteSummary = { promoted: number };

const DEFAULT_DOCUMENT = { version: 2, nodes: [] };

/**
 * `migrateDocumentToV2` maps `document.nodes` for anything that is not literally version
 * 2, so a truthy but shapeless column - `{}` - throws where reading the raw value never
 * did.
 *
 * This deliberately does NOT degrade to an empty document. Filing `{version:2,nodes:[]}`
 * as the revision for a publish looks like a real revision in the history, and the CMS
 * restore button writes a revision straight back over the live article - so degrading
 * here turned an article that could not be published into one that was published,
 * announced to every webhook subscriber, and one click away from having its body erased.
 * Refusing is the smaller failure: the caller isolates it, the article stays scheduled,
 * and the operator gets a named error.
 */
function publishableDocument(document: unknown) {
  if (!document) return DEFAULT_DOCUMENT;
  return migrateDocumentToV2(document as Parameters<typeof migrateDocumentToV2>[0]);
}

/**
 * Promote articles whose scheduled_at has arrived. Safe under concurrent
 * workers: the transition is a guarded UPDATE (status='scheduled' AND
 * scheduled_at <= now), so at most one worker wins per article; the outbox
 * event is keyed deterministically (exactly-once delivery per ADR-0005).
 */
export async function promoteScheduledArticles(db: Db): Promise<PromoteSummary> {
  const now = new Date();

  const due = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.status, "scheduled"), lte(articles.scheduledAt, now)))
    // oldest first: without an order an article that can never be promoted kept its slot
    // in every tick, and a hundred of them would starve scheduled publishing entirely
    .orderBy(asc(articles.scheduledAt))
    .limit(100);

  let promoted = 0;
  for (const { id } of due) {
    // One unpromotable article used to reject the whole function, and the worker abandons
    // the scheduled-publish job for that tick - so a single malformed document stopped
    // every other due article from publishing, on every tick, permanently.
    const updated = await promoteOne(db, id, now).catch((err) => {
      console.error(`[scheduler] article ${id} could not be promoted`, err);
      return null;
    });

    if (updated) promoted++;
  }

  return { promoted };
}

async function promoteOne(db: Db, id: string, now: Date) {
  return db.transaction(async (tx) => {
      // Read the intended time before nulling it. Stamping `new Date()` recorded the
      // promotion moment instead of the time the editor scheduled, and since
      // `scheduledAt` is cleared on the same statement the intent was unrecoverable.
      const scheduled = await tx.query.articles.findFirst({
        where: and(eq(articles.id, id), eq(articles.status, "scheduled")),
      });
      const intendedAt = scheduled?.scheduledAt ?? new Date();

      const rows = await tx
        .update(articles)
        .set({
          status: "published",
          publishedAt: intendedAt,
          scheduledAt: null,
          version: sql`${articles.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(articles.id, id), eq(articles.status, "scheduled"), lte(articles.scheduledAt, now)))
        .returning();
      const row = rows[0];
      if (!row) return null;

      const maxRev = await tx
        .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, id));
      await tx.insert(articleRevisions).values({
        articleId: id,
        revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
      // every other publish path migrates first; this one filed the raw column, so a
      // scheduled publish of a still-v1 article wrote a v1 body into a table whose
      // schema says v2 - the `as never` cast is what kept the compiler quiet about it
      document: publishableDocument(row.document) as never,
        createdBy: null,
        note: "scheduled publish",
      });

      const publishedAt = intendedAt;
      // Every other publish path writes an audit row; an unattended 03:00 publish left no
      // record at all. `actorType: "system"` exists for exactly this.
      await tx.insert(auditLog).values({
        siteId: row.siteId,
        actorType: "system",
        actorId: null,
        action: "articles.publish",
        objectType: "article",
        objectId: id,
        details: { via: "scheduler", scheduledAt: intendedAt.toISOString(), version: row.version },
      });

      await tx
        .insert(outboxEvents)
        .values({
          siteId: row.siteId,
          aggregateType: "article",
          aggregateId: id,
          eventType: "article.published",
          payload: { articleId: id, slug: row.slug, publishedAt: publishedAt.toISOString(), version: row.version },
          idempotencyKey: `article:${id}:publish:${publishedAt.getTime()}`,
        })
        .onConflictDoNothing();

    return row;
  });
}
