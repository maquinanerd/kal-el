import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignRole,
  bootstrap,
  createRole,
  createServiceToken,
  createTestApp,
  createUser,
  login,
  type Session,
  type TestContext,
} from "./helpers.js";

describe("site isolation", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let editorSession: Session;
  let siteA: string;
  let siteB: string;
  let editorRoleId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    const siteBRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { slug: "portal-b", name: "Portal B" },
    });
    expect(siteBRes.statusCode).toBe(201);
    siteB = siteBRes.json().data.id;

    const editorUser = await createUser(ctx, ownerSession, "editor-a@kalel.test", "editor-password-123", "Editor A");
    expect(editorUser.statusCode).toBe(201);
    const editorId = editorUser.json().data.id;

    const role = await createRole(ctx, ownerSession, "editor", ["articles.create", "articles.read", "articles.update"]);
    expect(role.statusCode).toBe(201);
    editorRoleId = role.json().data.id;

    const assigned = await assignRole(ctx, ownerSession, editorId, editorRoleId, siteA);
    expect(assigned.statusCode).toBe(201);

    editorSession = await login(ctx, "editor-a@kalel.test", "editor-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("allows the editor to create an article in their own site", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(editorSession),
      payload: { title: "Artigo do editor A", slug: "artigo-editor-a" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("denies the editor from creating an article in another site", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/articles`,
      headers: headers(editorSession),
      payload: { title: "Invasão", slug: "invasao" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SITE_SCOPE_MISMATCH");
  });

  it("denies reading another site's articles", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteB}/articles`,
      headers: { Cookie: editorSession.cookieHeader },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not leak site B content to site A users", async () => {
    // owner creates an article in site B
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Segredo do portal B", slug: "segredo-b" },
    });

    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles?q=Segredo`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    const items = list.json().data.items as { title: string }[];
    expect(items.some((a) => a.title === "Segredo do portal B")).toBe(false);
  });

  it("binds service tokens to their site", async () => {
    const tokenRes = await createServiceToken(ctx, ownerSession, siteA, ["articles.create", "articles.read"]);
    expect(tokenRes.statusCode).toBe(201);
    const token = tokenRes.json().data.token as string;
    const bearer = { Authorization: `Bearer ${token}` };

    const ok = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: bearer,
      payload: { title: "Via serviço", slug: "via-servico", externalKey: "ext-1" },
    });
    expect(ok.statusCode).toBe(201);

    const denied = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/articles`,
      headers: bearer,
      payload: { title: "Via serviço errado", slug: "via-servico-b" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("SITE_SCOPE_MISMATCH");
  });

  it("denies a service token lacking the required scope", async () => {
    const tokenRes = await createServiceToken(ctx, ownerSession, siteA, ["articles.read"]);
    const token = tokenRes.json().data.token as string;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { title: "Sem permissão", slug: "sem-permissao" },
    });
    expect(res.statusCode).toBe(403);
  });
});
