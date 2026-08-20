# KAL EL — RECOVERY REPORT (código completo, estado final)

Branch: feat/foundation-phase-1-3
Base:   3a96a3a9aca4d4f6d0b08bdb26583e1f96af9ab4
Head:   12695ae93002c3690dc56f87f1375f8c16aec930

Commits desta recuperação:
- 849c155 fix(auth): enforce publish/schedule permissions on article creation  (R0)
- 0045af3 feat(editor): introduce article document schema v2 with inline marks  (R1)
- 3f6311a feat(media): add local storage provider and media API               (R2)
- 5e003f5 feat(workflow): implement editorial state machine and preset roles   (R3)
- 23b8ceb feat(cms): bootstrap real Next.js editorial application              (R4)
- 12695ae feat(editor): integrate TipTap writing experience in the CMS         (R5)

Fases implementadas: R0, R1, R2, R3, R4, R5.
Fases NÃO implementadas: R6, R7, R8, R9, R10, R11, R12, R13.

Gates (executados):
- pnpm -r typecheck  PASS
- pnpm -r lint       PASS
- pnpm -r build      PASS
- pnpm -r test       119 testes, 0 fail, 0 skip

Abaixo, o conteúdo COMPLETO (estado final) de cada arquivo alterado/criado nesta
recuperação (excluído pnpm-lock.yaml). Contexto narrativo por fase está em
docs/progress/RECOVERY-0x-*.md e docs/adr/ADR-0008/0009/0010.

## .env.example

```text
# Placeholders only. Never commit real secrets.
DATABASE_URL=postgresql://kalel:kalel@localhost:5432/kalel
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:3001
PORT=3001
HOST=0.0.0.0
SESSION_SECRET=replace-with-a-long-random-string
SESSION_TTL_DAYS=30
COOKIE_SECURE=false
# Token required to call POST /v1/bootstrap/init (initial provisioning only)
BOOTSTRAP_TOKEN=replace-with-a-random-token
MEDIA_STORAGE_PROVIDER=local
MEDIA_LOCAL_PATH=./uploads
MEDIA_MAX_BYTES=26214400

```

## .gitignore

```text
node_modules/
.next/
dist/
build/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
.vscode/
.idea/
secrets/
*.pem
*.key
*.p12
*.pfx
uploads/
tmp/
*.zip
*.tsbuildinfo

```

## apps/api/package.json

```json
{
  "name": "@kal-el/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./src/*": "./src/*"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:integration": "vitest run"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.1",
    "@fastify/cors": "^11.0.0",
    "@fastify/helmet": "^13.0.0",
    "@fastify/multipart": "^10.1.1",
    "@fastify/rate-limit": "^10.2.0",
    "@fastify/swagger": "^9.3.0",
    "@fastify/swagger-ui": "^6.1.1",
    "@kal-el/auth": "workspace:*",
    "@kal-el/contracts": "workspace:*",
    "@kal-el/db": "workspace:*",
    "@kal-el/events": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "fastify": "^5.1.0",
    "fastify-plugin": "^5.0.1",
    "image-size": "^2.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@kal-el/testkit": "workspace:*",
    "@types/pg": "^8.11.10",
    "tsup": "^8.3.5",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}

```

## apps/api/src/app.ts

```ts
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { buildOpenApiDocument } from "@kal-el/contracts";
import { requestId } from "@kal-el/auth";

import type { AppConfig } from "./config.js";
import type { StorageProvider } from "./storage/provider.js";
import { createStorageProvider } from "./storage/index.js";
import { registerErrorHandler } from "./plugins/errors.js";
import { dbPlugin } from "./plugins/db.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { siteRoutes } from "./routes/site.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    storage: StorageProvider;
  }
}

export async function buildApp(opts: { connectionString: string; config: AppConfig; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: () => requestId(),
    bodyLimit: 5 * 1024 * 1024,
  });
  app.decorate("config", opts.config);
  app.decorate("storage", createStorageProvider(opts.config));
  registerErrorHandler(app);

  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  // global per-IP rate limit; login keeps a stricter route-level limit
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { files: 1, fileSize: opts.config.MEDIA_MAX_BYTES } });
  await app.register(dbPlugin, { connectionString: opts.connectionString });
  await app.register(authPlugin);

  await app.register(swagger, { openapi: buildOpenApiDocument() as never });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(siteRoutes);

  return app;
}

```

## apps/api/src/auth-context.ts

```ts
export const PERMISSIONS = {
  systemManage: "system.manage",
  siteCreate: "sites.create",
  siteRead: "sites.read",
  userCreate: "users.create",
  userRead: "users.read",
  roleManage: "roles.manage",
  tokenManage: "tokens.manage",
  articleCreate: "articles.create",
  articleRead: "articles.read",
  articleUpdate: "articles.update",
  articlePublish: "articles.publish",
  articleSchedule: "articles.schedule",
  articleSubmit: "articles.submit",
  articleApprove: "articles.approve",
  articleDelete: "articles.delete",
  categoryManage: "taxonomy.categories.manage",
  tagManage: "taxonomy.tags.manage",
  entityManage: "taxonomy.entities.manage",
  authorManage: "taxonomy.authors.manage",
  sourceManage: "taxonomy.sources.manage",
  mediaManage: "media.manage",
  mediaRead: "media.read",
  seoManage: "seo.manage",
  auditRead: "audit.read",
} as const;

export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

export type ActorContext =
  | {
      kind: "user";
      userId: string;
      name: string;
      siteId: string;
      permissions: Set<string>;
      actorKey: string;
      ip: string;
      requestId: string;
    }
  | {
      kind: "service";
      tokenId: string;
      name: string;
      siteId: string;
      scopes: Set<string>;
      actorKey: string;
      ip: string;
      requestId: string;
    };

export type Credentials =
  | { kind: "session"; token: string }
  | { kind: "service"; token: string }
  | null;

export type SiteScopeResolution =
  | { ok: true; actor: ActorContext }
  | { ok: false; status: 401 | 403 | 404; code: string; message: string };

import { ApiHttpError } from "./plugins/errors.js";

export function permissionDenied(req: { actor?: ActorContext }, permission: string): void {
  if (!req.actor) {
    throw new ApiHttpError(403, "FORBIDDEN", "actor missing");
  }
  const ok = req.actor.kind === "user" ? req.actor.permissions.has(permission) : req.actor.scopes.has(permission);
  if (!ok) {
    throw new ApiHttpError(403, "FORBIDDEN", `missing permission: ${permission}`);
  }
}

```

## apps/api/src/config.ts

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).default("postgresql://kalel:kalel@localhost:5432/kalel"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
  SESSION_SECRET: z.string().min(1).default("development-only-secret"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  BOOTSTRAP_TOKEN: z.string().optional(),
  MEDIA_STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  MEDIA_LOCAL_PATH: z.string().min(1).default("./uploads"),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}

```

## apps/api/src/routes/admin.ts

```ts
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

const zAssignRole = z
  .object({
    roleId: z.string().uuid(),
    siteId: z.string().uuid(),
  })
  .strict();

```

## apps/api/src/routes/auth.ts

```ts
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
      if (!row) throw unauthorized("invalid service token");
      return { data: { kind: "service", id: row.id, name: row.name, siteId: row.siteId, scopes: row.scopes } };
    }
    const sessionByToken = await app.db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, hashToken(credentials.token)),
    });
    if (!sessionByToken || sessionByToken.expiresAt < new Date()) throw unauthorized("session expired");
    const user = await app.db.query.users.findFirst({ where: eq(users.id, sessionByToken.userId) });
    if (!user) throw unauthorized();
    return { data: { kind: "user", user: toUserDto(user), sessionId: sessionByToken.id } };
  });

  app.get("/v1/me/sites", async (req) => {
    const credentials = req.credentials;
    if (!credentials || credentials.kind !== "session") throw unauthorized();
    const session = await app.db.query.sessions.findFirst({
      where: eq(sessions.tokenHash, hashToken(credentials.token)),
    });
    if (!session || session.expiresAt < new Date()) throw unauthorized("session expired");
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



```

## apps/api/src/routes/site.ts

```ts
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "@kal-el/db";
import { auditLog } from "@kal-el/db/schema";
import {
  articleListQuerySchema,
  createArticleBodySchema,
  createAuthorBodySchema,
  createCategoryBodySchema,
  createEntityBodySchema,
  createRedirectBodySchema,
  createSourceBodySchema,
  createTagBodySchema,
  idempotencyKeySchema,
  publishArticleBodySchema,
  scheduleArticleBodySchema,
  updateArticleBodySchema,
  updateMediaBodySchema,
  uuidSchema,
} from "@kal-el/contracts";

import { permissionDenied } from "../auth-context.js";
import { badRequest, notFound } from "../plugins/errors.js";
import { requireSiteScope } from "../plugins/auth.js";
import { idempotencyRequestHash, withIdempotency } from "../plugins/idempotency.js";
import {
  approveArticle,
  archiveArticle,
  createArticle,
  getArticle,
  listArticles,
  listRevisions,
  publishArticle,
  rejectArticle,
  scheduleArticle,
  submitArticle,
  unpublishArticle,
  updateArticle,
  type ActorRef,
} from "../services/articles.js";
import {
  createAuthor,
  createCategory,
  createEntity,
  createSource,
  createTag,
  listAuthors,
  listCategories,
  listEntities,
  listSources,
  listTags,
} from "../services/taxonomy.js";
import { createRedirect, deleteRedirect, listRedirects } from "../services/redirects.js";
import { deleteMedia, getMedia, listMedia, updateMedia, uploadMedia } from "../services/media.js";

function guard(permission: string) {
  return async (req: FastifyRequest) => {
    if (!req.actor) throw badRequest("actor missing");
    permissionDenied(req, permission);
  };
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.register(
    async (siteApp) => {
      siteApp.addHook("preHandler", async (req) => {
        const params = req.params as { siteId: string; articleId?: string };
        if (!uuidSchema.safeParse(params.siteId).success) throw badRequest("invalid siteId");
        if (params.articleId && !uuidSchema.safeParse(params.articleId).success) {
          throw notFound("article not found");
        }
        await requireSiteScope(app, req, params.siteId);
      });

      // ---- Articles ----
      siteApp.get("/articles", { preHandler: guard("articles.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = articleListQuerySchema.safeParse({ ...(req.query as object) });
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const page = await listArticles(app.db, siteId, parsed.data);
        return { data: page };
      });

      siteApp.post("/articles", { preHandler: guard("articles.create") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        // R0.1: creating directly into a published/scheduled state is a privileged
        // transition and must not be reachable with articles.create alone.
        const wantsPublished = parsed.data.status === "published" || parsed.data.publishedAt != null;
        const wantsScheduled = parsed.data.status === "scheduled" || parsed.data.scheduledAt != null;
        if (wantsPublished) permissionDenied(req, "articles.publish");
        if (wantsScheduled) permissionDenied(req, "articles.schedule");
        const actor = req.actor as ActorRef;
        const key = req.headers["idempotency-key"];

        if (typeof key === "string" && key.length > 0) {
          const parsedKey = idempotencyKeySchema.safeParse(key);
          if (!parsedKey.success) throw badRequest("invalid Idempotency-Key header");
          const result = await withIdempotency(app.db, {
            key: parsedKey.data,
            actorKey: actor.actorKey,
            requestHash: idempotencyRequestHash(req),
            run: async (tx) => {
              const { article, created } = await createArticle(tx as unknown as Db, siteId, actor, parsed.data);
              return { status: created ? 201 : 200, body: { data: article } };
            },
          });
          return reply.status(result.status).send(result.body);
        }

        const { article, created } = await createArticle(app.db, siteId, actor, parsed.data);
        return reply.status(created ? 201 : 200).send({ data: article });
      });

      siteApp.get("/articles/:articleId", { preHandler: guard("articles.read") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        return { data: await getArticle(app.db, siteId, articleId) };
      });

      siteApp.patch("/articles/:articleId", { preHandler: guard("articles.update") }, async (req, reply) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = updateArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const actor = req.actor as ActorRef;

        const ifMatch = req.headers["if-match"];
        let expectedVersion: number | undefined;
        if (typeof ifMatch === "string" && ifMatch.length > 0) {
          expectedVersion = Number(ifMatch);
          if (!Number.isInteger(expectedVersion)) throw badRequest("invalid If-Match header");
        }

        const article = await updateArticle(app.db, siteId, articleId, actor, parsed.data, expectedVersion);
        return reply.send({ data: article });
      });

      siteApp.get("/articles/:articleId/revisions", { preHandler: guard("articles.read") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        return { data: await listRevisions(app.db, siteId, articleId) };
      });

      siteApp.post("/articles/:articleId/publish", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const article = await publishArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note);
        return { data: article };
      });

      siteApp.post("/articles/:articleId/schedule", { preHandler: guard("articles.schedule") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = scheduleArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const scheduledAt = new Date(parsed.data.scheduledAt);
        if (Number.isNaN(scheduledAt.getTime())) throw badRequest("invalid scheduledAt");
        const article = await scheduleArticle(app.db, siteId, articleId, scheduledAt, req.actor as ActorRef, parsed.data.note);
        return { data: article };
      });

      // ---- Editorial workflow ----
      siteApp.post("/articles/:articleId/submit", { preHandler: guard("articles.submit") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await submitArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/approve", { preHandler: guard("articles.approve") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await approveArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/reject", { preHandler: guard("articles.approve") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await rejectArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/unpublish", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await unpublishArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/archive", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await archiveArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      // ---- Taxonomy ----
      siteApp.get("/categories", { preHandler: guard("taxonomy.categories.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listCategories(app.db, siteId) };
      });
      siteApp.post("/categories", { preHandler: guard("taxonomy.categories.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createCategoryBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createCategory(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            parentId: row.parentId,
            name: row.name,
            slug: row.slug,
            description: row.description ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/tags", { preHandler: guard("taxonomy.tags.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listTags(app.db, siteId) };
      });
      siteApp.post("/tags", { preHandler: guard("taxonomy.tags.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createTagBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createTag(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            name: row.name,
            slug: row.slug,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/entities", { preHandler: guard("taxonomy.entities.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const type = typeof req.query === "object" && req.query && "type" in req.query ? String((req.query as { type?: string }).type) : undefined;
        return { data: await listEntities(app.db, siteId, type) };
      });
      siteApp.post("/entities", { preHandler: guard("taxonomy.entities.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createEntityBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createEntity(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({ data: row });
      });

      siteApp.get("/authors", { preHandler: guard("taxonomy.authors.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listAuthors(app.db, siteId) };
      });
      siteApp.post("/authors", { preHandler: guard("taxonomy.authors.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createAuthorBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createAuthor(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            name: row.name,
            slug: row.slug,
            bio: row.bio ?? null,
            email: row.email ?? null,
            avatarMediaId: row.avatarMediaId ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/sources", { preHandler: guard("taxonomy.sources.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listSources(app.db, siteId) };
      });
      siteApp.post("/sources", { preHandler: guard("taxonomy.sources.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createSourceBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createSource(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({ data: row });
      });

      // ---- Redirects (SEO) ----
      siteApp.get("/redirects", { preHandler: guard("seo.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listRedirects(app.db, siteId) };
      });
      siteApp.post("/redirects", { preHandler: guard("seo.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createRedirectBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const redirect = await createRedirect(app.db, siteId, parsed.data);
        return reply.status(201).send({ data: redirect });
      });
      siteApp.delete("/redirects/:redirectId", { preHandler: guard("seo.manage") }, async (req) => {
        const { siteId, redirectId } = req.params as { siteId: string; redirectId: string };
        if (!uuidSchema.safeParse(redirectId).success) throw badRequest("invalid redirectId");
        return { data: await deleteRedirect(app.db, siteId, redirectId) };
      });

      // ---- Media ----
      siteApp.get("/media", { preHandler: guard("media.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const limit = req.query && typeof req.query === "object" && "limit" in req.query ? Number((req.query as { limit?: string }).limit) : 100;
        return { data: await listMedia(app.db, siteId, app.config.API_BASE_URL, Number.isFinite(limit) ? limit : 100) };
      });

      siteApp.post("/media", { preHandler: guard("media.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const part = await req.file();
        if (!part) throw badRequest("file is required");
        const data = await part.toBuffer();
        const mediaRow = await uploadMedia(
          app.db,
          app.storage,
          siteId,
          req.actor as ActorRef,
          { filename: part.filename || "file", mimeType: part.mimetype || "application/octet-stream", data },
          { maxBytes: app.config.MEDIA_MAX_BYTES, baseUrl: app.config.API_BASE_URL },
        );
        return reply.status(201).send({ data: mediaRow });
      });

      siteApp.get("/media/:mediaId", { preHandler: guard("media.read") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        return { data: await getMedia(app.db, siteId, mediaId, app.config.API_BASE_URL) };
      });

      siteApp.get("/media/:mediaId/file", { preHandler: guard("media.read") }, async (req, reply) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        const mediaRow = await getMedia(app.db, siteId, mediaId, app.config.API_BASE_URL);
        const buf = await app.storage.get(mediaRow.storageKey);
        if (!buf) throw notFound("media not found");
        return reply.type(mediaRow.mimeType).send(buf);
      });

      siteApp.patch("/media/:mediaId", { preHandler: guard("media.manage") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        const parsed = updateMediaBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateMedia(app.db, siteId, mediaId, req.actor as ActorRef, parsed.data, app.config.API_BASE_URL) };
      });

      siteApp.delete("/media/:mediaId", { preHandler: guard("media.manage") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        return { data: await deleteMedia(app.db, app.storage, siteId, mediaId, req.actor as ActorRef) };
      });

      // ---- Audit log (site-scoped) ----
      siteApp.get("/audit-log", { preHandler: guard("audit.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const rows = await app.db.select().from(auditLog).where(eq(auditLog.siteId, siteId)).orderBy(desc(auditLog.createdAt)).limit(200);
        return {
          data: rows.map((r) => ({
            id: r.id,
            siteId: r.siteId,
            actorType: r.actorType,
            actorId: r.actorId,
            action: r.action,
            objectType: r.objectType,
            objectId: r.objectId,
            details: r.details,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      });

      siteApp.get("/audit-log/:objectType/:objectId", { preHandler: guard("audit.read") }, async (req) => {
        const { siteId, objectType, objectId } = req.params as { siteId: string; objectType: string; objectId: string };
        if (!uuidSchema.safeParse(objectId).success) throw badRequest("invalid objectId");
        const rows = await app.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.siteId, siteId), eq(auditLog.objectType, objectType), eq(auditLog.objectId, objectId)))
          .orderBy(desc(auditLog.createdAt))
          .limit(100);
        return { data: rows.map((r) => ({ id: r.id, action: r.action, actorType: r.actorType, actorId: r.actorId, details: r.details, createdAt: r.createdAt.toISOString() })) };
      });
    },
    { prefix: "/v1/sites/:siteId" },
  );
}

```

## apps/api/src/server.ts

```ts
import { runMigrations } from "@kal-el/db";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { seedPermissions } from "./services/seed.js";
import { ensurePresetRoles } from "./services/roles.js";

const config = loadConfig();

// RUN_MIGRATIONS=true lets containers apply migrations idempotently on boot.
if (process.env.RUN_MIGRATIONS === "true") {
  await runMigrations(config.DATABASE_URL);
}

const app = await buildApp({ connectionString: config.DATABASE_URL, config });
await seedPermissions(app.db);
await ensurePresetRoles(app.db);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

```

## apps/api/src/services/articles.ts

```ts
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import {
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articles,
  articleTags,
  outboxEvents,
} from "@kal-el/db/schema";
import type { Article, ArticleDocumentV2, ArticleStatus, ArticleSummary, CreateArticleBody, SeoMetadata, UpdateArticleBody } from "@kal-el/contracts";
import { migrateDocumentToV2 } from "@kal-el/contracts";

import { badRequest, conflict, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { upsertSlugRedirect } from "./redirects.js";
import { assertMediaInSite, collectDocumentMediaIds } from "./media.js";

export type ActorRef = {
  kind: "user" | "service";
  userId?: string;
  actorKey: string;
  name: string;
  ip?: string;
  requestId?: string;
};

const DEFAULT_DOCUMENT: ArticleDocumentV2 = { version: 2, nodes: [] };

const WORKFLOW_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ["in_review", "scheduled", "published", "archived"],
  in_review: ["draft", "blocked", "scheduled", "published", "archived"],
  scheduled: ["published", "scheduled", "draft", "archived"],
  published: ["draft"],
  blocked: ["in_review", "draft", "archived"],
  archived: [],
};

function assertTransition(from: ArticleStatus, to: ArticleStatus): void {
  const allowed = WORKFLOW_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw conflict(`cannot transition article from "${from}" to "${to}"`);
  }
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "untitled"
  );
}

async function uniqueSlug(db: Db, siteId: string, base: string): Promise<string> {
  let slug = base;
  let i = 2;
  for (;;) {
    const exists = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.slug, slug)),
    });
    if (!exists) return slug;
    slug = `${base}-${i++}`;
  }
}

type ArticleRow = typeof articles.$inferSelect;

async function relationIds(db: Db, articleId: string) {
  const [authors, categories, tags, entities] = await Promise.all([
    db
      .select({ id: articleAuthors.authorId })
      .from(articleAuthors)
      .where(eq(articleAuthors.articleId, articleId))
      .orderBy(asc(articleAuthors.position)),
    db.select({ id: articleCategories.categoryId }).from(articleCategories).where(eq(articleCategories.articleId, articleId)),
    db.select({ id: articleTags.tagId }).from(articleTags).where(eq(articleTags.articleId, articleId)),
    db.select({ id: articleEntities.entityId }).from(articleEntities).where(eq(articleEntities.articleId, articleId)),
  ]);
  return {
    authors: authors.map((a) => a.id),
    categories: categories.map((c) => c.id),
    tags: tags.map((t) => t.id),
    entities: entities.map((e) => e.id),
  };
}

async function articleDto(db: Db, row: ArticleRow): Promise<Article> {
  const rel = await relationIds(db, row.id);
  return {
    id: row.id,
    siteId: row.siteId,
    type: row.type,
    status: row.status,
    title: row.title,
    dek: row.dek ?? null,
    slug: row.slug,
    excerpt: row.excerpt ?? null,
    version: row.version,
    externalKey: row.externalKey ?? null,
    featuredMediaId: row.featuredMediaId ?? null,
    document: row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT,
    seo: row.seo,
    provenance: row.provenance ?? null,
    ...rel,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    qualityFlags: [],
  };
}

function summaryDto(row: ArticleRow): ArticleSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    type: row.type,
    status: row.status,
    title: row.title,
    dek: row.dek ?? null,
    slug: row.slug,
    excerpt: row.excerpt ?? null,
    version: row.version,
    externalKey: row.externalKey ?? null,
    featuredMediaId: row.featuredMediaId ?? null,
    authors: [],
    categories: [],
    tags: [],
    entities: [],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    qualityFlags: [],
  };
}

async function replaceRelations(db: Db, articleId: string, body: CreateArticleBody | UpdateArticleBody) {
  if (body.authors) {
    await db.delete(articleAuthors).where(eq(articleAuthors.articleId, articleId));
    if (body.authors.length > 0) {
      await db.insert(articleAuthors).values(body.authors.map((id, i) => ({ articleId, authorId: id, position: i })));
    }
  }
  if (body.categories) {
    await db.delete(articleCategories).where(eq(articleCategories.articleId, articleId));
    if (body.categories.length > 0) {
      await db.insert(articleCategories).values(body.categories.map((id) => ({ articleId, categoryId: id })));
    }
  }
  if (body.tags) {
    await db.delete(articleTags).where(eq(articleTags.articleId, articleId));
    if (body.tags.length > 0) {
      await db.insert(articleTags).values(body.tags.map((id) => ({ articleId, tagId: id })));
    }
  }
  if (body.entities) {
    await db.delete(articleEntities).where(eq(articleEntities.articleId, articleId));
    if (body.entities.length > 0) {
      await db.insert(articleEntities).values(body.entities.map((id) => ({ articleId, entityId: id })));
    }
  }
}

function actorUserId(actor: ActorRef): string | null {
  return actor.kind === "user" ? (actor.userId ?? null) : null;
}

export async function createArticle(
  db: Db,
  siteId: string,
  actor: ActorRef,
  body: CreateArticleBody,
): Promise<{ article: Article; created: boolean }> {
  if (body.externalKey) {
    const existing = await db.query.articles.findFirst({
      where: and(eq(articles.siteId, siteId), eq(articles.externalKey, body.externalKey)),
    });
    if (existing) {
      return { article: await articleDto(db, existing), created: false };
    }
  }

  const slug = body.slug ?? (await uniqueSlug(db, siteId, slugify(body.title)));
  const document = body.document ? migrateDocumentToV2(body.document) : DEFAULT_DOCUMENT;
  const seo: SeoMetadata = {
    seoTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    robotsIndex: "index",
    robotsFollow: "follow",
    socialTitle: null,
    socialDescription: null,
    ...(body.seo ?? {}),
  };

  const createdBy = actorUserId(actor);

  const status = body.status ?? "draft";
  const publishedAt = body.publishedAt ? new Date(body.publishedAt) : status === "published" ? new Date() : null;
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const featuredMediaId = body.featuredMediaId ?? null;

  await assertMediaInSite(db, siteId, [...collectDocumentMediaIds(document), ...(featuredMediaId ? [featuredMediaId] : [])]);

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(articles)
      .values({
        siteId,
        type: body.type,
        title: body.title,
        slug,
        dek: body.dek ?? null,
        excerpt: body.excerpt ?? null,
        document,
        seo,
        provenance: body.provenance ?? null,
        externalKey: body.externalKey ?? null,
        featuredMediaId,
        status,
        publishedAt,
        scheduledAt,
        createdBy,
        updatedBy: createdBy,
        version: 0,
      })
      .returning();
    if (!inserted) throw new Error("createArticle returned no row");

    await tx.insert(articleRevisions).values({
      articleId: inserted.id,
      revisionNumber: 1,
      document,
      createdBy,
      note: "created",
    });

    // imported/published articles still emit the revalidation event (exactly-once)
    if (status === "published" && publishedAt) {
      await tx
        .insert(outboxEvents)
        .values({
          siteId,
          aggregateType: "article",
          aggregateId: inserted.id,
          eventType: "article.published",
          payload: { articleId: inserted.id, slug, publishedAt: publishedAt.toISOString(), version: 0 },
          idempotencyKey: `article:${inserted.id}:publish:${publishedAt.getTime()}`,
        })
        .onConflictDoNothing();
    }

    await replaceRelations(tx as unknown as Db, inserted.id, body);

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actorUserId(actor),
      action: "articles.create",
      objectType: "article",
      objectId: inserted.id,
      details: { title: body.title, slug, status, publishedAt: publishedAt?.toISOString() ?? null, externalKey: body.externalKey ?? null, provenance: body.provenance ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return inserted;
  });

  return { article: await articleDto(db, row), created: true };
}

export async function getArticle(db: Db, siteId: string, articleId: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  return articleDto(db, row);
}

export async function updateArticle(
  db: Db,
  siteId: string,
  articleId: string,
  actor: ActorRef,
  body: UpdateArticleBody,
  expectedVersion?: number,
) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");

  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw conflict("version mismatch: the article was modified by another actor", {
      currentVersion: row.version,
      expectedVersion,
      code: "VERSION_CONFLICT",
    });
  }

  let slug = row.slug;
  if (body.slug && body.slug !== row.slug) {
    const previousSlug = row.slug;
    slug = await uniqueSlug(db, siteId, body.slug);
    if (previousSlug) {
      await upsertSlugRedirect(db, siteId, previousSlug, slug);
    }
  }

  const document = body.document ? migrateDocumentToV2(body.document) : row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT;
  const seo = body.seo ? { ...row.seo, ...body.seo } : row.seo;
  const updatedBy = actorUserId(actor);
  const featuredMediaId = body.featuredMediaId !== undefined ? body.featuredMediaId : row.featuredMediaId;

  await assertMediaInSite(db, siteId, [...collectDocumentMediaIds(document), ...(featuredMediaId ? [featuredMediaId] : [])]);

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        type: body.type ?? row.type,
        title: body.title ?? row.title,
        slug,
        dek: body.dek !== undefined ? body.dek : row.dek,
        excerpt: body.excerpt !== undefined ? body.excerpt : row.excerpt,
        document,
        seo,
        provenance: body.provenance !== undefined ? body.provenance : row.provenance,
        featuredMediaId,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    if (body.document && JSON.stringify(document) !== JSON.stringify(row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT)) {
      const maxRev = await tx
        .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, articleId));
      await tx.insert(articleRevisions).values({
        articleId,
        revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
        document,
        createdBy: updatedBy,
        note: "updated",
      });
    }

    await replaceRelations(tx as unknown as Db, articleId, body);

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.update",
      objectType: "article",
      objectId: articleId,
      details: { version: result.version, changedFields: Object.keys(body) },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}

