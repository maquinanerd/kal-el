import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * `GET /v1/sites/:siteId/articles?order=published&offset=…`
 *
 * What a delivery front end needs to list news: newest *publication* first, a page it can
 * address directly, and how many there are. And every relation the summary declares —
 * tags included — so the front end can read the reserved tags that choose a page layout.
 *
 * The seeded articles are written in an order that disagrees with their publication
 * dates, as an imported archive is: the 2019 story is created last.
 */
describe("article list: publication order, offset paging, relations", () => {
  let ctx: TestContext;
  let session: Session;
  let siteId: string;
  let tagId: string;
  let categoryId: string;

  const headers = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });
  const list = (query: string) =>
    ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/articles?${query}`, headers: headers() });

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);

    const tag = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/tags`,
      headers: headers(),
      payload: { name: "Capa em tela cheia", slug: "capa-em-tela-cheia" },
    });
    expect(tag.statusCode).toBe(201);
    tagId = tag.json().data.id;

    const category = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/categories`,
      headers: headers(),
      payload: { name: "Cinema", slug: "cinema" },
    });
    expect(category.statusCode).toBe(201);
    categoryId = category.json().data.id;

    for (const [title, slug, publishedAt, extra] of [
      ["Publicada em 2026", "em-2026", "2026-09-09T10:00:00.000Z", { tags: [tagId], categories: [categoryId] }],
      ["Publicada em 2023", "em-2023", "2023-05-01T10:00:00.000Z", { categories: [categoryId] }],
      ["Publicada em 2019", "em-2019", "2019-01-15T10:00:00.000Z", {}],
    ] as const) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers: headers(),
        payload: { type: "article", title, slug, status: "published", publishedAt, ...extra },
      });
      expect(res.statusCode).toBe(201);
    }
    const draft = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: headers(),
      payload: { type: "article", title: "Rascunho", slug: "rascunho" },
    });
    expect(draft.statusCode).toBe(201);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const slugs = (res: { json: () => { data: { items: { slug: string }[] } } }) => res.json().data.items.map((i) => i.slug);

  it("keeps update order as the default, so existing clients see no change", async () => {
    const res = await list("status=published");
    expect(res.statusCode).toBe(200);
    // Last written first: the 2019 story was created last.
    expect(slugs(res)).toEqual(["em-2019", "em-2023", "em-2026"]);
  });

  it("lists newest publication first with order=published", async () => {
    const res = await list("status=published&order=published");
    expect(slugs(res)).toEqual(["em-2026", "em-2023", "em-2019"]);
  });

  it("puts unpublished rows last in publication order", async () => {
    const res = await list("order=published");
    expect(slugs(res)).toEqual(["em-2026", "em-2023", "em-2019", "rascunho"]);
  });

  it("walks publication order by cursor without skipping or repeating", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i += 1) {
      const res = await list(`order=published&limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.statusCode).toBe(200);
      seen.push(...slugs(res));
      cursor = res.json().data.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["em-2026", "em-2023", "em-2019", "rascunho"]);
  });

  it("refuses a cursor minted under the other order", async () => {
    const first = await list("status=published&limit=1");
    const updatedCursor = first.json().data.nextCursor as string;
    const res = await list(`status=published&order=published&cursor=${updatedCursor}`);
    expect(res.statusCode).toBe(400);
  });

  it("addresses a page directly with offset, and says how many there are", async () => {
    const res = await list("status=published&order=published&limit=1&offset=1");
    expect(res.statusCode).toBe(200);
    expect(slugs(res)).toEqual(["em-2023"]);
    expect(res.json().data.total).toBe(3);
  });

  it("counts the filter, not the page: total under a category", async () => {
    const res = await list(`status=published&order=published&categoryId=${categoryId}&limit=1&offset=0`);
    expect(slugs(res)).toEqual(["em-2026"]);
    expect(res.json().data.total).toBe(2);
  });

  it("refuses cursor and offset together", async () => {
    const first = await list("order=published&limit=1");
    const cursor = first.json().data.nextCursor as string;
    const res = await list(`order=published&limit=1&offset=1&cursor=${cursor}`);
    expect(res.statusCode).toBe(400);
  });

  it("returns every relation the summary declares — tags included", async () => {
    const res = await list("status=published&order=published&limit=1");
    const item = res.json().data.items[0];
    expect(item.tags).toEqual([tagId]);
    expect(item.categories).toEqual([categoryId]);
  });

  it("filters by tag through the same query", async () => {
    const res = await list(`status=published&tagId=${tagId}`);
    expect(slugs(res)).toEqual(["em-2026"]);
  });
});
