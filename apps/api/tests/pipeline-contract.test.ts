import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@kal-el/contracts";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * P1-G. `PIPELINE_API.md`, the OpenAPI document, the zod schemas, the SDK and the routes
 * had drifted apart: a documented `created` response field that never existed, a scope
 * list that could not run the doc's own Python example, and an OpenAPI path
 * (`POST /v1/admin/service-tokens`) with no route behind it.
 *
 * These tests pin the parts a document cannot keep honest on its own.
 */
const here = dirname(fileURLToPath(import.meta.url));
const DOC = readFileSync(join(here, "..", "..", "..", "docs", "integrations", "PIPELINE_API.md"), "utf8");

describe("pipeline contract", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const h = (extra: Record<string, string> = {}) => ({
    Cookie: owner.cookieHeader,
    "x-kal-el-csrf": owner.csrf,
    ...extra,
  });

  it("every path in the OpenAPI document resolves to a real route", async () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, unknown>> };
    const missing: string[] = [];

    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const method of Object.keys(methods)) {
        // substitute plausible params; a missing route answers 404 from the router itself
        const url = path
          .replace(/\{siteId\}/g, siteId)
          .replace(/\{[^}]+\}/g, "00000000-0000-0000-0000-000000000000");
        const res = await ctx.app.inject({ method: method.toUpperCase() as "GET", url, headers: h() });
        // 404 with no body is the router; a handled 404 carries the error envelope
        const routed = res.statusCode !== 404 || typeof res.json()?.error?.code === "string";
        if (!routed) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(missing, "OpenAPI must not describe paths that do not exist").toEqual([]);
  });

  it("createArticle signals created-vs-existing by status, and the doc says so", async () => {
    const payload = { title: "Contrato", externalKey: "pipe:contract:1" };
    const first = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/articles`, headers: h(), payload });
    expect(first.statusCode, "a new article is 201").toBe(201);
    expect(first.json().data.created, "there is no `created` field on the wire").toBeUndefined();

    const again = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/articles`, headers: h(), payload });
    expect(again.statusCode, "the same externalKey returns the existing article as 200").toBe(200);
    expect(again.json().data.id).toBe(first.json().data.id);

    expect(DOC, "the doc must not promise a `created` field").not.toMatch(/`created: false`/);
    expect(DOC).toMatch(/só pelo status HTTP/);
  });

  it("externalKey is create-only, as documented", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: h(),
      payload: { title: "Imutável", externalKey: "pipe:contract:2" },
    });
    const article = created.json().data;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: h({ "if-match": String(article.version) }),
      payload: { externalKey: "pipe:contract:changed" },
    });
    expect(res.statusCode, "the update schema is strict and omits externalKey").toBe(400);
    expect(DOC).toMatch(/Aceito apenas na criação/);
  });

  it("the scope list in the doc is sufficient to run the documented flow", async () => {
    // exactly the scopes section 8 says the example needs
    const token = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: h(),
      payload: {
        name: "doc-example",
        scopes: ["taxonomy.categories.manage", "media.manage", "articles.create", "articles.publish"],
      },
    });
    expect(token.statusCode).toBe(201);
    const bearer = { Authorization: `Bearer ${token.json().data.token as string}` };

    // step 1 of the example: LIST categories - this needed a scope the old doc never named
    const list = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/categories`, headers: bearer });
    expect(list.statusCode, "listing categories must work with the documented scopes").toBe(200);

    // step 1b: create one
    const cat = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/categories`,
      headers: { ...bearer, "idempotency-key": "doc-example-cat" },
      payload: { name: "Cinema", slug: "cinema-doc" },
    });
    expect(cat.statusCode).toBe(201);

    // step 3: create the article
    const article = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": "doc-example-article" },
      payload: {
        title: "Exemplo do doc",
        categories: [cat.json().data.id],
        externalKey: "pipe:doc:1",
      },
    });
    expect(article.statusCode).toBe(201);

    // step 4: publish
    const published = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.json().data.id}/publish`,
      headers: { ...bearer, "idempotency-key": "doc-example-publish" },
      payload: {},
    });
    expect(published.statusCode, "publish must work with the documented scopes").toBe(200);
    expect(published.json().data.status).toBe("published");
  });

  it("reading taxonomy requires the manage scope, and the doc warns about it", async () => {
    const token = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: h(),
      payload: { name: "read-only-attempt", scopes: ["articles.read"] },
    });
    const bearer = { Authorization: `Bearer ${token.json().data.token as string}` };

    const res = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/categories`, headers: bearer });
    expect(res.statusCode).toBe(403);
    expect(DOC, "this trap must stay documented while it is true").toMatch(/Ler taxonomia exige o escopo/);
  });

  it("rejecting an article uses articles.approve, as documented", async () => {
    const token = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: h(),
      payload: { name: "reviewer", scopes: ["articles.create", "articles.read", "articles.submit", "articles.approve"] },
    });
    const bearer = { Authorization: `Bearer ${token.json().data.token as string}` };

    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: bearer,
      payload: { title: "Para rejeitar" },
    });
    const id = created.json().data.id;
    await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/articles/${id}/submit`, headers: bearer, payload: {} });

    const rejected = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${id}/reject`,
      headers: bearer,
      payload: {},
    });
    expect(rejected.statusCode).toBe(200);
    expect(DOC).toMatch(/`articles\.reject` não existe/);
  });

  it("approve returns the article to draft, which the doc calls out", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: h(),
      payload: { title: "Aprovar" },
    });
    const id = created.json().data.id;
    await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/articles/${id}/submit`, headers: h(), payload: {} });
    const approved = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${id}/approve`,
      headers: h(),
      payload: {},
    });
    expect(approved.json().data.status).toBe("draft");
    expect(DOC).toMatch(/`approve` leva o artigo para `draft`/);
  });

  it("If-Match takes a bare integer, not a quoted ETag", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: h(),
      payload: { title: "ETag" },
    });
    const article = created.json().data;

    const quoted = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: h({ "if-match": `"${article.version}"` }),
      payload: { title: "aspas" },
    });
    expect(quoted.statusCode).toBe(400);
    expect(DOC).toMatch(/inteiro puro/);
  });
});
