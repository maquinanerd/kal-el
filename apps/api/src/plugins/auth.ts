import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import fp from "fastify-plugin";
import { hashToken, getEffectivePermissions } from "@kal-el/auth";
import { serviceTokens, userRoles } from "@kal-el/db/schema";

import type { ActorContext, Credentials, SiteScopeResolution } from "../auth-context.js";
import { resolveSession, rotateSessionToken, rotationDue, touchSession, type SessionResolution } from "../services/sessions.js";
import { ApiHttpError, unauthorized } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    credentials: Credentials;
    actor?: ActorContext;
    /**
     * The session behind a cookie credential, resolved once per request.
     *
     * Three routes used to run their own `findFirst` on the token hash and each applied a
     * different subset of the validity checks. Resolving here means every reader sees the
     * same answer, and a request costs one session lookup instead of one per reader.
     */
    session?: SessionResolution;
  }
}

const SESSION_COOKIE = "ke_session";
const CSRF_COOKIE = "ke_csrf";

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

/**
 * Double-submit CSRF check.
 *
 * The session cookie is `sameSite: "lax"`, which does not stop a same-site cross-origin
 * request, so every state-changing route needs this.
 */
export function csrfFailed(req: FastifyRequest, csrfTokenHash: string): boolean {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const csrfHeader = req.headers["x-kal-el-csrf"];
  return typeof csrfHeader !== "string" || hashToken(csrfHeader) !== csrfTokenHash;
}

export async function resolveUserActor(
  app: FastifyInstance,
  req: FastifyRequest,
  siteId: string,
): Promise<SiteScopeResolution> {
  const db = app.db;
  // Resolved once by the plugin hook: expiry, idle timeout, absolute timeout, and the
  // disabled-account check all live in `resolveSession`.
  const resolved = req.session;
  if (!resolved) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "invalid or expired session" };
  if (!resolved.ok) return resolved;
  const { session, user } = resolved;

  if (csrfFailed(req, session.csrfTokenHash)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "CSRF validation failed" };
  }

  const membership = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, user.id), eq(userRoles.siteId, siteId)),
  });
  if (!membership) {
    return { ok: false, status: 403, code: "SITE_SCOPE_MISMATCH", message: "no access to this site" };
  }

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
  app.addHook("onRequest", async (req, reply) => {
    req.credentials = readCredentials(req);
    if (req.credentials?.kind !== "session") return;

    const resolved = await resolveSession(app.db, app.config, req.credentials.token);
    req.session = resolved;
    if (!resolved.ok) {
      // Not thrown here: public routes (health, preview, bootstrap) must still answer, and
      // a stale cookie left over from a previous deployment should not make them 401. Each
      // authenticated reader consults `req.session` and refuses on its own terms.
      // Clear the cookies so the browser stops sending a credential that cannot work.
      if (resolved.status === 401) {
        const opts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: app.config.COOKIE_SECURE };
        reply.clearCookie(SESSION_COOKIE, opts);
        reply.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
      }
      return;
    }

    // Bound how long a copied cookie stays useful. The rotation is guarded so concurrent
    // requests cannot rotate twice, and the old token keeps working for the grace window
    // so requests already in flight do not fail.
    if (rotationDue(app.config, resolved.session)) {
      const rotated = await rotateSessionToken(app.db, resolved.session);
      if (rotated) {
        reply.setCookie(SESSION_COOKIE, rotated, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: app.config.COOKIE_SECURE,
        });
        return;
      }
    }
    // `rotateSessionToken` already stamps lastSeenAt, so only the non-rotating path needs
    // to; the idle clock reads this.
    await touchSession(app.db, resolved.session);
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


