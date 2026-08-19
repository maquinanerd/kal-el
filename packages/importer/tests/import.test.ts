import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "@kal-el/api/src/app.js";
import { loadConfig } from "@kal-el/api/src/config.js";
import { seedPermissions } from "@kal-el/api/src/services/seed.js";
import { freshTestDb } from "@kal-el/testkit";
import { outboxEvents } from "@kal-el/db/schema";
import { KalElClient } from "@kal-el/sdk";

import { importBatch } from "../src/import.js";
import { normalizeWordPress, readWordPressSnapshot } from "../src/wordpress.js";
import { reconcile } from "../src/reconcile.js";
import { externalKeyFor } from "../src/types.js";

const SNAPSHOT = {
  site: { name: "Portal Legado", url: "https://legado.example.com" },
  authors: [{ id: 1, display_name: "Ana Souza", user_nicename: "ana-souza", user_email: "ana@legado.example" }],
  categories: [{ id: 5, name: "Filmes", slug: "filmes" }],
  tags: [{ id: 9, name: "Gladiador", slug: "gladiador" }],
  media: [{ id: 12, filename: "gladiador.jpg", url: "https://legado.example.com/wp-content/gladiador.jpg", mime_type: "image/jpeg" }],
  posts: [
    {
      id: 42,
      post_type: "post",
      title: "Gladiador II chega aos cinemas",
      slug: "gladiador-ii-cinemas",
      content: "<h2>Retorno</h2><p>Uma nova aventura.</p><img src=\"https://legado.example.com/wp-content/gladiador.jpg\" alt=\"Cartaz\" />",
      excerpt: "Resumo",
      status: "publish",
      date: "2024-11-15T10:00:00Z",
      author: 1,
      categories: [5],
      tags: [9],
      featured_media: 12,
      meta: { _yoast_wpseo_title: "Título SEO", _yoast_wpseo_metadesc: "Descrição SEO" },
      link: "https://legado.example.com/gladiador-ii-cinemas",
    },
    {
      id: 43,
      post_type: "post",
      title: "Rascunho da crítica",
      slug: "rascunho-critica",
      content: "<p>Rascunho.</p>",
      status: "draft",
      date: "2024-11-14T09:00:00Z",
      author: 1,
      categories: [5],
      tags: [],
    },
  ],
};

