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

/**
 * P1-B. `articleAuthors.authorId` is an FK to `authors.id` - an editorial byline - but
 * `assertCanEdit` compared it against `actor.userId`. Those are disjoint UUID spaces, so
 * `isListedAuthor` was always false and ownership silently collapsed to `createdBy`
 * alone: a legitimately credited co-author got 403 on their own article.
 *
 * The fix models the relationship instead of relaxing the check: `authors.userId` links a
 * byline to an account, and ownership resolves through that join. An author remains a
 * byline, not an account - guest contributors and imported authors keep `userId = null`.
 */
describe("author ownership", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteId: string;

  let alice: Session;
  let aliceUserId: string;
  let aliceAuthorId: string;

  let bruno: Session;
  let brunoUserId: string;
  let brunoAuthorId: string;

  let editor: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    owner = await login(ctx, seeded.email, seeded.password);

    // writers: no publish/approve/schedule, so updates go through the ownership check
    // deliberately includes taxonomy.authors.manage but NOT roles.manage: this is the
    // configuration the byline-hijack escalation used
    const writerRole = await createRole(ctx, owner, "writer-own", [
      "articles.create",
      "articles.read",
      "articles.update",
      "taxonomy.authors.manage",
    ]);
    const writerRoleId = writerRole.json().data.id;

    const a = await createUser(ctx, owner, "alice@kalel.test", "alice-password-1234", "Alice");
    aliceUserId = a.json().data.id;
    await assignRole(ctx, owner, aliceUserId, writerRoleId, siteId);
    alice = await login(ctx, "alice@kalel.test", "alice-password-1234");

    const b = await createUser(ctx, owner, "bruno@kalel.test", "bruno-password-1234", "Bruno");
    brunoUserId = b.json().data.id;
    await assignRole(ctx, owner, brunoUserId, writerRoleId, siteId);
    bruno = await login(ctx, "bruno@kalel.test", "bruno-password-1234");

    const editorRole = await createRole(ctx, owner, "editor-full-own", [
      "articles.create",
      "articles.read",
      "articles.update",
      "articles.publish",
      "articles.approve",
    ]);
    const e = await createUser(ctx, owner, "editora@kalel.test", "editora-password-1234", "Editora");
    await assignRole(ctx, owner, e.json().data.id, editorRole.json().data.id, siteId);
    editor = await login(ctx, "editora@kalel.test", "editora-password-1234");

    aliceAuthorId = await mkAuthor("Alice Byline", "alice-byline", aliceUserId);
    brunoAuthorId = await mkAuthor("Bruno Byline", "bruno-byline", brunoUserId);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const h = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  async function mkAuthor(name: string, slug: string, userId?: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/authors`,
      headers: h(owner),
      payload: { name, slug, ...(userId ? { userId } : {}) },
    });
    expect(res.statusCode, `create author ${slug}`).toBe(201);
    return res.json().data.id as string;
  }

  async function mkArticle(session: Session, title: string, authorIds: string[]) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: h(session),
      payload: { title, authors: authorIds },
    });
    expect(res.statusCode, `create article ${title}`).toBe(201);
    return res.json().data as { id: string; version: number };
  }

  const patch = (session: Session, article: { id: string; version: number }, payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...h(session), "if-match": String(article.version) },
      payload,
    });

  it("a linked author can edit an article they are credited on but did not create", async () => {
    // Bruno creates it, Alice is the credited byline
    const article = await mkArticle(bruno, "Matéria assinada pela Alice", [aliceAuthorId]);

    const res = await patch(alice, article, { title: "Editada pela autora creditada" });
    expect(
      res.statusCode,
      "a credited author must be able to edit - this returned 403 before authors.userId existed",
    ).toBe(200);
    expect(res.json().data.title).toBe("Editada pela autora creditada");
  });

  it("a writer who is neither creator nor credited author is refused", async () => {
    const article = await mkArticle(alice, "Só da Alice", [aliceAuthorId]);

    const res = await patch(bruno, article, { title: "Invasão" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/your own articles/i);
  });

  it("the creator keeps ownership even with no byline credited", async () => {
    const article = await mkArticle(alice, "Sem byline", []);
    const res = await patch(alice, article, { title: "Ainda posso editar" });
    expect(res.statusCode).toBe(200);
  });

  it("an unlinked byline grants nobody edit rights", async () => {
    const guest = await mkAuthor("Colaborador Convidado", "colaborador-convidado");
    const article = await mkArticle(bruno, "Assinada por convidado", [guest]);

    // Alice is not the creator and the byline maps to no account
    expect((await patch(alice, article, { title: "x" })).statusCode).toBe(403);
    // and the byline itself carries no user
    const authors = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/authors`,
      headers: { Cookie: owner.cookieHeader },
    });
    const row = (authors.json().data as { id: string; userId: string | null }[]).find((x) => x.id === guest);
    expect(row?.userId).toBeNull();
  });

  it("an editor with publish rights bypasses ownership entirely", async () => {
    const article = await mkArticle(alice, "Da Alice, editada pela chefia", [aliceAuthorId]);
    const res = await patch(editor, article, { title: "Ajuste editorial" });
    expect(res.statusCode).toBe(200);
  });

  it("a byline cannot be linked to a user from another site", async () => {
    const other = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: h(owner),
      payload: { slug: "portal-b-own", name: "Portal B" },
    });
    const siteB = other.json().data.id;

    const outsider = await createUser(ctx, owner, "outsider@kalel.test", "outsider-password-1234", "Outsider");
    const outsiderId = outsider.json().data.id;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/authors`,
      headers: h(owner),
      payload: { name: "Byline invasora", slug: "byline-invasora", userId: outsiderId },
    });
    expect(res.statusCode, "the account is not a member of that site").toBe(400);
    expect(res.json().error.message).toMatch(/not a member of this site/i);
  });

  it("the link can be established and removed after the fact", async () => {
    // a writer with no byline yet, so the one-byline-per-account rule is not in play
    const c = await createUser(ctx, owner, "carla@kalel.test", "carla-password-1234", "Carla");
    const carlaUserId = c.json().data.id;
    const writerRole = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/roles",
      headers: { Cookie: owner.cookieHeader },
    });
    const roleId = (writerRole.json().data as { id: string; key: string }[]).find((r) => r.key === "writer-own")!.id;
    await assignRole(ctx, owner, carlaUserId, roleId, siteId);
    const carla = await login(ctx, "carla@kalel.test", "carla-password-1234");

    const detached = await mkAuthor("Editável", "editavel");
    const article = await mkArticle(bruno, "Ganha autora depois", [detached]);
    expect((await patch(carla, article, { title: "antes" })).statusCode).toBe(403);

    const linked = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/authors/${detached}`,
      headers: h(owner),
      payload: { userId: carlaUserId },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data.userId).toBe(carlaUserId);

    const fresh = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { Cookie: carla.cookieHeader },
    });
    expect((await patch(carla, fresh.json().data, { title: "depois" })).statusCode).toBe(200);

    // unlinking revokes it again
    const unlinked = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/authors/${detached}`,
      headers: h(owner),
      payload: { userId: null },
    });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json().data.userId).toBeNull();

    const again = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { Cookie: carla.cookieHeader },
    });
    expect((await patch(carla, again.json().data, { title: "revogado" })).statusCode).toBe(403);
  });

  it("taxonomy.authors.manage cannot repoint a byline at another account", async () => {
    // Linking a byline grants edit rights on every article carrying it. Bruno holds
    // taxonomy.authors.manage; without a separate permission he could free his own byline,
    // claim Alice's, and edit her published articles under her name.
    const unlink = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/authors/${brunoAuthorId}`,
      headers: h(bruno),
      payload: { userId: null },
    });
    expect(unlink.statusCode, "unlinking is also a permission change").toBe(403);

    const hijack = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/authors/${aliceAuthorId}`,
      headers: h(bruno),
      payload: { userId: brunoUserId },
    });
    expect(hijack.statusCode).toBe(403);

    // and the same writer can still rename a byline, which is ordinary taxonomy work
    const rename = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/authors/${brunoAuthorId}`,
      headers: h(bruno),
      payload: { name: "Bruno Byline Renomeado" },
    });
    expect(rename.statusCode, "renaming a byline is not a permission change").toBe(200);

    // the link survived the refused writes
    const authors = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/authors`,
      headers: { Cookie: owner.cookieHeader },
    });
    const rows = authors.json().data as { id: string; userId: string | null }[];
    expect(rows.find((a) => a.id === aliceAuthorId)?.userId).toBe(aliceUserId);
    expect(rows.find((a) => a.id === brunoAuthorId)?.userId).toBe(brunoUserId);
  });

  it("creating a byline already linked to an account also needs the permission", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/authors`,
      headers: h(bruno),
      payload: { name: "Atalho", slug: "atalho", userId: brunoUserId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("one account holds at most one byline per site, and the conflict says why", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/authors`,
      headers: h(owner),
      payload: { name: "Alice Duplicada", slug: "alice-duplicada", userId: aliceUserId },
    });
    expect(res.statusCode).toBe(409);
    // the message used to claim the SLUG was taken, which is not what happened
    expect(res.json().error.message).toMatch(/already has an author byline/i);
    expect(res.json().error.details.field).toBe("userId");
  });

  it("brunoAuthorId is wired to Bruno, not to Alice", async () => {
    const article = await mkArticle(alice, "Assinada pelo Bruno", [brunoAuthorId]);
    expect((await patch(bruno, article, { title: "Bruno edita a própria assinatura" })).statusCode).toBe(200);
  });
});
