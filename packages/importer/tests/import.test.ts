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

    const tokenRes = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
      payload: {
        name: "importer",
        scopes: ["articles.create", "articles.read", "articles.publish", "articles.schedule", "media.manage", "media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage", "seo.manage"],
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

    const published = await client.listArticles(siteId, { externalKey: "imp:wp:post:42" });
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
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(report.imported.articles).toBe(0);
    expect(report.existing.articles).toBe(2);

    const rc = await reconcile(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(rc.missingArticles).toEqual([]);
    expect(rc.extraArticles).toEqual([]);
    expect(rc.imported.articles).toBe(2);
    expect(rc.deterministic).toBe(true);

    const all = await client.listArticles(siteId, { limit: 100 });
    expect(all.items.filter((a) => a.externalKey?.startsWith("imp:")).length).toBe(2);
  });
});
