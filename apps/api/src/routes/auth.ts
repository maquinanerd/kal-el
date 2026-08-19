import { timingSafeEqual } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "@kal-el/db";
import { users, sites, userRoles, sessions, roles, permissions, rolePermissions, serviceTokens } from "@kal-el/db/schema";
import { hashToken, verifyPassword, hashPassword } from "@kal-el/auth";
import { loginBodySchema, initBootstrapBodySchema } from "@kal-el/contracts";

import { badRequest, forbidden, unauthorized } from "../plugins/errors.js";
import { csrfFailed } from "../plugins/auth.js";
import { writeAudit } from "../plugins/audit.js";
import { OWNER_ROLE_KEY } from "../services/roles.js";
import { createSession, revokeUserSessions } from "../services/sessions.js";
import { toUserDto } from "../services/users.js";

/**
 * The bootstrap token was the one secret compared with `!==` in a codebase that is
 * otherwise timing-safe (see `preview.ts`).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const SESSION_COOKIE = "ke_session";
const CSRF_COOKIE = "ke_csrf";

/**
 * The session the auth plugin already resolved, or the refusal it produced.
 *
 * Every reader here used to run its own token lookup with a different subset of the
 * checks - which is how `/v1/auth/me` and `/v1/me/sites` ended up answering for disabled
 * accounts until that was patched into each of them separately.
 */
function requireValidSession(req: FastifyRequest) {
  const resolved = req.session;
  if (!resolved) throw unauthorized();
  if (!resolved.ok) {
    if (resolved.status === 403) throw forbidden(resolved.message);
    throw unauthorized(resolved.message);
  }
  return resolved;
}

function sessionCookieOptions(app: FastifyInstance) {
  const config = app.config;
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.COOKIE_SECURE,
  };
}

