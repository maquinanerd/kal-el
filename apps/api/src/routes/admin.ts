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
  uuidSchema,
} from "@kal-el/contracts";

import { badRequest, forbidden, unauthorized } from "../plugins/errors.js";
import { getSite, listSites, createSite, updateSite } from "../services/sites.js";
import { createUser, listUsers } from "../services/users.js";
import { createRole, listRoles, assignRoleToUser } from "../services/roles.js";
import { createServiceToken, listServiceTokens, revokeServiceToken } from "../services/tokens.js";
import { createWebhook, deleteWebhook, listWebhooks } from "../services/webhooks.js";
import type { ActorContext } from "../auth-context.js";

async function requireAdminPermission(app: FastifyInstance, req: FastifyRequest, permission: string): Promise<ActorContext> {
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
  const user = await app.db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user || user.status === "disabled") throw forbidden("user is not active");

  const memberships = await app.db
    .selectDistinct({ siteId: userRoles.siteId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
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

function adminGuard(app: FastifyInstance, permission: string) {
  return async (req: FastifyRequest) => {
    req.actor = await requireAdminPermission(app, req, permission);
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
        const row = await createSite(app.db, parsed.data);
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

      adminApp.patch("/sites/:siteId", { preHandler: adminGuard(app, "sites.create") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = updateSiteBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await updateSite(app.db, siteId, parsed.data);
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
        return reply.status(201).send({ data: await createUser(app.db, parsed.data) });
      });

      adminApp.post("/users/:userId/roles", { preHandler: adminGuard(app, "roles.manage") }, async (req, reply) => {
        const userId = (req.params as { userId: string }).userId;
        if (!uuidSchema.safeParse(userId).success) throw badRequest("invalid userId");
        const parsed = zAssignRole.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        await assignRoleToUser(app.db, userId, parsed.data.roleId, parsed.data.siteId);
        return reply.status(201).send({ data: { assigned: true } });
      });

      adminApp.get("/roles", { preHandler: adminGuard(app, "roles.manage") }, async () => ({ data: await listRoles(app.db) }));

      adminApp.post("/roles", { preHandler: adminGuard(app, "roles.manage") }, async (req, reply) => {
        const parsed = createRoleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const role = await createRole(app.db, parsed.data, {
          kind: "system",
          actorKey: "system:admin",
        });
        return reply.status(201).send({ data: role });
      });

      adminApp.get("/sites/:siteId/service-tokens", { preHandler: adminGuard(app, "tokens.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        await getSite(app.db, siteId);
        return { data: await listServiceTokens(app.db, siteId) };
      });

      adminApp.post("/sites/:siteId/service-tokens", { preHandler: adminGuard(app, "tokens.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = createServiceTokenBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const token = await createServiceToken(app.db, siteId, parsed.data);
        return reply.status(201).send({ data: token });
      });

      adminApp.post("/sites/:siteId/service-tokens/:tokenId/revoke", { preHandler: adminGuard(app, "tokens.manage") }, async (req) => {
        const { siteId, tokenId } = req.params as { siteId: string; tokenId: string };
        if (!uuidSchema.safeParse(siteId).success || !uuidSchema.safeParse(tokenId).success) throw badRequest("invalid id");
        return { data: await revokeServiceToken(app.db, siteId, tokenId) };
      });

      adminApp.get("/sites/:siteId/webhooks", { preHandler: adminGuard(app, "tokens.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        await getSite(app.db, siteId);
        return { data: await listWebhooks(app.db, siteId) };
      });

      adminApp.post("/sites/:siteId/webhooks", { preHandler: adminGuard(app, "tokens.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        if (!uuidSchema.safeParse(siteId).success) throw badRequest("invalid siteId");
        const parsed = createWebhookBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const webhook = await createWebhook(app.db, siteId, parsed.data);
        return reply.status(201).send({ data: webhook });
      });

      adminApp.delete("/sites/:siteId/webhooks/:webhookId", { preHandler: adminGuard(app, "tokens.manage") }, async (req) => {
        const { siteId, webhookId } = req.params as { siteId: string; webhookId: string };
        if (!uuidSchema.safeParse(siteId).success || !uuidSchema.safeParse(webhookId).success) throw badRequest("invalid id");
        return { data: await deleteWebhook(app.db, siteId, webhookId) };
      });
    },
    { prefix: "/v1/admin" },
  );
}

const zAssignRole = z.object({
  roleId: z.string().uuid(),
  siteId: z.string().uuid(),
});
