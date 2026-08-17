import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignRole, bootstrap, createRole, createServiceToken, createTestApp, createUser, login, type Session, type TestContext } from "./helpers.js";

describe("multi-site isolation (R9)", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteA: string;
  let siteB: string;
  let editorA: Session;
  let managerB: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);

    const b = await ctx.app.inject({ method: "POST", url: "/v1/admin/sites", headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf }, payload: { slug: "portal-b", name: "Portal B" } });
    siteB = b.json().data.id;

    const user = await createUser(ctx, owner, "editor-a@kalel.test", "editor-password-123", "Editor A");
    const role = await createRole(ctx, owner, "editor-full", ["articles.create", "articles.read", "articles.update", "articles.publish", "media.manage", "media.read", "taxonomy.categories.manage", "seo.manage"]);
    await assignRole(ctx, owner, user.json().data.id, role.json().data.id, siteA);
    editorA = await login(ctx, "editor-a@kalel.test", "editor-password-123");

    const mb = await createUser(ctx, owner, "manager-b@kalel.test", "manager-b-password-123", "Manager B");
    const rb = await createRole(ctx, owner, "manager-b-role", ["articles.create", "articles.read", "taxonomy.categories.manage"]);
    await assignRole(ctx, owner, mb.json().data.id, rb.json().data.id, siteB);
    managerB = await login(ctx, "manager-b@kalel.test", "manager-b-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const h = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("site A user cannot read, edit or list site B articles", async () => {
    const inB = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteB}/articles`, headers: h(managerB), payload: { title: "Segredo do B", slug: "segredo-b" } });
    const articleB = inB.json().data;

    expect((await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteB}/articles/${articleB.id}`, headers: { Cookie: editorA.cookieHeader } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteB}/articles`, headers: { Cookie: editorA.cookieHeader } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteB}/articles/${articleB.id}`, headers: h(editorA), payload: { title: "invasão" } })).statusCode).toBe(403);
  });

  it("site A user cannot delete site B taxonomy", async () => {
    const catB = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteB}/categories`, headers: h(managerB), payload: { name: "Categoria B", slug: "categoria-b" } });
    const catId = catB.json().data.id;
    const del = await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteA}/categories/${catId}`, headers: h(editorA) });
    expect(del.statusCode).toBe(404);

    const still = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteB}/categories`, headers: { Cookie: managerB.cookieHeader } });
    expect((still.json().data as { id: string }[]).some((c) => c.id === catId)).toBe(true);
  });

  it("site A article cannot reference media it does not own", async () => {
    // a media id that is not a valid media record of site A is rejected
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: h(editorA),
      payload: { title: "Usa mídia inválida", slug: "usa-midia-invalida", document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111" } }] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("service token for site A cannot operate site B", async () => {
    const tokenRes = await createServiceToken(ctx, owner, siteA, ["articles.create", "articles.read"]);
    const token = tokenRes.json().data.token as string;
    const res = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteB}/articles`, headers: { Authorization: `Bearer ${token}` }, payload: { title: "x", slug: "x-b" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SITE_SCOPE_MISMATCH");
  });
});
