import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@kal-el/api/src/app.js";
import { loadConfig } from "@kal-el/api/src/config.js";
import { seedPermissions } from "@kal-el/api/src/services/seed.js";
import { freshTestDb } from "@kal-el/testkit";
import { processDueEvents } from "@kal-el/worker/src/dispatcher.js";
import { KalElClient } from "@kal-el/sdk";
import { buildFixture } from "../src/server.js";

async function apiInject(app: FastifyInstance, method: "POST" | "GET", url: string, opts: { headers?: Record<string, string>; payload?: Record<string, unknown> } = {}) {
  return app.inject({ method, url, headers: opts.headers, payload: opts.payload });
}

describe("delivery + revalidation end-to-end", () => {
  let api: FastifyInstance;
  let fixture: FastifyInstance;
  let db: import("@kal-el/db").Db;
  let pool: import("pg").Pool;
  let siteId: string;
  let apiBase: string;
  let token: string;
  let secret: string;
  let ownerSession: { cookieHeader: string; csrf: string };
  const revalidated: unknown[] = [];

  beforeAll(async () => {
    const fresh = await freshTestDb();
    db = fresh.db;
    pool = fresh.pool;

    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: fresh.url,
      SESSION_SECRET: "test-secret-key",
      BOOTSTRAP_TOKEN: "test-bootstrap-token",
    } as NodeJS.ProcessEnv);
    api = await buildApp({ connectionString: fresh.url, config });
    await seedPermissions(api.db);
    await api.listen({ port: 0, host: "127.0.0.1" });
    apiBase = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;

    const boot = await apiInject(api, "POST", "/v1/bootstrap/init", {
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      payload: { site: { slug: "portal-e2e", name: "Portal E2E" }, user: { email: "owner@kalel.test", name: "Owner", password: "super-secure-password-123" } },
    });
    expect(boot.statusCode).toBe(201);
    siteId = boot.json().data.site.id;

    const loginRes = await apiInject(api, "POST", "/v1/auth/login", {
      payload: { email: "owner@kalel.test", password: "super-secure-password-123" },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookies = loginRes.cookies ?? [];
    ownerSession = {
      cookieHeader: `ke_session=${cookies.find((c) => c.name === "ke_session")?.value ?? ""}`,
      csrf: cookies.find((c) => c.name === "ke_csrf")?.value ?? "",
    };

    const tokenRes = await apiInject(api, "POST", `/v1/admin/sites/${siteId}/service-tokens`, {
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { name: "mn26-e2e", scopes: ["articles.create", "articles.read", "articles.publish"] },
    });
    expect(tokenRes.statusCode).toBe(201);
    token = tokenRes.json().data.token as string;

    // fixture signs with a pre-shared secret; give it to the webhook subscription
    secret = randomBytes(32).toString("hex");
    fixture = await buildFixture({ secret, onRevalidate: (p) => revalidated.push(p) });
    await fixture.listen({ port: 0, host: "127.0.0.1" });
    const fixtureBase = `http://127.0.0.1:${(fixture.server.address() as { port: number }).port}`;

    const webhookRes = await apiInject(api, "POST", `/v1/admin/sites/${siteId}/webhooks`, {
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { url: `${fixtureBase}/webhooks/article.published`, events: ["article.published"], secret },
    });
    expect(webhookRes.statusCode).toBe(201);
  });

  afterAll(async () => {
    await fixture?.close();
    await api?.close();
    await pool?.end();
  });

  it("publishes via the MN26 service path and the fixture revalidates its cache", async () => {
    const client = new KalElClient({ baseUrl: apiBase, token, retries: 1 });

    const article = await client.createArticle(siteId, {
      title: "Gladiador II revalidado por webhook",
      slug: "gladiador-ii-webhook",
      type: "article",
      externalKey: "mn26:e2e:1",
    });
    expect(article.slug).toBe("gladiador-ii-webhook");

    const published = await client.publishArticle(siteId, article.id, "e2e", "mn26.publish.e2e.1");
    expect(published.status).toBe("published");

    const miss = await fixture.inject({ method: "GET", url: "/articles/gladiador-ii-webhook" });
    expect(miss.statusCode).toBe(404);

    const summary = await processDueEvents(db);
    expect(summary.delivered).toBe(1);

    expect(revalidated.length).toBe(1);
    expect(revalidated[0]).toMatchObject({ slug: "gladiador-ii-webhook", articleId: article.id });

    const hit = await fixture.inject({ method: "GET", url: "/articles/gladiador-ii-webhook" });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data.slug).toBe("gladiador-ii-webhook");
    expect(hit.json().cached).toBe(true);
  });

  it("rejects unsigned webhook deliveries", async () => {
    const bad = await fixture.inject({
      method: "POST",
      url: "/webhooks/article.published",
      headers: { "x-kal-el-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000" },
      payload: { articleId: "x", slug: "y", publishedAt: new Date().toISOString(), version: 1 },
    });
    expect(bad.statusCode).toBe(401);
  });
});
