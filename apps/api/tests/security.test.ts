import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { outboxEvents, redirects } from "@kal-el/db/schema";
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

describe("security (R0)", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let authorSession: Session;
  let siteA: string;
  let siteB: string;
  let seoManagerB: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    // second site
    const siteBRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { slug: "portal-b", name: "Portal B" },
    });
    expect(siteBRes.statusCode).toBe(201);
    siteB = siteBRes.json().data.id;

    // author: can create/read/update drafts but NOT publish or schedule
    const authorUser = await createUser(ctx, ownerSession, "autor@kalel.test", "autor-password-123", "Autor");
    expect(authorUser.statusCode).toBe(201);
    const authorId = authorUser.json().data.id;
    const authorRole = await createRole(ctx, ownerSession, "autor", ["articles.create", "articles.read", "articles.update"]);
    expect(authorRole.statusCode).toBe(201);
    expect((await assignRole(ctx, ownerSession, authorId, authorRole.json().data.id, siteA)).statusCode).toBe(201);
    authorSession = await login(ctx, "autor@kalel.test", "autor-password-123");

    // a user who can manage SEO only on site B
    const seoUser = await createUser(ctx, ownerSession, "seo-b@kalel.test", "seo-b-password-123", "SEO B");
    expect(seoUser.statusCode).toBe(201);
    const seoUserId = seoUser.json().data.id;
    const seoRole = await createRole(ctx, ownerSession, "seo-manager", ["seo.manage", "articles.read"]);
    expect(seoRole.statusCode).toBe(201);
    expect((await assignRole(ctx, ownerSession, seoUserId, seoRole.json().data.id, siteB)).statusCode).toBe(201);
    seoManagerB = await login(ctx, "seo-b@kalel.test", "seo-b-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("denies an author creating an already-published article (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Bypass publish", slug: "bypass-publish", status: "published" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    const published = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.eventType, "article.published"));
    expect(published.length).toBe(0);
  });

  it("denies an author creating with an arbitrary publishedAt (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Backdate", slug: "backdate", publishedAt: "2020-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an author creating an already-scheduled article (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Bypass schedule", slug: "bypass-schedule", status: "scheduled", scheduledAt: "2030-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("still lets an author create a draft (positive control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Draft legitimo", slug: "draft-legitimo" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("draft");
  });

  it("lets a user with articles.publish create a published article (positive control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Publicado pelo dono", slug: "publicado-dono", status: "published" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("published");
  });

  it("rejects unknown fields on PATCH (R0.3)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Para patch", slug: "para-patch" },
    });
    const article = created.json().data;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { ...headers(ownerSession), "if-match": String(article.version) },
      payload: { title: "Titulo alterado", status: "in_review" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown fields on POST article (R0.3)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Campo fantasma", slug: "campo-fantasma", unknownField: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not let a site A user delete a site B redirect (R0.2)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/redirects`,
      headers: headers(seoManagerB),
      payload: { sourcePath: "/antigo-b", targetPath: "/novo-b", kind: "301" },
    });
    expect(created.statusCode).toBe(201);
    const redirectB = created.json().data;
    expect(redirectB.siteId).toBe(siteB);

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/redirects/${redirectB.id}`,
      headers: headers(ownerSession),
    });
    expect(del.statusCode).toBe(404);

    const rows = await ctx.db.select().from(redirects).where(eq(redirects.id, redirectB.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.siteId).toBe(siteB);
  });
});
