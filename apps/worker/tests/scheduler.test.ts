import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb, seedSite } from "@kal-el/testkit";
import { createDb, createPool, type Db } from "@kal-el/db";
import { articleRevisions, articles, auditLog, outboxEvents } from "@kal-el/db/schema";

import { promoteScheduledArticles } from "../src/scheduler.js";

describe("scheduled publish promotion", () => {
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let siteId: string;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    db = createDb(pool);
    const site = await seedSite(db);
    siteId = site.id;
  });

  beforeEach(async () => {
    await db.delete(outboxEvents);
    await db.delete(auditLog);
    await db.delete(articleRevisions);
    await db.delete(articles);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedScheduled(slug: string, scheduledAt: Date) {
    const [row] = await db
      .insert(articles)
      .values({
        siteId,
        title: `Scheduled ${slug}`,
        slug,
        status: "scheduled",
        scheduledAt,
        document: { version: 1, nodes: [{ type: "paragraph", attrs: {}, content: "conteúdo" }] },
        version: 0,
      })
      .returning();
    if (!row) throw new Error("insert failed");
    return row;
  }

  it("promotes due articles, keeps scheduled_at as publishedAt and emits one event", async () => {
    const due = new Date(Date.now() - 60_000);
    const row = await seedScheduled("devido", due);

    const summary = await promoteScheduledArticles(db);
    expect(summary.promoted).toBe(1);

    const after = await db.query.articles.findFirst({ where: eq(articles.id, row.id) });
    expect(after?.status).toBe("published");
    expect(after?.scheduledAt).toBeNull();

    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, row.id));
    expect(events.filter((e) => e.eventType === "article.published").length).toBe(1);

    const revisions = await db.select().from(articleRevisions).where(eq(articleRevisions.articleId, row.id));
    expect(revisions.length).toBe(1);
    expect(revisions[0]?.note).toBe("scheduled publish");
  });

  it("refuses an article whose stored document cannot be read, and publishes the rest of the tick", async () => {
    // Degrading the document to an empty one instead was worse than refusing: it published
    // the article, announced it to every subscriber, and filed an empty revision that the
    // CMS restore button writes straight back over the live body.
    const due = new Date(Date.now() - 60_000);
    const healthy = await seedScheduled("saudavel", due);
    const [broken] = await db
      .insert(articles)
      .values({
        siteId,
        title: "Documento ilegível",
        slug: "ilegivel",
        status: "scheduled",
        scheduledAt: due,
        // truthy, but nothing the migration can read - a NOT NULL jsonb accepts it
        document: {} as never,
        version: 0,
      })
      .returning();
    if (!broken) throw new Error("insert failed");

    const summary = await promoteScheduledArticles(db);

    // the healthy one is not held back by its neighbour
    expect(summary.promoted).toBe(1);
    expect(summary.blocked).toBe(1);
    const ok = await db.query.articles.findFirst({ where: eq(articles.id, healthy.id) });
    expect(ok?.status).toBe("published");

    // nothing was published or announced for the unreadable one
    const bad = await db.query.articles.findFirst({ where: eq(articles.id, broken.id) });
    expect(bad?.publishedAt).toBeNull();
    const revisions = await db.select().from(articleRevisions).where(eq(articleRevisions.articleId, broken.id));
    expect(revisions).toHaveLength(0);
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, broken.id));
    expect(events).toHaveLength(0);

    // and it is out of the due window: left `scheduled` with a past date it would match
    // the query forever, and since a new schedule must be in the future it would sort
    // ahead of every healthy article and fill the window on every tick
    expect(bad?.status).toBe("blocked");
    const audit = await db.select().from(auditLog).where(eq(auditLog.objectId, broken.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("articles.block");
    expect(audit[0]?.actorType).toBe("system");

    const second = await promoteScheduledArticles(db);
    expect(second.promoted).toBe(0);
    expect(second.blocked).toBe(0);
  });

  it("does not promote articles scheduled in the future", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const row = await seedScheduled("futuro", future);

    const summary = await promoteScheduledArticles(db);
    expect(summary.promoted).toBe(0);

    const after = await db.query.articles.findFirst({ where: eq(articles.id, row.id) });
    expect(after?.status).toBe("scheduled");
  });

  it("is idempotent under repeated runs", async () => {
    const due = new Date(Date.now() - 60_000);
    const row = await seedScheduled("repetido", due);

    await promoteScheduledArticles(db);
    const summary2 = await promoteScheduledArticles(db);
    expect(summary2.promoted).toBe(0);

    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, row.id));
    expect(events.filter((e) => e.eventType === "article.published").length).toBe(1);
  });
});
