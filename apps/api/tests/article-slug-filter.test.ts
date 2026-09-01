import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * `GET /v1/sites/:siteId/articles?slug=…`
 *
 * A delivery frontend resolves `/{category}/{slug}` and holds only the slug. Without an
 * exact-match filter it has to page the whole corpus per request, which is O(n) and gets
 * worse as the archive grows. `q` is not a substitute: it is a substring match on the
 * title.
 */
describe("article list: slug filter", () => {
  let ctx: TestContext;
  let session: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);

    const headers = { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf };
    for (const [title, slug] of [
      ["Primeira matéria", "primeira-materia"],
      ["Segunda matéria", "segunda-materia"],
      ["Terceira matéria", "terceira-materia"],
    ] as const) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers,
        payload: { type: "article", title, slug },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });

  it("returns only the article carrying that slug", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?slug=segunda-materia`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe("segunda-materia");
  });

  it("returns an empty page for a slug that does not exist", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?slug=nao-existe`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it("matches exactly, never as a substring", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?slug=materia`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it("combines with the status filter", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?slug=primeira-materia&status=published`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    // The seeded articles are drafts, so a published filter must exclude them.
    expect(res.json().data.items).toEqual([]);
  });

  it("rejects an over-long slug rather than querying with it", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?slug=${"a".repeat(301)}`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(400);
  });
});
