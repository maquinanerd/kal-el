import { deflateSync } from "node:zlib";
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

// ---- media fixtures ----

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

/** Minimal valid RGBA PNG, so `image-size` can read real dimensions. */
export function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4), 0);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

export function multipartBody(boundary: string, filename: string, mime: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
    Buffer.from(`Content-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

/** Upload a PNG through the real multipart route and return the created media row. */
export async function uploadTestImage(
  ctx: TestContext,
  session: Session,
  siteId: string,
  opts: { filename?: string; width?: number; height?: number } = {},
): Promise<{ id: string; bytes: Buffer }> {
  const boundary = "----kaleltestboundary";
  const png = makePng(opts.width ?? 3, opts.height ?? 2);
  const res = await ctx.app.inject({
    method: "POST",
    url: `/v1/sites/${siteId}/media`,
    headers: {
      Cookie: session.cookieHeader,
      "x-kal-el-csrf": session.csrf,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: multipartBody(boundary, opts.filename ?? "cartaz.png", "image/png", png),
  });
  if (res.statusCode !== 201) throw new Error(`media upload failed: ${res.statusCode} ${res.body}`);
  return { id: (res.json() as { data: { id: string } }).data.id, bytes: png };
}