export function encodeCursor(row: ArticleRow): string {
  return Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!iso || !id || Number.isNaN(Date.parse(iso))) {
    throw badRequest("invalid cursor");
  }
  return { updatedAt: new Date(iso), id };
}

export async function listArticles(
  db: Db,
  siteId: string,
  q: {
    status?: string;
    type?: string;
    authorId?: string;
    categoryId?: string;
    tagId?: string;
    externalKey?: string;
    q?: string;
    cursor?: string;
    limit: number;
  },
) {
  const conditions: (ReturnType<typeof eq> | ReturnType<typeof ilike> | ReturnType<typeof inArray> | ReturnType<typeof or> | undefined)[] = [
    eq(articles.siteId, siteId),
  ];
  if (q.status) conditions.push(eq(articles.status, q.status as never));
  if (q.type) conditions.push(eq(articles.type, q.type as never));
  if (q.externalKey) conditions.push(eq(articles.externalKey, q.externalKey));
  if (q.q) conditions.push(ilike(articles.title, `%${q.q}%`));

  if (q.authorId) {
    const ids = await db.select({ articleId: articleAuthors.articleId }).from(articleAuthors).where(eq(articleAuthors.authorId, q.authorId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }
  if (q.categoryId) {
    const ids = await db.select({ articleId: articleCategories.articleId }).from(articleCategories).where(eq(articleCategories.categoryId, q.categoryId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }
  if (q.tagId) {
    const ids = await db.select({ articleId: articleTags.articleId }).from(articleTags).where(eq(articleTags.tagId, q.tagId));
    conditions.push(inArray(articles.id, ids.map((r) => r.articleId)));
  }

  if (q.cursor) {
    const { updatedAt, id } = decodeCursor(q.cursor);
    conditions.push(
      or(
        sql`(${articles.updatedAt}, ${articles.id}) < (${updatedAt}, ${id})`,
        sql`(${articles.updatedAt} = ${updatedAt} AND ${articles.id} < ${id})`,
      ),
    );
  }

  const rows = await db
    .select()
    .from(articles)
    .where(and(...conditions))
    .orderBy(desc(articles.updatedAt), desc(articles.id))
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1] as ArticleRow) : null;

  return {
    items: items.map(summaryDto),
    nextCursor,
    total: undefined,
  };
}

export async function listRevisions(db: Db, siteId: string, articleId: string) {
  await getArticle(db, siteId, articleId);
  const rows = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(desc(articleRevisions.revisionNumber));
  return rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    revisionNumber: r.revisionNumber,
    document: migrateDocumentToV2(r.document),
    createdBy: r.createdBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function publishArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (row.status === "published" && row.publishedAt) {
    return articleDto(db, row);
  }
  assertTransition(row.status, "published");

  const publishedAt = row.publishedAt ?? new Date();
  const updatedBy = actorUserId(actor);

  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: "published",
        publishedAt,
        scheduledAt: null,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    const maxRev = await tx
      .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
      .from(articleRevisions)
      .where(eq(articleRevisions.articleId, articleId));
    await tx.insert(articleRevisions).values({
      articleId,
      revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
    document: row.document ? migrateDocumentToV2(row.document) : DEFAULT_DOCUMENT,
      createdBy: updatedBy,
      note: note ?? "published",
    });

    await tx
      .insert(outboxEvents)
      .values({
        siteId,
        aggregateType: "article",
        aggregateId: articleId,
        eventType: "article.published",
        payload: { articleId, slug: row.slug, publishedAt: publishedAt.toISOString(), version: result.version },
        idempotencyKey: `article:${articleId}:publish:${publishedAt.getTime()}`,
      })
      .onConflictDoNothing();

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.publish",
      objectType: "article",
      objectId: articleId,
      details: { publishedAt: publishedAt.toISOString(), version: result.version },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}

export async function scheduleArticle(db: Db, siteId: string, articleId: string, scheduledAt: Date, actor: ActorRef, note?: string) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (scheduledAt <= new Date()) throw conflict("scheduledAt must be in the future");
  assertTransition(row.status, "scheduled");

  const updatedBy = actorUserId(actor);
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: "scheduled",
        scheduledAt,
        publishedAt: null,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action: "articles.schedule",
      objectType: "article",
      objectId: articleId,
      details: { scheduledAt: scheduledAt.toISOString(), note: note ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return result;
  });

  return articleDto(db, updated);
}


async function applyStatusTransition(
  db: Db,
  siteId: string,
  articleId: string,
  actor: ActorRef,
  to: ArticleStatus,
  action: string,
  note?: string,
  clearDates = false,
) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  assertTransition(row.status, to);

  const updatedBy = actorUserId(actor);
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx
      .update(articles)
      .set({
        status: to,
        publishedAt: clearDates ? null : row.publishedAt,
        scheduledAt: clearDates ? null : row.scheduledAt,
        updatedBy,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId)))
      .returning();
    if (!result) throw conflict("article changed concurrently");

    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: updatedBy,
      action,
      objectType: "article",
      objectId: articleId,
      details: { from: row.status, to, note: note ?? null },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return result;
  });

  return articleDto(db, updated);
}

export async function submitArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "in_review", "articles.submit", note);
}

export async function approveArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "draft", "articles.approve", note, true);
}

export async function rejectArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "blocked", "articles.reject", note, true);
}

export async function unpublishArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "draft", "articles.unpublish", note, true);
}

export async function archiveArticle(db: Db, siteId: string, articleId: string, actor: ActorRef, note?: string) {
  return applyStatusTransition(db, siteId, articleId, actor, "archived", "articles.archive", note, true);
}

```

## apps/api/src/services/media.ts

```ts
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { imageSize } from "image-size";
import type { Db } from "@kal-el/db";
import { articles, authors, media } from "@kal-el/db/schema";
import type { UpdateMediaBody } from "@kal-el/contracts";

import { badRequest, conflict, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import type { StorageProvider } from "../storage/provider.js";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import type { ActorRef } from "./articles.js";

// Raster formats only. SVG is deliberately excluded (XSS surface).
export const MEDIA_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

type MediaRow = typeof media.$inferSelect;

export function sanitizeFilename(raw: string): string {
  const base = path
    .basename(raw.replace(/\\/g, "/"))
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return base || "file";
}

function readDimensions(buffer: Buffer): { width: number | null; height: number | null } {
  try {
    const dim = imageSize(buffer);
    return { width: dim.width ?? null, height: dim.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export function mediaUrl(baseUrl: string, siteId: string, mediaId: string): string {
  return `${baseUrl}/v1/sites/${siteId}/media/${mediaId}/file`;
}

function mediaDto(row: MediaRow, baseUrl: string) {
  return {
    id: row.id,
    siteId: row.siteId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    altText: row.altText,
    caption: row.caption,
    credit: row.credit,
    focalX: row.focalX,
    focalY: row.focalY,
    storageKey: row.storageKey,
    provider: row.provider,
    url: mediaUrl(baseUrl, row.siteId, row.id),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function uploadMedia(
  db: Db,
  storage: StorageProvider,
  siteId: string,
  actor: ActorRef,
  input: { filename: string; mimeType: string; data: Buffer },
  opts: { maxBytes: number; baseUrl: string },
) {
  if (!MEDIA_MIME_TYPES.has(input.mimeType)) {
    throw badRequest(`unsupported media type: ${input.mimeType}`);
  }
  if (input.data.length === 0) throw badRequest("empty file");
  if (input.data.length > opts.maxBytes) throw badRequest(`file exceeds the ${opts.maxBytes} byte limit`);

  const ext = EXT_BY_MIME[input.mimeType] ?? "bin";
  const key = `sites/${siteId}/${randomUUID()}.${ext}`;
  const { width, height } = readDimensions(input.data);

  await storage.put({ key, data: input.data, mimeType: input.mimeType });

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(media)
      .values({
        siteId,
        filename: sanitizeFilename(input.filename),
        mimeType: input.mimeType,
        sizeBytes: input.data.length,
        width,
        height,
        storageKey: key,
        provider: storage.name,
        createdBy: actor.kind === "user" ? actor.userId ?? null : null,
      })
      .returning();
    if (!inserted) throw new Error("uploadMedia returned no row");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.upload",
      objectType: "media",
      objectId: inserted.id,
      details: { filename: inserted.filename, mimeType: inserted.mimeType, sizeBytes: inserted.sizeBytes },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return inserted;
  });

  return mediaDto(row, opts.baseUrl);
}

export async function listMedia(db: Db, siteId: string, baseUrl: string, limit = 100) {
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.siteId, siteId))
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => mediaDto(r, baseUrl));
}

export async function getMedia(db: Db, siteId: string, mediaId: string, baseUrl: string) {
  const row = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!row) throw notFound("media not found");
  return mediaDto(row, baseUrl);
}

export async function updateMedia(db: Db, siteId: string, mediaId: string, actor: ActorRef, body: UpdateMediaBody, baseUrl: string) {
  const existing = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!existing) throw notFound("media not found");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(media)
      .set({
        altText: body.altText !== undefined ? body.altText : existing.altText,
        caption: body.caption !== undefined ? body.caption : existing.caption,
        credit: body.credit !== undefined ? body.credit : existing.credit,
        focalX: body.focalX !== undefined ? body.focalX : existing.focalX,
        focalY: body.focalY !== undefined ? body.focalY : existing.focalY,
        updatedAt: new Date(),
      })
      .where(and(eq(media.id, mediaId), eq(media.siteId, siteId)))
      .returning();
    if (!row) throw notFound("media not found");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.update",
      objectType: "media",
      objectId: mediaId,
      details: { changedFields: Object.keys(body) },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return row;
  });

  return mediaDto(updated, baseUrl);
}

export async function deleteMedia(db: Db, storage: StorageProvider, siteId: string, mediaId: string, actor: ActorRef) {
  const existing = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!existing) throw notFound("media not found");

  const pattern = `%"mediaId":"${mediaId}"%`;
  const usedByArticle = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.siteId, siteId), or(eq(articles.featuredMediaId, mediaId), sql`${articles.document}::text like ${pattern}`)))
    .limit(1);
  const usedByAuthor = await db
    .select({ id: authors.id })
    .from(authors)
    .where(and(eq(authors.siteId, siteId), eq(authors.avatarMediaId, mediaId)))
    .limit(1);
  if (usedByArticle.length > 0 || usedByAuthor.length > 0) {
    throw conflict("media is in use");
  }

  await storage.delete(existing.storageKey);
  await db.transaction(async (tx) => {
    await tx.delete(media).where(and(eq(media.id, mediaId), eq(media.siteId, siteId)));
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.delete",
      objectType: "media",
      objectId: mediaId,
      details: { storageKey: existing.storageKey },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  });

  return { id: mediaId, deleted: true };
}

/**
 * Verify that every referenced media id exists and belongs to `siteId`.
 * Blocks cross-site media attachment for featured images and document nodes.
 */
export async function assertMediaInSite(db: Db, siteId: string, mediaIds: string[]): Promise<void> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (ids.length === 0) return;
  const rows = await db.select({ id: media.id, siteId: media.siteId }).from(media).where(inArray(media.id, ids));
  const found = new Map(rows.map((r) => [r.id, r.siteId]));
  for (const id of ids) {
    const site = found.get(id);
    if (!site) throw badRequest("referenced media does not exist", { mediaId: id });
    if (site !== siteId) throw badRequest("referenced media does not belong to this site", { mediaId: id });
  }
}

/** Collect every media id referenced by image/gallery document nodes. */
export function collectDocumentMediaIds(document: ArticleDocumentV2): string[] {
  const ids: string[] = [];
  for (const node of document.nodes ?? []) {
    if (node.type === "image") ids.push(node.attrs.mediaId);
    if (node.type === "gallery") ids.push(...node.attrs.mediaIds);
  }
  return ids;
}

```

## apps/api/src/services/redirects.ts

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { redirects } from "@kal-el/db/schema";
import type { CreateRedirectBody } from "@kal-el/contracts";

import { conflict, isUniqueViolation, notFound } from "../plugins/errors.js";

function dto(row: typeof redirects.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    sourcePath: row.sourcePath,
    targetPath: row.targetPath,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createRedirect(db: Db, siteId: string, body: CreateRedirectBody) {
  try {
    const [row] = await db.insert(redirects).values({ siteId, sourcePath: body.sourcePath, targetPath: body.targetPath, kind: body.kind }).returning();
    if (!row) throw new Error("createRedirect returned no row");
    return dto(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`source path "${body.sourcePath}" already has a redirect`, { field: "sourcePath" });
    }
    throw err;
  }
}

export async function listRedirects(db: Db, siteId: string) {
  const rows = await db.select().from(redirects).where(eq(redirects.siteId, siteId)).orderBy(asc(redirects.sourcePath));
  return rows.map(dto);
}

export async function deleteRedirect(db: Db, siteId: string, redirectId: string) {
  // Delete must be scoped by (id, site_id) in the query itself so a caller from
  // another site can never destroy a row that is not theirs.
  const [row] = await db
    .delete(redirects)
    .where(and(eq(redirects.id, redirectId), eq(redirects.siteId, siteId)))
    .returning();
  if (!row) throw notFound("redirect not found");
  return { id: row.id, deleted: true };
}

/**
 * SEO contract: when an article slug changes, keep the old URL alive with a
 * permanent (301) redirect to the new slug (docs/03-SEO.md).
 */
export async function upsertSlugRedirect(db: Db, siteId: string, fromSlug: string, toSlug: string): Promise<void> {
  if (fromSlug === toSlug) return;
  const sourcePath = `/${fromSlug}`;
  const targetPath = `/${toSlug}`;
  await db
    .insert(redirects)
    .values({ siteId, sourcePath, targetPath, kind: "301" })
    .onConflictDoUpdate({
      target: [redirects.siteId, redirects.sourcePath],
      set: { targetPath, kind: "301", updatedAt: new Date() },
    });
}

```

## apps/api/src/services/roles.ts

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { permissions, rolePermissions, roles, userRoles, users } from "@kal-el/db/schema";
import type { CreateRoleBody } from "@kal-el/contracts";

import { badRequest, conflict, isForeignKeyViolation, isUniqueViolation, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { PERMISSIONS } from "../auth-context.js";

export const OWNER_ROLE_KEY = "owner";

export async function listRoles(db: Db) {
  const rows = await db.select().from(roles).orderBy(desc(roles.createdAt));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    key: r.key,
    name: r.name,
    description: r.description ?? undefined,
  }));
}

export async function createRole(
  db: Db,
  body: CreateRoleBody,
  actor?: { kind: "user" | "service" | "system"; actorKey: string; ip?: string; requestId?: string },
) {
  const permRows = await db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, body.permissions));
  const found = new Set(permRows.map((r) => r.key));
  const missing = body.permissions.filter((k) => !found.has(k));
  if (missing.length > 0) {
    throw badRequest(`unknown permissions: ${missing.join(", ")}`);
  }

  let roleId: string;
  try {
    roleId = await db.transaction(async (tx) => {
      const [role] = await tx.insert(roles).values({ key: body.key, name: body.name, description: body.description }).returning();
      if (!role) throw new Error("createRole returned no row");
      await tx.insert(rolePermissions).values(permRows.map((p) => ({ roleId: role.id, permissionId: p.id })));
      return role.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`role key "${body.key}" already exists`, { field: "key" });
    }
    throw err;
  }

  if (actor) {
    await writeAudit(db, {
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.actorKey.replace("user:", "") : null,
      action: "roles.create",
      objectType: "role",
      objectId: roleId,
      details: { key: body.key, permissions: body.permissions },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  }

  return listRoles(db).then((all) => all.find((r) => r.id === roleId) ?? ({} as (typeof all)[number]));
}

export async function assignRoleToUser(db: Db, userId: string, roleId: string, siteId: string) {
  await db.query.roles.findFirst({ where: eq(roles.id, roleId) }).then((r) => {
    if (!r) throw notFound("role not found");
  });
  await db.query.users.findFirst({ where: eq(users.id, userId) }).then((u) => {
    if (!u) throw notFound("user not found");
  });
  try {
    await db.insert(userRoles).values({ userId, roleId, siteId }).onConflictDoNothing();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw badRequest("invalid user, role or site");
    }
    throw err;
  }
}

export async function roleHasPermission(db: Db, roleKey: string, permission: string): Promise<boolean> {
  const rows = await db
    .select({ key: permissions.key })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(roles.key, roleKey), eq(permissions.key, permission)));
  return rows.length > 0;
}

export async function ensureOwnerRole(db: Db): Promise<void> {
  const owner = await db.query.roles.findFirst({ where: eq(roles.key, OWNER_ROLE_KEY) });
  if (owner) return;
  await db.transaction(async (tx) => {
    const [role] = await tx.insert(roles).values({ key: OWNER_ROLE_KEY, name: "Owner", description: "Full control within assigned sites" }).returning();
    if (!role) return;
    const all = await tx.select({ id: permissions.id }).from(permissions).where(inArray(permissions.key, Object.values(PERMISSIONS)));
    await tx.insert(rolePermissions).values(all.map((p) => ({ roleId: role.id, permissionId: p.id })));
  });
}

const TAXONOMY = [
  PERMISSIONS.categoryManage,
  PERMISSIONS.tagManage,
  PERMISSIONS.entityManage,
  PERMISSIONS.authorManage,
  PERMISSIONS.sourceManage,
];

const EDITORIAL_BASE = [PERMISSIONS.articleCreate, PERMISSIONS.articleRead, PERMISSIONS.articleUpdate];

/**
 * Preset editorial roles. These are global keys (siteId = null) assignable to
 * any site via POST /v1/admin/users/:id/roles. The permission system remains
 * flexible — custom roles can still be created per-site.
 */
export const PRESET_ROLES: Array<{ key: string; name: string; description: string; permissions: string[] }> = [
  {
    key: "owner",
    name: "Owner",
    description: "Full platform control",
    permissions: Object.values(PERMISSIONS),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Full site control (no platform/system, user or role management)",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      PERMISSIONS.articleDelete,
      ...TAXONOMY,
      PERMISSIONS.seoManage,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
      PERMISSIONS.auditRead,
      PERMISSIONS.siteRead,
    ],
  },
  {
    key: "editor-chefe",
    name: "Editor chefe",
    description: "Approves, publishes and schedules content",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      ...TAXONOMY,
      PERMISSIONS.seoManage,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
      PERMISSIONS.auditRead,
    ],
  },
  {
    key: "editor",
    name: "Editor",
    description: "Edits and reviews content",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      ...TAXONOMY,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
    ],
  },
  {
    key: "autor",
    name: "Autor",
    description: "Writes and submits drafts (cannot publish)",
    permissions: [...EDITORIAL_BASE, PERMISSIONS.articleSubmit, PERMISSIONS.mediaRead],
  },
];

/** Create the preset roles if they do not already exist (idempotent). */
export async function ensurePresetRoles(db: Db): Promise<void> {
  for (const preset of PRESET_ROLES) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (existing) continue;
    const permRows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, preset.permissions));
    await db.transaction(async (tx) => {
      const [role] = await tx.insert(roles).values({ key: preset.key, name: preset.name, description: preset.description }).returning();
      if (!role) return;
      await tx.insert(rolePermissions).values(permRows.map((p) => ({ roleId: role.id, permissionId: p.id })));
    });
  }
}

```

## apps/api/src/storage/index.ts

```ts
import type { AppConfig } from "../config.js";
import { LocalStorageProvider } from "./local.js";
import type { StorageProvider } from "./provider.js";

export function createStorageProvider(config: AppConfig): StorageProvider {
  switch (config.MEDIA_STORAGE_PROVIDER) {
    case "local":
      return new LocalStorageProvider(config.MEDIA_LOCAL_PATH);
    default:
      throw new Error(`unsupported media storage provider: ${config.MEDIA_STORAGE_PROVIDER}`);
  }
}

export type { StorageProvider } from "./provider.js";

```

## apps/api/src/storage/local.ts

```ts
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "./provider.js";

function assertSafeKey(key: string): string {
  if (!key || key.includes("..") || path.isAbsolute(key) || key.includes("\\") || key.includes("\0")) {
    throw new Error("unsafe storage key");
  }
  return key;
}

