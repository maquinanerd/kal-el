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
  let entityId: string;

  type Item = {
    id: string;
    slug: string;
    tags: string[];
    categories: string[];
    entities: string[];
  };
  type ListResponse = { json: () => { data: { items: Item[]; nextCursor: string | null } } };

  const headers = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });
  const listIn = (site: string, query: string) =>
    ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${site}/articles?${query}`,
      headers: headers(),
    });
  const list = (query: string) => listIn(siteId, query);
  const slugs = (res: ListResponse) => res.json().data.items.map((i) => i.slug);
  const cursorParts = (cursor: string | undefined) =>
    Buffer.from(cursor ?? "", "base64url")
      .toString("utf8")
      .split("|");

  /** Follows `nextCursor` to the last page. */
  const walk = async (site: string, query: string) => {
    const pages: string[][] = [];
    const cursors: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const res = await listIn(site, cursor ? `${query}&cursor=${cursor}` : query);
      expect(res.statusCode).toBe(200);
      pages.push(slugs(res));
      cursor = res.json().data.nextCursor;
      if (!cursor) return { pages, cursors, seen: pages.flat() };
      cursors.push(cursor);
    }
    throw new Error(`the cursor walk over "${query}" did not end`);
  };

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

    const entity = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/entities`,
      headers: headers(),
      payload: { name: "Christopher Nolan", type: "person" },
    });
    expect(entity.statusCode).toBe(201);
    entityId = entity.json().data.id;

    for (const [title, slug, publishedAt, extra] of [
      [
        "Publicada em 2026",
        "em-2026",
        "2026-09-09T10:00:00.000Z",
        { tags: [tagId], categories: [categoryId], entities: [entityId] },
      ],
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
    const { seen } = await walk(siteId, "order=published&limit=1");
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
    const res = await list(
      `status=published&order=published&categoryId=${categoryId}&limit=1&offset=0`,
    );
    expect(slugs(res)).toEqual(["em-2026"]);
    expect(res.json().data.total).toBe(2);
  });

  it("refuses cursor and offset together", async () => {
    const first = await list("order=published&limit=1");
    const cursor = first.json().data.nextCursor as string;
    const res = await list(`order=published&limit=1&offset=1&cursor=${cursor}`);
    expect(res.statusCode).toBe(400);
  });

  it("returns every relation the summary declares — tags and entities included", async () => {
    const res = await list("status=published&order=published");
    expect(res.statusCode).toBe(200);
    const bySlug = new Map((res.json().data.items as Item[]).map((i) => [i.slug, i]));
    expect(bySlug.get("em-2026")).toMatchObject({
      tags: [tagId],
      categories: [categoryId],
      entities: [entityId],
    });
    // `[]` means "none" only for an article that really has none.
    expect(bySlug.get("em-2019")).toMatchObject({ tags: [], categories: [], entities: [] });
  });

  it("filters by tag through the same query", async () => {
    const res = await list(`status=published&tagId=${tagId}`);
    expect(slugs(res)).toEqual(["em-2026"]);
  });

  /**
   * The keyset edges, in a site of their own so the exact lists above stay exact: three
   * articles sharing one publication instant (a batch published together, or an import
   * whose source kept minutes only), and three that were never published.
   */
  describe("keyset edges: a tie on published_at, and the unpublished group", () => {
    const TIE = "2025-03-01T12:00:00.000Z";
    let edgeSiteId: string;
    let expected: string[] = [];

    beforeAll(async () => {
      const site = await ctx.app.inject({
        method: "POST",
        url: "/v1/admin/sites",
        headers: headers(),
        payload: { slug: "portal-bordas", name: "Portal Bordas" },
      });
      expect(site.statusCode).toBe(201);
      edgeSiteId = site.json().data.id;

      const create = async (payload: Record<string, unknown>) => {
        const res = await ctx.app.inject({
          method: "POST",
          url: `/v1/sites/${edgeSiteId}/articles`,
          headers: headers(),
          payload: { type: "article", ...payload },
        });
        expect(res.statusCode).toBe(201);
        return res.json().data as { id: string; slug: string };
      };
      const published = (slug: string, publishedAt: string) =>
        create({ title: slug, slug, status: "published", publishedAt });

      const newest = await published("mais-nova", "2025-06-01T12:00:00.000Z");
      const ties = [
        await published("empate-a", TIE),
        await published("empate-b", TIE),
        await published("empate-c", TIE),
      ];
      const oldest = await published("mais-antiga", "2024-01-01T12:00:00.000Z");
      const drafts = [
        await create({ title: "rascunho-1", slug: "rascunho-1" }),
        await create({ title: "rascunho-2", slug: "rascunho-2" }),
        await create({ title: "rascunho-3", slug: "rascunho-3" }),
      ];

      // A tie, and the unpublished group, fall back to id descending. PostgreSQL orders
      // uuid by bytes, which is the order of their lowercase hex strings.
      const byIdDesc = (a: { id: string }, b: { id: string }) =>
        a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      expected = [newest, ...[...ties].sort(byIdDesc), oldest, ...[...drafts].sort(byIdDesc)].map(
        (a) => a.slug,
      );
    });

    it("orders a tie on published_at by id, and unpublished rows last, by id", async () => {
      const res = await listIn(edgeSiteId, "order=published");
      expect(res.statusCode).toBe(200);
      expect(slugs(res)).toEqual(expected);
    });

    it("walks a tie on published_at by cursor, with no duplicate and no gap", async () => {
      // limit=2 over the five published rows: [newest, tie] [tie, tie] [oldest]. The first
      // cursor is minted inside the tie, so the second page is positioned by id alone.
      const { seen, pages, cursors } = await walk(
        edgeSiteId,
        "status=published&order=published&limit=2",
      );
      expect(cursorParts(cursors[0])).toEqual(["p", TIE, expect.any(String)]);
      expect(pages).toEqual([expected.slice(0, 2), expected.slice(2, 4), expected.slice(4, 5)]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("walks into and through the unpublished group by cursor", async () => {
      // limit=3 over all eight: [newest, tie, tie] [tie, oldest, draft] [draft, draft]. The
      // second cursor is minted on an unpublished row, so the last page is positioned
      // entirely inside the NULL group.
      const { seen, pages, cursors } = await walk(edgeSiteId, "order=published&limit=3");
      expect(cursorParts(cursors[1])).toEqual(["p", "", expect.any(String)]);
      expect(pages).toEqual([expected.slice(0, 3), expected.slice(3, 6), expected.slice(6, 8)]);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("never skips or repeats a row, at any page size", async () => {
      for (let limit = 1; limit <= expected.length; limit += 1) {
        const { seen } = await walk(edgeSiteId, `order=published&limit=${limit}`);
        expect(seen, `limit=${limit}`).toEqual(expected);
      }
    });
  });
});
