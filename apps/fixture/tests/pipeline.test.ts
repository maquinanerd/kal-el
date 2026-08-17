import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@kal-el/api/src/app.js";
import { loadConfig } from "@kal-el/api/src/config.js";
import { seedPermissions } from "@kal-el/api/src/services/seed.js";
import { freshTestDb } from "@kal-el/testkit";
import { KalElClient } from "@kal-el/sdk";

async function inject(app: FastifyInstance, method: "POST" | "GET", url: string, opts: { headers?: Record<string, string>; payload?: Record<string, unknown> } = {}) {
  return app.inject({ method, url, headers: opts.headers, payload: opts.payload });
}

describe("external pipeline contract (R10)", () => {
  let api: FastifyInstance;
  let db: import("@kal-el/db").Db;
  let pool: import("pg").Pool;
  let siteId: string;
  let apiBase: string;
  let token: string;
  let client: KalElClient;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    db = fresh.db;
    pool = fresh.pool;

    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: fresh.url, SESSION_SECRET: "test-secret-key", BOOTSTRAP_TOKEN: "test-bootstrap-token" } as NodeJS.ProcessEnv);
    api = await buildApp({ connectionString: fresh.url, config });
    await seedPermissions(api.db);
    await api.listen({ port: 0, host: "127.0.0.1" });
    apiBase = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;

    const boot = await inject(api, "POST", "/v1/bootstrap/init", { headers: { "x-bootstrap-token": "test-bootstrap-token" }, payload: { site: { slug: "portal-pipe", name: "Portal Pipe" }, user: { email: "owner@kalel.test", name: "Owner", password: "super-secure-password-123" } } });
    siteId = boot.json().data.site.id;

    const login = await inject(api, "POST", "/v1/auth/login", { payload: { email: "owner@kalel.test", password: "super-secure-password-123" } });
    const cookies = login.cookies ?? [];
    const session = { cookieHeader: `ke_session=${cookies.find((c) => c.name === "ke_session")?.value ?? ""}`, csrf: cookies.find((c) => c.name === "ke_csrf")?.value ?? "" };

    const tokenRes = await inject(api, "POST", `/v1/admin/sites/${siteId}/service-tokens`, {
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
      payload: { name: "pipeline", scopes: ["articles.create", "articles.read", "articles.update", "articles.publish", "articles.schedule", "articles.submit", "articles.approve", "media.manage", "media.read", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.entities.manage", "taxonomy.authors.manage", "taxonomy.sources.manage"] },
    });
    token = tokenRes.json().data.token as string;
    client = new KalElClient({ baseUrl: apiBase, token, retries: 1 });
  });

  afterAll(async () => {
    await api?.close();
    await pool?.end();
  });

  it("runs the full pipeline: create → media → taxonomy → submit → approve → publish", async () => {
    const category = await client.createCategory(siteId, { name: "Cinema", slug: "cinema" });
    const media = await client.uploadMedia(siteId, "capa.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), "image/png");
    expect(media.mimeType).toBe("image/png");

    const article = await client.createArticle(siteId, {
      title: "Matéria do pipeline",
      slug: "materia-pipeline",
      type: "article",
      externalKey: "mn26:pipe:1",
      categories: [category.id],
      featuredMediaId: media.id,
      document: { version: 2, nodes: [{ type: "paragraph", content: [{ type: "text", text: "texto do pipeline", marks: [] }] }] },
    });
    expect(article.status).toBe("draft");

    const submitted = await client.submitArticle(siteId, article.id);
    expect(submitted.status).toBe("in_review");

    const approved = await client.approveArticle(siteId, article.id);
    expect(approved.status).toBe("draft");

    const published = await client.publishArticle(siteId, article.id);
    expect(published.status).toBe("published");

    const entities = await client.listEntities(siteId);
    expect(Array.isArray(entities)).toBe(true);
    const sources = await client.listSources(siteId);
    expect(Array.isArray(sources)).toBe(true);
  });

  it("does not duplicate on externalKey or idempotency retry", async () => {
    const body = { title: "Sem duplicata", slug: "sem-duplicata", type: "article" as const, externalKey: "mn26:pipe:2" };
    const first = await client.createArticle(siteId, body);
    const second = await client.createArticle(siteId, body);
    expect(second.id).toBe(first.id);

    const list = await client.listArticles(siteId, { externalKey: "mn26:pipe:2" });
    expect(list.items.length).toBe(1);
  });
});