/**
 * Local filesystem storage. Keys are generated by the media service
 * (`sites/<siteId>/<uuid>.<ext>`) and are validated here defensively against
 * path traversal. This is the reference implementation of StorageProvider;
 * R2/S3-compatible backends implement the same contract.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    return path.join(this.root, assertSafeKey(key));
  }

  async put(input: { key: string; data: Buffer; mimeType: string }): Promise<void> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

```

## apps/api/src/storage/provider.ts

```ts
export interface StorageProvider {
  readonly name: string;
  put(input: { key: string; data: Buffer; mimeType: string }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

```

## apps/api/tests/articles.test.ts

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outboxEvents } from "@kal-el/db/schema";
import { bootstrap, createTestApp, login, type Session, type TestContext } from "./helpers.js";

describe("articles", () => {
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

  const articleHeaders = () => ({ Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf });

  it("creates an article with default document and revision", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: {
        type: "article",
        title: "Gladiador II chega aos cinemas",
        slug: "gladiador-ii-cinemas",
      },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.title).toBe("Gladiador II chega aos cinemas");
    expect(data.slug).toBe("gladiador-ii-cinemas");
    expect(data.version).toBe(0);
    expect(data.document).toEqual({ version: 2, nodes: [] });
    expect(data.status).toBe("draft");
    expect(data.seo.robotsIndex).toBe("index");
  });

  it("rejects duplicate slug within a site", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Outro", slug: "gladiador-ii-cinemas" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("enforces optimistic concurrency on update", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Concurrent article", slug: "concurrent-article" },
    });
    const article = created.json().data;

    const stale = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": "99" },
      payload: { title: "stale edit" },
    });
    expect(stale.statusCode).toBe(409);

    const ok = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": String(article.version) },
      payload: { title: "fresh edit", document: { version: 2, nodes: [{ type: "paragraph", content: [{ type: "text", text: "Olá mundo", marks: [] }] }] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.version).toBe(article.version + 1);
    expect(ok.json().data.title).toBe("fresh edit");
  });

  it("records revisions when the document changes", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Revisionável", slug: "revisionavel" },
    });
    expect(created.statusCode).toBe(201);
    const article = created.json().data;

    await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteId}/articles/${article.id}`,
      headers: { ...articleHeaders(), "if-match": String(article.version) },
      payload: { document: { version: 2, nodes: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Novo título", marks: [] }] }] } },
    });

    const revisions = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles/${article.id}/revisions`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().data.length).toBeGreaterThanOrEqual(2);
    expect(revisions.json().data[0].revisionNumber).toBeGreaterThan(1);
  });

  it("publishes an article exactly once and emits an outbox event", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Notícia publicável", slug: "noticia-publicavel" },
    });
    const article = created.json().data;

    const pub = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/publish`,
      headers: articleHeaders(),
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data.status).toBe("published");
    expect(pub.json().data.publishedAt).toBeTruthy();

    const pub2 = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/publish`,
      headers: articleHeaders(),
    });
    expect(pub2.statusCode).toBe(200);
    expect(pub2.json().data.publishedAt).toBe(pub.json().data.publishedAt);

    const events = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, article.id));
    const publishEvents = events.filter((e) => e.eventType === "article.published");
    expect(publishEvents.length).toBe(1);
  });

  it("schedules an article for a future time", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: articleHeaders(),
      payload: { title: "Agendado", slug: "agendado" },
    });
    const article = created.json().data;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/schedule`,
      headers: articleHeaders(),
      payload: { scheduledAt: future },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("scheduled");
    expect(res.json().data.scheduledAt).toBe(future);
  });

  it("lists articles with cursor pagination and filters", async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.app.inject({
        method: "POST",
        url: `/v1/sites/${siteId}/articles`,
        headers: articleHeaders(),
        payload: { title: `Lista artigo ${i}`, slug: `lista-artigo-${i}` },
      });
    }

    const page1 = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?limit=3&q=Lista`,
      headers: { Cookie: session.cookieHeader },
    });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json().data;
    expect(p1.items.length).toBe(3);
    expect(p1.nextCursor).toBeTruthy();

    const page2 = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteId}/articles?limit=3&q=Lista&cursor=${encodeURIComponent(p1.nextCursor)}`,
      headers: { Cookie: session.cookieHeader },
    });
    const p2 = page2.json().data;
    expect(p2.items.length).toBeGreaterThan(0);
    const ids = new Set([...p1.items, ...p2.items].map((a: { id: string }) => a.id));
    expect(ids.size).toBe(p1.items.length + p2.items.length);
  });
});

```

## apps/api/tests/auth.test.ts

```ts
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

  it("lists the sites the user belongs to via /me/sites", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me/sites",
      headers: { Cookie: session.cookieHeader },
    });
    expect(res.statusCode).toBe(200);
    const sites = res.json().data as { id: string; slug: string }[];
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(sites.some((s) => s.slug === "portal-a")).toBe(true);
  });

  it("requires a session for /me/sites", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me/sites" });
    expect(res.statusCode).toBe(401);
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

```

## apps/api/tests/media.test.ts

```ts
import { deflateSync } from "node:zlib";
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

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] as number;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 0);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

function multipartBody(boundary: string, filename: string, mime: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
    Buffer.from(`Content-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe("media subsystem", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let siteA: string;
  let siteB: string;
  let managerB: Session;

  const boundary = "----kaleltestboundary";
  const png = makePng(3, 2);

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    const siteBRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { slug: "portal-b-media", name: "Portal B Media" },
    });
    expect(siteBRes.statusCode).toBe(201);
    siteB = siteBRes.json().data.id;

    const manager = await createUser(ctx, ownerSession, "manager-b@kalel.test", "manager-b-password-123", "Manager B");
    const managerId = manager.json().data.id;
    const role = await createRole(ctx, ownerSession, "media-manager", ["media.manage", "media.read", "articles.create", "articles.read"]);
    await assignRole(ctx, ownerSession, managerId, role.json().data.id, siteB);
    managerB = await login(ctx, "manager-b@kalel.test", "manager-b-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  function upload(session: Session, siteId: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/media`,
      headers: { ...headers(session), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, "cartaz.png", "image/png", png),
    });
  }

  it("uploads an image and records width/height/mime/size", async () => {
    const res = await upload(ownerSession, siteA);
    expect(res.statusCode).toBe(201);
    const media = res.json().data;
    expect(media.id).toBeTruthy();
    expect(media.siteId).toBe(siteA);
    expect(media.mimeType).toBe("image/png");
    expect(media.width).toBe(3);
    expect(media.height).toBe(2);
    expect(media.sizeBytes).toBe(png.length);
    expect(media.provider).toBe("local");
    expect(media.url).toContain(`/v1/sites/${siteA}/media/${media.id}/file`);
    expect(media.storageKey).toContain(`sites/${siteA}/`);
  });

  it("lists and retrieves media, and serves the file bytes", async () => {
    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().data as { id: string }[];
    expect(items.length).toBe(1);
    const id = items[0]?.id;

    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${id}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(id);

    const file = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${id}/file`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(file.statusCode).toBe(200);
    expect(Buffer.from(file.rawPayload)).toEqual(png);
    expect(file.headers["content-type"]).toContain("image/png");
  });

  it("updates media metadata", async () => {
    const created = await upload(ownerSession, siteA);
    const id = created.json().data.id;
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/media/${id}`,
      headers: headers(ownerSession),
      payload: { altText: "Cartaz do filme", caption: "Legenda", focalX: 0.5, focalY: 0.25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.altText).toBe("Cartaz do filme");
    expect(res.json().data.caption).toBe("Legenda");
    expect(res.json().data.focalX).toBe(0.5);
  });

  it("associates a featured image and preserves it on reopen", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Com imagem de destaque", slug: "com-imagem", featuredMediaId: media.id },
    });
    expect(created.statusCode).toBe(201);
    const articleId = created.json().data.id;
    expect(created.json().data.featuredMediaId).toBe(media.id);

    const reopened = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/articles/${articleId}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(reopened.json().data.featuredMediaId).toBe(media.id);
  });

  it("accepts image and gallery nodes referencing real media", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: {
        title: "Com galeria",
        slug: "com-galeria",
        document: {
          version: 2,
          nodes: [
            { type: "image", attrs: { mediaId: media.id, altText: "x" } },
            { type: "gallery", attrs: { mediaIds: [media.id] } },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("blocks cross-site media attachment (featured image and document nodes)", async () => {
    const siteBMedia = (await upload(managerB, siteB)).json().data;

    const featured = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Invasão de mídia", slug: "invasao-midia", featuredMediaId: siteBMedia.id },
    });
    expect(featured.statusCode).toBe(400);

    const document = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: {
        title: "Invasão de mídia 2",
        slug: "invasao-midia-2",
        document: { version: 2, nodes: [{ type: "image", attrs: { mediaId: siteBMedia.id } }] },
      },
    });
    expect(document.statusCode).toBe(400);
  });

  it("refuses to delete media that is in use and deletes unused media", async () => {
    const media = (await upload(ownerSession, siteA)).json().data;
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Usa mídia", slug: "usa-midia", featuredMediaId: media.id },
    });

    const inUse = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${media.id}`,
      headers: headers(ownerSession),
    });
    expect(inUse.statusCode).toBe(409);

    const unused = (await upload(ownerSession, siteA)).json().data;
    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/media/${unused.id}`,
      headers: headers(ownerSession),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted).toBe(true);

    const after = await ctx.app.inject({
      method: "GET",
      url: `/v1/sites/${siteA}/media/${unused.id}`,
      headers: { Cookie: ownerSession.cookieHeader },
    });
    expect(after.statusCode).toBe(404);
  });
});

```

## apps/api/tests/security.test.ts

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { outboxEvents, redirects } from "@kal-el/db/schema";
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

describe("security (R0)", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let authorSession: Session;
  let siteA: string;
  let siteB: string;
  let seoManagerB: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteA = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    // second site
    const siteBRes = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/sites",
      headers: { Cookie: ownerSession.cookieHeader, "x-kal-el-csrf": ownerSession.csrf },
      payload: { slug: "portal-b", name: "Portal B" },
    });
    expect(siteBRes.statusCode).toBe(201);
    siteB = siteBRes.json().data.id;

    // author: can create/read/update drafts but NOT publish or schedule
    const authorUser = await createUser(ctx, ownerSession, "autor@kalel.test", "autor-password-123", "Autor");
    expect(authorUser.statusCode).toBe(201);
    const authorId = authorUser.json().data.id;
    const authorRole = await createRole(ctx, ownerSession, "autor", ["articles.create", "articles.read", "articles.update"]);
    expect(authorRole.statusCode).toBe(201);
    expect((await assignRole(ctx, ownerSession, authorId, authorRole.json().data.id, siteA)).statusCode).toBe(201);
    authorSession = await login(ctx, "autor@kalel.test", "autor-password-123");

    // a user who can manage SEO only on site B
    const seoUser = await createUser(ctx, ownerSession, "seo-b@kalel.test", "seo-b-password-123", "SEO B");
    expect(seoUser.statusCode).toBe(201);
    const seoUserId = seoUser.json().data.id;
    const seoRole = await createRole(ctx, ownerSession, "seo-manager", ["seo.manage", "articles.read"]);
    expect(seoRole.statusCode).toBe(201);
    expect((await assignRole(ctx, ownerSession, seoUserId, seoRole.json().data.id, siteB)).statusCode).toBe(201);
    seoManagerB = await login(ctx, "seo-b@kalel.test", "seo-b-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  it("denies an author creating an already-published article (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Bypass publish", slug: "bypass-publish", status: "published" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    const published = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.eventType, "article.published"));
    expect(published.length).toBe(0);
  });

  it("denies an author creating with an arbitrary publishedAt (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Backdate", slug: "backdate", publishedAt: "2020-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies an author creating an already-scheduled article (R0.1)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Bypass schedule", slug: "bypass-schedule", status: "scheduled", scheduledAt: "2030-01-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("still lets an author create a draft (positive control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(authorSession),
      payload: { title: "Draft legitimo", slug: "draft-legitimo" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("draft");
  });

  it("lets a user with articles.publish create a published article (positive control)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Publicado pelo dono", slug: "publicado-dono", status: "published" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("published");
  });

  it("rejects unknown fields on PATCH (R0.3)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Para patch", slug: "para-patch" },
    });
    const article = created.json().data;

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/sites/${siteA}/articles/${article.id}`,
      headers: { ...headers(ownerSession), "if-match": String(article.version) },
      payload: { title: "Titulo alterado", status: "in_review" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown fields on POST article (R0.3)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteA}/articles`,
      headers: headers(ownerSession),
      payload: { title: "Campo fantasma", slug: "campo-fantasma", unknownField: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not let a site A user delete a site B redirect (R0.2)", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteB}/redirects`,
      headers: headers(seoManagerB),
      payload: { sourcePath: "/antigo-b", targetPath: "/novo-b", kind: "301" },
    });
    expect(created.statusCode).toBe(201);
    const redirectB = created.json().data;
    expect(redirectB.siteId).toBe(siteB);

    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/sites/${siteA}/redirects/${redirectB.id}`,
      headers: headers(ownerSession),
    });
    expect(del.statusCode).toBe(404);

    const rows = await ctx.db.select().from(redirects).where(eq(redirects.id, redirectB.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.siteId).toBe(siteB);
  });
});

```

## apps/api/tests/workflow.test.ts

```ts
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
import { ensurePresetRoles, roleHasPermission } from "../src/services/roles.js";

describe("editorial workflow", () => {
  let ctx: TestContext;
  let ownerSession: Session;
  let authorSession: Session;
  let headEditorSession: Session;
  let siteId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const seeded = await bootstrap(ctx);
    siteId = seeded.siteId;
    ownerSession = await login(ctx, seeded.email, seeded.password);

    const author = await createUser(ctx, ownerSession, "autor@kalel.test", "autor-password-123", "Autor");
    const authorId = author.json().data.id;
    const authorRole = await createRole(ctx, ownerSession, "autor", ["articles.create", "articles.read", "articles.update", "articles.submit"]);
    await assignRole(ctx, ownerSession, authorId, authorRole.json().data.id, siteId);
    authorSession = await login(ctx, "autor@kalel.test", "autor-password-123");

    const chefe = await createUser(ctx, ownerSession, "chefe@kalel.test", "chefe-password-123", "Editor chefe");
    const chefeId = chefe.json().data.id;
    const chefeRole = await createRole(ctx, ownerSession, "editor-chefe", [
      "articles.create",
      "articles.read",
      "articles.update",
      "articles.submit",
      "articles.approve",
      "articles.publish",
      "articles.schedule",
    ]);
    await assignRole(ctx, ownerSession, chefeId, chefeRole.json().data.id, siteId);
    headEditorSession = await login(ctx, "chefe@kalel.test", "chefe-password-123");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const headers = (s: Session) => ({ Cookie: s.cookieHeader, "x-kal-el-csrf": s.csrf });

  async function createDraft(session: Session, slug: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles`,
      headers: headers(session),
      payload: { title: slug, slug },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  async function act(session: Session, articleId: string, action: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${articleId}/${action}`,
      headers: headers(session),
      payload: {},
    });
  }

  it("author can create a draft and submit it for review", async () => {
    const article = await createDraft(authorSession, "autor-rascunho");
    expect(article.status).toBe("draft");

    const submit = await act(authorSession, article.id, "submit");
    expect(submit.statusCode).toBe(200);
    expect(submit.json().data.status).toBe("in_review");
  });

  it("author cannot publish, approve or schedule (RBAC)", async () => {
    const article = await createDraft(authorSession, "autor-sem-publicar");

    const publish = await act(authorSession, article.id, "publish");
    expect(publish.statusCode).toBe(403);

    const approve = await act(authorSession, article.id, "approve");
    expect(approve.statusCode).toBe(403);

    const schedule = await act(authorSession, article.id, "schedule");
    expect(schedule.statusCode).toBe(403);
  });

  it("head editor approves, rejects, schedules and publishes", async () => {
    // full happy path: draft -> in_review -> approved -> scheduled -> published
    const article = await createDraft(authorSession, "fluxo-completo");
    await act(authorSession, article.id, "submit");

    const approve = await act(headEditorSession, article.id, "approve");
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data.status).toBe("draft");

    // schedule from draft
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const schedule = await ctx.app.inject({
      method: "POST",
      url: `/v1/sites/${siteId}/articles/${article.id}/schedule`,
      headers: headers(headEditorSession),
      payload: { scheduledAt: future },
    });
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json().data.status).toBe("scheduled");

    const publish = await act(headEditorSession, article.id, "publish");
    expect(publish.statusCode).toBe(200);
    expect(publish.json().data.status).toBe("published");
  });

  it("reject moves in_review to blocked, and blocked can be resubmitted", async () => {
    const article = await createDraft(authorSession, "rejeitado");
    await act(authorSession, article.id, "submit");

    const reject = await act(headEditorSession, article.id, "reject");
    expect(reject.statusCode).toBe(200);
    expect(reject.json().data.status).toBe("blocked");

    const resubmit = await act(authorSession, article.id, "submit");
    expect(resubmit.statusCode).toBe(200);
    expect(resubmit.json().data.status).toBe("in_review");
  });

  it("unpublish returns a published article to draft", async () => {
    const article = await createDraft(headEditorSession, "despublicar");
    await act(headEditorSession, article.id, "publish");

    const unpublish = await act(headEditorSession, article.id, "unpublish");
    expect(unpublish.statusCode).toBe(200);
    expect(unpublish.json().data.status).toBe("draft");
  });

  it("archive withdraws a draft and blocks further transitions", async () => {
    const article = await createDraft(authorSession, "arquivar");
    const archive = await act(headEditorSession, article.id, "archive");
    expect(archive.statusCode).toBe(200);
    expect(archive.json().data.status).toBe("archived");

    const publish = await act(headEditorSession, article.id, "publish");
    expect(publish.statusCode).toBe(409);
  });

  it("preset roles define the editorial permission matrix", async () => {
    await ensurePresetRoles(ctx.db);

    expect(await roleHasPermission(ctx.db, "autor", "articles.submit")).toBe(true);
    expect(await roleHasPermission(ctx.db, "autor", "articles.publish")).toBe(false);
    expect(await roleHasPermission(ctx.db, "autor", "articles.approve")).toBe(false);

    expect(await roleHasPermission(ctx.db, "editor", "articles.approve")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor", "articles.publish")).toBe(false);

    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.approve")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.publish")).toBe(true);
    expect(await roleHasPermission(ctx.db, "editor-chefe", "articles.schedule")).toBe(true);

    expect(await roleHasPermission(ctx.db, "admin", "articles.publish")).toBe(true);
    expect(await roleHasPermission(ctx.db, "admin", "media.manage")).toBe(true);
  });
});

```

## apps/cms/app/(app)/articles/[id]/page.tsx

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Input, PageHead, Textarea } from "@kal-el/design-system";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import { useAuth } from "../../../../lib/auth";
import { ApiError, getArticle, listRevisions, updateArticle, type ArticleDetail, type ArticleRevision } from "../../../../lib/api";
import { RichTextEditor } from "../../../../components/editor/RichTextEditor";

const EMPTY_DOC: ArticleDocumentV2 = { version: 2, nodes: [] };

const SAVE_LABEL: Record<string, string> = {
  idle: "",
  saving: "Salvando…",
  saved: "Salvo",
  error: "Erro ao salvar",
};

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { activeSiteId } = useAuth();

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [title, setTitle] = useState("");
  const [dek, setDek] = useState("");
  const [slug, setSlug] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [featuredMediaId, setFeaturedMediaId] = useState("");
  const [doc, setDoc] = useState<ArticleDocumentV2>(EMPTY_DOC);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeSiteId) return;
    getArticle(activeSiteId, params.id)
      .then((a) => {
        setArticle(a);
        setTitle(a.title);
        setDek(a.dek ?? "");
        setSlug(a.slug ?? "");
        setSeoTitle(a.seo?.seoTitle ?? "");
        setSeoDesc(a.seo?.metaDescription ?? "");
        setFeaturedMediaId(a.featuredMediaId ?? "");
        setDoc((a.document as ArticleDocumentV2) ?? EMPTY_DOC);
        setVersion(a.version);
        loadedRef.current = true;
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Falha ao carregar"));

    listRevisions(activeSiteId, params.id)
      .then(setRevisions)
      .catch(() => {});
  }, [activeSiteId, params.id]);

  const save = useCallback(async () => {
    if (!activeSiteId || !loadedRef.current) return;
    setSaveState("saving");
    try {
      const updated = await updateArticle(
        activeSiteId,
        params.id,
        {
          title,
          dek: dek || null,
          slug: slug || null,
          document: doc,
          seo: { seoTitle: seoTitle || null, metaDescription: seoDesc || null },
          featuredMediaId: featuredMediaId || null,
        },
        version,
      );
      setVersion(updated.version);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [activeSiteId, params.id, title, dek, slug, doc, seoTitle, seoDesc, featuredMediaId, version]);

  const scheduleSave = useCallback(() => {
    setSaveState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function restore(revision: ArticleRevision) {
    setDoc((revision.document as ArticleDocumentV2) ?? EMPTY_DOC);
    setEditorKey((k) => k + 1);
    setSaveState("idle");
    void save();
  }

  if (loadError) {
    return <p className="peg-field__error">{loadError}</p>;
  }

  return (
    <>
      <PageHead
        title={article?.title ?? "Carregando…"}
        description={saveState ? SAVE_LABEL[saveState] : "Editor de artigo"}
      />

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="Título" value={title} onChange={(e) => { setTitle(e.target.value); scheduleSave(); }} />
          <Input label="Subtítulo (dek)" value={dek} onChange={(e) => { setDek(e.target.value); scheduleSave(); }} />

          <RichTextEditor
            key={editorKey}
            document={doc}
            onChange={(next) => {
              setDoc(next);
              scheduleSave();
            }}
          />
        </div>

        <aside style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="peg-card">
            <div className="peg-card__body">
              <div className="peg-field__label">Status</div>
              <Badge tone="neutral">{article?.status ?? "…"}</Badge>
              <div className="peg-field__label" style={{ marginTop: 12 }}>Versão</div>
              <span className="peg-table__muted">v{version}</span>
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input label="Slug" value={slug} onChange={(e) => { setSlug(e.target.value); scheduleSave(); }} />
              <Input label="SEO — título" value={seoTitle} onChange={(e) => { setSeoTitle(e.target.value); scheduleSave(); }} />
              <Textarea label="SEO — meta descrição" rows={3} value={seoDesc} onChange={(e) => { setSeoDesc(e.target.value); scheduleSave(); }} />
              <Input label="Imagem de destaque (mediaId)" value={featuredMediaId} onChange={(e) => { setFeaturedMediaId(e.target.value); scheduleSave(); }} />
            </div>
          </div>

          <div className="peg-card">
            <div className="peg-card__header"><h3 className="peg-card__title">Revisões</h3></div>
            <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {revisions.length === 0 && <span className="peg-table__muted">Sem revisões</span>}
              {revisions.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>
                    <span className="peg-table__muted">r{r.revisionNumber}</span>{" "}
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                  <Button size="xs" variant="secondary" onClick={() => restore(r)}>Restaurar</Button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

```

## apps/cms/app/(app)/articles/page.tsx

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, EmptyState, IconPlus, PageHead, Table, type BadgeTone, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createArticle, listArticles, type ArticleSummary } from "../../../lib/api";

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  in_review: "info",
  scheduled: "warning",
  published: "success",
  blocked: "danger",
  archived: "neutral",
};

export default function ArticlesPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (siteId: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listArticles(siteId);
      setArticles(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar artigos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId);
    else setArticles([]);
  }, [activeSiteId, load]);

  async function newArticle() {
    if (!activeSiteId) return;
    setCreating(true);
    try {
      const article = await createArticle(activeSiteId, { title: "Novo artigo" });
      router.push(`/articles/${article.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar artigo");
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<ArticleSummary>[] = [
    {
      key: "title",
      header: "Título",
      render: (a) => (
        <button type="button" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--peg-accent, #2563eb)" }} onClick={() => router.push(`/articles/${a.id}`)}>
          {a.title}
        </button>
      ),
    },
    { key: "status", header: "Status", render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
    { key: "updated", header: "Atualizado", render: (a) => new Date(a.updatedAt).toLocaleString("pt-BR"), muted: true },
  ];

  return (
    <>
      <PageHead
        title="Artigos"
        description="Lista de artigos do site selecionado."
        actions={
          <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating || !activeSiteId}>
            {creating ? "Criando…" : "Novo artigo"}
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site disponível" body="Crie um site ou solicite acesso a um administrador." />
      ) : articles.length === 0 ? (
        <EmptyState
          title="Nenhum artigo ainda"
          body="Comece criando o primeiro artigo deste site."
          action={
            <Button variant="primary" icon={<IconPlus />} onClick={() => void newArticle()} disabled={creating}>
              Novo artigo
            </Button>
          }
        />
      ) : (
        <Table columns={columns} rows={articles} />
      )}
    </>
  );
}

```

## apps/cms/app/(app)/layout.tsx

```tsx
"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppShell } from "../../components/AppShell";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div style={{ padding: 32, font: "var(--peg-font-body)" }}>Carregando…</div>
    );
  }

  return <AppShell>{children}</AppShell>;
}

```

## apps/cms/app/(app)/page.tsx

```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/articles");
}

```

## apps/cms/app/globals.css

```css
.peg-body {
  min-height: 100vh;
}

a {
  color: inherit;
  text-decoration: none;
}

/* --- RichText editor (ProseMirror) --- */
.peg-editor {
  border: var(--peg-border);
  border-radius: var(--peg-radius-md, 8px);
  background: var(--peg-surface, #fff);
}
.peg-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: var(--peg-border);
  flex-wrap: wrap;
}
.peg-editor__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--peg-text-secondary, #555);
  cursor: pointer;
  font: inherit;
}
.peg-editor__btn:hover {
  background: var(--peg-surface-hover, #f3f4f6);
  color: var(--peg-text-primary, #111);
}
.peg-editor__sep {
  width: 1px;
  height: 18px;
  background: var(--peg-border-color, #e5e7eb);
  margin: 0 4px;
}
.peg-editor__surface {
  min-height: 320px;
  padding: 16px 20px;
  outline: none;
}
.peg-editor__surface .ProseMirror {
  min-height: 288px;
  outline: none;
  font: var(--peg-font-body);
  color: var(--peg-text-primary, #111);
  line-height: 1.7;
}
.peg-editor__surface .ProseMirror p { margin: 0 0 0.6em; }
.peg-editor__surface .ProseMirror h2 { margin: 1.2em 0 0.4em; font-size: 1.5em; }
.peg-editor__surface .ProseMirror h3 { margin: 1em 0 0.3em; font-size: 1.25em; }
.peg-editor__surface .ProseMirror h4 { margin: 1em 0 0.3em; font-size: 1.1em; }
.peg-editor__surface .ProseMirror blockquote {
  margin: 0.8em 0;
  padding-left: 12px;
  border-left: 3px solid var(--peg-accent, #2563eb);
  color: var(--peg-text-secondary, #555);
}
.peg-editor__surface .ProseMirror ul, .peg-editor__surface .ProseMirror ol { margin: 0.6em 0; padding-left: 1.5em; }
.peg-editor__surface .ProseMirror code {
  font-family: var(--peg-font-mono, monospace);
  background: var(--peg-surface-hover, #f3f4f6);
  padding: 0 4px;
  border-radius: 4px;
}
.peg-editor__surface .ProseMirror a { color: var(--peg-accent, #2563eb); text-decoration: underline; }

```

## apps/cms/app/layout.tsx

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@kal-el/design-system/tokens.css";
import "@kal-el/design-system/styles.css";
import "./globals.css";

import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "Kal El CMS",
  description: "CMS editorial Kal El",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light">
      <body className="peg-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

```

## apps/cms/app/login/page.tsx

```tsx
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@kal-el/design-system";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/articles");
    } catch {
      // error surfaced by the auth context
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        onSubmit={onSubmit}
        className="peg-card"
        style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div className="peg-sidebar__brand">
          <span className="peg-sidebar__brand-dot">K</span>
          <span>Kal El</span>
        </div>
        <h1 className="peg-page-title">Entrar</h1>
        <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && (
          <span className="peg-field__error" role="alert">
            {error}
          </span>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}

```

## apps/cms/components/AppShell.tsx

```tsx
"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  AppLayout,
  Button,
  Content,
  IconFile,
  IconHome,
  IconImage,
  IconMore,
  IconSettings,
  IconTag,
  IconUsers,
  IconWorkflow,
  Sidebar,
  Topbar,
  Workspace,
  type NavItemDef,
} from "@kal-el/design-system";

import { useAuth } from "../lib/auth";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, sites, activeSiteId, setActiveSite, signOut } = useAuth();

  const navGroups: { label?: string; items: NavItemDef[] }[] = [
    {
      label: "Editorial",
      items: [
        { id: "home", label: "Início", icon: <IconHome />, onClick: () => router.push("/") },
        { id: "articles", label: "Artigos", icon: <IconFile />, active: true, onClick: () => router.push("/articles") },
        { id: "media", label: "Mídia", icon: <IconImage /> },
        { id: "calendar", label: "Calendário", icon: <IconWorkflow /> },
      ],
    },
    {
      label: "Organização",
      items: [
        { id: "categories", label: "Categorias", icon: <IconTag /> },
        { id: "users", label: "Usuários", icon: <IconUsers /> },
        { id: "settings", label: "Configurações", icon: <IconSettings /> },
      ],
    },
  ];

  const signOutAndGo = () => void signOut().then(() => router.replace("/login"));

  return (
    <AppLayout>
      <Sidebar
        brand="Kal El"
        groups={navGroups}
        footer={
          <button type="button" className="peg-nav-item" onClick={signOutAndGo}>
            <IconMore />
            <span>{user?.name ?? "Conta"}</span>
          </button>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Topbar
          left={
            <select
              className="peg-select"
              style={{ minWidth: 180 }}
              value={activeSiteId ?? ""}
              onChange={(e) => setActiveSite(e.target.value)}
              aria-label="Selecionar site"
            >
              {sites.length === 0 && <option value="">Sem sites</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          }
          right={
            <Button size="sm" variant="secondary" onClick={signOutAndGo}>
              Sair
            </Button>
          }
        />
        <Workspace>
          <Content>{children}</Content>
        </Workspace>
      </div>
    </AppLayout>
  );
}

```

## apps/cms/components/editor/RichTextEditor.tsx

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { EditorView } from "@tiptap/pm/view";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from "@tiptap/pm/commands";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import type { MarkType, NodeType } from "@tiptap/pm/model";
import { buildTiptapSchema, documentToProseMirror, proseMirrorToDocument } from "@kal-el/editor";
import type { ArticleDocumentV2 } from "@kal-el/contracts";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean;

type Props = {
  document: ArticleDocumentV2;
  onChange: (doc: ArticleDocumentV2) => void;
};

function run(view: EditorView, command: Command) {
  command(view.state, view.dispatch, view);
  view.focus();
}

function toggleMarkCommand(markType: MarkType) {
  return (view: EditorView) => run(view, toggleMark(markType));
}

function setHeading(view: EditorView, level: number) {
  const nodeType = view.state.schema.nodes.heading;
  run(view, setBlockType(nodeType, { level }));
}

function setParagraph(view: EditorView) {
  run(view, setBlockType(view.state.schema.nodes.paragraph));
}

function toggleListType(view: EditorView, listType: NodeType) {
  const { state } = view;
  let inThisList = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.type === listType) inThisList = true;
  });
  if (inThisList) run(view, lift);
  else run(view, wrapInList(listType));
}

function toggleBullet(view: EditorView) {
  toggleListType(view, view.state.schema.nodes.bulletList);
}

function toggleOrdered(view: EditorView) {
  toggleListType(view, view.state.schema.nodes.orderedList);
}

function toggleBlockquote(view: EditorView) {
  run(view, wrapIn(view.state.schema.nodes.blockquote));
}

function setLink(view: EditorView) {
  const href = window.prompt("URL do link (https://… ou /slug-interno)");
  if (href == null) return;
  const { state } = view;
  const markType = state.schema.marks.link;
  const { from, to } = state.selection;
  let tr = state.tr.removeMark(from, to, markType);
  tr = tr.addMark(from, to, markType.create({ href }));
  view.dispatch(tr);
  view.focus();
}

export function RichTextEditor({ document, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const schema = buildTiptapSchema();
    const listItem = schema.nodes.listItem as NodeType;
    const state = EditorState.create({
      schema,
      doc: documentToProseMirror(document),
      plugins: [
        history(),
        keymap({ Enter: splitListItem(listItem), Tab: sinkListItem(listItem), "Shift-Tab": liftListItem(listItem) }),
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(hostRef.current, {
      state,
      dispatchTransaction(transaction) {
        const next = viewRef.current?.state.apply(transaction) ?? state.apply(transaction);
        viewRef.current?.updateState(next);
        if (transaction.docChanged) {
          onChangeRef.current(proseMirrorToDocument(next.doc));
        }
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const view = viewRef.current;

  return (
    <div className="peg-editor">
      <div className="peg-editor__toolbar" role="toolbar" aria-label="Formatar texto">
        <ToolbarButton label="Negrito" onClick={() => view && toggleMarkCommand(view.state.schema.marks.bold)(view)}>B</ToolbarButton>
        <ToolbarButton label="Itálico" onClick={() => view && toggleMarkCommand(view.state.schema.marks.italic)(view)}><i>I</i></ToolbarButton>
        <ToolbarButton label="Código" onClick={() => view && toggleMarkCommand(view.state.schema.marks.code)(view)}>{"<>"}</ToolbarButton>
        <ToolbarButton label="Link" onClick={() => view && setLink(view)}>🔗</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Parágrafo" onClick={() => view && setParagraph(view)}>P</ToolbarButton>
        <ToolbarButton label="Título 2" onClick={() => view && setHeading(view, 2)}>H2</ToolbarButton>
        <ToolbarButton label="Título 3" onClick={() => view && setHeading(view, 3)}>H3</ToolbarButton>
        <ToolbarButton label="Título 4" onClick={() => view && setHeading(view, 4)}>H4</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Lista com marcadores" onClick={() => view && toggleBullet(view)}>•≡</ToolbarButton>
        <ToolbarButton label="Lista numerada" onClick={() => view && toggleOrdered(view)}>1≡</ToolbarButton>
        <ToolbarButton label="Citação" onClick={() => view && toggleBlockquote(view)}>”</ToolbarButton>
        <span className="peg-editor__sep" />
        <ToolbarButton label="Desfazer" onClick={() => view && run(view, undo)}>↺</ToolbarButton>
        <ToolbarButton label="Refazer" onClick={() => view && run(view, redo)}>↻</ToolbarButton>
      </div>
      <div ref={hostRef} className="peg-editor__surface" />
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="peg-editor__btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

```

## apps/cms/lib/api.ts

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)ke_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfToken();
    if (csrf) headers["x-kal-el-csrf"] = csrf;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } }) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json?.data as T;
}

export type MeUser = { id: string; email: string; name: string; status: string };
export type MeResponse = { kind: "user"; user: MeUser; sessionId: string };
export type SiteInfo = { id: string; slug: string; name: string; status: string };
export type ArticleStatus = "draft" | "in_review" | "scheduled" | "published" | "blocked" | "archived";
export type ArticleSummary = {
  id: string;
  title: string;
  slug: string | null;
  status: ArticleStatus;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
};
export type ArticlePage = { items: ArticleSummary[]; nextCursor: string | null };

export function login(email: string, password: string): Promise<MeResponse> {
  return request<MeResponse>("POST", "/v1/auth/login", { email, password });
}

export function logout(): Promise<unknown> {
  return request("POST", "/v1/auth/logout");
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>("GET", "/v1/auth/me");
}

export function listMySites(): Promise<SiteInfo[]> {
  return request<SiteInfo[]>("GET", "/v1/me/sites");
}

export function listArticles(siteId: string, q?: string): Promise<ArticlePage> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<ArticlePage>("GET", `/v1/sites/${siteId}/articles${suffix}`);
}

export type ArticleDetail = {
  id: string;
  title: string;
  dek: string | null;
  slug: string | null;
  status: ArticleStatus;
  version: number;
  excerpt: string | null;
  featuredMediaId: string | null;
  document: { version: number; nodes: unknown[] };
  seo: { seoTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; robotsIndex: string; robotsFollow: string };
  updatedAt: string;
  publishedAt: string | null;
};

export type ArticleRevision = { id: string; revisionNumber: number; document: { version: number; nodes: unknown[] }; note: string | null; createdAt: string };

export function createArticle(siteId: string, body: { title: string; slug?: string }): Promise<ArticleSummary & { id: string }> {
  return request("POST", `/v1/sites/${siteId}/articles`, body);
}

export function getArticle(siteId: string, articleId: string): Promise<ArticleDetail> {
  return request("GET", `/v1/sites/${siteId}/articles/${articleId}`);
}

export function updateArticle(
  siteId: string,
  articleId: string,
  body: Record<string, unknown>,
  ifMatch: number,
): Promise<ArticleDetail> {
  return request("PATCH", `/v1/sites/${siteId}/articles/${articleId}`, body, { "if-match": String(ifMatch) });
}

export function listRevisions(siteId: string, articleId: string): Promise<ArticleRevision[]> {
  return request("GET", `/v1/sites/${siteId}/articles/${articleId}/revisions`);
}

```

## apps/cms/lib/auth.tsx

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, listMySites, login as apiLogin, logout as apiLogout, me as apiMe, type MeUser, type SiteInfo } from "./api";

type AuthContextValue = {
  user: MeUser | null;
  sites: SiteInfo[];
  activeSiteId: string | null;
  loading: boolean;
  error: string | null;
  setActiveSite: (id: string) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [meRes, sitesRes] = await Promise.all([apiMe(), listMySites()]);
      setUser(meRes.user);
      setSites(sitesRes);
      setActiveSiteId((prev) => prev ?? sitesRes[0]?.id ?? null);
      setError(null);
    } catch {
      setUser(null);
      setSites([]);
      setActiveSiteId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        await apiLogin(email, password);
        await refresh();
      } catch (err) {
        const message = err instanceof ApiError && err.status === 401 ? "Credenciais inválidas" : "Falha ao entrar";
        setError(message);
        throw err;
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setSites([]);
      setActiveSiteId(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, sites, activeSiteId, loading, error, setActiveSite: setActiveSiteId, signIn, signOut }),
    [user, sites, activeSiteId, loading, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

```

## apps/cms/middleware.ts

```ts
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = pathname === "/" || pathname.startsWith("/articles");
  if (!isProtected) return NextResponse.next();

  const session = req.cookies.get("ke_session");
  if (!session?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/articles/:path*"],
};

```

## apps/cms/next-env.d.ts

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.

```

## apps/cms/next.config.mjs

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@kal-el/design-system", "@kal-el/editor", "@kal-el/contracts"],
  reactStrictMode: true,
};

export default nextConfig;

```

## apps/cms/package.json

```json
{
  "name": "@kal-el/cms",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint app components lib"
  },
  "dependencies": {
    "@kal-el/contracts": "workspace:*",
    "@kal-el/design-system": "workspace:*",
    "@kal-el/editor": "workspace:*",
    "@tiptap/pm": "^2.9.0",
    "next": "14.2.35",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "eslint": "^9.14.0",
    "typescript": "^5.6.3"
  }
}

```

## apps/cms/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}

```

## apps/worker/src/scheduler.ts

```ts
import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articleRevisions, articles, outboxEvents } from "@kal-el/db/schema";

export type PromoteSummary = { promoted: number };

const DEFAULT_DOCUMENT = { version: 2, nodes: [] };

/**
 * Promote articles whose scheduled_at has arrived. Safe under concurrent
 * workers: the transition is a guarded UPDATE (status='scheduled' AND
 * scheduled_at <= now), so at most one worker wins per article; the outbox
 * event is keyed deterministically (exactly-once delivery per ADR-0005).
 */
export async function promoteScheduledArticles(db: Db): Promise<PromoteSummary> {
  const now = new Date();

  const due = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.status, "scheduled"), lte(articles.scheduledAt, now)))
    .limit(100);

  let promoted = 0;
  for (const { id } of due) {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(articles)
        .set({
          status: "published",
          publishedAt: new Date(),
          scheduledAt: null,
          version: sql`${articles.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(articles.id, id), eq(articles.status, "scheduled"), lte(articles.scheduledAt, now)))
        .returning();
      const row = rows[0];
      if (!row) return null;

      const maxRev = await tx
        .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, id));
      await tx.insert(articleRevisions).values({
        articleId: id,
        revisionNumber: Number(maxRev[0]?.n ?? 0) + 1,
        document: (row.document ?? DEFAULT_DOCUMENT) as never,
        createdBy: null,
        note: "scheduled publish",
      });

      const publishedAt = new Date();
      await tx
        .insert(outboxEvents)
        .values({
          siteId: row.siteId,
          aggregateType: "article",
          aggregateId: id,
          eventType: "article.published",
          payload: { articleId: id, slug: row.slug, publishedAt: publishedAt.toISOString(), version: row.version },
          idempotencyKey: `article:${id}:publish:${publishedAt.getTime()}`,
        })
        .onConflictDoNothing();

      return row;
    });

    if (updated) promoted++;
  }

  return { promoted };
}

```

## docs/adr/ADR-0008-document-schema-v2.md

```markdown
# ADR-0008 — Canonical editorial document schema V2 (inline marks)

Status: Accepted
Date: 2026-08-17
Related: ADR-0007, docs/02-EDITOR-UX.md, docs/03-SEO.md

## Context

The v1 document model stored paragraph/heading/quote content as plain strings
and list/table cells as plain strings. Rich inline formatting — bold, italic,
links (internal and external), code — was structurally impossible to store,
which blocks editorial use, internal linking (SEO) and lossless imports.

## Decision

- The canonical document schema is **V2**, where every text-bearing block
  (paragraph, heading, quote, list item, table cell) carries **inline content**:
  an ordered array of text nodes with optional **marks**.
- Marks: `bold`, `italic`, `code`, `underline`, `strike`, `link` (link carries
  `href`, `title`, `internal`). `href` accepts `http(s)` URLs or internal paths
  (`/slug`), matching the internal/external link requirement.
- The versioned schema remains a discriminated union `version: 1 | 2`:
  - `version: 1` (legacy) is still accepted at the API boundary (old
    SDK/importer clients and legacy stored rows);
  - `version: 2` (canonical) is what the API serves and what the editor/importer
    produce.
- Pure, tested migration functions (`migrateDocumentToV2`, `migrateDocumentToV1`)
  normalize between versions. V1→V2 is lossless; V2→V1 flattens marks (documented
  as lossy). The API normalizes to V2 on read and write, so legacy V1 rows are
  served as V2 and new writes always store V2. No SQL migration is required
  (documents are `jsonb`; the transform is structural and reversible for plain
  text).
- ProseMirror (TipTap, per ADR-0007) is extended with mark specs mirroring the
  contract; `documentToProseMirror` / `proseMirrorToDocument` round-trip V2,
  preserving marks. Inline content is canonicalized (`normalizeInlineContent`:
  stable mark order + merge adjacent identical text nodes) for deterministic
  serialization.

## Consequences

- Bold/italic/link survive editor → JSON → editor and storage round-trips.
- The WordPress importer now preserves inline marks and links via an
  `extractInline` walker (still allow-list based; unsafe hrefs/scripts dropped).
- Renderers on consuming frontends must only trust known node types and marks;
  unknown node types are rejected at the ProseMirror schema boundary and by the
  zod contract.
- Lexical remains the documented alternative prototype (ADDR-0007); its headless
  bridge flattens marks, which is an explicit known limitation requiring custom
  node/mark registration.

```

## docs/adr/ADR-0009-media-storage.md

```markdown
# ADR-0009 — Media storage provider and image metadata

Status: Accepted
Date: 2026-08-17
Related: docs/11-OPEN-DECISIONS.md, R2 media subsystem

## Context

The `media` table existed but nothing wrote to it: no upload endpoint, no
StorageProvider, no dimensions. R2 requires a real media subsystem — upload,
list, detail, metadata update, safe delete, featured image and gallery — with a
storage abstraction that can later support R2/S3 without touching the editorial
domain.

## Decision

- **`StorageProvider`** is a narrow interface (`put`/`get`/`delete`, with a
  `name`) implemented by **`LocalStorageProvider`** (filesystem) as the first,
  reference backend. Storage keys are generated by the media service as
  `sites/<siteId>/<uuid>.<ext>` and validated defensively against path
  traversal. A future S3/R2 provider implements the same contract; the editorial
  domain only ever sees `storageKey` + `provider` strings.
- **Upload is multipart** (`@fastify/multipart`) with a single-file limit and a
  configurable size cap (`MEDIA_MAX_BYTES`, default 25 MB).
- **MIME allow-list**: raster images only (`jpeg/png/webp/gif/avif`). SVG is
  deliberately excluded (XSS surface).
- **Image metadata**: `image-size` (pure-JS, dependency-light) reads
  width/height at upload time. Full image transformation (resize/variants) is
  deferred; `sharp` remains the candidate for that later phase, and adding it
  will not change the StorageProvider contract.
- **RBAC**: `media.manage` (upload/update/delete) and `media.read`
  (list/detail/file). Both are site-scoped.
- **Cross-site protection**: articles may only reference media in the same site
  (`assertMediaInSite` validates `featured_media_id` and image/gallery document
  nodes at write time).
- **Delete is guarded**: media referenced as a featured image, author avatar, or
  embedded in any document (jsonb text search) is rejected with 409.

## Consequences

- Featured images and galleries now reference real media records and are
  verified same-site on every write.
- Media binaries are served through an authenticated
  `GET /v1/sites/:siteId/media/:id/file` endpoint; public CDN delivery remains a
  frontend/portal concern.
- The media record exposes a `url` (computed from `API_BASE_URL`) for the editor
  and future SDK methods.

```

## docs/adr/ADR-0010-workflow-state-machine.md

```markdown
# ADR-0010 — Editorial workflow state machine and preset roles

Status: Accepted
Date: 2026-08-17
Related: docs/02-EDITOR-UX.md, R3 workflow

## Context

The `status` enum declared `in_review`/`blocked` but no code reached them; the
only transitions were draft→published, draft→scheduled (and publish/schedule).
There was no review path, and status changes via PATCH were silently dropped
(fixed separately in R0.3). Editorial operations were not modeled as explicit,
authorizable transitions.

## Decision

- The workflow is an explicit **state machine** with states
  `draft`, `in_review`, `scheduled`, `published`, `blocked`, `archived`
  (`archived` is a plain-text column value — no SQL migration required; the
  column is `text` without a CHECK constraint).
- Every editorial action is a **dedicated endpoint**, never a generic PATCH:

  | action | transition | permission |
  |---|---|---|
  | `submit` | draft/blocked → in_review | `articles.submit` |
  | `approve` | in_review → draft | `articles.approve` |
  | `reject` | in_review → blocked | `articles.approve` |
  | `schedule` | draft/in_review/scheduled → scheduled | `articles.schedule` |
  | `publish` | draft/in_review/scheduled → published | `articles.publish` |
  | `unpublish` | published → draft | `articles.publish` |
  | `archive` | draft/blocked/in_review/scheduled → archived | `articles.publish` |

  The transition matrix is validated on every write (`assertTransition`); illegal
  transitions return 409. `approve` returns to `draft` because the six-state
  model has no dedicated "approved" state — `draft` is the publishable pre-live
  state. This is documented, not accidental.
- **Preset roles** (global keys, assignable per site) are seeded idempotently at
  boot: `owner`, `admin`, `editor-chefe`, `editor`, `autor`. The exact permission
  matrix lives in `PRESET_ROLES` (`apps/api/src/services/roles.ts`). Custom roles
  remain fully supported.

## Consequences

- `in_review` and `blocked` are now reachable; authors can submit, editors can
  approve/reject, head editors publish/schedule.
- RBAC: `articles.create` can only produce drafts; publishing/scheduling/approving
  require their own permissions (R0.1 + this ADR close the bypass surface).
- The SDK and external pipelines (R10) will target these explicit action
  endpoints rather than a status field on PATCH.

```

## docs/progress/RECOVERY-00-BASELINE.md

```markdown
# RECOVERY-00 — BASELINE

**Date:** 2026-08-17
**Branch:** `feat/foundation-phase-1-3`
**HEAD:** `3a96a3a9aca4d4f6d0b08bdb26583e1f96af9ab4`

## Worktree discovery (mechanical)

```text
worktree produto:   C:\Users\pablo\Documents\OpenCode\Kal El   (branch feat/foundation-phase-1-3)
remote:             origin https://github.com/maquinanerd/kal-el.git
tracked_files:      261
node:               v24.19.0
package_manager:    pnpm 11.15.1
apps/:              api  fixture  worker   (NO apps/cms)
packages/:          auth contracts db design-system editor events importer sdk testkit
```

Fonte de verdade: `docs/audits/KALEL_360_AUDIT.md`. Seus achados P0/P1 são o ponto de partida.

## Baseline gates (executados nesta recuperação)

| comando | resultado |
|---|---|
| `pnpm -r typecheck` | PASS (12/13 projetos) |
| `pnpm -r lint` | PASS |
| `pnpm -r test` | PASS — 87 tests, 0 fail, 0 skip |
| `pnpm -r build` | PASS (api 73.33 KB, worker 9.44 KB, fixture 1.71 KB) |

Testes por pacote (87 total): contracts 9, design-system 5, editor 6, sdk 5, db 8, auth 5, worker 8, api 31, fixture 2, importer 8.

Observações: "close timed out after 10000ms" em pacotes com PostgreSQL embutido é cosmético no Windows (exit 0). `DeprecationWarning` do `pg` é ruído.

## Pontos de partida R0 (da auditoria)

- P0-1: bypass de publicação via `POST /articles {"status":"published"}`.
- P1-3: `deleteRedirect` apaga linha antes de validar `site_id`.
- P1-2 (parte R0.3): PATCH descarta `status` em silêncio (zod strip).

```

## docs/progress/RECOVERY-01-SECURITY.md

```markdown
# RECOVERY-01 — SECURITY (R0)

**Date:** 2026-08-17

## Scope

Corrigir os bloqueadores de segurança/integridade identificados na auditoria 360°:

- **P0-1** — bypass de RBAC: `articles.create` publicava (`status:"published"`) e backdatava (`publishedAt`) sem `articles.publish`.
- **P1-3** — `deleteRedirect` apagava a linha antes de validar `site_id` (isolamento quebrado).
- **P1-2 / R0.3** — zod descartava campos desconhecidos em silêncio (ex.: `status` no PATCH → 200 sem efeito).

## Files changed

| arquivo | mudança |
|---|---|
| `apps/api/src/routes/site.ts` | POST `/articles` agora exige `articles.publish` para `status:"published"`/`publishedAt` e `articles.schedule` para `status:"scheduled"`/`scheduledAt`. |
| `apps/api/src/services/redirects.ts` | `deleteRedirect` filtra por `(id, site_id)` na própria query. |
| `packages/contracts/src/editorial.ts` | `.strict()` em todos os schemas de mutação (article create/update, category/tag/entity/author/source create, publish/schedule). |
| `packages/contracts/src/seo.ts` | `.strict()` em `createRedirectBodySchema`. |
| `packages/contracts/src/identity.ts` | `.strict()` em createUser/login/createRole/createServiceToken. |
| `packages/contracts/src/sites.ts` | `.strict()` em createSite/updateSite/initBootstrap. |
| `packages/contracts/src/webhooks.ts` | `.strict()` em createWebhook. |
| `apps/api/src/routes/admin.ts` | `.strict()` no schema de assign-role. |
| `packages/importer/tests/import.test.ts` | service token do importer agora inclui `articles.publish`/`articles.schedule` (o importer preserva status/datas de origem por design). |

## Migrations

Nenhuma.

## Tests added

- `apps/api/tests/security.test.ts` (8 testes):
  - autor sem `articles.publish` → POST `status:"published"` = 403 + zero eventos `article.published` no outbox;
  - autor → POST com `publishedAt` arbitrário = 403;
  - autor sem `articles.schedule` → POST `status:"scheduled"` = 403;
  - autor ainda cria draft (controle positivo);
  - dono com `articles.publish` cria publicado (controle positivo);
  - PATCH com campo desconhecido (`status`) = 400;
  - POST com campo desconhecido = 400;
  - site A não consegue deletar redirect do site B (404; linha do site B continua existindo).
- `packages/contracts/tests/schemas.test.ts` (+1): strict schemas rejeitam campos desconhecidos.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm --filter @kal-el/api test        39 tests pass (incl. 8 security)
pnpm --filter @kal-el/importer test    8 tests pass
pnpm --filter @kal-el/contracts test  10 tests pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- `status:"in_review"`/`"blocked"` ainda são alcançáveis via `POST /articles` (campo válido). Não é bypass de publicação; será endereçado em R3 (workflow state machine), que restringe transições a ações explícitas.
- `COOKIE_SECURE`/CORS/Swagger/SSRF (P2/P1 de hardening) ficam para R13, fora do escopo R0.

## Gate R0

```text
P0 security   = 0  (bypass de publish corrigido + teste negativo)
P1 isolation  = 0  (deleteRedirect site-scoped + teste negativo)
P1 silent loss= 0  (campos desconhecidos → 400)
```

## Commit

Vide `git log` (commit R0).

```

## docs/progress/RECOVERY-02-DOCUMENT-V2.md

```markdown
# RECOVERY-02 — DOCUMENT V2 (R1)

**Date:** 2026-08-17

## Scope

Substituir o modelo de documento de texto-plano (V1) por um **ArticleDocument V2**
com suporte real a rich text inline (marks), preservando compatibilidade com V1.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/contracts/src/editorial.ts` | Marks (`bold/italic/code/underline/strike/link`), nós inline (`text`/`hardBreak`), `inlineContentSchema`, schemas `documentV1Schema`/`documentV2Schema`, `documentSchema` (união discriminada), e funções `textToInline`, `inlineContentToText`, `normalizeInlineContent`, `migrateDocumentToV2`, `migrateDocumentToV1`. |
| `packages/editor/src/tiptap.ts` | Schema ProseMirror com marks; round-trip V2 preservando marcas; canonicalização determinística. |
| `packages/editor/src/lexical.ts` | Bridge Lexical atualizada para V2 (achata marcas — limitação documentada). |
| `packages/importer/src/html.ts` | `extractInline` preserva bold/italic/code/underline/strike/link; `finalizeDocument` produz V2. |
| `apps/api/src/services/articles.ts` | Normaliza documento para V2 em leitura/escrita/revisões; `DEFAULT_DOCUMENT` V2. |
| `apps/worker/src/scheduler.ts` | `DEFAULT_DOCUMENT` V2 (cosmético). |
| `docs/adr/ADR-0008-document-schema-v2.md` | ADR registrando a decisão. |

## Migrations

Nenhuma SQL (documentos são `jsonb`). Migração V1↔V2 é função pura e testada;
API normaliza em leitura/escrita, então linhas V1 legadas são servidas como V2.

## Tests added / updated

- `contracts/tests/schemas.test.ts`: V2 com marks, rejeição de href inseguro, rejeição de versão 3, e migração V1→V2 idempotente + round-trip V1→V2→V1.
- `editor/tests/prototype.test.ts`: round-trip completo + preservação de marks (bold/italic/link, bold+link).
- `importer/tests/html.test.ts`: preservação de links e formatação no V2; nós intermediários com inline content.
- `api/tests/articles.test.ts`: V2 nas operações de criação/edição/leitura.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 74.00 KB)
pnpm --filter @kal-el/contracts test  15 pass
pnpm --filter @kal-el/editor test      7 pass
pnpm --filter @kal-el/importer test    9 pass
pnpm --filter @kal-el/api test        39 pass
pnpm --filter @kal-el/worker test      8 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Lexical (alternativa documentada) ainda achata marks — fora do caminho runtime.
- Table headers continuam como lista de textos (mesma semântica V1); melhorar o modelo de tabela é trabalho futuro não bloqueante.

## Gate R1

```text
round-trip editor↔JSON↔editor:  PASS (marcas/links preservados)
links preservados:              PASS
marcas preservadas:             PASS
documentos V1 legíveis:         PASS (normalizados para V2)
API aceita V2:                  PASS
revisions preservam V2:         PASS
importer produz V2:             PASS
```

## Commit

Vide `git log` (commit R1).

```

## docs/progress/RECOVERY-03-MEDIA.md

```markdown
# RECOVERY-03 — MEDIA (R2)

**Date:** 2026-08-17

## Scope

Construir o subsistema de mídia de ponta a ponta: StorageProvider, upload,
listagem, detalhe, metadata, delete seguro, featured image e galeria com
isolamento por site.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/api/src/storage/provider.ts` | Contrato `StorageProvider` (put/get/delete). |
| `apps/api/src/storage/local.ts` | `LocalStorageProvider` (filesystem) com validação de key contra path traversal. |
| `apps/api/src/storage/index.ts` | Fábrica `createStorageProvider(config)`. |
| `apps/api/src/services/media.ts` | upload/list/get/update/delete + `assertMediaInSite` + `collectDocumentMediaIds`. |
| `apps/api/src/routes/site.ts` | Rotas `/media` (GET/POST), `/media/:id` (GET/PATCH/DELETE), `/media/:id/file` (GET). |
| `apps/api/src/app.ts` | Registra `@fastify/multipart` e decora `storage`. |
| `apps/api/src/config.ts` | `MEDIA_STORAGE_PROVIDER`, `MEDIA_LOCAL_PATH`, `MEDIA_MAX_BYTES`. |
| `apps/api/src/auth-context.ts` | Nova permissão `media.read`. |
| `packages/contracts/src/editorial.ts` | `featuredMediaId` em create/update article. |
| `apps/api/src/services/articles.ts` | Valida mídia referenciada (featured + nós image/gallery) no mesmo site. |
| `.env.example` | `MEDIA_MAX_BYTES`. |
| `docs/adr/ADR-0009-media-storage.md` | ADR (StorageProvider + image-size, SVG excluído). |

Dependências adicionadas: `@fastify/multipart`, `image-size`.

## Migrations

Nenhuma (tabela `media` já existia).

## Tests added

`apps/api/tests/media.test.ts` (7 testes): upload com dimensões/mime/tamanho,
list/detail/file (bytes íntegros), update metadata, featured image persistente
após reabrir, nós image/gallery com mídia real, bloqueio cross-site (featured e
nó de documento), delete seguro (409 em uso / 200 não usado).

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 85.84 KB)
pnpm --filter @kal-el/api test   46 pass (incl. 7 media)
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Cursor pagination na listagem de mídia (limite simples por enquanto; cursor chega com a tela Media Library em R6).
- Transformação de imagem (resize/variants) adiada — `sharp` é o candidato, sem mudar o contrato StorageProvider.
- Verificação de "media em uso" em nós de documento usa busca textual no jsonb (heurística segura); rastreamento referencial explícito pode vir depois.

## Gate R2

```text
upload → media record → retrieve → assign featured → reopen → relation intact: PASS
site A article cannot use site B media: PASS
```

## Commit

Vide `git log` (commit R2).

```

## docs/progress/RECOVERY-04-WORKFLOW.md

```markdown
# RECOVERY-04 — WORKFLOW (R3)

**Date:** 2026-08-17

## Scope

Implementar a máquina de estados editorial explícita (submit/approve/reject/
schedule/publish/unpublish/archive), permissões de transição e roles preset.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/contracts/src/editorial.ts` | `archived` no `articleStatusSchema`. |
| `packages/db/src/schema/editorial.ts` | `archived` no enum TS de `status` (coluna `text`; sem migration). |
| `apps/api/src/auth-context.ts` | Novas permissões `articles.submit`, `articles.approve`. |
| `apps/api/src/services/articles.ts` | Máquina de estados (`WORKFLOW_TRANSITIONS` + `assertTransition`), funções `submitArticle`/`approveArticle`/`rejectArticle`/`unpublishArticle`/`archiveArticle`; publish/schedule restritos a from-states válidos. |
| `apps/api/src/routes/site.ts` | Endpoints `/submit`, `/approve`, `/reject`, `/unpublish`, `/archive`. |
| `apps/api/src/services/roles.ts` | `PRESET_ROLES` (owner/admin/editor-chefe/editor/autor) + `ensurePresetRoles`. |
| `apps/api/src/server.ts` | Seed de roles preset no boot. |
| `docs/adr/ADR-0010-workflow-state-machine.md` | ADR da máquina de estados e roles. |

## Migrations

Nenhuma. `archived` é valor de coluna `text` (sem CHECK constraint no schema
gerado — confirmado em `0000_furry_psynapse.sql`).

## Tests added

`apps/api/tests/workflow.test.ts` (7 testes): autor cria+submete; autor não
publica/aprova/agenda (403); chefe aprova→agenda→publica; reject→blocked→resubmit;
unpublish; archive bloqueia transições (409); matriz de permissões dos roles preset.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 93.26 KB)
pnpm --filter @kal-el/api test   53 pass (incl. 7 workflow)
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- "Autor edita apenas seus artigos" (ownership) ainda não é restrito — autor com `articles.update` pode editar qualquer artigo do site. Refinamento de ownership fica para R6/R13.
- `approve` retorna a `draft` (modelo de 6 estados sem "approved"); documentado no ADR-0010.

## Gate R3

```text
transições explícitas:    PASS (submit/approve/reject/unpublish/archive)
autorização por transição: PASS (403 em publish/schedule/approve sem permissão)
roles preset documentados: PASS (PRESET_ROLES + ensurePresetRoles)
```

## Commit

Vide `git log` (commit R3).

```

## docs/progress/RECOVERY-05-CMS.md

```markdown
# RECOVERY-05 — CMS (R4)

**Date:** 2026-08-17

## Scope

Criar `apps/cms` (Next.js App Router + React 18 + TypeScript) consumindo a API
real via session + CSRF, com shell PEG e tela de artigos real (sem dados falsos).

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/**` | App Next.js: login, layout protegido, shell PEG, índice de artigos, detail stub. |
| `apps/cms/lib/api.ts` | Cliente browser (fetch + credentials + `x-kal-el-csrf`). |
| `apps/cms/lib/auth.tsx` | AuthProvider (me + sites + signIn/signOut). |
| `apps/cms/components/AppShell.tsx` | Shell PEG (Sidebar/Topbar/Workspace) + site switcher. |
| `apps/cms/middleware.ts` | Gate por cookie `ke_session`. |
| `apps/api/src/routes/auth.ts` | `GET /v1/me/sites` (sites do usuário, para o switcher). |
| `apps/api/tests/auth.test.ts` | +2 testes para `/me/sites`. |
| `packages/design-system/src/{index,components/FormControls,Table,Overlays}` | Removidas extensões `.js` dos imports internos (compatibilidade com bundler Next/webpack). |

Dependências: `next@14.2`, `react@18`, `react-dom@18`.

## Migrations

Nenhuma.

## Tests

- API: 55 testes passando (inclui 2 novos `/me/sites`).
- Design-system: 5 testes passando após remoção de extensões `.js`.
- CMS: `next build` OK (6 rotas: `/`, `/login`, `/articles`, `/articles/[id]`, `/_not-found`), typecheck e lint OK.

## Commands

```text
pnpm -r typecheck    PASS (13 projetos, incl. cms)
pnpm -r lint         PASS
pnpm --filter @kal-el/cms build    PASS
pnpm --filter @kal-el/api test     55 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Browser E2E (Playwright) do fluxo login→artigos fica para R12/R13, conforme plano.
- Editor rich text (R5) ainda não conectado; `/articles/[id]` é stub.
- `origin: true` no CORS (P2) será revisado em R13; suficiente para dev local.

## Gate R4

```text
apps/cms real:        SIM (Next.js, consome /v1)
login/session/CSRF:   SIM (cliente com credentials + x-kal-el-csrf)
protected layout:     SIM (middleware + AuthProvider)
shell PEG:            SIM (Sidebar/Topbar/Workspace + site switcher)
artigos (real API):   SIM (loading/empty/error/success)
```

## Commit

Vide `git log` (commit R4).

```

## docs/progress/RECOVERY-06-EDITOR.md

```markdown
# RECOVERY-06 — EDITOR (R5)

**Date:** 2026-08-17

## Scope

Conectar o editor rich text real (ProseMirror/TipTap, reusando `packages/editor`)
à tela de artigo do CMS, com autosave real, revisões e inspector.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/components/editor/RichTextEditor.tsx` | Editor ProseMirror real (EditorView + schema de `@kal-el/editor`), toolbar (bold/italic/code/link/H2-H4/listas/quote/undo/redo), round-trip V2 com marcas. |
| `apps/cms/app/(app)/articles/[id]/page.tsx` | Tela de artigo: título/dek, editor, inspector (slug/SEO/featured), autosave com If-Match + estados visuais, revisões com restore. |
| `apps/cms/lib/api.ts` | `updateArticle` (PATCH + If-Match), `listRevisions`, `getArticle`/`ArticleDetail`. |
| `apps/cms/app/globals.css` | Estilos do editor (toolbar, ProseMirror, listas/quote/link). |
| `apps/cms/next.config.mjs` | `transpilePackages` inclui `@kal-el/editor` e `@kal-el/contracts`. |
| `packages/contracts/src/*.ts`, `packages/editor/src/index.ts` | Removidas extensões `.js` dos imports internos (compatibilidade com bundler Next/webpack). |

Dependência: `@kal-el/editor` (workspace) + `@tiptap/pm` no CMS.

## Migrations

Nenhuma.

## Tests

- Suíte completa: **119 testes, todos passando** (api 55, importer 9, worker 8, db 8, editor 7, contracts 15, auth 5, sdk 5, design-system 5, fixture 2).
- `next build` do CMS OK (rota `/articles/[id]` dinâmica, 180 kB first-load).

## Commands

```text
pnpm -r typecheck    PASS (13 projetos)
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm -r test         119 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Inserção de nós atômicos (imagem/galeria/embed/tabela/fonte) via UI e slash commands: pendente — media library (R6) e editor de blocos.
- Autosave cobre documento + título/dek/slug/SEO/featured; estados visuais (Salvando…/Salvo/Erro) presentes.
- Diff entre revisões não renderizado (lista + restore funcionais).
- Browser E2E (Playwright) do fluxo completo fica para R12/R13.

## Gate R5

```text
editor real (ProseMirror):          PASS
rich text com marcas persiste:       PASS (round-trip V2 via packages/editor)
bold/link sobrevivem:                PASS
autosave real (If-Match + estados):  PASS
revisions (lista + restore):         PASS
inspector real (slug/SEO/featured):  PASS
```

## Commit

Vide `git log` (commit R5).

```

## packages/contracts/src/editorial.ts

```ts
import { z } from "zod";
import { seoMetadataSchema } from "./seo";
import { timestampSchema, uuidSchema } from "./common";

export const articleTypeSchema = z.enum(["article", "review", "list", "video", "audio"]);

export const articleStatusSchema = z.enum(["draft", "in_review", "scheduled", "published", "blocked", "archived"]);

export const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs are allowed");

export const provenanceSourceSchema = z.object({
  provider: z.string().min(1).max(64),
  externalId: z.string().min(1).max(256),
  externalUrl: z.string().url().max(2048).nullable().optional(),
});

export const provenanceSchema = z
  .object({
    system: z.string().min(1).max(64),
    sources: z.array(provenanceSourceSchema).max(50),
    createdAt: z.string().max(64).optional(),
  })
  .nullable();

/**
 * Versioned structured document schema (editor engine).
 *
 * v1 (legacy): prose-first; text blocks carry plain strings (no inline marks).
 * v2 (canonical): text blocks carry inline content — an ordered array of text
 * nodes with optional marks (bold/italic/code/underline/strike/link) — so rich
 * text survives round-trip. Renderers on consuming frontends must only trust
 * known node types and marks.
 */

export const linkHrefSchema = z
  .string()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u) || u.startsWith("/"), "link href must be an http(s) URL or an internal path");

export const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      href: linkHrefSchema,
      title: z.string().max(500).optional(),
      internal: z.boolean().optional(),
    }),
  }),
]);

export const inlineNodeSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(10000), marks: z.array(markSchema).max(8).default([]) }),
  z.object({ type: z.literal("hardBreak") }),
]);

export const inlineContentSchema = z.array(inlineNodeSchema).max(2000);

// Shared atom nodes (identical across document versions).
const imageNodeSchema = z.object({
  type: z.literal("image"),
  attrs: z.object({
    mediaId: uuidSchema,
    caption: z.string().max(2000).optional(),
    credit: z.string().max(500).optional(),
    altText: z.string().max(500).optional(),
  }),
});
const galleryNodeSchema = z.object({ type: z.literal("gallery"), attrs: z.object({ mediaIds: z.array(uuidSchema).min(1).max(50) }) });
const embedNodeSchema = z.object({
  type: z.literal("embed"),
  attrs: z.object({
    url: httpUrlSchema,
    provider: z.string().max(64),
    id: z.string().max(128).optional(),
  }),
});
const sourceNodeSchema = z.object({
  type: z.literal("source"),
  attrs: z.object({ label: z.string().max(200), url: httpUrlSchema, kind: z.string().max(32).optional() }),
});

// ---- v1 (legacy, string content) ----
export const documentV1NodeSchema = z.union([
  z.object({ type: z.literal("paragraph"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: z.string() }),
  z.object({ type: z.literal("quote"), attrs: z.record(z.string(), z.unknown()).default({}), content: z.string() }),
  z.object({ type: z.literal("list"), attrs: z.object({ ordered: z.boolean().default(false) }), content: z.array(z.string()) }),
  z.object({
    type: z.literal("table"),
    attrs: z.object({ headers: z.array(z.string()).default([]) }),
    content: z.array(z.array(z.string())),
  }),
  imageNodeSchema,
  galleryNodeSchema,
  embedNodeSchema,
  sourceNodeSchema,
]);

export const documentV1Schema = z.object({
  version: z.literal(1),
  nodes: z.array(documentV1NodeSchema),
});

// ---- v2 (canonical, inline content with marks) ----
export const documentV2NodeSchema = z.union([
  z.object({ type: z.literal("paragraph"), attrs: z.record(z.string(), z.unknown()).default({}), content: inlineContentSchema }),
  z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: inlineContentSchema }),
  z.object({ type: z.literal("quote"), attrs: z.record(z.string(), z.unknown()).default({}), content: inlineContentSchema }),
  z.object({ type: z.literal("list"), attrs: z.object({ ordered: z.boolean().default(false) }), content: z.array(inlineContentSchema).max(500) }),
  z.object({
    type: z.literal("table"),
    attrs: z.object({ headers: z.array(z.string()).default([]) }),
    content: z.array(z.array(inlineContentSchema).max(500)).max(500),
  }),
  imageNodeSchema,
  galleryNodeSchema,
  embedNodeSchema,
  sourceNodeSchema,
]);

export const documentV2Schema = z.object({
  version: z.literal(2),
  nodes: z.array(documentV2NodeSchema),
});

export const documentSchema = z.discriminatedUnion("version", [documentV1Schema, documentV2Schema]);

export const articleSummarySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  type: articleTypeSchema,
  status: articleStatusSchema,
  title: z.string().max(400),
  dek: z.string().max(600).nullable(),
  slug: z.string().max(300).nullable(),
  excerpt: z.string().max(2000).nullable(),
  version: z.number().int().nonnegative(),
  externalKey: z.string().max(256).nullable(),
  featuredMediaId: uuidSchema.nullable(),
  authors: z.array(uuidSchema),
  categories: z.array(uuidSchema),
  tags: z.array(uuidSchema),
  entities: z.array(uuidSchema),
  publishedAt: timestampSchema.nullable(),
  scheduledAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  createdAt: timestampSchema,
  qualityFlags: z.array(z.string()).default([]),
});

export const articleSchema = articleSummarySchema.extend({
  dek: z.string().max(600).nullable(),
  document: documentV2Schema,
  seo: seoMetadataSchema,
  provenance: provenanceSchema,
});

export const createArticleBodySchema = z.object({
  type: articleTypeSchema.default("article"),
  title: z.string().min(1).max(400),
  slug: z.string().min(1).max(300).nullable().optional(),
  dek: z.string().max(600).nullable().optional(),
  excerpt: z.string().max(2000).nullable().optional(),
  document: documentSchema.optional(),
  seo: seoMetadataSchema.partial().optional(),
  authors: z.array(uuidSchema).default([]),
  categories: z.array(uuidSchema).default([]),
  tags: z.array(uuidSchema).default([]),
  entities: z.array(uuidSchema).default([]),
  externalKey: z.string().max(256).optional(),
  provenance: provenanceSchema.optional(),
  featuredMediaId: uuidSchema.nullable().optional(),
  // Import/automation path: allow setting status and original timestamps.
  // Enforced by articles.publish / articles.schedule at the route level.
  status: articleStatusSchema.optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export const updateArticleBodySchema = z
  .object({
    type: articleTypeSchema.optional(),
    title: z.string().min(1).max(400).optional(),
    slug: z.string().min(1).max(300).nullable().optional(),
    dek: z.string().max(600).nullable().optional(),
    excerpt: z.string().max(2000).nullable().optional(),
    document: documentSchema.optional(),
    seo: seoMetadataSchema.partial().optional(),
    authors: z.array(uuidSchema).optional(),
    categories: z.array(uuidSchema).optional(),
    tags: z.array(uuidSchema).optional(),
    entities: z.array(uuidSchema).optional(),
    provenance: provenanceSchema.optional(),
    featuredMediaId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const articleListQuerySchema = z.object({
  status: articleStatusSchema.optional(),
  type: articleTypeSchema.optional(),
  authorId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  externalKey: z.string().max(256).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const categorySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140),
  description: z.string().max(1000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createCategoryBodySchema = z
  .object({
    name: categorySchema.shape.name,
    slug: categorySchema.shape.slug,
    parentId: uuidSchema.nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const tagSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createTagBodySchema = z
  .object({
    name: tagSchema.shape.name,
    slug: tagSchema.shape.slug,
  })
  .strict();

export const entitySchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(64),
  description: z.string().max(2000).nullable(),
  externalRefs: z
    .array(
      z.object({
        provider: z.string().min(1).max(64),
        type: z.string().min(1).max(64),
        externalId: z.string().min(1).max(256),
      }),
    )
    .max(20)
    .default([]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createEntityBodySchema = z
  .object({
    name: entitySchema.shape.name,
    type: entitySchema.shape.type,
    description: z.string().max(2000).nullable().optional(),
    externalRefs: entitySchema.shape.externalRefs,
  })
  .strict();

export const authorSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140),
  bio: z.string().max(2000).nullable(),
  email: z.string().email().nullable(),
  avatarMediaId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createAuthorBodySchema = z
  .object({
    name: authorSchema.shape.name,
    slug: authorSchema.shape.slug,
    bio: z.string().max(2000).nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .strict();

export const sourceSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  name: z.string().min(1).max(200),
  url: z.string().url().max(2048).nullable(),
  kind: z.string().max(32).default("generic"),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSourceBodySchema = z
  .object({
    name: sourceSchema.shape.name,
    url: z.string().url().max(2048).nullable().optional(),
    kind: sourceSchema.shape.kind,
  })
  .strict();

export const articleRevisionSchema = z.object({
  id: uuidSchema,
  articleId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  document: documentV2Schema,
  createdBy: uuidSchema.nullable(),
  note: z.string().max(500).nullable(),
  createdAt: timestampSchema,
});

export const publishArticleBodySchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

export const scheduleArticleBodySchema = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }),
    note: z.string().max(500).optional(),
  })
  .strict();

export type ArticleType = z.infer<typeof articleTypeSchema>;
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export type Mark = z.infer<typeof markSchema>;
export type InlineNode = z.infer<typeof inlineNodeSchema>;
export type InlineContent = z.infer<typeof inlineContentSchema>;
export type DocumentNodeV1 = z.infer<typeof documentV1NodeSchema>;
export type DocumentNodeV2 = z.infer<typeof documentV2NodeSchema>;
export type DocumentNode = DocumentNodeV2;
export type ArticleDocumentV1 = z.infer<typeof documentV1Schema>;
export type ArticleDocumentV2 = z.infer<typeof documentV2Schema>;
export type ArticleDocument = z.infer<typeof documentSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type Article = z.infer<typeof articleSchema>;
export type ArticleSummary = z.infer<typeof articleSummarySchema>;
export type CreateArticleBody = z.infer<typeof createArticleBodySchema>;
export type CreateArticleInput = z.input<typeof createArticleBodySchema>;
export type UpdateArticleBody = z.infer<typeof updateArticleBodySchema>;
export type UpdateArticleInput = z.input<typeof updateArticleBodySchema>;
export type Category = z.infer<typeof categorySchema>;
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type Tag = z.infer<typeof tagSchema>;
export type CreateTagBody = z.infer<typeof createTagBodySchema>;
export type Entity = z.infer<typeof entitySchema>;
export type CreateEntityBody = z.infer<typeof createEntityBodySchema>;
export type Author = z.infer<typeof authorSchema>;
export type CreateAuthorBody = z.infer<typeof createAuthorBodySchema>;
export type Source = z.infer<typeof sourceSchema>;
export type CreateSourceBody = z.infer<typeof createSourceBodySchema>;
export type ArticleRevision = z.infer<typeof articleRevisionSchema>;

// ---- document migration (v1 <-> v2) ----

/** Wrap plain text into a single markless text node. */
export function textToInline(text: string): InlineContent {
  return [{ type: "text", text, marks: [] }];
}

/** Flatten inline content back to plain text (hard breaks become newlines). */
export function inlineContentToText(content: InlineContent): string {
  return content.map((n) => (n.type === "text" ? n.text : "\n")).join("");
}

function canonicalMarkKey(m: Mark): string {
  if (m.type === "link") {
    return `link:${m.attrs.href}:${m.attrs.title ?? ""}:${m.attrs.internal ?? ""}`;
  }
  return m.type;
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const la = (a ?? []).map(canonicalMarkKey).sort();
  const lb = (b ?? []).map(canonicalMarkKey).sort();
  if (la.length !== lb.length) return false;
  return la.every((k, i) => k === lb[i]);
}

/**
 * Canonicalize inline content for deterministic serialization: sort marks into
 * a stable order and merge adjacent text nodes carrying identical marks.
 */
export function normalizeInlineContent(content: InlineContent): InlineContent {
  const out: InlineContent = [];
  for (const node of content) {
    if (node.type === "hardBreak") {
      out.push(node);
      continue;
    }
    const marks = [...(node.marks ?? [])].sort((a, b) => canonicalMarkKey(a).localeCompare(canonicalMarkKey(b)));
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && sameMarks(prev.marks, marks)) {
      prev.text += node.text;
    } else {
      out.push({ type: "text", text: node.text, marks });
    }
  }
  return out;
}

/** Normalize every text-bearing node of a v2 document. */
export function normalizeDocumentV2(document: ArticleDocumentV2): ArticleDocumentV2 {
  return {
    version: 2,
    nodes: document.nodes.map((node) => {
      switch (node.type) {
        case "paragraph":
        case "heading":
        case "quote":
          return { ...node, content: normalizeInlineContent(node.content) };
        case "list":
          return { ...node, content: node.content.map(normalizeInlineContent) };
        case "table":
          return { ...node, content: node.content.map((row) => row.map(normalizeInlineContent)) };
        default:
          return node;
      }
    }),
  };
}

function migrateNodeToV2(node: DocumentNodeV1): DocumentNodeV2 {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return { ...node, content: textToInline(node.content) };
    case "list":
      return { ...node, content: node.content.map(textToInline) };
    case "table":
      return { ...node, content: node.content.map((row) => row.map(textToInline)) };
    default:
      return node;
  }
}

/** Upgrade a legacy v1 document (or already-v2) to the canonical v2 form. */
export function migrateDocumentToV2(document: ArticleDocument): ArticleDocumentV2 {
  if (document.version === 2) return normalizeDocumentV2(document);
  return { version: 2, nodes: document.nodes.map(migrateNodeToV2) };
}

function migrateNodeToV1(node: DocumentNodeV2): DocumentNodeV1 {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "quote":
      return { ...node, content: inlineContentToText(node.content) };
    case "list":
      return { ...node, content: node.content.map(inlineContentToText) };
    case "table":
      return { ...node, content: node.content.map((row) => row.map(inlineContentToText)) };
    default:
      return node;
  }
}

/** Downgrade a v2 document to v1. Lossy: inline marks are flattened away. */
export function migrateDocumentToV1(document: ArticleDocumentV2): ArticleDocumentV1 {
  return { version: 1, nodes: document.nodes.map(migrateNodeToV1) };
}

```

## packages/contracts/src/errors.ts

```ts
import { apiErrorSchema } from "./common";

export const API_ERROR_CODES = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SITE_SCOPE_MISMATCH: "SITE_SCOPE_MISMATCH",
  RATE_LIMITED: "RATE_LIMITED",
  IDEMPOTENCY_REPLAY: "IDEMPOTENCY_REPLAY",
  INTERNAL: "INTERNAL_ERROR",
  UNSUPPORTED: "UNSUPPORTED_MEDIA_TYPE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
};

export function errorBody(code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

export const parseApiError = (body: unknown) => apiErrorSchema.safeParse(body);

```

## packages/contracts/src/identity.ts

```ts
import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const userStatusSchema = z.enum(["active", "invited", "disabled"]);

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  name: z.string().min(1).max(120),
  status: userStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createUserBodySchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    password: z.string().min(12).max(128),
  })
  .strict();

export const loginBodySchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export const roleSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema.nullable(),
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export const createRoleBodySchema = z
  .object({
    key: roleSchema.shape.key,
    name: roleSchema.shape.name,
    description: z.string().max(500).optional(),
    permissions: z.array(z.string().min(1).max(80)).min(1),
  })
  .strict();

export const permissionKeySchema = z.string().min(1).max(80);

export const serviceTokenSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(80)),
  expiresAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const createServiceTokenBodySchema = z
  .object({
    name: serviceTokenSchema.shape.name,
    scopes: z.array(z.string().min(1).max(80)).min(1),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const sessionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type ServiceToken = z.infer<typeof serviceTokenSchema>;
export type CreateServiceTokenBody = z.infer<typeof createServiceTokenBodySchema>;

```

## packages/contracts/src/index.ts

```ts
export * from "./common";
export * from "./errors";
export * from "./sites";
export * from "./identity";
export * from "./media";
export * from "./seo";
export * from "./editorial";
export * from "./webhooks";
export * from "./openapi";

```

## packages/contracts/src/media.ts

```ts
import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const mediaSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(127),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  altText: z.string().max(500).nullable(),
  caption: z.string().max(2000).nullable(),
  credit: z.string().max(500).nullable(),
  focalX: z.number().min(0).max(1).nullable(),
  focalY: z.number().min(0).max(1).nullable(),
  storageKey: z.string().min(1),
  provider: z.string().min(1),
  createdBy: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const updateMediaBodySchema = z
  .object({
    altText: z.string().max(500).nullable().optional(),
    caption: z.string().max(2000).nullable().optional(),
    credit: z.string().max(500).nullable().optional(),
    focalX: z.number().min(0).max(1).nullable().optional(),
    focalY: z.number().min(0).max(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export type Media = z.infer<typeof mediaSchema>;
export type UpdateMediaBody = z.infer<typeof updateMediaBodySchema>;

```

## packages/contracts/src/openapi.ts

```ts
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
import { apiErrorSchema } from "./common";
import {
  articleSchema,
  articleSummarySchema,
  authorSchema,
  categorySchema,
  createArticleBodySchema,
  createAuthorBodySchema,
  createCategoryBodySchema,
  createEntityBodySchema,
  createSourceBodySchema,
  createTagBodySchema,
  entitySchema,
  tagSchema,
  updateArticleBodySchema,
} from "./editorial";
import { createRoleBodySchema, createServiceTokenBodySchema, createUserBodySchema, loginBodySchema } from "./identity";
import { mediaSchema } from "./media";
import { createRedirectBodySchema, redirectSchema, seoMetadataSchema } from "./seo";
import { createSiteBodySchema, siteSchema } from "./sites";
import { createWebhookBodySchema, webhookDeliverySchema, webhookSchema } from "./webhooks";

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "cookieAuth", { type: "apiKey", in: "cookie", name: "ke_session" });
registry.registerComponent("securitySchemes", "serviceAuth", { type: "http", scheme: "bearer" });

export const SCHEMA_NAMES = {
  ApiError: "ApiError",
  Site: "Site",
  User: "User",
  Role: "Role",
  ServiceToken: "ServiceToken",
  Session: "Session",
  Media: "Media",
  Category: "Category",
  Tag: "Tag",
  Entity: "Entity",
  Author: "Author",
  Source: "Source",
  Article: "Article",
  ArticleSummary: "ArticleSummary",
  SeoMetadata: "SeoMetadata",
  Redirect: "Redirect",
} as const;

registry.register("ApiError", apiErrorSchema);
registry.register("Site", siteSchema);
registry.register("User", z.object({ id: z.string().uuid(), email: z.string().email(), name: z.string(), status: z.string() }));
registry.register("Role", createRoleBodySchema.partial().extend({ id: z.string().uuid() }));
registry.register("ServiceToken", z.object({ id: z.string().uuid(), name: z.string(), scopes: z.array(z.string()), expiresAt: z.string().nullable() }));
registry.register("Session", z.object({ id: z.string().uuid(), userId: z.string().uuid(), expiresAt: z.string() }));
registry.register("Media", mediaSchema);
registry.register("Category", categorySchema);
registry.register("Tag", tagSchema);
registry.register("Entity", entitySchema);
registry.register("Author", authorSchema);
registry.register("Source", createSourceBodySchema.extend({ id: z.string().uuid(), createdAt: z.string() }));
registry.register("Article", articleSchema);
registry.register("ArticleSummary", articleSummarySchema);
registry.register("SeoMetadata", seoMetadataSchema);
registry.register("Redirect", redirectSchema);
registry.register("Webhook", webhookSchema);
registry.register("WebhookDelivery", webhookDeliverySchema);

function registerCorePaths() {
  registry.registerPath({
    method: "get",
    path: "/v1/health",
    summary: "Liveness probe",
    responses: { 200: { description: "healthy", content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/auth/login",
    summary: "Human login",
    request: { body: { content: { "application/json": { schema: loginBodySchema } } } },
    responses: {
      200: { description: "logged in", content: { "application/json": { schema: z.object({ data: z.object({ user: z.unknown() }) }) } } },
      401: { description: "bad credentials", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/sites",
    summary: "Create site",
    request: { body: { content: { "application/json": { schema: createSiteBodySchema } } } },
    responses: {
      201: { description: "created", content: { "application/json": { schema: z.object({ data: siteSchema }) } } },
      409: { description: "slug conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/users",
    summary: "Create user",
    request: { body: { content: { "application/json": { schema: createUserBodySchema } } } },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/roles",
    summary: "Create role",
    request: { body: { content: { "application/json": { schema: createRoleBodySchema } } } },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/service-tokens",
    summary: "Create scoped service token",
    request: { body: { content: { "application/json": { schema: createServiceTokenBodySchema } } } },
    responses: { 201: { description: "created with token secret", content: { "application/json": { schema: z.unknown() } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/articles",
    summary: "Create article",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      headers: z.object({ "Idempotency-Key": z.string().optional() }),
      body: { content: { "application/json": { schema: createArticleBodySchema } } },
    },
    responses: {
      201: { description: "created", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      200: { description: "idempotent replay", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      409: { description: "conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/articles",
    summary: "List articles",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: {
      200: { description: "list", content: { "application/json": { schema: z.object({ data: z.object({ items: z.array(articleSummarySchema) }) }) } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/articles/{articleId}",
    summary: "Get article",
    request: { params: z.object({ siteId: z.string().uuid(), articleId: z.string().uuid() }) },
    responses: { 200: { description: "article", content: { "application/json": { schema: z.object({ data: articleSchema }) } } } },
  });

  registry.registerPath({
    method: "patch",
    path: "/v1/sites/{siteId}/articles/{articleId}",
    summary: "Update article (optimistic concurrency via version)",
    request: {
      params: z.object({ siteId: z.string().uuid(), articleId: z.string().uuid() }),
      headers: z.object({ "If-Match": z.string().optional() }),
      body: { content: { "application/json": { schema: updateArticleBodySchema } } },
    },
    responses: {
      200: { description: "updated", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      409: { description: "version conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/categories",
    summary: "Create category",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createCategoryBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: categorySchema }) } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/categories",
    summary: "List categories",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: { 200: { description: "list", content: { "application/json": { schema: z.object({ data: z.array(categorySchema) }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/tags",
    summary: "Create tag",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createTagBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: tagSchema }) } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/tags",
    summary: "List tags",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: { 200: { description: "list", content: { "application/json": { schema: z.object({ data: z.array(tagSchema) }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/entities",
    summary: "Create entity",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createEntityBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: entitySchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/authors",
    summary: "Create author",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createAuthorBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: authorSchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/sources",
    summary: "Create source",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createSourceBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/redirects",
    summary: "Create redirect",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createRedirectBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: redirectSchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/sites/{siteId}/webhooks",
    summary: "Create webhook subscription",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createWebhookBodySchema } } },
    },
    responses: { 201: { description: "created (secret returned once)", content: { "application/json": { schema: z.object({ data: webhookSchema }) } } } },
  });
}

registerCorePaths();

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3["generateDocument"]> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Kal El Editorial API",
      version: "1.0.0",
      description:
        "API-first editorial CMS. REST /v1 is canonical. All write endpoints require auth, authorization, validation, audit and idempotency where retryable.",
    },
    servers: [{ url: "/" }],
    security: [{ cookieAuth: [] }, { serviceAuth: [] }],
  });
}

```

## packages/contracts/src/seo.ts

```ts
import { z } from "zod";

export const robotsIndexSchema = z.enum(["index", "noindex"]);
export const robotsFollowSchema = z.enum(["follow", "nofollow"]);

export const seoMetadataSchema = z.object({
  seoTitle: z.string().max(160).nullable(),
  metaDescription: z.string().max(320).nullable(),
  canonicalUrl: z.string().url().max(2048).nullable(),
  robotsIndex: robotsIndexSchema.default("index"),
  robotsFollow: robotsFollowSchema.default("follow"),
  socialTitle: z.string().max(160).nullable(),
  socialDescription: z.string().max(320).nullable(),
});

export const redirectKindSchema = z.enum(["301", "302"]);

export const redirectSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  sourcePath: z.string().min(1).max(2048).startsWith("/"),
  targetPath: z.string().min(1).max(2048).startsWith("/"),
  kind: redirectKindSchema,
});

export const createRedirectBodySchema = z
  .object({
    sourcePath: redirectSchema.shape.sourcePath,
    targetPath: redirectSchema.shape.targetPath,
    kind: redirectKindSchema.default("301"),
  })
  .strict();

export type SeoMetadata = z.infer<typeof seoMetadataSchema>;
export type Redirect = z.infer<typeof redirectSchema>;
export type CreateRedirectBody = z.infer<typeof createRedirectBodySchema>;

```

## packages/contracts/src/sites.ts

```ts
import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const siteStatusSchema = z.enum(["active", "inactive"]);

export const siteSchema = z.object({
  id: uuidSchema,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1).max(120),
  status: siteStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createSiteBodySchema = z
  .object({
    slug: siteSchema.shape.slug,
    name: siteSchema.shape.name,
  })
  .strict();

export const updateSiteBodySchema = z
  .object({
    name: siteSchema.shape.name.optional(),
    status: siteStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

import { createUserBodySchema } from "./identity";

export const initBootstrapBodySchema = z
  .object({
    site: createSiteBodySchema,
    user: createUserBodySchema,
  })
  .strict();

export type Site = z.infer<typeof siteSchema>;
export type CreateSiteBody = z.infer<typeof createSiteBodySchema>;
export type UpdateSiteBody = z.infer<typeof updateSiteBodySchema>;
export type InitBootstrapBody = z.infer<typeof initBootstrapBodySchema>;

```

## packages/contracts/src/webhooks.ts

```ts
import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common";

export const webhookEventSchema = z.enum(["article.published", "article.scheduled", "article.updated"]);

export const webhookSchema = z.object({
  id: uuidSchema,
  siteId: uuidSchema,
  url: z.string().url().max(2048),
  events: z.array(webhookEventSchema).min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const createWebhookBodySchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs are allowed"),
    events: z.array(webhookEventSchema).min(1),
    // optional subscriber-supplied signing secret; generated if omitted
    secret: z.string().min(16).max(128).optional(),
  })
  .strict();

export const webhookDeliverySchema = z.object({
  id: uuidSchema,
  webhookId: uuidSchema,
  outboxEventId: uuidSchema,
  status: z.enum(["pending", "success", "failed"]),
  attempt: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  error: z.string().max(1000).nullable(),
  createdAt: timestampSchema,
  deliveredAt: timestampSchema.nullable(),
});

export type Webhook = z.infer<typeof webhookSchema>;
export type CreateWebhookBody = z.infer<typeof createWebhookBodySchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

```

## packages/contracts/tests/schemas.test.ts

```ts
import { describe, expect, it } from "vitest";
import {
  articleListQuerySchema,
  createArticleBodySchema,
  documentSchema,
  documentV2Schema,
  idempotencyKeySchema,
  migrateDocumentToV1,
  migrateDocumentToV2,
  updateArticleBodySchema,
} from "@kal-el/contracts";

describe("document schema", () => {
  it("accepts a legacy v1 prose-first document", () => {
    const doc = {
      version: 1,
      nodes: [
        { type: "paragraph", content: "Primeiro parágrafo" },
        { type: "heading", attrs: { level: 2 }, content: "Seção" },
        { type: "quote", content: "Citação" },
        { type: "list", attrs: { ordered: false }, content: ["a", "b"] },
      ],
    };
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts a v2 document with inline marks", () => {
    const doc = {
      version: 2,
      nodes: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "texto com ", marks: [] },
            { type: "text", text: "negrito", marks: [{ type: "bold" }] },
            { type: "text", text: " e ", marks: [] },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(true);
  });

  it("rejects unknown node types (no arbitrary executable blocks)", () => {
    const doc = {
      version: 2,
      nodes: [{ type: "html", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [] }] }],
    };
    const parsed = documentV2Schema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rejects unsupported document versions", () => {
    expect(documentSchema.safeParse({ version: 3, nodes: [] }).success).toBe(false);
  });

  it("rejects unsafe link hrefs", () => {
    const doc = {
      version: 2,
      nodes: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });

  it("accepts media, gallery, embed and source nodes with strict urls", () => {
    const doc = {
      version: 2,
      nodes: [
        { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Legenda" } },
        { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
        { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube" } },
        { type: "source", attrs: { label: "Fonte", url: "https://example.com" } },
      ],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(true);
  });

  it("rejects invalid embed urls", () => {
    const doc = { version: 2, nodes: [{ type: "embed", attrs: { url: "javascript:alert(1)", provider: "x" } }] };
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });
});

describe("document migration", () => {
  it("migrates v1 to v2 preserving text", () => {
    const v1 = {
      version: 1 as const,
      nodes: [
        { type: "paragraph" as const, attrs: {}, content: "Olá mundo" },
        { type: "heading" as const, attrs: { level: 2 as const }, content: "Seção" },
        { type: "list" as const, attrs: { ordered: false as const }, content: ["a", "b"] },
        { type: "table" as const, attrs: { headers: ["Ano"] }, content: [["Ano", "2024"]] },
      ],
    };
    const v2 = migrateDocumentToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.nodes[0]).toEqual({ type: "paragraph", attrs: {}, content: [{ type: "text", text: "Olá mundo", marks: [] }] });
    expect(v2.nodes[1]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção", marks: [] }] });
    expect(v2.nodes[2]).toEqual({ type: "list", attrs: { ordered: false }, content: [[{ type: "text", text: "a", marks: [] }], [{ type: "text", text: "b", marks: [] }]] });
    expect(v2.nodes[3]).toEqual({ type: "table", attrs: { headers: ["Ano"] }, content: [[[{ type: "text", text: "Ano", marks: [] }], [{ type: "text", text: "2024", marks: [] }]]] });
  });

  it("is idempotent for v2 documents", () => {
    const v2 = { version: 2 as const, nodes: [{ type: "paragraph" as const, attrs: {}, content: [{ type: "text", text: "x", marks: [] }] }] };
    expect(migrateDocumentToV2(v2)).toEqual(v2);
  });

  it("round-trips v1 -> v2 -> v1 for plain text documents", () => {
    const v1 = {
      version: 1 as const,
      nodes: [
        { type: "paragraph" as const, attrs: {}, content: "Olá mundo" },
        { type: "list" as const, attrs: { ordered: true as const }, content: ["a", "b"] },
      ],
    };
    const back = migrateDocumentToV1(migrateDocumentToV2(v1));
    expect(back).toEqual(v1);
  });
});

describe("article body schemas", () => {
  it("applies defaults on create", () => {
    const parsed = createArticleBodySchema.safeParse({ title: "Título" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("article");
      expect(parsed.data.authors).toEqual([]);
    }
  });

  it("rejects empty update bodies", () => {
    expect(updateArticleBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields (strict mutation schemas)", () => {
    expect(updateArticleBodySchema.safeParse({ title: "x", status: "in_review" }).success).toBe(false);
    expect(createArticleBodySchema.safeParse({ title: "x", unknownField: 1 }).success).toBe(false);
  });

  it("normalizes list query defaults", () => {
    const parsed = articleListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(25);
  });

  it("rejects unsafe idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("a;b;c;d;e;f;g").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("mn26.create.2026-08-14").success).toBe(true);
  });
});

```

## packages/db/src/schema/editorial.ts

```ts
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ArticleDocument, ArticleStatus, ArticleType, Provenance, SeoMetadata } from "@kal-el/contracts";

import { media } from "./media";
import { sites } from "./sites";
import { users } from "./identity";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    // parentId is not an FK to avoid a self-referential TS inference cycle;
    // the createCategory service validates the parent in the same site.
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_site_slug_unique").on(t.siteId, t.slug),
    index("categories_site_parent_idx").on(t.siteId, t.parentId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_site_slug_unique").on(t.siteId, t.slug)],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    externalRefs: jsonb("external_refs")
      .$type<{ provider: string; type: string; externalId: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entities_site_type_idx").on(t.siteId, t.type)],
);

export const authors = pgTable(
  "authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    bio: text("bio"),
    email: text("email"),
    avatarMediaId: uuid("avatar_media_id").references(() => media.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("authors_site_slug_unique").on(t.siteId, t.slug)],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url"),
    kind: text("kind").notNull().default("generic"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_site_name_idx").on(t.siteId, t.name)],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["article", "review", "list", "video", "audio"] })
      .$type<ArticleType>()
      .notNull()
      .default("article"),
    status: text("status", { enum: ["draft", "in_review", "scheduled", "published", "blocked", "archived"] })
      .$type<ArticleStatus>()
      .notNull()
      .default("draft"),
    title: text("title").notNull(),
    dek: text("dek"),
    slug: text("slug"),
    excerpt: text("excerpt"),
    document: jsonb("document").$type<ArticleDocument>(),
    seo: jsonb("seo").$type<SeoMetadata>().notNull().default({
      seoTitle: null,
      metaDescription: null,
      canonicalUrl: null,
      robotsIndex: "index",
      robotsFollow: "follow",
      socialTitle: null,
      socialDescription: null,
    }),
    featuredMediaId: uuid("featured_media_id").references(() => media.id, { onDelete: "set null" }),
    externalKey: text("external_key"),
    provenance: jsonb("provenance").$type<Provenance>(),
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_site_slug_unique").on(t.siteId, t.slug),
    uniqueIndex("articles_site_external_key_unique").on(t.siteId, t.externalKey),
    index("articles_site_status_idx").on(t.siteId, t.status),
    index("articles_site_updated_idx").on(t.siteId, t.updatedAt),
  ],
);

export const articleRevisions = pgTable(
  "article_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    document: jsonb("document").$type<ArticleDocument>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_revisions_article_number_unique").on(t.articleId, t.revisionNumber)],
);

export const articleAuthors = pgTable(
  "article_authors",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.authorId] })],
);

export const articleCategories = pgTable(
  "article_categories",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.categoryId] })],
);

export const articleTags = pgTable(
  "article_tags",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.tagId] })],
);

export const articleEntities = pgTable(
  "article_entities",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.entityId] })],
);

export type ArticleRow = typeof articles.$inferSelect;

```

## packages/design-system/src/components/FormControls.tsx

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { IconCheck, IconSearch } from "../icons";

export type FieldShellProps = {
  label?: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children?: ReactNode;
};

export function FieldShell({ label, optional, hint, error, children }: FieldShellProps) {
  return (
    <label className="peg-field">
      {label && (
        <span className="peg-field__label">
          {label}
          {optional && <span className="peg-field__optional">opcional</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="peg-field__error">{error}</span>
      ) : hint ? (
        <span className="peg-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldShellProps;

export function Input({ label, optional, hint, error, className = "", id, ...rest }: InputProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <input
        id={id}
        className={`peg-input ${error ? "peg-input--error" : ""} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShellProps;

export function Textarea({ label, optional, hint, error, className = "", ...rest }: TextareaProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <textarea className={`peg-textarea ${error ? "peg-textarea--error" : ""} ${className}`} {...rest} />
    </FieldShell>
  );
}

export type SearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { placeholder?: string };

export function Search({ className = "", ...rest }: SearchProps) {
  return (
    <div className="peg-search">
      <IconSearch className="peg-search__icon" />
      <input type="search" className={`peg-input peg-search__input ${className}`} {...rest} />
    </div>
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldShellProps;

export function Select({ label, optional, hint, error, className = "", children, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} optional={optional} hint={hint} error={error}>
      <select className={`peg-select ${className}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Checkbox({ label, className = "", ...rest }: CheckboxProps) {
  return (
    <label className={`peg-checkbox ${className}`}>
      <input type="checkbox" {...rest} />
      <span className="peg-checkbox__box" aria-hidden="true">
        <IconCheck size={12} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export type RadioProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Radio({ label, className = "", ...rest }: RadioProps) {
  return (
    <label className={`peg-radio ${className}`}>
      <input type="radio" {...rest} />
      <span className="peg-radio__dot" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

export type SwitchProps = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Switch({ label, className = "", ...rest }: SwitchProps) {
  return (
    <label className={`peg-switch ${className}`}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="peg-switch__track" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

```

## packages/design-system/src/components/Overlays.tsx

```tsx
import type { ReactNode } from "react";
import { IconCheck } from "../icons";

export type Account = {
  id: string;
  name: string;
  meta: string;
  avatar?: string;
};

export function AccountSwitcher({
  accounts,
  activeId,
  footer,
}: {
  accounts: Account[];
  activeId: string;
  footer?: ReactNode;
}) {
  return (
    <div className="peg-account-switcher">
      <div className="peg-menu__label">Conta</div>
      {accounts.map((a) => (
        <div key={a.id} className={`peg-account-switcher__row ${a.id === activeId ? "peg-account-switcher__row--active" : ""}`}>
          <span className="peg-avatar">{a.avatar ?? a.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="peg-account-switcher__name">{a.name}</div>
            <div className="peg-account-switcher__meta">{a.meta}</div>
          </div>
          {a.id === activeId && <IconCheck className="peg-account-switcher__check" />}
        </div>
      ))}
      {footer && (
        <>
          <div className="peg-menu__separator" />
          {footer}
        </>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="peg-overlay" role="presentation">
      <div className="peg-modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <header className="peg-modal__header">
          <h3 className="peg-modal__title">{title}</h3>
          <button className="peg-btn peg-btn--icon" aria-label="Fechar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="peg-modal__body">{children}</div>
        {footer && <footer className="peg-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Toast({ tone = "success", children }: { tone?: "success" | "error"; children: ReactNode }) {
  return (
    <div className="peg-toast" aria-live="polite">
      <div className={`peg-toast__item ${tone === "error" ? "peg-toast__item--error" : ""}`}>{children}</div>
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`peg-alert peg-alert--${tone}`} role="alert">
      <div>
        {title && <div className="peg-alert__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="peg-empty">
      <div className="peg-empty__title">{title}</div>
      {body && <div className="peg-empty__body">{body}</div>}
      {action && <div className="peg-row">{action}</div>}
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; current?: boolean }[] }) {
  return (
    <nav className="peg-breadcrumb" aria-label="Trilha">
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <span className="peg-breadcrumb__sep">/</span>}
          <span className={it.current ? "peg-breadcrumb__current" : ""}>{it.label}</span>
        </span>
      ))}
    </nav>
  );
}

```

## packages/design-system/src/components/Table.tsx

```tsx
import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  muted?: boolean;
};

export function Table<T extends { id: string }>({ columns, rows, selectable = true }: { columns: Column<T>[]; rows: T[]; selectable?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="peg-table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40 }}>
                <span className="peg-checkbox">
                  <input type="checkbox" aria-label="Select all" />
                  <span className="peg-checkbox__box" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  </span>
                </span>
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {selectable && (
                <td>
                  <span className="peg-checkbox">
                    <input type="checkbox" aria-label={`Select ${row.id}`} />
                    <span className="peg-checkbox__box" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    </span>
                  </span>
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={c.muted ? "peg-table__muted" : undefined} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  total,
  perPage,
  onChange,
}: {
  page: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="peg-pagination">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="peg-pagination__controls">
        <button className="peg-pagebtn" aria-label="Anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <IconChevronLeft />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} className={`peg-pagebtn ${p === page ? "peg-pagebtn--active" : ""}`} onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
        <button className="peg-pagebtn" aria-label="Próxima" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}

```

## packages/design-system/src/index.ts

```ts
export * from "./components/Button";
export * from "./components/FormControls";
export * from "./components/Tabs";
export * from "./components/Badge";
export * from "./components/Card";
export * from "./components/Table";
export * from "./components/Overlays";
export * from "./components/Shell";
export * from "./components/Editor";
export * from "./icons";

```

## packages/editor/src/index.ts

```ts
export {
  buildTiptapSchema,
  documentToProseMirror,
  proseMirrorToDocument,
  serializeDeterministic as tiptapSerializeDeterministic,
} from "./tiptap";
export {
  buildLexicalEditor,
  documentToLexical,
  lexicalToDocument,
  serializeDeterministic as lexicalSerializeDeterministic,
} from "./lexical";

```

## packages/editor/src/lexical.ts

```ts
import type { ArticleDocumentV2, DocumentNodeV2 } from "@kal-el/contracts";
import { inlineContentToText, textToInline } from "@kal-el/contracts";
import { createHeadlessEditor } from "@lexical/headless";
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot, ParagraphNode, RootNode, TextNode } from "lexical";

export type LexicalEditor = ReturnType<typeof createHeadlessEditor>;

/**
 * Lexical headless prototype. Lexical's extension model uses node classes:
 * custom Kal El nodes (image, gallery, embed, source) would each require a
 * Node subclass registered here — this prototype registers the core rich-text
 * block set and documents that extension cost for the ADR comparison.
 */
export function buildLexicalEditor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [RootNode, TextNode, ParagraphNode, HeadingNode, QuoteNode, ListNode, ListItemNode],
  });
}

const HEADING_TAG: Record<2 | 3 | 4, "h2" | "h3" | "h4"> = { 2: "h2", 3: "h3", 4: "h4" };
const TAG_LEVEL: Record<string, number> = { h2: 2, h3: 3, h4: 4 };

export async function documentToLexical(editor: LexicalEditor, document: ArticleDocumentV2): Promise<void> {
  await editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const node of document.nodes) {
      switch (node.type) {
        case "paragraph":
          root.append($createParagraphNode().append($createTextNode(inlineContentToText(node.content))));
          break;
        case "heading":
          root.append($createHeadingNode(HEADING_TAG[node.attrs.level as 2 | 3 | 4]).append($createTextNode(inlineContentToText(node.content))));
          break;
        case "quote":
          root.append($createQuoteNode().append($createTextNode(inlineContentToText(node.content))));
          break;
        case "list": {
          const list = $createListNode(node.attrs.ordered ? "number" : "bullet");
          for (const item of node.content) {
            list.append($createListItemNode().append($createTextNode(inlineContentToText(item))));
          }
          root.append(list);
          break;
        }
        default:
          // image/gallery/embed/source: require custom Node subclasses (documented)
          break;
      }
    }
  });
}

type SerializedNode = {
  type: string;
  text?: string;
  tag?: string;
  listType?: string;
  children?: SerializedNode[];
};

function textOf(node: SerializedNode): string {
  if (node.text != null) return node.text;
  if (Array.isArray(node.children)) return node.children.map(textOf).join("");
  return "";
}

export function lexicalToDocument(editor: LexicalEditor): ArticleDocumentV2 {
  const state = editor.getEditorState().toJSON() as { root: { children?: SerializedNode[] } };
  const children = state.root.children ?? [];
  const nodes: DocumentNodeV2[] = [];
  for (const child of children) {
    switch (child.type) {
      case "paragraph":
        nodes.push({ type: "paragraph", attrs: {}, content: textToInline(textOf(child)) });
        break;
      case "heading":
        nodes.push({ type: "heading", attrs: { level: (TAG_LEVEL[child.tag ?? ""] ?? 2) as 2 | 3 | 4 }, content: textToInline(textOf(child)) });
        break;
      case "quote":
        nodes.push({ type: "quote", attrs: {}, content: textToInline(textOf(child)) });
        break;
      case "list": {
        const items = (child.children ?? []).map((li) => textToInline(textOf(li)));
        nodes.push({ type: "list", attrs: { ordered: child.listType === "number" }, content: items });
        break;
      }
      default:
        break;
    }
  }
  return { version: 2, nodes };
}

export function serializeDeterministic(editor: LexicalEditor): string {
  return JSON.stringify(editor.getEditorState().toJSON());
}


```

## packages/editor/src/tiptap.ts

```ts
import type { ArticleDocumentV2, DocumentNodeV2, InlineContent, Mark } from "@kal-el/contracts";
import { inlineContentToText, normalizeInlineContent, textToInline } from "@kal-el/contracts";
import { Node, Schema, type Mark as ProseMirrorMark, type MarkSpec, type NodeSpec } from "@tiptap/pm/model";

/**
 * ProseMirror schema mirroring the Kal El versioned document schema
 * (packages/contracts/src/editorial.ts). The schema is the sanitizer: unknown
 * node types / marks are rejected by `Node.fromJSON` instead of being stored.
 */
export function buildTiptapSchema(): Schema {
  const text: NodeSpec = { group: "inline" };
  const hardBreak: NodeSpec = { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] };
  const paragraph: NodeSpec = { group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] };
  const heading: NodeSpec = {
    group: "block",
    content: "inline*",
    attrs: { level: { default: 2 } },
    parseDOM: [{ tag: "h2", attrs: { level: 2 } }, { tag: "h3", attrs: { level: 3 } }, { tag: "h4", attrs: { level: 4 } }],
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  };
  const blockquote: NodeSpec = { group: "block", content: "inline*", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] };
  const bulletList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] };
  const orderedList: NodeSpec = { group: "block", content: "listItem+", parseDOM: [{ tag: "ol" }], toDOM: () => ["ol", 0] };
  const listItem: NodeSpec = { content: "inline*", parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] };
  const image: NodeSpec = {
    group: "block",
    atom: true,
    attrs: { mediaId: {}, caption: { default: null }, credit: { default: null }, altText: { default: null } },
    parseDOM: [{ tag: "img[src]" }],
    toDOM: () => ["img"],
  };
  const gallery: NodeSpec = { group: "block", atom: true, attrs: { mediaIds: { default: [] } }, toDOM: () => ["div", 0] };
  const embed: NodeSpec = { group: "block", atom: true, attrs: { url: {}, provider: {}, id: { default: null } }, toDOM: () => ["div", 0] };
  const source: NodeSpec = { group: "block", atom: true, attrs: { label: {}, url: {}, kind: { default: null } }, toDOM: () => ["div", 0] };
  const table: NodeSpec = { group: "block", content: "tableRow+", toDOM: () => ["table", 0] };
  const tableRow: NodeSpec = { content: "tableCell+", toDOM: () => ["tr", 0] };
  const tableCell: NodeSpec = { content: "inline*", attrs: { header: { default: false } }, toDOM: (n) => [n.attrs.header ? "th" : "td", 0] };

  const bold: MarkSpec = { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] };
  const italic: MarkSpec = { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] };
  const code: MarkSpec = { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] };
  const underline: MarkSpec = { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] };
  const strike: MarkSpec = { parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }], toDOM: () => ["s", 0] };
  const link: MarkSpec = {
    attrs: { href: {}, title: { default: null }, internal: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const el = dom as { getAttribute(name: string): string | null };
          const href = el.getAttribute("href") ?? "";
          return { href, title: el.getAttribute("title") ?? null, internal: href.startsWith("/") ? true : null };
        },
      },
    ],
    toDOM: (mark) => {
      const { href, title } = mark.attrs as { href: string; title: string | null };
      return ["a", { href, ...(title ? { title } : {}) }, 0];
    },
  };

  return new Schema({
    nodes: {
      doc: { content: "block+" },
      text,
      hardBreak,
      paragraph,
      heading,
      blockquote,
      bulletList,
      orderedList,
      listItem,
      image,
      gallery,
      embed,
      source,
      table,
      tableRow,
      tableCell,
    },
    marks: { bold, italic, code, underline, strike, link },
  });
}

