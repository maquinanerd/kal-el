import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("auth", () => {
  let ctx: TestContext;
  let session: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("bootstraps the system exactly once", async () => {
    const seeded = await bootstrap(ctx);
    expect(seeded.siteId).toBeTruthy();
    expect(seeded.userId).toBeTruthy();
  });

  it("rejects a second bootstrap", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      headers: { "x-bootstrap-token": ctx.config.BOOTSTRAP_TOKEN as string },
      payload: {
        site: { slug: "portal-b", name: "Portal B" },
        user: { email: "other@kalel.test", name: "Other", password: "super-secure-password-123" },
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects bootstrap without the bootstrap token", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      payload: {
        site: { slug: "portal-c", name: "Portal C" },
        user: { email: "x@kalel.test", name: "X", password: "super-secure-password-123" },
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects wrong credentials", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@kalel.test", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logs in and establishes a session with CSRF token", async () => {
    session = await login(ctx, "owner@kalel.test", "super-secure-password-123");
    expect(session.cookieHeader).toContain("ke_session=");
    expect(session.csrf).toBeTruthy();
  });

  it("exposes the authenticated user via /me", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { Cookie: session.cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toBe("owner@kalel.test");
  });

  it("rejects mutating requests without the CSRF header", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/sites/00000000-0000-0000-0000-000000000000/articles",
      headers: { Cookie: session.cookieHeader },
      payload: { title: "x" },
    });
    // no CSRF header → session actor resolution fails (before site lookup)
    expect(res.statusCode).toBe(403);
  });

  it("logs out and invalidates the session", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { Cookie: session.cookieHeader },
    });
    expect(res.statusCode).toBe(200);

    const me = await ctx.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { Cookie: session.cookieHeader },
    });
    expect(me.statusCode).toBe(401);
  });
});
