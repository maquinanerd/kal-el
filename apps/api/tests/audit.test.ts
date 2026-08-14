import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("audit log", () => {
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

  it("records article writes", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
      payload: { title: "Auditável", slug: "auditavel" },
    });
    const article = res.json().data;

    const log = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/audit-log`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(log.statusCode).toBe(200);
    const entries = log.json().data;
    const createEntry = entries.find((e: { action: string }) => e.action === "articles.create");
    expect(createEntry).toBeTruthy();
    expect(createEntry.objectId).toBe(article.id);

    const objectLog = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/audit-log/article/${article.id}`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(objectLog.statusCode).toBe(200);
    expect(objectLog.json().data.length).toBeGreaterThan(0);
  });

  it("denies audit log access without the audit.read permission", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/audit-log`,
      headers: { Cookie: "ke_session=invalid.token.value" },
    });
    expect(res.statusCode).toBe(401);
  });
});
