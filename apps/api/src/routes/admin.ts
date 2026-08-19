import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { serviceTokens, sessions, users, userRoles } from "@kal-el/db/schema";
import { hashToken, getEffectivePermissions } from "@kal-el/auth";
import {
  createSiteBodySchema,
  createUserBodySchema,
  createRoleBodySchema,
  createServiceTokenBodySchema,
  createWebhookBodySchema,
  updateSiteBodySchema,
  updateWebhookBodySchema,
  uuidSchema,
} from "@kal-el/contracts";

import { badRequest, forbidden, unauthorized } from "../plugins/errors.js";
import { getSite, listSites, createSite, updateSite } from "../services/sites.js";
import { createUser, listUsers } from "../services/users.js";
import { createRole, listRoles, assignRoleToUser, getRolePermissions, grantOwnerOnSite, type RoleAuditActor } from "../services/roles.js";
import { createServiceToken, listServiceTokens, revokeServiceToken } from "../services/tokens.js";
import { createWebhook, deleteWebhook, listWebhooks, updateWebhook } from "../services/webhooks.js";
import { auditActorFields, writeAudit, type AuditEntry } from "../plugins/audit.js";
import type { ActorContext } from "../auth-context.js";

/**
 * Admin routes come in two shapes:
 *
 *  - global routes (`/sites`, `/users`, `/roles`) where the actor's permissions are the
 *    union across every site they belong to;
 *  - site-scoped routes (`/sites/:siteId/...`) where the permission MUST be held at that
 *    specific site.
 *
 * `targetSiteId` selects the second mode. Without it a user who owns one site would be
 * able to act on every other site, because the union carries their permission everywhere.
 */
