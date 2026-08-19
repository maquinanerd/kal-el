import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "@kal-el/db";
import { users, sites, userRoles, sessions, roles, permissions, rolePermissions, serviceTokens } from "@kal-el/db/schema";
import { hashToken, verifyPassword, generateOpaqueToken, sessionTokenPrefix, generateCsrfToken, hashPassword } from "@kal-el/auth";
import { loginBodySchema, initBootstrapBodySchema } from "@kal-el/contracts";

import { badRequest, forbidden, unauthorized } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { OWNER_ROLE_KEY } from "../services/roles.js";
import { toUserDto } from "../services/users.js";

const SESSION_COOKIE = "ke_session";
const CSRF_COOKIE = "ke_csrf";

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

      const token = generateOpaqueToken(sessionTokenPrefix());
      const csrf = generateCsrfToken();
      const ttlDays = app.config.SESSION_TTL_DAYS;
      const [session] = await app.db
        .insert(sessions)
        .values({
          userId: user.id,
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrf),
          expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
          ip: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        })
        .returning();
      if (!session) throw new Error("login failed to create session");

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
    const token = req.cookies?.[SESSION_COOKIE];
    if (token && token.startsWith("ke_s.")) {
      await app.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    }
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(app));
    reply.clearCookie(CSRF_COOKIE, { ...sessionCookieOptions(app), httpOnly: false });
    return { data: { loggedOut: true } };
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
    const sessionByToken = await app.db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, hashToken(credentials.token)),
    });
    if (!sessionByToken || sessionByToken.expiresAt < new Date()) throw unauthorized("session expired");
    const user = await app.db.query.users.findFirst({ where: eq(users.id, sessionByToken.userId) });
    if (!user) throw unauthorized();
    // a disabled account keeps an unexpired session; every data route rejects it, so this
    // one should not keep answering with the profile either
    if (user.status === "disabled") throw forbidden("user is not active");
    return { data: { kind: "user", user: toUserDto(user), sessionId: sessionByToken.id } };
  });

  app.get("/v1/me/sites", async (req) => {
    const credentials = req.credentials;
    if (!credentials || credentials.kind !== "session") throw unauthorized();
    const session = await app.db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, hashToken(credentials.token)),
    });
    if (!session || session.expiresAt < new Date()) throw unauthorized("session expired");
    // same checks /v1/auth/me makes: a disabled account keeps an unexpired cookie for up
    // to SESSION_TTL_DAYS, and this route discloses every site they belonged to
    const sitesUser = await app.db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!sitesUser) throw unauthorized();
    if (sitesUser.status === "disabled") throw forbidden("user is not active");
    const memberships = await app.db
      .selectDistinct({ siteId: userRoles.siteId })
      .from(userRoles)
      .where(eq(userRoles.userId, session.userId));
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

  app.post("/v1/bootstrap/init", async (req, reply) => {
    const header = req.headers["x-bootstrap-token"];
    if (!app.config.BOOTSTRAP_TOKEN || header !== app.config.BOOTSTRAP_TOKEN) {
      throw forbidden("bootstrap token required");
    }
    const existing = await app.db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) throw forbidden("system is already initialized");

    const parsed = initBootstrapBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
    const { site, user } = parsed.data;

    return app.db.transaction(async (tx) => {
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


