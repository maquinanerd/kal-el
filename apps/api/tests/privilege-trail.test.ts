import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog } from "@kal-el/db/schema";

import { assignRole, bootstrap, createRole, createServiceToken, createUser, createTestApp, login, type Session, type TestContext } from "./helpers.js";

/**
 * The two writes that decide who can do what: creating the system's first owner, and
 * granting a role on a site. Both were reachable without leaving usable evidence.
 */
describe("privilege operations leave a trail", () => {
  let ctx: TestContext;
  let owner: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const boot = await bootstrap(ctx);
    siteId = boot.siteId;
    owner = await login(ctx, boot.email, boot.password);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("records a role grant in the site audit log, naming who granted what to whom", async () => {
    const created = await createUser(ctx, owner, "writer@kalel.test", "another-secure-password-1");
    expect(created.statusCode).toBe(201);
    const targetId = (created.json() as { data: { id: string } }).data.id;

    const roleRes = await createRole(ctx, owner, "trail-editor", ["articles.create", "articles.read"]);
    expect(roleRes.statusCode).toBe(201);
    const roleId = (roleRes.json() as { data: { id: string } }).data.id;

    const assigned = await assignRole(ctx, owner, targetId, roleId, siteId);
    expect(assigned.statusCode).toBe(201);

    // the grant is the highest-privilege write in the product and used to write nothing
    const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "roles.assign"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.siteId).toBe(siteId);
    expect(row?.actorId).toBe(owner.userId);
    expect(row?.objectId).toBe(targetId);
    expect(row?.details).toMatchObject({ roleKey: "trail-editor", targetEmail: "writer@kalel.test" });

    // and it is visible through the API a site admin actually reads
    const log = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/audit-log`,
      headers: { Cookie: owner.cookieHeader },
    });
    expect(log.statusCode).toBe(200);
    const actions = (log.json() as { data: { action: string }[] }).data.map((r) => r.action);
    expect(actions).toContain("roles.assign");
  });

  it("a service token cannot grant permissions it does not itself hold", async () => {
    // The escalation guard read `actor.kind === "user"` only, so a token carrying
    // `roles.manage` could hand out the owner role - every permission in the system -
    // while holding none of them.
    const tokenRes = await createServiceToken(ctx, owner, siteId, ["roles.manage"]);
    expect(tokenRes.statusCode).toBe(201);
    const token = (tokenRes.json() as { data: { token: string } }).data.token;

    const victim = await createUser(ctx, owner, "escalation@kalel.test", "another-secure-password-2");
    const victimId = (victim.json() as { data: { id: string } }).data.id;

    const ownerRole = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/roles",
      headers: { Cookie: owner.cookieHeader },
    });
    const roles = (ownerRole.json() as { data: { id: string; key: string }[] }).data;
    const ownerRoleId = roles.find((r) => r.key === "owner")?.id;
    expect(ownerRoleId).toBeTruthy();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/users/${victimId}/roles`,
      headers: { authorization: `Bearer ${token}` },
      payload: { roleId: ownerRoleId, siteId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/cannot grant permissions/);
  });

  it("attributes role creation to the acting user, inside the same transaction", async () => {
    const res = await createRole(ctx, owner, "trail-reviewer", ["articles.read"]);
    expect(res.statusCode).toBe(201);
    const roleId = (res.json() as { data: { id: string } }).data.id;

    const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.objectId, roleId));
    expect(rows).toHaveLength(1);
    // was hardcoded to a system actor, so the log could not say who created the role
    expect(rows[0]?.actorType).toBe("user");
    expect(rows[0]?.actorId).toBe(owner.userId);
  });
});
