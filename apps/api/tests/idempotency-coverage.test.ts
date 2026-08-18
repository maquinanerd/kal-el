import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * `Idempotency-Key` was documented as the retry contract for every write, but only
 * `POST /articles` ever read the header. Entities, sources and media have no unique
 * index to fall back on, so a retried create inserted a genuine duplicate row.
 */
describe("idempotency coverage on retryable writes", () => {
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

  const h = (key?: string) => ({
    Cookie: owner.cookieHeader,
    "x-kal-el-csrf": owner.csrf,
    ...(key ? { "idempotency-key": key } : {}),
  });

  it("a retried entity create does not insert a second row", async () => {
    const payload = { name: "Christopher Nolan", type: "person" as const };
    const first = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h("entity-key-1"), payload });
    expect(first.statusCode).toBe(201);
    const id = first.json().data.id;

    const retry = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h("entity-key-1"), payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().data.id, "the retry must replay the original row, not create a new one").toBe(id);

    const all = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/entities`, headers: { Cookie: owner.cookieHeader } });
    const matching = (all.json().data as { id: string; name: string }[]).filter((e) => e.name === "Christopher Nolan");
    expect(matching.length, "exactly one entity row").toBe(1);
  });

  it("a retried source create does not insert a second row", async () => {
    const payload = { name: "Variety", url: "https://variety.com" };
    const first = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/sources`, headers: h("source-key-1"), payload });
    expect(first.statusCode).toBe(201);
    const id = first.json().data.id;

    const retry = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/sources`, headers: h("source-key-1"), payload });
    expect(retry.json().data.id).toBe(id);

    const all = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/sources`, headers: { Cookie: owner.cookieHeader } });
    const matching = (all.json().data as { name: string }[]).filter((s) => s.name === "Variety");
    expect(matching.length).toBe(1);
  });

  it("without a key, a repeated create is NOT deduplicated (documents the contract)", async () => {
    const payload = { name: "Denis Villeneuve", type: "person" as const };
    await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h(), payload });
    await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h(), payload });

    const all = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/entities`, headers: { Cookie: owner.cookieHeader } });
    const matching = (all.json().data as { name: string }[]).filter((e) => e.name === "Denis Villeneuve");
    expect(matching.length, "no key means no dedupe - the caller must send one").toBe(2);
  });

  it("the same key with a different body is rejected, not silently replayed", async () => {
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/entities`,
      headers: h("ent-clash"),
      payload: { name: "Greta Gerwig", type: "person" },
    });
    const clash = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/entities`,
      headers: h("ent-clash"),
      payload: { name: "Sofia Coppola", type: "person" },
    });
    expect(clash.statusCode).toBe(409);
  });

  it("a retry that reorders JSON keys still replays instead of 409-ing", async () => {
    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/entities`,
      headers: h("ent-order"),
      payload: { name: "Wes Anderson", type: "person" },
    });
    expect(first.statusCode).toBe(201);
    const id = first.json().data.id;

    // same payload, different serialisation order - a client rebuilding the dict, or a
    // proxy re-encoding it, must not turn a safe retry into a hard failure
    const reordered = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/entities`,
      headers: h("ent-order"),
      payload: { type: "person", name: "Wes Anderson" },
    });
    expect(reordered.statusCode).toBe(201);
    expect(reordered.json().data.id).toBe(id);
  });

  it("concurrent retries with the same key produce exactly one row", async () => {
    const payload = { name: "Yorgos Lanthimos", type: "person" as const };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h("ent-race"), payload }),
      ),
    );
    const ids = new Set(responses.filter((r) => r.statusCode < 300).map((r) => r.json().data.id));
    expect(ids.size, "all concurrent requests must converge on one row").toBe(1);

    const all = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/entities`, headers: { Cookie: owner.cookieHeader } });
    const matching = (all.json().data as { name: string }[]).filter((e) => e.name === "Yorgos Lanthimos");
    expect(matching.length).toBe(1);
  });
});
