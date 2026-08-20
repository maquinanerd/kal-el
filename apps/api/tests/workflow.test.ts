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
import { ensurePresetRoles, roleHasPermission } from "../src/services/roles.js";

describe("editorial workflow", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let authorSession: Session;
  let headEditorSession: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    const author = await createUser(ctx, ownerSession, "autor@kalel.test", "autor-password-123", "Autor");
    const authorId = author.json().data.id;
    const authorRole = await createRole(ctx, ownerSession, "autor", ["articles.create", "articles.read", "articles.update", "articles.submit"]);
    await assignRole(ctx, ownerSession, authorId, authorRole.json().data.id, siteId);
    authorSession = await login(ctx, "autor@kalel.test", "autor-password-123");

    const chefe = await createUser(ctx, ownerSession, "chefe@kalel.test", "chefe-password-123", "Editor chefe");
    const chefeId = chefe.json().data.id;
    const chefeRole = await createRole(ctx, ownerSession, "editor-chefe", [
      "articles.create",
      "articles.read",
      "articles.update",
      "articles.submit",
      "articles.approve",
      "articles.publish",
      "articles.schedule",
    ]);
    await assignRole(ctx, ownerSession, chefeId, chefeRole.json().data.id, siteId);
    headEditorSession = await login(ctx, "chefe@kalel.test", "chefe-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  async function createDraft(session: Session, slug: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: headers(session),
      payload: { title: slug, slug },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  async function act(session: Session, articleId: string, action: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${articleId}/${action}`,
      headers: headers(session),
      payload: {},
    });
  }

  /**
   * The author is the person who has to act on a rejection, and the reason lived only in
   * the audit log, behind `audit.read` - a permission an author does not have. The
   * article itself now carries the note of the transition that produced its status, so it
   * arrives with the same read the editor already does.
   */
  it("carries the rejection note on the blocked article, readable by the author", async () => {
    const article = await createDraft(authorSession, "bloqueado-com-motivo");
    await act(authorSession, article.id, "submit");

    const reject = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/reject`,
      headers: headers(headEditorSession),
      payload: { note: "Rever a introducao antes de reenviar." },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().data.status).toBe("blocked");

    const seen = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { Cookie: authorSession.cookieHeader },
    });
    expect(seen.statusCode).toBe(200);
    const note = seen.json().data.workflowNote;
    expect(note, "the author must be able to read why it came back").toBeTruthy();
    expect(note.note).toBe("Rever a introducao antes de reenviar.");
    expect(note.action).toBe("articles.reject");
    expect(note.actorLabel).toBe("Editor chefe");

    // resubmitting leaves the block behind: the note must not follow the article forward
    const again = await act(authorSession, article.id, "submit");
    expect(again.statusCode).toBe(200);
    expect(again.json().data.status).toBe("in_review");
    expect(again.json().data.workflowNote, "a submit with no note carries none").toBeNull();
  });

  it("author can create a draft and submit it for review", async () => {
    const article = await createDraft(authorSession, "autor-rascunho");
    expect(article.status).toBe("draft");

    const submit = await act(authorSession, article.id, "submit");
    expect(submit.statusCode).toBe(200);
    expect(submit.json().data.status).toBe("in_review");
  });

  it("author cannot publish, approve or schedule (RBAC)", async () => {
    const article = await createDraft(authorSession, "autor-sem-publicar");

    const publish = await act(authorSession, article.id, "publish");
    expect(publish.statusCode).toBe(403);

    const approve = await act(authorSession, article.id, "approve");
    expect(approve.statusCode).toBe(403);

    const schedule = await act(authorSession, article.id, "schedule");
    expect(schedule.statusCode).toBe(403);
  });

  it("head editor approves, rejects, schedules and publishes", async () => {
    // full happy path: draft -> in_review -> approved -> scheduled -> published
    const article = await createDraft(authorSession, "fluxo-completo");
    await act(authorSession, article.id, "submit");

    const approve = await act(headEditorSession, article.id, "approve");
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data.status).toBe("draft");

    // schedule from draft
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const schedule = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/schedule`,
      headers: headers(headEditorSession),
      payload: { scheduledAt: future },
    });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json().data.status).toBe("scheduled");

    const publish = await act(headEditorSession, article.id, "publish");
    expect(publish.statusCode).toBe(200);
    expect(publish.json().data.status).toBe("published");
  });

  it("reject moves in_review to blocked, and blocked can be resubmitted", async () => {
    const article = await createDraft(authorSession, "rejeitado");
    await act(authorSession, article.id, "submit");

    const reject = await act(headEditorSession, article.id, "reject");
    expect(reject.statusCode).toBe(200);
    expect(reject.json().data.status).toBe("blocked");

    const resubmit = await act(authorSession, article.id, "submit");
    expect(resubmit.statusCode).toBe(200);
    expect(resubmit.json().data.status).toBe("in_review");
  });

  it("unpublish returns a published article to draft", async () => {
    const article = await createDraft(headEditorSession, "despublicar");
    await act(headEditorSession, article.id, "publish");

    const unpublish = await act(headEditorSession, article.id, "unpublish");
    expect(unpublish.statusCode).toBe(200);
    expect(unpublish.json().data.status).toBe("draft");
  });

  it("archive withdraws a draft and blocks further transitions", async () => {
    const article = await createDraft(authorSession, "arquivar");
    const archive = await act(headEditorSession, article.id, "archive");
    expect(archive.statusCode).toBe(200);
    expect(archive.json().data.status).toBe("archived");

    const publish = await act(headEditorSession, article.id, "publish");
    expect(publish.statusCode).toBe(409);
  });

  it("preset roles define the editorial permission matrix", async () => {
    await ensurePresetRoles(ctx.db);

    expect(await roleHasPermission(ctx.db, "autor", "articles.submit")).toBe(true);
    expect(await roleHasPermission(ctx.db, "autor", "articles.publish")).toBe(false);
    expect(await roleHasPermission(ctx.db, "autor", "articles.approve")).toBe(false);

    expect(await roleHasPermission(ctx.db, "editor", "articles.approve")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor", "articles.publish")).toBe(false);

    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.approve")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.publish")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.schedule")).toBe(true);

    expect(await roleHasPermission(ctx.db, "admin", "articles.publish")).toBe(true);
    expect(await roleHasPermission(ctx.db, "admin", "media.manage")).toBe(true);
  });

  it("approve cannot be used as an unpublish by a role without publish rights", async () => {
    // `approve` and `unpublish` share the target `draft`, and `published -> draft` is a
    // legal transition - so `/approve`, guarded by articles.approve, would withdraw a
    // live article and `clearDates` would destroy its original publishedAt.
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { title: "Publicado de verdade" },
    });
    const id = created.json().data.id as string;

    const published = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${id}/publish`,
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: {},
    });
    expect(published.statusCode).toBe(200);
    const originalPublishedAt = published.json().data.publishedAt as string;
    expect(originalPublishedAt).toBeTruthy();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${id}/approve`,
      headers: { Cookie: headEditorSession.cookieHeader, "x-kal-el-csrf": headEditorSession.csrf },
      payload: {},
    });
    expect(res.statusCode, "approving a published article is not a thing").toBe(409);
    expect(res.json().error.code).toBe("INVALID_TRANSITION");

    const still = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${id}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(still.json().data.status, "the article must still be live").toBe("published");
    expect(still.json().data.publishedAt, "its publication date must survive").toBe(originalPublishedAt);
  });
});
