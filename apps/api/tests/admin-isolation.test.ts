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
 * Regression tests for the two cross-tenant escalation paths found in the staging audit:
 *
 *  1. `/v1/admin/sites/:siteId/*` authorised against the UNION of the caller's permissions
 *     across every site, so an owner of site A could mint service tokens and register
 *     webhooks on site B.
 *  2. `POST /v1/admin/users/:id/roles` took `siteId` from the request body with no check,
 *     so any holder of `roles.manage` could grant themselves Owner on any other site.
 */
describe("admin route site isolation", () => {
  let ctx: TestContext;
  let platformOwner: Session;
  let siteA: string;
  let siteB: string;
  let ownerA: Session;
  let ownerAUserId: string;
  let ownerRoleId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    platformOwner = await login(ctx, seeded.email, seeded.password);

    const b = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: platformOwner.cookieHeader, "x-kal-el-csrf": platformOwner.csrf },
      payload: { slug: "portal-b-adm", name: "Portal B" },
    });
    siteB = b.json().data.id;

    // A full owner-equivalent, but only on site A.
    const user = await createUser(ctx, platformOwner, "owner-a@kalel.test", "owner-a-password-123", "Owner A");
    ownerAUserId = user.json().data.id;
    const role = await createRole(ctx, platformOwner, "site-a-owner", [
      "sites.read",
      "sites.create",
      "tokens.manage",
      "roles.manage",
      "users.read",
      "users.create",
      "articles.create",
      "articles.read",
    ]);
    ownerRoleId = role.json().data.id;
    await assignRole(ctx, platformOwner, ownerAUserId, ownerRoleId, siteA);
    ownerA = await login(ctx, "owner-a@kalel.test", "owner-a-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const h = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("an owner of site A cannot mint a service token for site B", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteB}/service-tokens`,
      headers: h(ownerA),
      payload: { name: "stolen", scopes: ["articles.create", "articles.read"] },
    });
    expect(res.statusCode).toBe(403);

    // ...and the same call against their own site still works.
    const own = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteA}/service-tokens`,
      headers: h(ownerA),
      payload: { name: "legit", scopes: ["articles.create", "articles.read"] },
    });
    expect(own.statusCode).toBe(201);
  });

  it("an owner of site A cannot list or revoke site B service tokens", async () => {
    const tokenB = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteB}/service-tokens`,
      headers: h(platformOwner),
      payload: { name: "b-token", scopes: ["articles.read"] },
    });
    expect(tokenB.statusCode).toBe(201);
    const tokenBId = tokenB.json().data.id;

    expect(
      (await ctx.app.inject({ method: "GET", url: `/v1/admin/sites/${siteB}/service-tokens`, headers: h(ownerA) })).statusCode,
    ).toBe(403);

    // cross-site revoke through site A's path must not touch site B's token
    const revoke = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteA}/service-tokens/${tokenBId}/revoke`,
      headers: h(ownerA),
    });
    expect(revoke.statusCode).toBe(404);

    const stillLive = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/sites/${siteB}/service-tokens`,
      headers: h(platformOwner),
    });
    const row = (stillLive.json().data as { id: string; revokedAt: string | null }[]).find((t) => t.id === tokenBId);
    expect(row?.revokedAt, "site B token must NOT have been revoked by a site A request").toBeNull();
  });

  it("an owner of site A cannot read, create or delete site B webhooks", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteB}/webhooks`,
      headers: h(platformOwner),
      payload: { url: "https://example.com/hook-b", events: ["article.published"] },
    });
    expect(created.statusCode).toBe(201);
    const webhookBId = created.json().data.id;

    expect(
      (await ctx.app.inject({ method: "GET", url: `/v1/admin/sites/${siteB}/webhooks`, headers: h(ownerA) })).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/v1/admin/sites/${siteB}/webhooks`,
          headers: h(ownerA),
          payload: { url: "https://attacker.example/exfil", events: ["article.published"] },
        })
      ).statusCode,
    ).toBe(403);

    // deleting site B's webhook through site A's path must be a no-op, not a silent delete
    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/admin/sites/${siteA}/webhooks/${webhookBId}`,
      headers: h(ownerA),
    });
    expect(del.statusCode).toBe(404);

    const remaining = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/sites/${siteB}/webhooks`,
      headers: h(platformOwner),
    });
    expect(
      (remaining.json().data as { id: string }[]).some((w) => w.id === webhookBId),
      "site B webhook must still exist after a cross-site delete attempt",
    ).toBe(true);
  });

  it("an owner of site A cannot edit site B settings", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/admin/sites/${siteB}`,
      headers: h(ownerA),
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("roles.manage on site A does not allow granting a role on site B", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/users/${ownerAUserId}/roles`,
      headers: h(ownerA),
      payload: { roleId: ownerRoleId, siteId: siteB },
    });
    expect(res.statusCode).toBe(403);

    // the grant must not have happened: site B stays out of reach
    const sites = await ctx.app.inject({ method: "GET", url: "/v1/me/sites", headers: { Cookie: ownerA.cookieHeader } });
    expect((sites.json().data as { id: string }[]).some((s) => s.id === siteB)).toBe(false);
  });

  it("a role assignment cannot grant permissions the caller does not hold", async () => {
    const powerful = await createRole(ctx, platformOwner, "super-role", [
      "articles.create",
      "articles.read",
      "articles.publish",
      "articles.delete",
      "system.manage",
    ]);
    const target = await createUser(ctx, platformOwner, "pawn@kalel.test", "pawn-password-1234", "Pawn");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/users/${target.json().data.id}/roles`,
      headers: h(ownerA),
      payload: { roleId: powerful.json().data.id, siteId: siteA },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/cannot grant permissions/i);
  });

  it("a service token cannot act on a site it is not bound to via admin routes", async () => {
    const tokenA = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteA}/service-tokens`,
      headers: h(platformOwner),
      payload: { name: "a-admin-token", scopes: ["tokens.manage"] },
    });
    const plaintext = tokenA.json().data.token as string;

    const res = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/sites/${siteB}/service-tokens`,
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