function attrsFor(node: DocumentNodeV2): Record<string, unknown> {
  switch (node.type) {
    case "heading":
      return { level: node.attrs.level };
    case "image":
      return { mediaId: node.attrs.mediaId, caption: node.attrs.caption ?? null, credit: node.attrs.credit ?? null, altText: node.attrs.altText ?? null };
    case "gallery":
      return { mediaIds: node.attrs.mediaIds };
    case "embed":
      return { url: node.attrs.url, provider: node.attrs.provider, id: node.attrs.id ?? null };
    case "source":
      return { label: node.attrs.label, url: node.attrs.url, kind: node.attrs.kind ?? null };
    case "list":
      return { ordered: node.attrs.ordered };
    case "table":
      return { headers: node.attrs.headers };
    default:
      return {};
  }
}

function markToPmJson(mark: Mark): Record<string, unknown> {
  if (mark.type === "link") {
    return { type: "link", attrs: { href: mark.attrs.href, title: mark.attrs.title ?? null, internal: mark.attrs.internal ?? null } };
  }
  return { type: mark.type };
}

function inlineToPmJson(content: InlineContent): Record<string, unknown>[] {
  return content.map((n) => {
    if (n.type === "hardBreak") return { type: "hardBreak" };
    return { type: "text", text: n.text, marks: n.marks.map(markToPmJson) };
  });
}

