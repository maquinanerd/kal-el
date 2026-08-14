import type { FastifyInstance } from "fastify";
import { freshTestDb } from "@kal-el/testkit";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { seedPermissions } from "../src/services/seed.js";
import type { Db } from "@kal-el/db";

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  pool: import("pg").Pool;
  url: string;
  config: AppConfig;
  close: () => Promise<void>;
};

export async function createTestApp(overrides: Partial<Record<keyof AppConfig, string | boolean>> = {}): Promise<TestContext> {
  const fresh = await freshTestDb();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: fresh.url,
    SESSION_SECRET: "test-secret-key",
    BOOTSTRAP_TOKEN: "test-bootstrap-token",
    APP_BASE_URL: "http://localhost:3000",
    API_BASE_URL: "http://localhost:3001",
    COOKIE_SECURE: "false",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const app = await buildApp({ connectionString: fresh.url, config });
  await seedPermissions(app.db);
  return {
    app,
    db: app.db,
    pool: fresh.pool,
    url: fresh.url,
    config,
    close: async () => {
      await app.close();
      await fresh.pool.end();
    },
  };
}

export type Session = {
  cookieHeader: string;
  csrf: string;
  userId: string;
};

export async function bootstrap(ctx: TestContext): Promise<{ siteId: string; userId: string; email: string; password: string }> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/bootstrap/init",
    headers: { "x-bootstrap-token": ctx.config.BOOTSTRAP_TOKEN as string },
    payload: {
      site: { slug: "portal-a", name: "Portal A" },
      user: { email: "owner@kalel.test", name: "Owner", password: "super-secure-password-123" },
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`bootstrap failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { data: { site: { id: string }; user: { id: string } } };
  return {
    siteId: body.data.site.id,
    userId: body.data.user.id,
    email: "owner@kalel.test",
    password: "super-secure-password-123",
  };
}

export async function login(ctx: TestContext, email: string, password: string): Promise<Session> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const cookies = res.cookies ?? [];
  const session = cookies.find((c) => c.name === "ke_session");
  const csrf = cookies.find((c) => c.name === "ke_csrf");
  if (!session || !csrf) throw new Error("missing session/csrf cookies");
  const body = res.json() as { data: { user: { id: string } } };
  return {
    cookieHeader: `ke_session=${session.value}`,
    csrf: csrf.value,
    userId: body.data.user.id,
  };
}

export async function createUser(ctx: TestContext, session: Session, email: string, password: string, name = "Editor") {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/admin/users",
    headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
    payload: { email, name, password },
  });
  return res;
}

export async function createRole(ctx: TestContext, session: Session, key: string, permissions: string[]) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/admin/roles",
    headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
    payload: { key, name: key, permissions },
  });
  return res;
}

export async function assignRole(ctx: TestContext, session: Session, userId: string, roleId: string, siteId: string) {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/v1/admin/users/${userId}/roles`,
    headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
    payload: { roleId, siteId },
  });
  return res;
}

export async function createServiceToken(ctx: TestContext, session: Session, siteId: string, scopes: string[]) {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/v1/admin/sites/${siteId}/service-tokens`,
    headers: { Cookie: session.cookieHeader, "x-kal-el-csrf": session.csrf },
    payload: { name: "mn26-token", scopes },
  });
  return res;
}
