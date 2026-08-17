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

describe("taxonomy management and ownership", () => {
  let ctx: TestContext;
  let owner: Session;
  let authorA: Session;
  let authorB: Session;
  let editor: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);

    async function makeUser(email: string, perms: string[]) {
      const res = await createUser(ctx, owner, email, "password-123456", email.split("@")[0]);
      const id = res.json().data.id;
      const role = await createRole(ctx, owner, `${email.split("@")[0]}-role`, perms);
      await assignRole(ctx, owner, id, role.json().data.id, siteId);
      return login(ctx, email, "password-123456");
    }

    authorA = await makeUser("autor-a@kalel.test", ["articles.create", "articles.read", "articles.update", "articles.submit", "media.read"]);
    authorB = await makeUser("autor-b@kalel.test", ["articles.create", "articles.read", "articles.update", "articles.submit", "media.read"]);
    editor = await makeUser("editor@kalel.test", ["articles.create", "articles.read", "articles.update", "articles.approve", "articles.submit"]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const h = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("supports category create/update/delete with hierarchy detach", async () => {
    const parent = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/categories`, headers: h(owner), payload: { name: "Filmes", slug: "filmes" } });
    expect(parent.statusCode).toBe(201);
    const parentId = parent.json().data.id;

    const child = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/categories`, headers: h(owner), payload: { name: "Crítica", slug: "critica", parentId } });
    expect(child.statusCode).toBe(201);
    const childId = child.json().data.id;

    const updated = await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/categories/${childId}`, headers: h(owner), payload: { name: "Crítica de cinema" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.name).toBe("Crítica de cinema");

    const del = await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/categories/${parentId}`, headers: h(owner) });
    expect(del.statusCode).toBe(200);

    const list = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/categories`, headers: { Cookie: owner.cookieHeader } });
    const items = list.json().data as { id: string; parentId: string | null }[];
    expect(items.find((c) => c.id === parentId)).toBeUndefined();
    expect(items.find((c) => c.id === childId)?.parentId).toBeNull();
  });

  it("supports tag/entity/author/source update and delete", async () => {
    const tag = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/tags`, headers: h(owner), payload: { name: "Gladiador", slug: "gladiador" } });
    const tagId = tag.json().data.id;
    expect((await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/tags/${tagId}`, headers: h(owner), payload: { name: "Gladiador II" } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/tags/${tagId}`, headers: h(owner) })).statusCode).toBe(200);

    const author = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/authors`, headers: h(owner), payload: { name: "Ana", slug: "ana" } });
    const authorId = author.json().data.id;
    expect((await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/authors/${authorId}`, headers: h(owner), payload: { bio: "Crítica de cinema" } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/authors/${authorId}`, headers: h(owner) })).statusCode).toBe(200);

    const entity = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/entities`, headers: h(owner), payload: { name: "Ridley Scott", type: "person" } });
    const entityId = entity.json().data.id;
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/entities/${entityId}`, headers: h(owner) })).statusCode).toBe(200);

    const source = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/sources`, headers: h(owner), payload: { name: "IMDb", url: "https://imdb.com", kind: "external" } });
    const sourceId = source.json().data.id;
    expect((await ctx.app.inject({ method: "DELETE", url: `/v1/sites/${siteId}/sources/${sourceId}`, headers: h(owner) })).statusCode).toBe(200);
  });

  it("enforces article ownership for plain authors", async () => {
    const created = await ctx.app.inject({ method: "POST", url: `/v1/sites/${siteId}/articles`, headers: h(authorA), payload: { title: "Do autor A", slug: "do-autor-a" } });
    const article = created.json().data;

    const selfEdit = await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/articles/${article.id}`, headers: { ...h(authorA), "if-match": String(article.version) }, payload: { title: "Do autor A (editado)" } });
    expect(selfEdit.statusCode).toBe(200);

    const otherEdit = await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/articles/${article.id}`, headers: { ...h(authorB), "if-match": String(selfEdit.json().data.version) }, payload: { title: "Invasão do autor B" } });
    expect(otherEdit.statusCode).toBe(403);

    const editorEdit = await ctx.app.inject({ method: "PATCH", url: `/v1/sites/${siteId}/articles/${article.id}`, headers: { ...h(editor), "if-match": String(selfEdit.json().data.version) }, payload: { title: "Editado pelo editor" } });
    expect(editorEdit.statusCode).toBe(200);
  });

  it("exposes real site stats", async () => {
    const res = await ctx.app.inject({ method: "GET", url: `/v1/sites/${siteId}/stats`, headers: { Cookie: owner.cookieHeader } });
    expect(res.statusCode).toBe(200);
    const stats = res.json().data;
    expect(typeof stats.articles.total).toBe("number");
    expect(stats.articles.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.media).toBe("number");
  });
});