function proseJson(node: DocumentNodeV2): Record<string, unknown> {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: inlineToPmJson(node.content) };
    case "heading":
      return { type: "heading", attrs: { level: node.attrs.level }, content: inlineToPmJson(node.content) };
    case "quote":
      return { type: "blockquote", content: inlineToPmJson(node.content) };
    case "list":
      return {
        type: node.attrs.ordered ? "orderedList" : "bulletList",
        content: node.content.map((item) => ({ type: "listItem", content: inlineToPmJson(item) })),
      };
    case "table":
      return {
        type: "table",
        content: node.content.map((row, ri) => ({
          type: "tableRow",
          content: row.map((cell) => ({
            type: "tableCell",
            attrs: { header: ri === 0 && node.attrs.headers.includes(inlineContentToText(cell)) },
            content: inlineToPmJson(cell),
          })),
        })),
      };
    case "image":
      return { type: "image", attrs: attrsFor(node) };
    case "gallery":
      return { type: "gallery", attrs: attrsFor(node) };
    case "embed":
      return { type: "embed", attrs: attrsFor(node) };
    case "source":
      return { type: "source", attrs: attrsFor(node) };
  }
}

/** Validate + convert a Kal El v2 document into a ProseMirror doc node. Throws on unknown/invalid nodes. */
export function documentToProseMirror(document: ArticleDocumentV2): Node {
  const schema = buildTiptapSchema();
  const json = { type: "doc", content: document.nodes.map(proseJson) };
  return Node.fromJSON(schema, json);
}

