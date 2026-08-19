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

  // `approve` and `unpublish` both target `draft`, so status equality cannot tell a retry
  // from a call that was never legal. They get retry safety from Idempotency-Key instead.
  for (const name of ["submit", "reject", "publish", "archive"] as const) {
    it(`an exact retry of ${name} succeeds instead of 409-ing`, async () => {
      const article = await mkArticle(siteA, `Retry ${name} ${Date.now()}`);

      // reach a state from which the action is legal
      if (name === "reject" || name === "archive") {
        await action(siteA, article.id, "submit");
      }

      const first = await action(siteA, article.id, name);
      expect(first.statusCode, `${name} first call`).toBe(200);
      const statusAfter = first.json().data.status;

      // the response was lost; the pipeline re-sends the same request
      const retry = await action(siteA, article.id, name);
      expect(retry.statusCode, `${name} retry must not be a hard failure`).toBe(200);
      expect(retry.json().data.status, `${name} retry must land in the same state`).toBe(statusAfter);
    });
  }

  for (const name of ["approve", "unpublish"] as const) {
    it(`${name} is not treated as a retry just because the article is already draft`, async () => {
      // Both target `draft`. Answering 200 on status equality turned an approval that
      // never happened into a reported success with no audit entry - the editorial gate
      // silently doing nothing is worse than a 409.
      const article = await mkArticle(siteA, `Nunca submetido ${name} ${Date.now()}`);
      const res = await action(siteA, article.id, name);
      expect(res.statusCode, `${name} from draft was never a legal transition`).toBe(409);
      expect(res.json().error.code).toBe("INVALID_TRANSITION");
    });

    it(`${name} retries safely with an Idempotency-Key`, async () => {
      const article = await mkArticle(siteA, `Retry via chave ${name} ${Date.now()}`);
      await action(siteA, article.id, "submit");
      if (name === "unpublish") await action(siteA, article.id, "publish");

      const key = `wf-${name}-idem-${Date.now()}`;
      const first = await action(siteA, article.id, name, key);
      expect(first.statusCode, `${name} first call`).toBe(200);
      const retry = await action(siteA, article.id, name, key);
      expect(retry.statusCode, `${name} retry must replay, not 409`).toBe(200);
      expect(retry.json().data.version).toBe(first.json().data.version);
    });
  }

  it("a repeated no-op transition writes no second audit entry", async () => {
    const article = await mkArticle(siteA, `Auditoria ${Date.now()}`);
    await action(siteA, article.id, "submit");
    await action(siteA, article.id, "submit");

    const log = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/audit-log/article/${article.id}`,
      headers: { Cookie: owner.cookieHeader },
    });
    const submits = (log.json().data as { action: string }[]).filter((e) => e.action === "articles.submit");
    expect(submits.length, "the no-op must not fabricate a second submission in the trail").toBe(1);
  });

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

  it("a replayed taxonomy create returns the same body, not a 500", async () => {
    // These handlers shape their DTO after the write. A replay returns the stored body
    // from JSONB, where timestamps have become strings - calling .toISOString() on them
    // throws. Regression guard for that specific shape.
    const first = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/categories`,
      headers: h("cat-replay-key"),
      payload: { name: "Séries", slug: "series-replay" },
    });
    expect(first.statusCode).toBe(201);

    const retry = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/categories`,
      headers: h("cat-replay-key"),
      payload: { name: "Séries", slug: "series-replay" },
    });
    expect(retry.statusCode, "a replay must not 500").toBe(201);
    expect(retry.json().data.id).toBe(first.json().data.id);
    expect(retry.json().data.createdAt).toBe(first.json().data.createdAt);

    for (const [path, payload] of [
      ["tags", { name: "Estreias", slug: "estreias-replay" }],
      ["authors", { name: "Repórter Replay", slug: "reporter-replay" }],
    ] as const) {
      const key = `${path}-replay-key`;
      const a = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteA}/${path}`, headers: h(key), payload });
      const b = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteA}/${path}`, headers: h(key), payload });
      expect(a.statusCode, `${path} first`).toBe(201);
      expect(b.statusCode, `${path} replay`).toBe(201);
      expect(b.json().data.id).toBe(a.json().data.id);
    }
  });

  it("two different files under one key do not collide", async () => {
    // The multipart body is not in `req.body`, so without the file's own digest every
    // upload to the same URL hashed identically: the second file was silently discarded
    // and the first file's media id returned as if it had been stored.
    const boundary = "----kalelretryboundary";
    const CRLF = String.fromCharCode(13, 10);
    const multipart = (name: string, bytes: number[]) =>
      Buffer.concat([
        Buffer.from(`--${boundary}${CRLF}`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"${CRLF}`),
        Buffer.from(`Content-Type: image/gif${CRLF}${CRLF}`),
        Buffer.from(bytes),
        Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
      ]);

    const gifA = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0];
    const gifB = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 2, 0, 0, 0, 0, 9, 9];

    const post = (name: string, bytes: number[]) =>
      ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteA}/media`,
        headers: {
          ...h("upload-collision-key"),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipart(name, bytes),
      });

    const first = await post("a.gif", gifA);
    expect(first.statusCode).toBe(201);

    const second = await post("b.gif", gifB);
    expect(second.statusCode, "a different file under the same key is a different request").toBe(409);
    expect(second.json().error.code).toBe("IDEMPOTENCY_REPLAY");

    // and the identical file still replays
    const replay = await post("a.gif", gifA);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(first.json().data.id);
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