describe("WordPress import through the REST API", () => {
  let api: FastifyInstance;
  let pool: import("pg").Pool;
  let db: import("@kal-el/db").Db;
  let siteId: string;
  let client: KalElClient;
  let ownerSession: { cookieHeader: string; csrf: string };
  let apiBase: string;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    db = fresh.db;

    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: fresh.url,
      SESSION_SECRET: "test-secret-key",
      BOOTSTRAP_TOKEN: "test-bootstrap-token",
    } as NodeJS.ProcessEnv);
    api = await buildApp({ connectionString: fresh.url, config });
    await seedPermissions(api.db);
    await api.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    apiBase = base;

    const boot = await api.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      payload: { site: { slug: "portal-import", name: "Portal Import" }, user: { email: "owner@kalel.test", name: "Owner", password: "super-secure-password-123" } },
    });
    siteId = boot.json().data.site.id;

    const login = await api.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "owner@kalel.test", password: "super-secure-password-123" } });
    const cookies = login.cookies ?? [];
    const session = { cookieHeader: `ke_session=${cookies.find((c) => c.name === "ke_session")?.value ?? ""}`, csrf: cookies.find((c) => c.name === "ke_csrf")?.value ?? "" };
    ownerSession = session;

    const tokenRes = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
      payload: {
        name: "importer",
        // articles.update is what makes a re-import synchronize rather than skip
        scopes: ["articles.create", "articles.read", "articles.update", "articles.publish", "articles.schedule", "media.manage", "media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage", "seo.manage"],
      },
    });
    const token = tokenRes.json().data.token as string;
    client = new KalElClient({ baseUrl: base, token, retries: 1 });
  });

  afterAll(async () => {
    await api?.close();
    await pool?.end();
  });

  it("imports a WordPress snapshot, preserving status/dates and emitting revalidation", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp", fetchMedia });

    expect(report.imported.articles).toBe(2);
    expect(report.imported.categories).toBe(1);
    expect(report.imported.tags).toBe(1);
    expect(report.imported.authors).toBe(1);
    expect(report.imported.media).toBe(1);
    expect(report.mediaPending).toBe(0);

    const published = await client.listArticles(siteId, { externalKey: externalKeyFor("imp", "article", "wp:post:42") });
    expect(published.items.length).toBe(1);
    const publishedItem = published.items[0];
    if (!publishedItem) throw new Error("published article missing");
    const full = await client.getArticle(siteId, publishedItem.id);
    expect(full.status).toBe("published");
    expect(new Date(full.publishedAt!).getTime()).toBe(new Date("2024-11-15T10:00:00Z").getTime());
    expect(full.seo.seoTitle).toBe("Título SEO");
    expect(full.provenance?.sources?.[0]?.externalId).toBe("wp:post:42");
    // image node is preserved via uploaded media
    expect(full.document.nodes.some((n) => n.type === "image")).toBe(true);
    expect(full.featuredMediaId).toBeTruthy();

    // Relations must actually be ATTACHED, not merely created. The taxonomy lookup was
    // keyed by slug while articles reference taxonomy by external id, so every category,
    // tag and author silently fell out of `.filter(Boolean)` on every imported article.
    expect(full.categories.length, "imported article must keep its categories").toBeGreaterThan(0);
    expect(full.tags.length, "imported article must keep its tags").toBeGreaterThan(0);
    expect(full.authors.length, "imported article must keep its authors").toBeGreaterThan(0);
    expect(report.warnings.filter((w) => /reference dropped/.test(w))).toEqual([]);

    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateType, "article"));
    expect(events.filter((e) => e.eventType === "article.published").length).toBe(1);
  });

  it("re-import is idempotent (no duplicates) and reconciles", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp", fetchMedia });
    expect(report.imported.articles).toBe(0);
    expect(report.existing.articles).toBe(2);

    const rc = await reconcile(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(rc.missingArticles).toEqual([]);
    expect(rc.extraArticles).toEqual([]);
    expect(rc.imported.articles).toBe(2);
    expect(rc.deterministic).toBe(true);

    const all = await client.listArticles(siteId, { limit: 100 });
    expect(all.items.filter((a) => a.externalKey?.startsWith("imp:")).length).toBe(2);

    // an unchanged source performs no write at all
    expect(report.updated.articles, "nothing changed, so nothing should be written").toBe(0);
    expect(report.unchanged.articles).toBe(2);
  });

  it("re-import propagates a changed title, body, status and relations", async () => {
    const snapshot = readWordPressSnapshot(SNAPSHOT);
    const post = snapshot.posts.find((p) => p.id === 42);
    if (!post) throw new Error("fixture post 42 missing");

    post.title = "Título revisado na origem";
    post.content = `${post.content}<p>Parágrafo acrescentado depois.</p>`;

    const batch = normalizeWordPress(snapshot);
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp", fetchMedia });

    expect(report.warnings.filter((w) => /update failed/.test(w))).toEqual([]);
    expect(report.imported.articles, "no new article - the same source item").toBe(0);
    expect(report.updated.articles, "the changed item must be synchronized, not skipped").toBe(1);
    expect(report.unchanged.articles).toBe(1);

    const found = await client.listArticles(siteId, { externalKey: externalKeyFor("imp", "article", "wp:post:42") });
    expect(found.items.length, "still exactly one article for this source id").toBe(1);
    const item = found.items[0];
    if (!item) throw new Error("article missing");

    const full = await client.getArticle(siteId, item.id);
    expect(full.id, "the SAME article id, not a second one").toBe(item.id);
    expect(full.title).toBe("Título revisado na origem");
    const text = JSON.stringify(full.document);
    expect(text).toContain("Parágrafo acrescentado depois.");

    const all = await client.listArticles(siteId, { limit: 100 });
    expect(all.items.filter((a) => a.externalKey?.startsWith("imp:")).length).toBe(2);
  });

  it("re-import with media reuses the existing binary instead of uploading it again", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });

    const before = await client.listMedia(siteId, { limit: 100 });
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp", fetchMedia });
    const after = await client.listMedia(siteId, { limit: 100 });

    expect(
      after.items.length,
      "a second run with fetchMedia used to create N more media rows and N more blobs",
    ).toBe(before.items.length);
    expect(report.warnings.filter((w) => /media failed/.test(w))).toEqual([]);
  });

  it("reconcile does not claim keys from a different prefix that shares a leading string", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    // "imp" must not swallow "impx:..." - the separator is part of the comparison
    await client.createArticle(siteId, { title: "Outro importador", externalKey: "impx:999" });

    const rc = await reconcile(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(rc.extraArticles).toEqual([]);
  });
  it("survives an article the API refuses, and says so in the report", async () => {
    // createArticle was the one unguarded call in the loop: a single refusal threw out of
    // it, so every later article was skipped and the report - with all its warnings - was
    // never returned to the caller at all.
    const weakToken = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      // no articles.create: every article in the batch will be refused
      payload: { name: "weak-importer", scopes: ["articles.read", "media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage"] },
    });
    const weak = new KalElClient({ baseUrl: apiBase, token: weakToken.json().data.token as string, retries: 1 });

    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });

    const report = await importBatch(weak, siteId, batch, { externalKeyPrefix: "refused", fetchMedia });

    // it returns rather than throwing, and the refusals are counted, not just warned about
    expect(report.imported.articles).toBe(0);
    expect(report.failed.articles).toBe(2);
    expect(report.warnings.filter((w) => w.startsWith("create failed"))).toHaveLength(2);
  });

  it("counts a refused update, and survives a token that cannot even read", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const fetchMedia = async () => ({ data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mimeType: "image/jpeg" });

    // the articles from the first test are already there under this prefix, so this run
    // takes the update path for both of them
    const noUpdate = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { name: "no-update", scopes: ["articles.read", "articles.create", "media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage"] },
    });
    const readOnlyish = new KalElClient({ baseUrl: apiBase, token: noUpdate.json().data.token as string, retries: 1 });

    const changed = { ...batch, articles: batch.articles.map((a) => ({ ...a, title: `${a.title} (revisado)` })) };
    const updateReport = await importBatch(readOnlyish, siteId, changed, { externalKeyPrefix: "imp", fetchMedia });
    // counted, not merely warned: a re-sync with a token that lost articles.update used to
    // report zero failures while synchronizing nothing
    expect(updateReport.failed.articles).toBe(2);
    expect(updateReport.updated.articles).toBe(0);
    expect(updateReport.warnings.filter((w) => w.startsWith("update failed"))).toHaveLength(2);

    // and the lookups at the top of the loop are guarded too - without articles.read the
    // very first call in the iteration threw out of the batch and discarded the report
    const blind = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { name: "blind", scopes: ["media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage"] },
    });
    const blindClient = new KalElClient({ baseUrl: apiBase, token: blind.json().data.token as string, retries: 1 });

    const blindReport = await importBatch(blindClient, siteId, batch, { externalKeyPrefix: "blind", fetchMedia });
    expect(blindReport.failed.articles).toBe(2);
    expect(blindReport.warnings.filter((w) => w.startsWith("import failed"))).toHaveLength(2);
  });

});
