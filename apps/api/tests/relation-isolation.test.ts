import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * P1-A. `replaceRelations` inserted authors/categories/tags/entities straight into the
 * join tables with no site check - inconsistent with `assertMediaInSite`, which validates.
 *
 * Two consequences: an article in site A could hold FK references into site B's taxonomy
 * (so site B deleting its own tag cascades into another tenant's article), and the
 * endpoint became an existence oracle - a real foreign id returned 201, an invented one
 * 400 from the FK handler.
 */
describe("article relations are confined to the article's site", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteA: string;
  let siteB: string;

  // ids that legitimately belong to site B
  let categoryB: string;
  let tagB: string;
  let entityB: string;
  let authorB: string;

  // ids that belong to site A
  let categoryA: string;
  let tagA: string;
  let entityA: string;
  let authorA: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);

    const b = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: h(),
      payload: { slug: "portal-b-rel", name: "Portal B" },
    });
    siteB = b.json().data.id;

    const mk = async (site: string, path: string, payload: Record<string, unknown>) => {
      const res = await ctx.app.inject({ method: "POST", url: `/v1/sites/${site}/${path}`, headers: h(), payload });
      expect(res.statusCode, `${path} on ${site}`).toBe(201);
      return res.json().data.id as string;
    };

    categoryA = await mk(siteA, "categories", { name: "Cinema A", slug: "cinema-a" });
    tagA = await mk(siteA, "tags", { name: "Estreia A", slug: "estreia-a" });
    entityA = await mk(siteA, "entities", { name: "Nolan A", type: "person" });
    authorA = await mk(siteA, "authors", { name: "Repórter A", slug: "reporter-a" });

    categoryB = await mk(siteB, "categories", { name: "Cinema B", slug: "cinema-b" });
    tagB = await mk(siteB, "tags", { name: "Estreia B", slug: "estreia-b" });
    entityB = await mk(siteB, "entities", { name: "Nolan B", type: "person" });
    authorB = await mk(siteB, "authors", { name: "Repórter B", slug: "reporter-b" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  function h() {
    return { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf };
  }

  const create = (payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: `/v1/sites/${siteA}/articles`, headers: h(), payload });

  it("rejects a create that references another site's category", async () => {
    const res = await create({ title: "Cross category", categories: [categoryB] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/category does not belong to this site/i);
  });

  it("rejects a create that references another site's tag", async () => {
    const res = await create({ title: "Cross tag", tags: [tagB] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/tag does not belong to this site/i);
  });

  it("rejects a create that references another site's entity", async () => {
    const res = await create({ title: "Cross entity", entities: [entityB] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/entity does not belong to this site/i);
  });

  it("rejects a create that references another site's author", async () => {
    const res = await create({ title: "Cross author", authors: [authorB] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/author does not belong to this site/i);
  });

  it("is not an existence oracle: a foreign id and an invented id fail identically", async () => {
    const foreign = await create({ title: "Foreign", tags: [tagB] });
    const invented = await create({ title: "Invented", tags: ["11111111-2222-3333-4444-555555555555"] });
    expect(foreign.statusCode).toBe(invented.statusCode);
    expect(foreign.json().error.message).toBe(invented.json().error.message);
    expect(foreign.json().error.code).toBe(invented.json().error.code);
  });

  it("writes nothing when a relation is rejected", async () => {
    const before = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles`,
      headers: { Cookie: owner.cookieHeader },
    });
    const countBefore = (before.json().data.items as unknown[]).length;

    const res = await create({ title: "Deve falhar inteiro", categories: [categoryA], tags: [tagB] });
    expect(res.statusCode).toBe(400);

    const after = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles`,
      headers: { Cookie: owner.cookieHeader },
    });
    expect(
      (after.json().data.items as unknown[]).length,
      "a rejected relation must not leave a half-written article behind",
    ).toBe(countBefore);
  });

  it("accepts same-site relations on create and on update", async () => {
    const created = await create({
      title: "Same site relations",
      categories: [categoryA],
      tags: [tagA],
      entities: [entityA],
      authors: [authorA],
    });
    expect(created.statusCode).toBe(201);
    const article = created.json().data;
    expect(article.categories).toEqual([categoryA]);
    expect(article.tags).toEqual([tagA]);
    expect(article.entities).toEqual([entityA]);
    expect(article.authors).toEqual([authorA]);

    const patched = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { ...h(), "if-match": String(article.version) },
      payload: { tags: [] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.tags).toEqual([]);
  });

  it("rejects an update that introduces another site's relation", async () => {
    const created = await create({ title: "Update cross", categories: [categoryA] });
    const article = created.json().data;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { ...h(), "if-match": String(article.version) },
      payload: { entities: [entityB] },
    });
    expect(res.statusCode).toBe(400);

    const reread = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { Cookie: owner.cookieHeader },
    });
    expect(reread.json().data.entities, "the rejected update must not have partially applied").toEqual([]);
    expect(reread.json().data.categories).toEqual([categoryA]);
  });
});