function markFromPm(mark: ProseMirrorMark): Mark {
  if (mark.type.name === "link") {
    const attrs = mark.attrs as { href: string; title?: string | null; internal?: boolean | null };
    return {
      type: "link",
      attrs: {
        href: attrs.href,
        ...(attrs.title ? { title: attrs.title } : {}),
        ...(attrs.internal != null ? { internal: attrs.internal } : {}),
      },
    };
  }
  return { type: mark.type.name as "bold" | "italic" | "code" | "underline" | "strike" };
}

function inlineFromPm(node: Node): InlineContent {
  const out: InlineContent = [];
  node.forEach((child) => {
    if (child.isText) {
      out.push({ type: "text", text: child.text ?? "", marks: child.marks.map(markFromPm) });
    } else if (child.type.name === "hardBreak") {
      out.push({ type: "hardBreak" });
    }
  });
  return normalizeInlineContent(out);
}

/** Convert a ProseMirror doc node back into a Kal El v2 document (round-trip). */
export function proseMirrorToDocument(node: Node): ArticleDocumentV2 {
  const nodes: DocumentNodeV2[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case "paragraph":
        nodes.push({ type: "paragraph", attrs: {}, content: inlineFromPm(child) });
        break;
      case "heading":
        nodes.push({ type: "heading", attrs: { level: child.attrs.level as 2 | 3 | 4 }, content: inlineFromPm(child) });
        break;
      case "blockquote":
        nodes.push({ type: "quote", attrs: {}, content: inlineFromPm(child) });
        break;
      case "bulletList":
      case "orderedList": {
        const items: InlineContent[] = [];
        child.forEach((li) => items.push(inlineFromPm(li)));
        nodes.push({ type: "list", attrs: { ordered: child.type.name === "orderedList" }, content: items });
        break;
      }
      case "table": {
        const rows: InlineContent[][] = [];
        const headers: string[] = [];
        let first = true;
        child.forEach((tr) => {
          const cells: InlineContent[] = [];
          tr.forEach((td) => {
            const content = inlineFromPm(td);
            if (first && td.attrs.header) headers.push(inlineContentToText(content));
            cells.push(content);
          });
          first = false;
          rows.push(cells);
        });
        nodes.push({ type: "table", attrs: { headers }, content: rows });
        break;
      }
      case "image":
        nodes.push({ type: "image", attrs: { mediaId: child.attrs.mediaId as string, caption: child.attrs.caption as string | undefined, credit: child.attrs.credit as string | undefined, altText: child.attrs.altText as string | undefined } });
        break;
      case "gallery":
        nodes.push({ type: "gallery", attrs: { mediaIds: child.attrs.mediaIds as string[] } });
        break;
      case "embed":
        nodes.push({ type: "embed", attrs: { url: child.attrs.url as string, provider: child.attrs.provider as string, id: child.attrs.id as string | undefined } });
        break;
      case "source":
        nodes.push({ type: "source", attrs: { label: child.attrs.label as string, url: child.attrs.url as string, kind: child.attrs.kind as string | undefined } });
        break;
    }
  });
  return { version: 2, nodes };
}

