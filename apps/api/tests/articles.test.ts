import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { articleRevisions, articles, outboxEvents } from "@kal-el/db/schema";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("articles", () => {
  let ctx: TestContext;
  let session: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const articleHeaders = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });

  it("creates an article with default document and revision", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: {
        type: "article",
        title: "Gladiador II chega aos cinemas",
        slug: "gladiador-ii-cinemas",
      },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.title).toBe("Gladiador II chega aos cinemas");
    expect(data.slug).toBe("gladiador-ii-cinemas");
    expect(data.version).toBe(0);
    expect(data.document).toEqual({ version: 2, nodes: [] });
    expect(data.status).toBe("draft");
    expect(data.seo.robotsIndex).toBe("index");
  });

  it("rejects duplicate slug within a site", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Outro", slug: "gladiador-ii-cinemas" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("enforces optimistic concurrency on update", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Concurrent article", slug: "concurrent-article" },
    });
    const article = created.json().data;

    const stale = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": "99" },
      payload: { title: "stale edit" },
    });
    expect(stale.statusCode).toBe(409);

    const ok = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": String(article.version) },
      payload: { title: "fresh edit", document: { version: 2, nodes: [{ type: "paragraph", content: [{ type: "text", text: "Olá mundo", marks: [] }] }] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.version).toBe(article.version + 1);
    expect(ok.json().data.title).toBe("fresh edit");
  });

  it("records revisions when the document changes", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Revisionável", slug: "revisionavel" },
    });
    expect(created.statusCode).toBe(201);
    const article = created.json().data;

    await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": String(article.version) },
      payload: { document: { version: 2, nodes: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Novo título", marks: [] }] }] } },
    });

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}/revisions`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().data.length).toBeGreaterThanOrEqual(2);
    expect(revisions.json().data[0].revisionNumber).toBeGreaterThan(1);
  });

  it("serves the revision history even when one stored document is unreadable", async () => {
    // `migrateDocumentToV2` has no `version === 1` branch, so anything not literally 2
    // takes the v1 path - and a NOT NULL jsonb column still accepts 'null'::jsonb. One
    // such row used to 500 the entire revision history for the article.
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Histórico frágil", slug: "historico-fragil" },
    });
    expect(created.statusCode).toBe(201);
    const article = created.json().data;

    // both shapes: `null` is falsy and never reached the migration, `{}` is truthy and is
    // the one that actually threw - guarding only the first still 500ed the whole history
    await ctx.db.execute(
      sql`insert into ${articleRevisions} (article_id, revision_number, document, note)
          values (${article.id}::uuid, 98, 'null'::jsonb, 'corrupted-null'),
                 (${article.id}::uuid, 99, '{}'::jsonb, 'corrupted-empty')`,
    );

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}/revisions`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(revisions.statusCode).toBe(200);
    const rows = revisions.json().data as { revisionNumber: number; document: { version: number } }[];
    expect(rows.find((r) => r.revisionNumber === 98)?.document).toEqual({ version: 2, nodes: [] });
    expect(rows.find((r) => r.revisionNumber === 99)?.document).toEqual({ version: 2, nodes: [] });
  });

  it("keeps an article with an unreadable document readable, and repairable", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Corpo ilegível", slug: "corpo-ilegivel" },
    });
    const article = created.json().data;

    await ctx.db.execute(sql`update ${articles} set document = '{}'::jsonb where id = ${article.id}::uuid`);

    // every read used to 500, which also made the article unrepairable: the PATCH that
    // would fix it reads the old value on the way through
    const read = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.document).toEqual({ version: 2, nodes: [] });

    const repaired = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: articleHeaders(),
      payload: { document: { version: 2, nodes: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "recuperado", marks: [] }] }] } },
    });
    expect(repaired.statusCode).toBe(200);
    expect(repaired.json().data.document.nodes).toHaveLength(1);
  });

  it("publishes an article exactly once and emits an outbox event", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Notícia publicável", slug: "noticia-publicavel" },
    });
    const article = created.json().data;

    const pub = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/publish`,
      headers: articleHeaders(),
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.status).toBe("published");
    expect(pub.json().data.publishedAt).toBeTruthy();

    const pub2 = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/publish`,
      headers: articleHeaders(),
    });
    expect(pub2.statusCode).toBe(200);
    expect(pub2.json().data.publishedAt).toBe(pub.json().data.publishedAt);

    const events = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, article.id));
    const publishEvents = events.filter((e) => e.eventType === "article.published");
    expect(publishEvents.length).toBe(1);
  });

  it("schedules an article for a future time", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Agendado", slug: "agendado" },
    });
    const article = created.json().data;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/schedule`,
      headers: articleHeaders(),
      payload: { scheduledAt: future },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("scheduled");
    expect(res.json().data.scheduledAt).toBe(future);
  });

  it("lists articles with cursor pagination and filters", async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers: articleHeaders(),
        payload: { title: `Lista artigo ${i}`, slug: `lista-artigo-${i}` },
      });
    }

    const page1 = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?limit=3&q=Lista`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json().data;
    expect(p1.items.length).toBe(3);
    expect(p1.nextCursor).toBeTruthy();

    const page2 = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?limit=3&q=Lista&cursor=${encodeURIComponent(p1.nextCursor)}`,
      headers: { Cookie: session.cookieHeader },
    });
    const p2 = page2.json().data;
    expect(p2.items.length).toBeGreaterThan(0);
    const ids = new Set([...p1.items, ...p2.items].map((a: { id: string }) => a.id));
    expect(ids.size).toBe(p1.items.length + p2.items.length);
  });
});
