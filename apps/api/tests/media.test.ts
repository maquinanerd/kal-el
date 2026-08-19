import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignRole,
  bootstrap,
  createRole,
  createTestApp,
  createUser,
  login,
  type Session,
  type TestContext,
} from "./helpers.js";

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 0);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function multipartBody(boundary: string, filename: string, mime: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
    Buffer.from(`Content-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe("media subsystem", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let siteA: string;
  let siteB: string;
  let managerB: Session;

  const boundary = "----kaleltestboundary";
  const png = makePng(3, 2);

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    const siteBRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { slug: "portal-b-media", name: "Portal B Media" },
    });
    expect(siteBRes.statusCode).toBe(201);
    siteB = siteBRes.json().data.id;

    const manager = await createUser(ctx, ownerSession, "manager-b@kalel.test", "manager-b-password-123", "Manager B");
    const managerId = manager.json().data.id;
    const role = await createRole(ctx, ownerSession, "media-manager", ["media.manage", "media.read", "articles.create", "articles.read"]);
    await assignRole(ctx, ownerSession, managerId, role.json().data.id, siteB);
    managerB = await login(ctx, "manager-b@kalel.test", "manager-b-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  function upload(session: Session, siteId: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/media`,
      headers: { ...headers(session), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, "cartaz.png", "image/png", png),
    });
  }

  function uploadRaw(session: Session, siteId: string, filename: string, mime: string, data: Buffer) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/media`,
      headers: { ...headers(session), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, filename, mime, data),
    });
  }

  it("rejects a payload whose bytes are not the declared image type", async () => {
    // the classic "rename the executable to .png" - the declared type is allow-listed,
    // the content is not an image at all
    const exe = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(512, 0)]);
    const res = await uploadRaw(ownerSession, siteA, "inocente.png", "image/png", exe);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/not a supported image/i);
  });

  it("rejects a real image uploaded under the wrong declared type", async () => {
    const res = await uploadRaw(ownerSession, siteA, "cartaz.jpg", "image/jpeg", png);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not match the declared media type/i);
    expect(res.json().error.details.detected).toBe("image/png");
  });

  it("rejects SVG by content as well as by declared type", async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "latin1");
    expect((await uploadRaw(ownerSession, siteA, "x.svg", "image/svg+xml", svg)).statusCode).toBe(400);
    expect((await uploadRaw(ownerSession, siteA, "x.png", "image/png", svg)).statusCode).toBe(400);
  });

  it("uploads an image and records width/height/mime/size", async () => {
    const res = await upload(ownerSession, siteA);
    expect(res.statusCode).toBe(201);
    const media = res.json().data;
    expect(media.id).toBeTruthy();
    expect(media.siteId).toBe(siteA);
    expect(media.mimeType).toBe("image/png");
    expect(media.width).toBe(3);
    expect(media.height).toBe(2);
    expect(media.sizeBytes).toBe(png.length);
    expect(media.provider).toBe("local");
    expect(media.url).toContain(`/v1/sites/${siteA}/media/${media.id}/file`);
    expect(media.storageKey).toContain(`sites/${siteA}/`);
  });

  it("lists and retrieves media, and serves the file bytes", async () => {
    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const page = list.json().data as { items: { id: string }[]; total: number };
    expect(page.total).toBe(1);
    expect(page.items.length).toBe(1);
    const id = page.items[0]?.id;

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${id}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(id);

    const file = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${id}/file`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(file.statusCode).toBe(200);
    expect(Buffer.from(file.rawPayload)).toEqual(png);
    expect(file.headers["content-type"]).toContain("image/png");
  });

  it("updates media metadata", async () => {
    const created = await upload(ownerSession, siteA);
    const id = created.json().data.id;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/media/${id}`,
      headers: headers(ownerSession),
      payload: { altText: "Cartaz do filme", caption: "Legenda", focalX: 0.5, focalY: 0.25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.altText).toBe("Cartaz do filme");
    expect(res.json().data.caption).toBe("Legenda");
    expect(res.json().data.focalX).toBe(0.5);
  });

  it("associates a featured image and preserves it on reopen", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Com imagem de destaque", slug: "com-imagem", featuredMediaId: media.id },
    });
    expect(created.statusCode).toBe(201);
    const articleId = created.json().data.id;
    expect(created.json().data.featuredMediaId).toBe(media.id);

    const reopened = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles/${articleId}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(reopened.json().data.featuredMediaId).toBe(media.id);
  });

  it("accepts image and gallery nodes referencing real media", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: {
        title: "Com galeria",
        slug: "com-galeria",
        document: {
          version: 2,
          nodes: [
            { type: "image", attrs: { mediaId: media.id, altText: "x" } },
            { type: "gallery", attrs: { mediaIds: [media.id] } },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("blocks cross-site media attachment (featured image and document nodes)", async () => {
    const siteBMedia = (await upload(managerB, siteB)).json().data;

    const featured = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Invasão de mídia", slug: "invasao-midia", featuredMediaId: siteBMedia.id },
    });
    expect(featured.statusCode).toBe(400);

    const document = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: {
        title: "Invasão de mídia 2",
        slug: "invasao-midia-2",
        document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: siteBMedia.id } }] },
      },
    });
    expect(document.statusCode).toBe(400);
  });

  it.each([
    [
      "an image in the article body",
      (id: string) => ({ document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: id } }] } }),
    ],
    [
      "one image of a gallery",
      (id: string) => ({ document: { version: 2, nodes: [{ type: "gallery", attrs: { mediaIds: [id] } }] } }),
    ],
    [
      "the social sharing image",
      (id: string) => ({ seo: { socialImageMediaId: id } }),
    ],
  ])("refuses to delete media referenced as %s", async (_label, reference) => {
    // The body check was a LIKE for `"mediaId":"<id>"` against `document::text`. Postgres
    // renders jsonb with a space after the colon, so it never matched anything - and it
    // could not have seen a gallery (attribute `mediaIds`, an array) or the social image
    // at all. The CMS grid deletes on one click with no confirmation and relies entirely
    // on this 409.
    const asset = (await upload(ownerSession, siteA)).json().data;
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: `Usa ${_label}`, ...reference(asset.id) },
    });
    expect(created.statusCode).toBe(201);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${asset.id}`,
      headers: headers(ownerSession),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/in use/);

    // and the bytes are still there: the delete used to unlink before the transaction
    const still = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${asset.id}`,
      headers: headers(ownerSession),
    });
    expect(still.statusCode).toBe(200);
  });

  it.each([
    [
      "an image in the article body",
      (id: string) => ({ document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: id } }] } }),
    ],
    [
      "one image of a gallery",
      (id: string) => ({ document: { version: 2, nodes: [{ type: "gallery", attrs: { mediaIds: [id] } }] } }),
    ],
    [
      "the social sharing image",
      (id: string) => ({ seo: { socialImageMediaId: id } }),
    ],
  ])("refuses to delete media referenced as %s", async (_label, reference) => {
    // The body check was a LIKE for `"mediaId":"<id>"` against `document::text`. Postgres
    // renders jsonb with a space after the colon, so it never matched anything - and it
    // could not have seen a gallery (attribute `mediaIds`, an array) or the social image
    // at all. The CMS grid deletes on one click with no confirmation and relies entirely
    // on this 409.
    const asset = (await upload(ownerSession, siteA)).json().data;
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: `Usa ${_label}`, ...reference(asset.id) },
    });
    expect(created.statusCode).toBe(201);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${asset.id}`,
      headers: headers(ownerSession),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/in use/);

    // and the bytes are still there: the delete used to unlink before the transaction
    const still = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${asset.id}`,
      headers: headers(ownerSession),
    });
    expect(still.statusCode).toBe(200);
  });

  it("refuses to delete media that is in use and deletes unused media", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Usa mídia", slug: "usa-midia", featuredMediaId: media.id },
    });

    const inUse = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${media.id}`,
      headers: headers(ownerSession),
    });
    expect(inUse.statusCode).toBe(409);

    const unused = (await upload(ownerSession, siteA)).json().data;
    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${unused.id}`,
      headers: headers(ownerSession),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted).toBe(true);

    const after = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${unused.id}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(after.statusCode).toBe(404);
  });
});
