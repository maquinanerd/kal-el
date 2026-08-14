import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("editorial SEO", () => {
  let ctx: TestContext;
  let session: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    session = await login(ctx, seeded.email, seeded.password);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });

  it("creates a 301 redirect automatically when an article slug changes", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: headers(),
      payload: { title: "SEO slug change", slug: "velho-slug" },
    });
    expect(created.statusCode).toBe(201);
    const article = created.json().data;

    const updated = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...headers(), "if-match": String(article.version) },
      payload: { slug: "novo-slug" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.slug).toBe("novo-slug");

    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/redirects`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const redirects = list.json().data as { sourcePath: string; targetPath: string; kind: string }[];
    const auto = redirects.find((r) => r.sourcePath === "/velho-slug");
    expect(auto).toBeTruthy();
    expect(auto?.targetPath).toBe("/novo-slug");
    expect(auto?.kind).toBe("301");
  });

  it("supports manual redirect CRUD", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/redirects`,
      headers: headers(),
      payload: { sourcePath: "/antigo", targetPath: "/novo", kind: "302" },
    });
    expect(created.statusCode).toBe(201);
    const redirect = created.json().data;
    expect(redirect.kind).toBe("302");

    const dup = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/redirects`,
      headers: headers(),
      payload: { sourcePath: "/antigo", targetPath: "/outro", kind: "301" },
    });
    expect(dup.statusCode).toBe(409);

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteId}/redirects/${redirect.id}`,
      headers: headers(),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted).toBe(true);
  });

  it("edits editorial SEO metadata via article update", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: headers(),
      payload: { title: "SEO meta", slug: "seo-meta" },
    });
    const article = created.json().data;

    const updated = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...headers(), "if-match": String(article.version) },
      payload: {
        seo: {
          seoTitle: "Título otimizado",
          metaDescription: "Descrição para o buscador.",
          robotsIndex: "noindex",
          canonicalUrl: "https://portal.example.com/seo-meta",
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.seo.seoTitle).toBe("Título otimizado");
    expect(updated.json().data.seo.robotsIndex).toBe("noindex");
    expect(updated.json().data.seo.canonicalUrl).toBe("https://portal.example.com/seo-meta");
  });
});
