import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { articles } from "@kal-el/db/schema";
import { bootstrap, createServiceToken, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("automation idempotency", () => {
  let ctx: TestContext;
  let session: Session;
  let siteId: string;
  let bearer: { Authorization: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);
    const tokenRes = await createServiceToken(ctx, session, siteId, ["articles.create"]);
    const token = tokenRes.json().data.token as string;
    bearer = { Authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await ctx.close();
  });

  const payload = (n: number) => ({
    type: "article",
    title: `Automação MN26 nº ${n}`,
    slug: `automacao-mn26-${n}`,
    externalKey: `mn26:${n}`,
  });

  it("returns the same article for identical retried requests", async () => {
    const key = "idem-key-00000001";
    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": key },
      payload: payload(1),
    });
    expect(first.statusCode).toBe(201);
    const firstArticle = first.json().data;

    const second = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": key },
      payload: payload(1),
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(firstArticle.id);
  });

  it("creates only one article across retries", async () => {
    const rows = await ctx.db.select().from(articles).where(eq(articles.siteId, siteId));
    const matching = rows.filter((a) => a.externalKey === "mn26:1");
    expect(matching.length).toBe(1);
  });

  it("rejects a key reused with a different request", async () => {
    const key = "idem-key-00000002";
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": key },
      payload: payload(2),
    });
    const different = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": key },
      payload: payload(3),
    });
    expect(different.statusCode).toBe(409);
  });

  it("treats externalKey as a natural idempotency key", async () => {
    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: bearer,
      payload: payload(9),
    });
    expect(first.statusCode).toBe(201);

    // no Idempotency-Key header, same externalKey → returns the existing article
    const second = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: bearer,
      payload: payload(9),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
  });

  it("scopes idempotency keys per actor", async () => {
    const key = "idem-key-00000003";
    const viaService = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { ...bearer, "idempotency-key": key },
      payload: payload(4),
    });
    expect(viaService.statusCode).toBe(201);

    // a human with the same key must not collide with the service actor
    const viaHuman = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf, "idempotency-key": key },
      payload: payload(5),
    });
    expect(viaHuman.statusCode).toBe(201);
    expect(viaHuman.json().data.id).not.toBe(viaService.json().data.id);
  });
});
