import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, uploadTestImage, type Session, type TestContext } from "./helpers.js";

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
    const url = preview.json().data.url as string;
    expect(url).toContain("/v1/preview/kpv.");

    const token = url.split("/v1/preview/")[1];
    const served = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}` });
    expect(served.statusCode).toBe(200);
    expect(served.json().data.article.title).toBe("Rascunho para preview");
    expect(served.headers["x-robots-tag"]).toContain("noindex");
  });

  it("rejects tampered or malformed preview tokens", async () => {
    const bad = await ctx.app.inject({ method: "GET", url: "/v1/preview/kpv.dGFtcGVyZWQ.sig" });
    expect(bad.statusCode).toBe(401);
  });

  describe("body media", () => {
    let token: string;
    let bodyMediaId: string;
    let bodyMediaBytes: Buffer;
    let orphanMediaId: string;

    beforeAll(async () => {
      const inBody = await uploadTestImage(ctx, owner, siteId, { filename: "no-corpo.png" });
      bodyMediaId = inBody.id;
      bodyMediaBytes = inBody.bytes;
      orphanMediaId = (await uploadTestImage(ctx, owner, siteId, { filename: "nao-referenciada.png" })).id;

      const created = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
        payload: {
          title: "Rascunho com imagem",
          slug: "rascunho-com-imagem",
          document: {
            version: 2,
            nodes: [
              { type: "paragraph", content: [{ type: "text", text: "Antes da imagem", marks: [] }] },
              { type: "image", attrs: { mediaId: bodyMediaId, altText: "Uma foto", caption: "Legenda" } },
            ],
          },
        },
      });
      expect(created.statusCode).toBe(201);
      const articleId = created.json().data.id;

      const preview = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles/${articleId}/preview`,
        headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
      });
      expect(preview.statusCode).toBe(200);
      token = (preview.json().data.url as string).split("/v1/preview/")[1] as string;
    });

    it("serves media referenced by the previewed article, without a session", async () => {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}/media/${bodyMediaId}` });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload)).toEqual(bodyMediaBytes);
      expect(res.headers["content-type"]).toContain("image/png");
      // helmet defaults to same-origin, which would block the <img> in the CMS
      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(res.headers["x-robots-tag"]).toContain("noindex");
    });

    it("does not turn the token into a pass for the rest of the site library", async () => {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}/media/${orphanMediaId}` });
      expect(res.statusCode).toBe(404);
    });

    it("still requires a valid token, and rejects malformed media ids", async () => {
      const noToken = await ctx.app.inject({ method: "GET", url: `/v1/preview/kpv.dGFtcGVyZWQ.sig/media/${bodyMediaId}` });
      expect(noToken.statusCode).toBe(401);

      const badId = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}/media/nao-e-uuid` });
      expect(badId.statusCode).toBe(404);
    });

    it("keeps the session-guarded media route closed to anonymous callers", async () => {
      const direct = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/media/${bodyMediaId}/file` });
      expect(direct.statusCode).toBe(401);
    });
  });
});
