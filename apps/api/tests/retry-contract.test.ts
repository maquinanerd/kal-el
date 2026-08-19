import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * P1-D, P1-E, P1-F.
 *
 *  - workflow transitions 409'd on an exact retry (`in_review -> in_review` is not a
 *    legal transition), so a pipeline whose response was lost saw a hard failure for a
 *    request that had actually succeeded;
 *  - `IDEMPOTENCY_REPLAY` / `VERSION_CONFLICT` were documented as error codes but emitted
 *    as a bare `CONFLICT` with the real code buried in `details`, so an integrator could
 *    not tell a version clash from a slug clash;
 *  - idempotency keys were scoped by actor only, so the same key aimed at two sites
 *    collided.
 */
describe("retry and error contract", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteA: string;
  let siteB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);

    const b = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: h(),
      payload: { slug: "portal-b-retry", name: "Portal B" },
    });
    siteB = b.json().data.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function h(key?: string) {
    return {
      Cookie: owner.cookieHeader,
      "x-kal-el-csrf": owner.csrf,
      ...(key ? { "idempotency-key": key } : {}),
    };
  }

  async function mkArticle(site: string, title: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${site}/articles`,
      headers: h(),
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; version: number };
  }

  const action = (site: string, id: string, name: string, key?: string, payload: Record<string, unknown> = {}) =>
    ctx.app.inject({ method: "POST", url: `/v1/sites/${site}/articles/${id}/${name}`, headers: h(key), payload });

  // ---- P1-D: workflow retries ----

  for (const name of ["submit", "approve", "reject", "publish", "unpublish", "archive"] as const) {
    it(`an exact retry of ${name} succeeds instead of 409-ing`, async () => {
      const article = await mkArticle(siteA, `Retry ${name} ${Date.now()}`);

      // reach a state from which the action is legal
      if (name === "approve" || name === "reject" || name === "unpublish" || name === "archive") {
        await action(siteA, article.id, "submit");
      }
      if (name === "unpublish") await action(siteA, article.id, "publish");

      const first = await action(siteA, article.id, name);
      expect(first.statusCode, `${name} first call`).toBe(200);
      const statusAfter = first.json().data.status;

      // the response was lost; the pipeline re-sends the same request
      const retry = await action(siteA, article.id, name);
      expect(retry.statusCode, `${name} retry must not be a hard failure`).toBe(200);
      expect(retry.json().data.status, `${name} retry must land in the same state`).toBe(statusAfter);
    });
  }

  it("a retry carrying the same Idempotency-Key replays the stored response", async () => {
    const article = await mkArticle(siteA, `Idempotent submit ${Date.now()}`);
    const first = await action(siteA, article.id, "submit", "wf-submit-key-1");
    expect(first.statusCode).toBe(200);
    const retry = await action(siteA, article.id, "submit", "wf-submit-key-1");
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.version, "a replay returns the stored body verbatim").toBe(first.json().data.version);
  });

  it("a genuinely illegal transition is still rejected, with INVALID_TRANSITION", async () => {
    const article = await mkArticle(siteA, `Ilegal ${Date.now()}`);
    await action(siteA, article.id, "submit");
    await action(siteA, article.id, "reject"); // -> blocked

    const res = await action(siteA, article.id, "publish");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_TRANSITION");
    expect(res.json().error.details.from).toBe("blocked");
    expect(res.json().error.details.to).toBe("published");
  });

  // ---- P1-E: machine-readable codes ----

  it("a version clash reports VERSION_CONFLICT, not a bare CONFLICT", async () => {
    const article = await mkArticle(siteA, `Versão ${Date.now()}`);
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { ...h(), "if-match": String(article.version + 99) },
      payload: { title: "conflito" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_CONFLICT");
    expect(res.json().error.details.expectedVersion).toBe(article.version + 99);
    expect(res.json().error.details.currentVersion).toBe(article.version);
  });

  it("an idempotency replay with a different body reports IDEMPOTENCY_REPLAY", async () => {
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("replay-code-key"),
      payload: { name: "Primeira", type: "person" },
    });
    const clash = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("replay-code-key"),
      payload: { name: "Segunda", type: "person" },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe("IDEMPOTENCY_REPLAY");
  });

  it("a slug clash stays a plain CONFLICT, so the three are distinguishable", async () => {
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/categories`,
      headers: h(),
      payload: { name: "Cinema", slug: "cinema-dup" },
    });
    const dup = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/categories`,
      headers: h(),
      payload: { name: "Cinema de novo", slug: "cinema-dup" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("CONFLICT");
  });

  // ---- P1-F: key scope ----

  it("the same key in two different sites does not collide", async () => {
    const a = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("shared-batch-key"),
      payload: { name: "Entidade A", type: "person" },
    });
    expect(a.statusCode).toBe(201);

    const b = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/entities`,
      headers: h("shared-batch-key"),
      payload: { name: "Entidade B", type: "person" },
    });
    expect(b.statusCode, "the same key aimed at another site is a different write").toBe(201);
    expect(b.json().data.id).not.toBe(a.json().data.id);
    expect(b.json().data.siteId).toBe(siteB);
  });

  it("within one site the key still replays", async () => {
    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("same-site-key"),
      payload: { name: "Replay me", type: "person" },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("same-site-key"),
      payload: { name: "Replay me", type: "person" },
    });
    expect(second.json().data.id).toBe(first.json().data.id);
  });

  it("an expired record behaves as if absent and does not replay a stale body", async () => {
    const { idempotencyKeys } = await import("@kal-el/db/schema");
    const { eq } = await import("drizzle-orm");

    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("expiring-key"),
      payload: { name: "Antes de expirar", type: "person" },
    });
    expect(first.statusCode).toBe(201);

    // age the record past its TTL
    await ctx.app.db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(idempotencyKeys.key, "expiring-key"));

    const after = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/entities`,
      headers: h("expiring-key"),
      payload: { name: "Depois de expirar", type: "person" },
    });
    expect(after.statusCode, "an expired key must execute, not replay").toBe(201);
    expect(after.json().data.name).toBe("Depois de expirar");
    expect(after.json().data.id).not.toBe(first.json().data.id);
  });
});
