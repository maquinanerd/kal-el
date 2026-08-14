import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articleRevisions, articles, outboxEvents } from "@kal-el/db/schema";

export type PromoteSummary = { promoted: number };

const DEFAULT_DOCUMENT = { version: 1, nodes: [] };

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
    .limit(100);

  let promoted = 0;
  for (const { id } of due) {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(articles)
        .set({
          status: "published",
          publishedAt: new Date(),
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
        document: (row.document ?? DEFAULT_DOCUMENT) as never,
        createdBy: null,
        note: "scheduled publish",
      });

      const publishedAt = new Date();
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

    if (updated) promoted++;
  }

  return { promoted };
}
