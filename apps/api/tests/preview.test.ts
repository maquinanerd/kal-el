import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("preview", () => {
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

  it("issues a signed preview URL and serves the draft publicly via that URL only", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
      payload: { title: "Rascunho para preview", slug: "rascunho-preview", document: { version: 2, nodes: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo do preview", marks: [] }] }] } },
    });
    const articleId = created.json().data.id;

    // draft is not public
    const direct = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/articles/${articleId}` });
    expect(direct.statusCode).toBe(401);

    const preview = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${articleId}/preview`,
      headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
    });
    expect(preview.statusCode).toBe(200);
    // `url` is what a person opens: the CMS renderer, not the JSON endpoint. Pointing it
    // at the API meant the preview showed the raw payload instead of the article.
    const url = preview.json().data.url as string;
    const dataUrl = preview.json().data.dataUrl as string;
    expect(url).toContain("/preview/kpv.");
    expect(url).not.toContain("/v1/preview/");
    expect(dataUrl).toContain("/v1/preview/kpv.");

    const token = dataUrl.split("/v1/preview/")[1];
    const served = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}` });
    expect(served.statusCode).toBe(200);
    expect(served.json().data.article.title).toBe("Rascunho para preview");
    expect(served.headers["x-robots-tag"]).toContain("noindex");
  });

  it("rejects tampered or malformed preview tokens", async () => {
    const bad = await ctx.app.inject({ method: "GET", url: "/v1/preview/kpv.dGFtcGVyZWQ.sig" });
    expect(bad.statusCode).toBe(401);
  });
});
