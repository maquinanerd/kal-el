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
  let otherSiteId: string;
  let segundaId: string;
  let segundaInOtherSiteId: string;

  type Item = { id: string; siteId: string; slug: string; status: string };

  const headers = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });

  const list = (site: string, query: string) =>
    ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${site}/articles?${query}`,
      headers: headers(),
    });

  const create = async (site: string, payload: Record<string, unknown>): Promise<Item> => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${site}/articles`,
      headers: headers(),
      payload: { type: "article", ...payload },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as Item;
  };

  const ids = (res: { json: () => { data: { items: Item[] } } }) =>
    res.json().data.items.map((i) => i.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);

    await create(siteId, { title: "Primeira matéria", slug: "primeira-materia" });
    segundaId = (await create(siteId, { title: "Segunda matéria", slug: "segunda-materia" })).id;
    await create(siteId, { title: "Terceira matéria", slug: "terceira-materia" });
    await create(siteId, {
      title: "Matéria publicada",
      slug: "materia-publicada",
      status: "published",
    });

    // A second tenant. Its creator becomes its owner, so the same session can write there.
    // It holds the same slug as site A, and one slug site A does not have.
    const other = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: headers(),
      payload: { slug: "portal-b", name: "Portal B" },
    });
    expect(other.statusCode).toBe(201);
    otherSiteId = other.json().data.id;
    segundaInOtherSiteId = (
      await create(otherSiteId, { title: "Segunda matéria do B", slug: "segunda-materia" })
    ).id;
    await create(otherSiteId, { title: "Só no portal B", slug: "so-no-portal-b" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns only the article carrying that slug", async () => {
    const res = await list(siteId, "slug=segunda-materia");
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Item[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: segundaId, siteId, slug: "segunda-materia" });
  });

  it("returns an empty page for a slug that does not exist", async () => {
    const res = await list(siteId, "slug=nao-existe");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it("matches exactly, never as a substring", async () => {
    const res = await list(siteId, "slug=materia");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it("rejects an empty slug instead of listing the whole site", async () => {
    // The service skips an empty filter: accepted, `?slug=` answered 200 with every
    // article of the site, and a route resolver would have rendered the first of them.
    const res = await list(siteId, "slug=");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an over-long slug rather than querying with it", async () => {
    const res = await list(siteId, `slug=${"a".repeat(301)}`);
    expect(res.statusCode).toBe(400);
  });

  it("never returns the same slug from another site", async () => {
    const inA = await list(siteId, "slug=segunda-materia");
    expect(inA.statusCode).toBe(200);
    expect(ids(inA)).toEqual([segundaId]);

    const inB = await list(otherSiteId, "slug=segunda-materia");
    expect(inB.statusCode).toBe(200);
    expect(ids(inB)).toEqual([segundaInOtherSiteId]);
    expect(segundaInOtherSiteId).not.toBe(segundaId);
  });

  it("does not find a slug that exists only in another site", async () => {
    const res = await list(siteId, "slug=so-no-portal-b");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });

  it("combined with status=published, returns the published article", async () => {
    const res = await list(siteId, "slug=materia-publicada&status=published");
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Item[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ siteId, slug: "materia-publicada", status: "published" });
  });

  it("combined with status=published, excludes a draft carrying the slug", async () => {
    const res = await list(siteId, "slug=primeira-materia&status=published");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toEqual([]);
  });
});
