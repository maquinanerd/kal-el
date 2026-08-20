import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] as number;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4), 0);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

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
    // the editor opens the rendered page, not the JSON endpoint
    expect(url).toContain("/preview/kpv.");
    expect(url).not.toContain("/v1/preview/");

    const token = url.split("/preview/")[1];
    const served = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}` });
    expect(served.statusCode).toBe(200);
    expect(served.json().data.article.title).toBe("Rascunho para preview");
    expect(served.headers["x-robots-tag"]).toContain("noindex");
  });

  it("rejects tampered or malformed preview tokens", async () => {
    const bad = await ctx.app.inject({ method: "GET", url: "/v1/preview/kpv.dGFtcGVyZWQ.sig" });
    expect(bad.statusCode).toBe(401);
  });

  describe("media over a preview token", () => {
    const boundary = "----kalelpreviewboundary";
    let token: string;
    let usedMediaId: string;
    let unusedMediaId: string;

    async function upload(): Promise<string> {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/media`,
        headers: {
          Cookie: owner.cookieHeader,
          "x-kal-el-csrf": owner.csrf,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\n`),
          Buffer.from('Content-Disposition: form-data; name="file"; filename="cartaz.png"\r\n'),
          Buffer.from("Content-Type: image/png\r\n\r\n"),
          makePng(3, 2),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect(res.statusCode).toBe(201);
      return res.json().data.id as string;
    }

    beforeAll(async () => {
      usedMediaId = await upload();
      unusedMediaId = await upload();

      const created = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
        payload: {
          title: "Rascunho com imagem",
          slug: "rascunho-com-imagem",
          document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: usedMediaId } }] },
        },
      });
      expect(created.statusCode).toBe(201);

      const preview = await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles/${created.json().data.id}/preview`,
        headers: { Cookie: owner.cookieHeader, "x-kal-el-csrf": owner.csrf },
      });
      token = (preview.json().data.url as string).split("/preview/")[1] as string;
    });

    it("serves an image the previewed article shows, embeddable from the CMS origin", async () => {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}/media/${usedMediaId}/file` });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      // helmet's default same-origin would stop the CMS from rendering this in an <img>
      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(res.headers["x-robots-tag"]).toContain("noindex");
      expect(res.rawPayload.length).toBeGreaterThan(0);
    });

    it("does not turn the token into a key to the rest of the site's media", async () => {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/preview/${token}/media/${unusedMediaId}/file` });
      expect(res.statusCode).toBe(404);
    });

    it("rejects a tampered token", async () => {
      const res = await ctx.app.inject({ method: "GET", url: `/v1/preview/kpv.dGFtcGVyZWQ.sig/media/${usedMediaId}/file` });
      expect(res.statusCode).toBe(401);
    });
  });
});