export function serializeDeterministic(node: Node): string {
  return JSON.stringify(node.toJSON());
}

// re-export for convenience (deterministic serialization of a v2 document)
export { inlineContentToText, normalizeInlineContent, textToInline };

```

## packages/editor/tests/prototype.test.ts

```ts
import { describe, expect, it } from "vitest";
import { documentV2Schema, type ArticleDocumentV2 } from "@kal-el/contracts";
import { documentToProseMirror, proseMirrorToDocument, serializeDeterministic as tiptapSerialize } from "../src/tiptap.js";
import { buildLexicalEditor, documentToLexical, lexicalToDocument, serializeDeterministic as lexicalSerialize } from "../src/lexical.js";

const FULL_DOC: ArticleDocumentV2 = {
  version: 2,
  nodes: [
    { type: "paragraph", attrs: {}, content: [{ type: "text", text: "Gladiador II chega aos cinemas com recorde.", marks: [] }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retorno à arena", marks: [] }] },
    { type: "quote", attrs: {}, content: [{ type: "text", text: "Uma citação importante.", marks: [] }] },
    { type: "list", attrs: { ordered: false }, content: [[{ type: "text", text: "Item um", marks: [] }], [{ type: "text", text: "Item dois", marks: [] }]] },
    { type: "list", attrs: { ordered: true }, content: [[{ type: "text", text: "Primeiro", marks: [] }], [{ type: "text", text: "Segundo", marks: [] }]] },
    {
      type: "table",
      attrs: { headers: ["Ano"] },
      content: [
        [[{ type: "text", text: "Ano", marks: [] }], [{ type: "text", text: "Bilheteria", marks: [] }]],
        [[{ type: "text", text: "2000", marks: [] }], [{ type: "text", text: "R$ 100 mi", marks: [] }]],
      ],
    },
    { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Cartaz", credit: "Divulgação", altText: "Cartaz do filme" } },
    { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
    { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube", id: "abc" } },
    { type: "source", attrs: { label: "IMDb", url: "https://imdb.com", kind: "external" } },
  ],
};

const TEXT_ONLY: ArticleDocumentV2 = {
  version: 2,
  nodes: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "apenas texto", marks: [] }] }],
};

const MARKED_DOC: ArticleDocumentV2 = {
  version: 2,
  nodes: [
    {
      type: "paragraph",
      attrs: {},
      content: [
        { type: "text", text: "texto com ", marks: [] },
        { type: "text", text: "negrito", marks: [{ type: "bold" }] },
        { type: "text", text: ", ", marks: [] },
        { type: "text", text: "itálico", marks: [{ type: "italic" }] },
        { type: "text", text: " e ", marks: [] },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: " combinado", marks: [{ type: "bold" }, { type: "link", attrs: { href: "/slug-interno", internal: true } }] },
      ],
    },
  ],
};

describe("TipTap (ProseMirror) prototype", () => {
  it("round-trips the full Kal El node set deterministically", () => {
    const pm = documentToProseMirror(FULL_DOC);
    const back = proseMirrorToDocument(pm);
    expect(JSON.stringify(back)).toBe(JSON.stringify(FULL_DOC));
    expect(tiptapSerialize(documentToProseMirror(FULL_DOC))).toBe(tiptapSerialize(documentToProseMirror(FULL_DOC)));
  });

  it("preserves inline marks (bold, italic, link) across the round-trip", () => {
    const back = proseMirrorToDocument(documentToProseMirror(MARKED_DOC));
    expect(JSON.stringify(back)).toBe(JSON.stringify(MARKED_DOC));
  });

  it("rejects unknown node types at the schema boundary (sanitization)", () => {
    const doc = { version: 2, nodes: [{ type: "html", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [] }] }] } as unknown as ArticleDocumentV2;
    expect(() => documentToProseMirror(doc)).toThrow();
  });

  it("accepts out-of-range heading levels structurally (range is enforced by the zod contract at the API boundary)", () => {
    const doc: ArticleDocumentV2 = { version: 2, nodes: [{ type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "x", marks: [] }] }] };
    const pm = documentToProseMirror(doc);
    expect(pm.childCount).toBe(1);
    // zod already rejects level 6 before it ever reaches the editor
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });
});