async function requireAdminPermission(
  app: FastifyInstance,
  req: FastifyRequest,
  permission: string,
  targetSiteId?: string,
): Promise<ActorContext> {
  const credentials = req.credentials;
  if (!credentials) throw unauthorized();

  if (credentials.kind === "service") {
    const row = await app.db.query.serviceTokens.findFirst({
      where: eq(serviceTokens.tokenHash, hashToken(credentials.token)),
    });
    if (!row) throw unauthorized("invalid service token");
    if (row.revokedAt) throw forbidden("service token revoked");
    if (row.expiresAt && row.expiresAt < new Date()) throw unauthorized("service token expired");
    if (!row.scopes.includes(permission)) throw forbidden(`missing scope: ${permission}`);
    if (targetSiteId && row.siteId !== targetSiteId) throw forbidden("token is not scoped to this site");
    return {
      kind: "service",
      tokenId: row.id,
      name: row.name,
      siteId: row.siteId,
      scopes: new Set(row.scopes),
      actorKey: `service:${row.id}`,
      ip: req.ip,
      requestId: (req as { id?: string }).id ?? "unknown",
    };
  }

  const session = await app.db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, hashToken(credentials.token)), gt(sessions.expiresAt, new Date())),
  });
  if (!session) throw unauthorized("invalid or expired session");

  // Same double-submit check `/v1/sites/*` runs. Without it every mutating admin route -
  // create site, create user, assign role, mint token, register webhook - was reachable
  // cross-origin from any same-site subdomain, because the cookie is sameSite=lax.
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const csrfHeader = req.headers["x-kal-el-csrf"];
    if (typeof csrfHeader !== "string" || hashToken(csrfHeader) !== session.csrfTokenHash) {
      throw forbidden("CSRF validation failed");
    }
  }

  const user = await app.db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user || user.status === "disabled") throw forbidden("user is not active");

  const memberships = await app.db
    .selectDistinct({ siteId: userRoles.siteId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  if (targetSiteId) {
    // Site-scoped route: membership in the target site is mandatory and the permission
    // must come from a role held *there*, never from another site.
    if (!memberships.some((m) => m.siteId === targetSiteId)) {
      throw forbidden("you are not a member of this site");
    }
    const scoped = await getEffectivePermissions(app.db, user.id, targetSiteId);
    if (!scoped.has(permission)) throw forbidden(`missing permission: ${permission}`);
    return {
      kind: "user",
      userId: user.id,
      name: user.name,
      siteId: targetSiteId,
      permissions: scoped,
      actorKey: `user:${user.id}`,
      ip: req.ip,
      requestId: (req as { id?: string }).id ?? "unknown",
    };
  }

  const union = new Set<string>();
  for (const m of memberships) {
    if (!m.siteId) continue;
    const perms = await getEffectivePermissions(app.db, user.id, m.siteId);
    for (const k of perms) union.add(k);
  }
  if (!union.has(permission)) throw forbidden(`missing permission: ${permission}`);

  return {
    kind: "user",
    userId: user.id,
    name: user.name,
    siteId: memberships[0]?.siteId ?? "",
    permissions: union,
    actorKey: `user:${user.id}`,
    ip: req.ip,
    requestId: (req as { id?: string }).id ?? "unknown",
  };
}

/**
 * Audit identity for an admin action.
 *
 * Every one of these routes used to record `actorId: req.actor?.kind === "user" ? ... :
 * null`, so a platform integration acting through a service token appeared in the log as
 * an unattributed action. `auditActorFields` resolves the token id and its operator-chosen
 * name instead.
 */
function adminAudit(req: FastifyRequest): Pick<AuditEntry, "actorType" | "actorId" | "actorLabel"> {
  const actor = req.actor;
  if (!actor) return { actorType: "system", actorId: null, actorLabel: null };
  return auditActorFields(actor);
}

/** The same identity in the shape the roles service takes. */
function roleAuditActor(req: FastifyRequest): RoleAuditActor {
  const actor = req.actor;
  if (!actor) return { kind: "system", actorKey: "system:admin", id: null, label: null, ip: req.ip, requestId: req.id };
  return {
    kind: actor.kind,
    actorKey: actor.actorKey,
    id: actor.kind === "service" ? actor.tokenId : actor.userId,
    label: actor.name,
    ip: req.ip,
    requestId: req.id,
  };
}

function adminGuard(app: FastifyInstance, permission: string) {
  return async (req: FastifyRequest) => {
    req.actor = await requireAdminPermission(app, req, permission);
  };
}

/** Guard for `/sites/:siteId/...` routes: the permission must be held at that site. */
function siteAdminGuard(app: FastifyInstance, permission: string) {
  return async (req: FastifyRequest) => {
    const siteId = (req.params as { siteId?: string }).siteId;
    if (!siteId || !uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
    req.actor = await requireAdminPermission(app, req, permission, siteId);
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.register(
    async (adminApp) => {
      adminApp.get("/sites", { preHandler: adminGuard(app, "sites.read") }, async (_req, reply) => {
        const rows = await listSites(app.db);
        return reply.send({
          data: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        });
      });

      adminApp.post("/sites", { preHandler: adminGuard(app, "sites.create") }, async (req, reply) => {
        const parsed = createSiteBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        // Creating a tenant, granting its first owner and recording that it happened are
        // one act: a crash between them leaves a site nobody can administer, or a site
        // with no record of who created it. F10 - `createSite` wrote no audit row at all.
        const row = await app.db.transaction(async (tx) => {
          const site = await createSite(tx as unknown as typeof app.db, parsed.data);
          // Site-scoped admin routes require membership in the target site, so the creator
          // has to become an owner of the site they just created - otherwise the new site
          // would be unadministrable by anyone.
          const actor = req.actor;
          if (actor && actor.kind === "user") {
            await grantOwnerOnSite(tx as unknown as typeof app.db, actor.userId, site.id);
          }
          await writeAudit(tx, {
            siteId: site.id,
            ...adminAudit(req),
            action: "sites.create",
            objectType: "site",
            objectId: site.id,
            details: { slug: site.slug, name: site.name },
            ip: req.ip,
            requestId: req.id,
          });
          return site;
        });
        return reply.status(201).send({
          data: {
            id: row.id,
            slug: row.slug,
            name: row.name,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      adminApp.patch("/sites/:siteId", { preHandler: siteAdminGuard(app, "sites.create") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = updateSiteBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await app.db.transaction(async (tx) => {
          const site = await updateSite(tx as unknown as typeof app.db, siteId, parsed.data);
          // Deactivating a site is an operational event; it had no trail either.
          await writeAudit(tx, {
            siteId,
            ...adminAudit(req),
            action: "sites.update",
            objectType: "site",
            objectId: siteId,
            details: { changedFields: Object.keys(parsed.data), status: site.status },
            ip: req.ip,
            requestId: req.id,
          });
          return site;
        });
        return {
          data: {
            id: row.id,
            slug: row.slug,
            name: row.name,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        };
      });

      adminApp.get("/users", { preHandler: adminGuard(app, "users.read") }, async () => ({ data: await listUsers(app.db) }));

      adminApp.post("/users", { preHandler: adminGuard(app, "users.create") }, async (req, reply) => {
        const parsed = createUserBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        // F10: creating an account is how a person enters the platform, and it left no
        // record of who let them in. Same transaction as the insert, so the account and
        // the entry saying it was created cannot disagree.
        const user = await app.db.transaction(async (tx) => {
          const created = await createUser(tx as unknown as typeof app.db, parsed.data);
          await writeAudit(tx, {
            // no siteId: an account is a platform object and only becomes site-scoped
            // when a role is granted (see roles.assign)
            ...adminAudit(req),
            action: "users.create",
            objectType: "user",
            objectId: created.id,
            // deliberately never the password or its hash
            details: { email: created.email, name: created.name, status: created.status },
            ip: req.ip,
            requestId: req.id,
          });
          return created;
        });
        return reply.status(201).send({ data: user });
      });

      // The target site comes from the body, so the guard has to run inside the handler:
      // `roles.manage` must be held at THAT site, otherwise any site owner could grant
      // themselves a role on every other site.
      adminApp.post("/users/:userId/roles", async (req, reply) => {
        const userId = (req.params as { userId: string }).userId;
        if (!uuidSchema.safeParse(userId).success) throw badRequest("invalid userId");
        const parsed = zAssignRole.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const { roleId, siteId } = parsed.data;

        const actor = await requireAdminPermission(app, req, "roles.manage", siteId);
        req.actor = actor;

        // No escalation: you cannot grant a permission you do not hold at this site.
        // This checked `actor.kind === "user"` only, so a service token carrying
        // `roles.manage` could grant the owner role - every permission in the system -
        // while holding none of them.
        const held = actor.kind === "service" ? actor.scopes : actor.permissions;
        const granted = await getRolePermissions(app.db, roleId);
        const escalation = [...granted].filter((p) => !held.has(p));
        if (escalation.length > 0) {
          throw forbidden("cannot grant permissions you do not hold at this site", {
            missing: escalation.sort(),
          });
        }

        await assignRoleToUser(app.db, userId, roleId, siteId, roleAuditActor(req));
        return reply.status(201).send({ data: { assigned: true } });
      });

      adminApp.get("/roles", { preHandler: adminGuard(app, "roles.manage") }, async () => ({ data: await listRoles(app.db) }));

      adminApp.post("/roles", { preHandler: adminGuard(app, "roles.manage") }, async (req, reply) => {
        const parsed = createRoleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        // was hardcoded to `system:admin`, so every role creation was attributed to
        // nobody in the one log that exists to say who did it
        const role = await createRole(app.db, parsed.data, roleAuditActor(req));
        return reply.status(201).send({ data: role });
      });

      adminApp.get("/sites/:siteId/service-tokens", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        await getSite(app.db, siteId);
        return { data: await listServiceTokens(app.db, siteId) };
      });

      adminApp.post("/sites/:siteId/service-tokens", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = createServiceTokenBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const token = await createServiceToken(app.db, siteId, parsed.data);
        // Minting a credential wrote nothing at all. A token can carry every permission in
        // the system and outlive the person who created it; the one log that exists to say
        // who did what had no record that it was ever issued.
        await writeAudit(app.db, {
          siteId,
          ...adminAudit(req),
          action: "tokens.create",
          objectType: "service_token",
          objectId: token.id,
          details: { name: parsed.data.name, scopes: parsed.data.scopes },
          ip: req.ip,
          requestId: req.id,
        });
        return reply.status(201).send({ data: token });
      });

      adminApp.post("/sites/:siteId/service-tokens/:tokenId/revoke", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req) => {
        const { siteId, tokenId } = req.params as { siteId: string; tokenId: string };
        if (!uuidSchema.safeParse(siteId).success || !uuidSchema.safeParse(tokenId).success) throw badRequest("invalid id");
        const revoked = await revokeServiceToken(app.db, siteId, tokenId);
        await writeAudit(app.db, {
          siteId,
          ...adminAudit(req),
          action: "tokens.revoke",
          objectType: "service_token",
          objectId: tokenId,
          details: {},
          ip: req.ip,
          requestId: req.id,
        });
        return { data: revoked };
      });

      adminApp.get("/sites/:siteId/webhooks", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        await getSite(app.db, siteId);
        return { data: await listWebhooks(app.db, siteId) };
      });

      adminApp.post("/sites/:siteId/webhooks", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = createWebhookBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const webhook = await createWebhook(app.db, siteId, parsed.data, { allowPrivate: app.config.ALLOW_PRIVATE_WEBHOOKS });
        // a webhook receives the full payload of every event it subscribes to; registering
        // one is a data-egress decision and left no trace
        await writeAudit(app.db, {
          siteId,
          ...adminAudit(req),
          action: "webhooks.create",
          objectType: "webhook",
          objectId: webhook.id,
          details: { url: parsed.data.url, events: parsed.data.events },
          ip: req.ip,
          requestId: req.id,
        });
        return reply.status(201).send({ data: webhook });
      });

      adminApp.patch("/sites/:siteId/webhooks/:webhookId", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req) => {
        const { siteId, webhookId } = req.params as { siteId: string; webhookId: string };
        if (!uuidSchema.safeParse(siteId).success || !uuidSchema.safeParse(webhookId).success) throw badRequest("invalid id");
        const parsed = updateWebhookBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const webhook = await updateWebhook(app.db, siteId, webhookId, parsed.data, {
          allowPrivate: app.config.ALLOW_PRIVATE_WEBHOOKS,
        });
        await writeAudit(app.db, {
          siteId,
          ...adminAudit(req),
          action: "webhooks.update",
          objectType: "webhook",
          objectId: webhookId,
          // never the secret; it is not updatable and is not read here
          details: { changedFields: Object.keys(parsed.data), enabled: webhook.enabled },
          ip: req.ip,
          requestId: req.id,
        });
        return { data: webhook };
      });

      adminApp.delete("/sites/:siteId/webhooks/:webhookId", { preHandler: siteAdminGuard(app, "tokens.manage") }, async (req) => {
        const { siteId, webhookId } = req.params as { siteId: string; webhookId: string };
        if (!uuidSchema.safeParse(siteId).success || !uuidSchema.safeParse(webhookId).success) throw badRequest("invalid id");
        const removed = await deleteWebhook(app.db, siteId, webhookId);
        await writeAudit(app.db, {
          siteId,
          ...adminAudit(req),
          action: "webhooks.delete",
          objectType: "webhook",
          objectId: webhookId,
          details: {},
          ip: req.ip,
          requestId: req.id,
        });
        return { data: removed };
      });
    },
    { prefix: "/v1/admin" },
  );
}

const zAssignRole = z
  .object({
    roleId: z.string().uuid(),
    siteId: z.string().uuid(),
  })
  .strict();