async function ensureOwnerRoleInTx(tx: Db): Promise<string> {
  const existing = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, OWNER_ROLE_KEY)).limit(1);
  if (existing.length > 0 && existing[0]) return existing[0].id;
  const allPerms = await tx.select({ id: permissions.id }).from(permissions);
  const [role] = await tx.insert(roles).values({ key: OWNER_ROLE_KEY, name: "Owner", description: "Full control within assigned sites" }).returning();
  if (!role) throw new Error("owner role insert failed");
  await tx.insert(rolePermissions).values(allPerms.map((p) => ({ roleId: role.id, permissionId: p.id })));
  return role.id;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });

      const { email, password } = parsed.data;
      const user = await app.db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
      if (!user) throw unauthorized("invalid credentials");
      if (user.status === "disabled") throw unauthorized("account is disabled");

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) throw unauthorized("invalid credentials");

      const { session, token, csrf } = await createSession(app.db, app.config, user, {
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(app));
      reply.setCookie(CSRF_COOKIE, csrf, { ...sessionCookieOptions(app), httpOnly: false });

      return {
        data: {
          user: toUserDto(user),
          session: {
            id: session.id,
            userId: session.userId,
            expiresAt: session.expiresAt.toISOString(),
            createdAt: session.createdAt.toISOString(),
          },
        },
      };
    },
  );

  app.post("/v1/auth/logout", async (req, reply) => {
    // Delete the row rather than clearing the cookie alone: a cookie the browser forgot
    // is still a valid credential to anyone who copied it.
    const resolved = req.session;
    if (resolved?.ok) {
      await app.db.delete(sessions).where(eq(sessions.id, resolved.session.id));
    } else {
      const token = req.cookies?.[SESSION_COOKIE];
      if (token && token.startsWith("ke_s.")) {
        await app.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
      }
    }
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(app));
    reply.clearCookie(CSRF_COOKIE, { ...sessionCookieOptions(app), httpOnly: false });
    return { data: { loggedOut: true } };
  });

  /**
   * Log out everywhere.
   *
   * A password compromise is not answered by changing the password alone while every
   * previously issued cookie keeps working for up to SESSION_TTL_DAYS.
   */
  app.post("/v1/auth/logout-all", async (req, reply) => {
    const resolved = requireValidSession(req);
    if (csrfFailed(req, resolved.session.csrfTokenHash)) throw forbidden("CSRF validation failed");
    const revoked = await revokeUserSessions(app.db, resolved.user.id);
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(app));
    reply.clearCookie(CSRF_COOKIE, { ...sessionCookieOptions(app), httpOnly: false });
    return { data: { loggedOut: true, revoked } };
  });

  app.get("/v1/auth/me", async (req) => {
    const credentials = req.credentials;
    if (!credentials) throw unauthorized();
    if (credentials.kind === "service") {
      const row = await app.db.query.serviceTokens.findFirst({
        where: eq(serviceTokens.tokenHash, hashToken(credentials.token)),
      });
      // revocation and expiry are checked everywhere else; without them here a revoked
      // token still got 200 disclosing its id, name, site and full scope list
      if (!row) throw unauthorized("invalid service token");
      if (row.revokedAt) throw forbidden("service token revoked");
      if (row.expiresAt && row.expiresAt < new Date()) throw unauthorized("service token expired");
      return { data: { kind: "service", id: row.id, name: row.name, siteId: row.siteId, scopes: row.scopes } };
    }
    const resolved = requireValidSession(req);
    return { data: { kind: "user", user: toUserDto(resolved.user), sessionId: resolved.session.id } };
  });

  app.get("/v1/me/sites", async (req) => {
    if (req.credentials?.kind !== "session") throw unauthorized();
    const resolved = requireValidSession(req);
    const memberships = await app.db
      .selectDistinct({ siteId: userRoles.siteId })
      .from(userRoles)
      .where(eq(userRoles.userId, resolved.user.id));
    const ids = memberships.map((m) => m.siteId);
    if (ids.length === 0) return { data: [] };
    const rows = await app.db.select().from(sites).where(inArray(sites.id, ids));
    return {
      data: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  /**
   * One-time provisioning.
   *
   * Hardening here is about a single credential that creates a full-permission owner:
   *
   *  - a dedicated rate limit, far below the global one. Without it the bootstrap token
   *    was guessable at 600 attempts a minute, and it is the only secret in the system
   *    that is compared against a value an unauthenticated caller supplies.
   *  - one refusal for every failure mode. Answering "bootstrap token required" for a bad
   *    token and "system is already initialized" for a good one turns the endpoint into
   *    an oracle: a caller learns their guess was correct from a system that then refuses
   *    to act on it, which is exactly the signal an offline search needs.
   *  - the advisory lock and the already-initialized check inside one transaction, so two
   *    concurrent calls cannot both create an owner.
   */
  app.post("/v1/bootstrap/init", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    // Identical refusal for a missing token, a wrong token, and an already-provisioned
    // system. The caller who legitimately holds the token knows which it is; nobody else
    // learns anything from the difference.
    const refuse = () => forbidden("bootstrap is not available");

    const header = req.headers["x-bootstrap-token"];
    const tokenOk =
      Boolean(app.config.BOOTSTRAP_TOKEN) &&
      typeof header === "string" &&
      constantTimeEquals(header, app.config.BOOTSTRAP_TOKEN as string);

    const parsed = initBootstrapBodySchema.safeParse(req.body);
    if (!tokenOk) {
      // Logged, not returned: an operator debugging a failed provisioning run needs to be
      // able to tell these apart, and the server log is the right place for that.
      req.log.warn({ reason: app.config.BOOTSTRAP_TOKEN ? "bad-token" : "not-configured" }, "bootstrap refused");
      throw refuse();
    }
    if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
    const { site, user } = parsed.data;

    return app.db.transaction(async (tx) => {
      // The "is the system already initialized" check ran on the pool, outside this
      // transaction, with nothing serializing it. Two concurrent calls - a retried
      // request, or a deploy script that runs twice - both read zero users and both
      // committed, leaving two sites and two full-permission owner accounts with nothing
      // surfacing the duplicate. The unique constraints only stop identical payloads.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('kal-el:bootstrap', 0))`);
      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing.length > 0) {
        req.log.warn({ reason: "already-initialized" }, "bootstrap refused");
        throw refuse();
      }

      const [siteRow] = await tx.insert(sites).values(site).returning();
      if (!siteRow) throw new Error("bootstrap site failed");
      const passwordHash = await hashPassword(user.password);
      const [userRow] = await tx.insert(users).values({ email: user.email, name: user.name, passwordHash }).returning();
      if (!userRow) throw new Error("bootstrap user failed");
      const roleId = await ensureOwnerRoleInTx(tx as unknown as Db);
      await tx.insert(userRoles).values({ userId: userRow.id, roleId, siteId: siteRow.id }).onConflictDoNothing();
      await writeAudit(tx, {
        siteId: siteRow.id,
        actorType: "system",
        actorLabel: "Bootstrap",
        action: "bootstrap.init",
        objectType: "site",
        objectId: siteRow.id,
        details: { site: site.slug, user: user.email },
      });
      reply.status(201);
      return {
        data: {
          site: {
            id: siteRow.id,
            slug: siteRow.slug,
            name: siteRow.name,
            status: siteRow.status,
            createdAt: siteRow.createdAt.toISOString(),
            updatedAt: siteRow.updatedAt.toISOString(),
          },
          user: toUserDto(userRow),
        },
      };
    });
  });
}