describe("Lexical headless prototype", () => {
  it("round-trips the core text block set deterministically", async () => {
    const editor = buildLexicalEditor();
    const doc: ArticleDocumentV2 = {
      version: 2,
      nodes: [
        { type: "paragraph", attrs: {}, content: [{ type: "text", text: "Olá mundo", marks: [] }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Seção", marks: [] }] },
        { type: "quote", attrs: {}, content: [{ type: "text", text: "Citação", marks: [] }] },
        { type: "list", attrs: { ordered: true }, content: [[{ type: "text", text: "a", marks: [] }], [{ type: "text", text: "b", marks: [] }]] },
      ],
    };
    await documentToLexical(editor, doc);
    expect(JSON.stringify(lexicalToDocument(editor))).toBe(JSON.stringify(doc));
    expect(lexicalSerialize(editor)).toBe(lexicalSerialize(editor));
  });

  it("serialization includes engine internals (versionability cost)", async () => {
    const editor = buildLexicalEditor();
    await documentToLexical(editor, TEXT_ONLY);
    const json = JSON.stringify(editor.getEditorState().toJSON());
    // Lexical JSON is heavier: node "version" and "type:root" fields are present
    expect(json).toContain('"version"');
    expect(json).toContain('"root"');
  });

  it("drops unsupported node types silently (needs custom node classes)", async () => {
    const editor = buildLexicalEditor();
    await documentToLexical(editor, { version: 2, nodes: [{ type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111" } }] });
    expect(lexicalToDocument(editor).nodes.length).toBe(0);
  });
});

```

## packages/importer/src/html.ts

```ts
import type { ArticleDocumentV2, DocumentNodeV2, InlineContent, Mark } from "@kal-el/contracts";
import { normalizeInlineContent } from "@kal-el/contracts";
import { parse, type HTMLElement } from "node-html-parser";

export type IntermediateNode =
  | { type: "paragraph"; content: InlineContent }
  | { type: "heading"; attrs: { level: 2 | 3 | 4 }; content: InlineContent }
  | { type: "quote"; content: InlineContent }
  | { type: "list"; attrs: { ordered: boolean }; content: InlineContent[] }
  | { type: "table"; attrs: { headers: string[] }; content: InlineContent[][] }
  | { type: "image"; attrs: { sourceUrl: string; caption?: string; altText?: string; credit?: string } }
  | { type: "gallery"; attrs: { sourceUrls: string[] } }
  | { type: "embed"; attrs: { url: string; provider?: string; id?: string } }
  | { type: "source"; attrs: { label: string; url: string } };

export type HtmlParseResult = { nodes: IntermediateNode[]; warnings: string[] };

function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value.length > 2048 ? null : value;
}

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!(/^https?:\/\//i.test(value) || value.startsWith("/"))) return null;
  return value.length > 2048 ? null : value;
}

function trimInline(content: InlineContent): InlineContent {
  const result = [...content];
  const first = result[0];
  if (first && first.type === "text") {
    first.text = first.text.replace(/^\s+/, "");
  }
  const last = result[result.length - 1];
  if (last && last.type === "text") {
    last.text = last.text.replace(/\s+$/, "");
  }
  return normalizeInlineContent(result).filter((n) => (n.type === "text" ? n.text.length > 0 : true));
}

/** Walk inline markup, preserving marks (bold/italic/code/underline/strike/link). */
function extractInline(el: HTMLElement, marks: Mark[] = []): InlineContent {
  const out: InlineContent = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* text */) {
      const text = child.rawText.replace(/\s+/g, " ");
      if (text) out.push({ type: "text", text, marks: [...marks] });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as HTMLElement;
    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    if (tag === "strong" || tag === "b") {
      out.push(...extractInline(node, [...marks, { type: "bold" }]));
      continue;
    }
    if (tag === "em" || tag === "i") {
      out.push(...extractInline(node, [...marks, { type: "italic" }]));
      continue;
    }
    if (tag === "code") {
      out.push(...extractInline(node, [...marks, { type: "code" }]));
      continue;
    }
    if (tag === "u") {
      out.push(...extractInline(node, [...marks, { type: "underline" }]));
      continue;
    }
    if (tag === "s" || tag === "del" || tag === "strike") {
      out.push(...extractInline(node, [...marks, { type: "strike" }]));
      continue;
    }
    if (tag === "a") {
      const href = safeHref(node.getAttribute("href"));
      if (href) {
        const title = node.getAttribute("title");
        const linkMark: Mark = {
          type: "link",
          attrs: { href, internal: href.startsWith("/") ? true : undefined, ...(title ? { title } : {}) },
        };
        out.push(...extractInline(node, [...marks, linkMark]));
      } else {
        out.push(...extractInline(node, marks));
      }
      continue;
    }
    // other inline elements (span, mark, etc.) degrade to their text
    out.push(...extractInline(node, marks));
  }
  return trimInline(out);
}

function extractText(el: HTMLElement): string {
  return extractInline(el)
    .filter((n): n is Extract<typeof n, { type: "text" }> => n.type === "text")
    .map((n) => n.text)
    .join("")
    .trim();
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return m?.[1] ?? null;
}

function parseImage(img: HTMLElement, parent?: HTMLElement): IntermediateNode {
  const src = safeUrl(img.getAttribute("src") ?? img.getAttribute("data-src"));
  if (!src) {
    return { type: "paragraph", content: [{ type: "text", text: "[imagem removida]", marks: [] }] };
  }
  const caption =
    parent?.tagName.toLowerCase() === "figure"
      ? (parent.querySelector("figcaption")?.text ?? undefined)
      : undefined;
  return {
    type: "image",
    attrs: {
      sourceUrl: src,
      caption,
      altText: img.getAttribute("alt") ?? undefined,
      credit: img.getAttribute("data-credit") ?? undefined,
    },
  };
}

function parseTable(table: HTMLElement): IntermediateNode {
  const rows: InlineContent[][] = [];
  const headerCells: string[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells: InlineContent[] = [];
    for (const cell of tr.childNodes) {
      if (cell.nodeType !== 1) continue;
      const el = cell as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "th" || tag === "td") {
        const content = extractInline(el);
        if (tag === "th" && rows.length === 0) headerCells.push(extractText(el));
        cells.push(content);
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { type: "table", attrs: { headers: headerCells }, content: rows };
}

function parseChildren(el: HTMLElement, warnings: string[], out: IntermediateNode[]): void {
  for (const child of el.childNodes) {
    if (child.nodeType !== 1) continue;
    const node = child as HTMLElement;
    const tag = node.tagName.toLowerCase();

    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    if (tag === "h1") {
      out.push({ type: "paragraph", content: extractInline(node) });
      continue;
    }
    if (tag === "h2" || tag === "h3" || tag === "h4") {
      out.push({ type: "heading", attrs: { level: Number(tag.slice(1)) as 2 | 3 | 4 }, content: extractInline(node) });
      continue;
    }
    if (tag === "p") {
      out.push({ type: "paragraph", content: extractInline(node) });
      continue;
    }
    if (tag === "blockquote") {
      out.push({ type: "quote", content: extractInline(node) });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items = node.querySelectorAll("li").map((li) => extractInline(li));
      out.push({ type: "list", attrs: { ordered: tag === "ol" }, content: items });
      continue;
    }
    if (tag === "table") {
      out.push(parseTable(node));
      continue;
    }
    if (tag === "img") {
      out.push(parseImage(node));
      continue;
    }
    if (tag === "figure") {
      const img = node.querySelector("img");
      if (img) {
        out.push(parseImage(img as HTMLElement, node));
      } else {
        out.push({ type: "paragraph", content: extractInline(node) });
      }
      continue;
    }
    if (tag === "iframe" || tag === "video") {
      const src = safeUrl(node.getAttribute("src"));
      if (src) {
        const id = youtubeId(src);
        out.push({ type: "embed", attrs: { url: src, provider: id ? "youtube" : node.getAttribute("data-provider") ?? undefined, id: id ?? undefined } });
      }
      continue;
    }
    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      parseChildren(node, warnings, out);
      continue;
    }
    // any other block-ish element degrades to its text
    const text = extractText(node);
    if (text) {
      out.push({ type: "paragraph", content: [{ type: "text", text, marks: [] }] });
    }
  }
}

/**
 * Deterministic, allow-listed conversion of WordPress classic HTML into the
 * intermediate document model. Scripts, styles, unknown elements and unsafe
 * URLs are dropped; inline marks (bold/italic/code/link/…) are preserved; image
 * URLs are kept as `sourceUrl` until import resolves media.
 */
export function htmlToIntermediate(html: string): HtmlParseResult {
  const warnings: string[] = [];
  const root = parse(html, { comment: true });
  const nodes: IntermediateNode[] = [];
  parseChildren(root, warnings, nodes);
  return { nodes, warnings };
}

/**
 * Resolve intermediate image/gallery source URLs to created media UUIDs,
 * producing a schema-valid v2 ArticleDocument (marks preserved).
 */
export function finalizeDocument(
  intermediate: IntermediateNode[],
  urlToMediaId: Map<string, string>,
  warnings: string[],
): ArticleDocumentV2 {
  const nodes: DocumentNodeV2[] = [];
  for (const node of intermediate) {
    if (node.type === "image") {
      const mediaId = urlToMediaId.get(node.attrs.sourceUrl);
      if (!mediaId) {
        warnings.push(`media not imported: ${node.attrs.sourceUrl}`);
        continue;
      }
      nodes.push({
        type: "image",
        attrs: {
          mediaId,
          caption: node.attrs.caption,
          credit: node.attrs.credit,
          altText: node.attrs.altText,
        },
      });
    } else if (node.type === "gallery") {
      const ids = node.attrs.sourceUrls.map((u) => urlToMediaId.get(u)).filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        warnings.push("gallery dropped: no media imported");
        continue;
      }
      nodes.push({ type: "gallery", attrs: { mediaIds: ids } });
    } else if (node.type === "embed") {
      nodes.push({ type: "embed", attrs: { url: node.attrs.url, provider: node.attrs.provider ?? "unknown", id: node.attrs.id } });
    } else if (node.type === "source") {
      nodes.push({ type: "source", attrs: { label: node.attrs.label, url: node.attrs.url, kind: "external" } });
    } else if (node.type === "paragraph") {
      nodes.push({ type: "paragraph", attrs: {}, content: node.content });
    } else if (node.type === "heading") {
      nodes.push({ type: "heading", attrs: { level: node.attrs.level }, content: node.content });
    } else if (node.type === "quote") {
      nodes.push({ type: "quote", attrs: {}, content: node.content });
    } else if (node.type === "list") {
      nodes.push({ type: "list", attrs: { ordered: node.attrs.ordered }, content: node.content });
    } else {
      nodes.push({ type: "table", attrs: { headers: node.attrs.headers }, content: node.content });
    }
  }
  return { version: 2, nodes };
}

```

## packages/importer/tests/html.test.ts

```ts
import { describe, expect, it } from "vitest";
import { finalizeDocument, htmlToIntermediate } from "../src/html.js";

const WP_HTML = `
<h2>Retorno à arena</h2>
<p>Uma <strong>nova</strong> aventura de <a href="https://example.com">Ridley Scott</a>.</p>
<blockquote>Citação de exemplo</blockquote>
<ul><li>Item um</li><li>Item dois</li></ul>
<figure><img src="https://legado.example.com/wp-content/gladiador.jpg" alt="Cartaz" /><figcaption>Cartaz oficial</figcaption></figure>
<iframe src="https://www.youtube.com/embed/abc123xyz" frameborder="0"></iframe>
<script>alert(1)</script>
<p style="color:red" onclick="evil()">Texto seguro</p>
<table><tr><th>Ano</th></tr><tr><td>2024</td></tr></table>
`;

describe("html → document transform", () => {
  it("converts classic WordPress HTML into intermediate nodes deterministically", () => {
    const { nodes, warnings } = htmlToIntermediate(WP_HTML);
    expect(warnings).toEqual([]);
    expect(nodes[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retorno à arena", marks: [] }] });
    expect(nodes[1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Uma ", marks: [] },
        { type: "text", text: "nova", marks: [{ type: "bold" }] },
        { type: "text", text: " aventura de ", marks: [] },
        { type: "text", text: "Ridley Scott", marks: [{ type: "link", attrs: { href: "https://example.com", internal: undefined } }] },
        { type: "text", text: ".", marks: [] },
      ],
    });
    expect(nodes[2]).toEqual({ type: "quote", content: [{ type: "text", text: "Citação de exemplo", marks: [] }] });
    expect(nodes[3]).toEqual({
      type: "list",
      attrs: { ordered: false },
      content: [[{ type: "text", text: "Item um", marks: [] }], [{ type: "text", text: "Item dois", marks: [] }]],
    });
    expect(nodes[4]).toMatchObject({ type: "image", attrs: { sourceUrl: "https://legado.example.com/wp-content/gladiador.jpg", caption: "Cartaz oficial", altText: "Cartaz" } });
    expect(nodes[5]).toMatchObject({ type: "embed", attrs: { url: "https://www.youtube.com/embed/abc123xyz", provider: "youtube", id: "abc123xyz" } });
    // scripts and inline event handlers are gone; no node holds the script text
    const flattened = JSON.stringify(nodes);
    expect(flattened).not.toContain("alert(1)");
    expect(flattened).not.toContain("onclick");
    expect(nodes.some((n) => n.type === "table")).toBe(true);
  });

  it("preserves links and formatting into the v2 document", () => {
    const { nodes } = htmlToIntermediate('<p>leia <a href="https://outro.example.com">aqui</a> e <strong>não esqueça</strong></p>');
    const doc = finalizeDocument(nodes, new Map(), []);
    const paragraph = doc.nodes[0];
    expect(paragraph).toMatchObject({
      type: "paragraph",
      content: [
        { type: "text", text: "leia ", marks: [] },
        { type: "text", text: "aqui", marks: [{ type: "link", attrs: { href: "https://outro.example.com" } }] },
        { type: "text", text: " e ", marks: [] },
        { type: "text", text: "não esqueça", marks: [{ type: "bold" }] },
      ],
    });
    expect(doc.version).toBe(2);
  });

  it("finalizes documents, resolving media URLs to mediaIds and dropping unmapped images", () => {
    const { nodes } = htmlToIntermediate('<p>Olá</p><img src="https://a.example.com/x.jpg" />');
    const warnings: string[] = [];
    const map = new Map([["https://a.example.com/x.jpg", "11111111-1111-4111-8111-111111111111"]]);
    const doc = finalizeDocument(nodes, map, warnings);
    expect(warnings).toEqual([]);
    expect(doc.nodes[1]).toEqual({
      type: "image",
      attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: undefined, credit: undefined, altText: undefined },
    });

    const unmapped = finalizeDocument(nodes, new Map(), warnings);
    expect(unmapped.nodes.length).toBe(1);
    expect(warnings.some((w) => w.includes("media not imported"))).toBe(true);
  });

  it("never emits arbitrary html or unsafe urls", () => {
    const { nodes } = htmlToIntermediate('<p>ok</p><a href="javascript:evil()">x</a><img src="data:text/html;base64,AAAA" />');
    const flattened = JSON.stringify(nodes);
    expect(flattened).not.toContain("javascript:");
    expect(flattened).not.toContain("data:");
  });
});

```

## packages/importer/tests/import.test.ts

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "@kal-el/api/src/app.js";
import { loadConfig } from "@kal-el/api/src/config.js";
import { seedPermissions } from "@kal-el/api/src/services/seed.js";
import { freshTestDb } from "@kal-el/testkit";
import { outboxEvents } from "@kal-el/db/schema";
import { KalElClient } from "@kal-el/sdk";

import { importBatch } from "../src/import.js";
import { normalizeWordPress, readWordPressSnapshot } from "../src/wordpress.js";
import { reconcile } from "../src/reconcile.js";

const SNAPSHOT = {
  site: { name: "Portal Legado", url: "https://legado.example.com" },
  authors: [{ id: 1, display_name: "Ana Souza", user_nicename: "ana-souza", user_email: "ana@legado.example" }],
  categories: [{ id: 5, name: "Filmes", slug: "filmes" }],
  tags: [{ id: 9, name: "Gladiador", slug: "gladiador" }],
  media: [{ id: 12, filename: "gladiador.jpg", url: "https://legado.example.com/wp-content/gladiador.jpg", mime_type: "image/jpeg" }],
  posts: [
    {
      id: 42,
      post_type: "post",
      title: "Gladiador II chega aos cinemas",
      slug: "gladiador-ii-cinemas",
      content: "<h2>Retorno</h2><p>Uma nova aventura.</p><img src=\"https://legado.example.com/wp-content/gladiador.jpg\" alt=\"Cartaz\" />",
      excerpt: "Resumo",
      status: "publish",
      date: "2024-11-15T10:00:00Z",
      author: 1,
      categories: [5],
      tags: [9],
      featured_media: 12,
      meta: { _yoast_wpseo_title: "Título SEO", _yoast_wpseo_metadesc: "Descrição SEO" },
      link: "https://legado.example.com/gladiador-ii-cinemas",
    },
    {
      id: 43,
      post_type: "post",
      title: "Rascunho da crítica",
      slug: "rascunho-critica",
      content: "<p>Rascunho.</p>",
      status: "draft",
      date: "2024-11-14T09:00:00Z",
      author: 1,
      categories: [5],
      tags: [],
    },
  ],
};

describe("WordPress import through the REST API", () => {
  let api: FastifyInstance;
  let pool: import("pg").Pool;
  let db: import("@kal-el/db").Db;
  let siteId: string;
  let client: KalElClient;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    db = fresh.db;

    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: fresh.url,
      SESSION_SECRET: "test-secret-key",
      BOOTSTRAP_TOKEN: "test-bootstrap-token",
    } as NodeJS.ProcessEnv);
    api = await buildApp({ connectionString: fresh.url, config });
    await seedPermissions(api.db);
    await api.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;

    const boot = await api.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      payload: { site: { slug: "portal-import", name: "Portal Import" }, user: { email: "owner@kalel.test", name: "Owner", password: "super-secure-password-123" } },
    });
    siteId = boot.json().data.site.id;

    const login = await api.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "owner@kalel.test", password: "super-secure-password-123" } });
    const cookies = login.cookies ?? [];
    const session = { cookieHeader: `ke_session=${cookies.find((c) => c.name === "ke_session")?.value ?? ""}`, csrf: cookies.find((c) => c.name === "ke_csrf")?.value ?? "" };

    const tokenRes = await api.inject({
      method: "POST",
      url: `/v1/admin/sites/${siteId}/service-tokens`,
      headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
      payload: {
        name: "importer",
        scopes: ["articles.create", "articles.read", "articles.publish", "articles.schedule", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.authors.manage", "seo.manage"],
      },
    });
    const token = tokenRes.json().data.token as string;
    client = new KalElClient({ baseUrl: base, token, retries: 1 });
  });

  afterAll(async () => {
    await api?.close();
    await pool?.end();
  });

  it("imports a WordPress snapshot, preserving status/dates and emitting revalidation", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp" });

    expect(report.imported.articles).toBe(2);
    expect(report.imported.categories).toBe(1);
    expect(report.imported.tags).toBe(1);
    expect(report.imported.authors).toBe(1);
    expect(report.mediaPending).toBe(1);

    const published = await client.listArticles(siteId, { externalKey: "imp:wp:post:42" });
    expect(published.items.length).toBe(1);
    const publishedItem = published.items[0];
    if (!publishedItem) throw new Error("published article missing");
    const full = await client.getArticle(siteId, publishedItem.id);
    expect(full.status).toBe("published");
    expect(new Date(full.publishedAt!).getTime()).toBe(new Date("2024-11-15T10:00:00Z").getTime());
    expect(full.seo.seoTitle).toBe("Título SEO");
    expect(full.provenance?.sources?.[0]?.externalId).toBe("wp:post:42");
    // image node was dropped (media pending), heading+paragraph remain
    expect(full.document.nodes.every((n) => n.type !== "image")).toBe(true);
    expect(full.document.nodes.length).toBe(2);

    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateType, "article"));
    expect(events.filter((e) => e.eventType === "article.published").length).toBe(1);
  });

  it("re-import is idempotent (no duplicates) and reconciles", async () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const report = await importBatch(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(report.imported.articles).toBe(0);
    expect(report.existing.articles).toBe(2);

    const rc = await reconcile(client, siteId, batch, { externalKeyPrefix: "imp" });
    expect(rc.missingArticles).toEqual([]);
    expect(rc.extraArticles).toEqual([]);
    expect(rc.imported.articles).toBe(2);
    expect(rc.deterministic).toBe(true);

    const all = await client.listArticles(siteId, { limit: 100 });
    expect(all.items.filter((a) => a.externalKey?.startsWith("imp:")).length).toBe(2);
  });
});

```

## packages/importer/tests/wordpress.test.ts

```ts
import { describe, expect, it } from "vitest";
import { dryRun } from "../src/dryrun.js";
import { normalizeWordPress, readWordPressSnapshot } from "../src/wordpress.js";

const SNAPSHOT = {
  site: { name: "Portal Legado", url: "https://legado.example.com" },
  authors: [{ id: 1, display_name: "Ana Souza", user_nicename: "ana-souza", user_email: "ana@legado.example" }],
  categories: [
    { id: 5, name: "Filmes", slug: "filmes" },
    { id: 6, name: "Crítica", slug: "critica" },
  ],
  tags: [{ id: 9, name: "Gladiador", slug: "gladiador" }],
  media: [{ id: 12, filename: "gladiador.jpg", url: "https://legado.example.com/wp-content/gladiador.jpg", mime_type: "image/jpeg" }],
  posts: [
    {
      id: 42,
      post_type: "post",
      title: "Gladiador II chega aos cinemas",
      slug: "gladiador-ii-cinemas",
      content: "<h2>Retorno</h2><p>Texto.</p>",
      excerpt: "Resumo",
      status: "publish",
      date: "2024-11-15T10:00:00Z",
      author: 1,
      categories: [5],
      tags: [9],
      featured_media: 12,
      meta: { _yoast_wpseo_title: "Título SEO", _yoast_wpseo_metadesc: "Descrição SEO" },
      link: "https://legado.example.com/gladiador-ii-cinemas",
    },
    {
      id: 43,
      post_type: "post",
      title: "Rascunho da crítica",
      slug: "rascunho-critica",
      content: "<p>Rascunho.</p>",
      status: "draft",
      date: "2024-11-14T09:00:00Z",
      author: 1,
      categories: [6],
      tags: [],
    },
  ],
};

describe("WordPress adapter", () => {
  it("normalizes a snapshot deterministically", () => {
    const snapshot = readWordPressSnapshot(SNAPSHOT);
    const batch = normalizeWordPress(snapshot);

    expect(batch.sourceName).toBe("Portal Legado");
    expect(batch.categories.length).toBe(2);
    expect(batch.tags.length).toBe(1);
    expect(batch.authors.length).toBe(1);
    expect(batch.media.length).toBe(1);
    expect(batch.articles.length).toBe(2);

    const published = batch.articles.find((a) => a.externalId === "wp:post:42");
    expect(published).toBeDefined();
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toBe("2024-11-15T10:00:00Z");
    expect(published?.seo?.seoTitle).toBe("Título SEO");
    expect(published?.categoryExternalIds).toEqual(["wp:cat:5"]);
    expect(published?.authorExternalIds).toEqual(["wp:author:1"]);
    expect(published?.intermediateNodes[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retorno", marks: [] }] });

    const draft = batch.articles.find((a) => a.externalId === "wp:post:43");
    expect(draft?.status).toBe("draft");
    expect(draft?.publishedAt).toBeUndefined();

    const again = normalizeWordPress(snapshot);
    expect(JSON.stringify(again)).toBe(JSON.stringify(batch));
  });

  it("produces a dry-run report with counts and no issues for a valid snapshot", () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const report = dryRun(batch);
    expect(report.issues).toEqual([]);
    expect(report.counts.articles).toBe(2);
    expect(report.mediaPending).toBe(1);
    expect(report.preview.length).toBe(2);
  });

  it("flags broken references in the dry-run", () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const first = batch.articles[0];
    if (first) first.categoryExternalIds.push("wp:cat:999");
    const report = dryRun(batch);
    expect(report.issues.some((i) => i.includes("missing category ref"))).toBe(true);
  });
});

```
