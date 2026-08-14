import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import fp from "fastify-plugin";
import { hashToken, getEffectivePermissions } from "@kal-el/auth";
import { sessions, serviceTokens, userRoles, users } from "@kal-el/db/schema";

import type { ActorContext, Credentials, SiteScopeResolution } from "../auth-context.js";
import { ApiHttpError, unauthorized } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    credentials: Credentials;
    actor?: ActorContext;
  }
}

const SESSION_COOKIE = "ke_session";

function readCredentials(req: FastifyRequest): Credentials {
  const session = req.cookies?.[SESSION_COOKIE];
  if (session && session.startsWith("ke_s.")) {
    return { kind: "session", token: session };
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.startsWith("ke_st.")) {
      return { kind: "service", token };
    }
  }
  return null;
}

export async function resolveUserActor(
  app: FastifyInstance,
  req: FastifyRequest,
  siteId: string,
): Promise<SiteScopeResolution> {
  const token = (req.credentials as { token: string }).token;
  const db = app.db;
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())),
  });
  if (!session) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "invalid or expired session" };

  const method = req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrfHeader = req.headers["x-kal-el-csrf"];
    if (typeof csrfHeader !== "string" || hashToken(csrfHeader) !== session.csrfTokenHash) {
      return { ok: false, status: 403, code: "FORBIDDEN", message: "CSRF validation failed" };
    }
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user || user.status === "disabled") {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "user is not active" };
  }

  const membership = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, user.id), eq(userRoles.siteId, siteId)),
  });
  if (!membership) {
    return { ok: false, status: 403, code: "SITE_SCOPE_MISMATCH", message: "no access to this site" };
  }

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));

  const permissions = await getEffectivePermissions(db, user.id, siteId);
  return {
    ok: true,
    actor: {
      kind: "user",
      userId: user.id,
      name: user.name,
      siteId,
      permissions,
      actorKey: `user:${user.id}`,
      ip: req.ip,
      requestId: (req as { id?: string }).id ?? "unknown",
    },
  };
}

export async function resolveServiceActor(
  app: FastifyInstance,
  token: string,
  siteId: string,
  ip: string,
  requestId: string,
): Promise<SiteScopeResolution> {
  const db = app.db;
  const row = await db.query.serviceTokens.findFirst({
    where: eq(serviceTokens.tokenHash, hashToken(token)),
  });
  if (!row) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "invalid service token" };
  if (row.revokedAt) return { ok: false, status: 403, code: "FORBIDDEN", message: "service token revoked" };
  if (row.expiresAt && row.expiresAt < new Date()) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "service token expired" };
  }
  if (row.siteId !== siteId) {
    return { ok: false, status: 403, code: "SITE_SCOPE_MISMATCH", message: "token is not scoped to this site" };
  }

  await db.update(serviceTokens).set({ lastUsedAt: new Date() }).where(eq(serviceTokens.id, row.id));

  return {
    ok: true,
    actor: {
      kind: "service",
      tokenId: row.id,
      name: row.name,
      siteId,
      scopes: new Set(row.scopes),
      actorKey: `service:${row.id}`,
      ip,
      requestId,
    },
  };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (req) => {
    req.credentials = readCredentials(req);
  });
});

export async function requireAuthenticated(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.credentials) {
    throw unauthorized();
  }
}

export function requireSession(req: FastifyRequest, _reply: FastifyReply): void {
  if (req.credentials?.kind !== "session") {
    throw unauthorized("session required");
  }
}

export function requireService(req: FastifyRequest, _reply: FastifyReply): void {
  if (req.credentials?.kind !== "service") {
    throw unauthorized("service token required");
  }
}

export function resolveActorContext(
  app: FastifyInstance,
  req: FastifyRequest,
  siteId: string,
): Promise<SiteScopeResolution> {
  const credentials = req.credentials;
  if (!credentials) {
    return Promise.resolve({ ok: false, status: 401, code: "UNAUTHENTICATED", message: "unauthenticated" });
  }
  if (credentials.kind === "session") {
    return resolveUserActor(app, req, siteId);
  }
  return resolveServiceActor(app, credentials.token, siteId, req.ip, (req as { id?: string }).id ?? "unknown");
}

export async function requireSiteScope(app: FastifyInstance, req: FastifyRequest, siteId: string): Promise<ActorContext> {
  const resolution = await resolveActorContext(app, req, siteId);
  if (!resolution.ok) {
    if (resolution.status === 401) throw unauthorized(resolution.message);
    throw new ApiHttpError(resolution.status, resolution.code, resolution.message);
  }
  req.actor = resolution.actor;
  return resolution.actor;
}


