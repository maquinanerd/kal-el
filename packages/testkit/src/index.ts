import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { Pool } from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { createDb, createPool, runMigrations } from "@kal-el/db";
import { sites } from "@kal-el/db/schema";

export const DEFAULT_TEST_URL = "postgresql://kalel:kalel@localhost:5432/kalel_test";

let embedded: EmbeddedPostgres | null = null;
let embeddedUrl: string | null = null;
let started = false;

/**
 * Find a free TCP port to avoid collisions between parallel test processes.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        srv.close(() => resolve(addr.port));
      } else {
        srv.close(() => reject(new Error("could not allocate a free port")));
      }
    });
  });
}

/**
 * Integration tests need a real PostgreSQL. When `DATABASE_URL` is not set
 * (local dev without a running docker-compose), an embedded PostgreSQL is
 * started on a per-process ephemeral port and data directory. CI and prod
 * use an external PostgreSQL via DATABASE_URL.
 */
export async function ensureTestPostgres(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (started && embeddedUrl) return embeddedUrl;

  const port = await freePort();
  const dir = join(tmpdir(), `kalel-test-pg-${process.pid}-${Date.now()}`);
  const instance = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "kalel",
    password: "kalel",
    authMethod: "password",
    persistent: false,
    onLog: () => {},
    onError: (e) => {
      if (typeof e === "string" && /password authentication|already exists|listening/i.test(e)) return;
      console.error("[embedded-postgres]", e);
    },
  });

  await instance.initialise();
  await instance.start();
  try {
    await instance.createDatabase("kalel_test");
  } catch {
    // database already exists
  }
  embedded = instance;
  embeddedUrl = `postgresql://kalel:kalel@localhost:${port}/kalel_test`;
  started = true;
  return embeddedUrl;
}

export async function testDatabaseUrl(): Promise<string> {
  return ensureTestPostgres();
}

/**
 * Stop the embedded cluster and release the data directory. Keeps the
 * test process from hanging after the last test.
 */
export async function stopTestPostgres(): Promise<void> {
  if (embedded) {
    try {
      await embedded.stop();
    } catch {
      // already stopped
    }
    embedded = null;
    embeddedUrl = null;
    started = false;
  }
}

export async function testGlobalSetup(): Promise<void> {
  await ensureTestPostgres();
}

export async function testGlobalTeardown(): Promise<void> {
  await stopTestPostgres();
}

/**
 * Wipe and re-apply all migrations so tests run against a pristine schema.
 * Returns a pool + db bound to that pool. Caller must `pool.end()`.
 */
export async function freshTestDb(
  url?: string,
): Promise<{ pool: Pool; db: ReturnType<typeof createDb>; url: string }> {
  const target = url ?? (await ensureTestPostgres());
  const adminPool = createPool(target);
  await adminPool.query(`DROP SCHEMA IF EXISTS public CASCADE`);
  await adminPool.query(`CREATE SCHEMA public`);
  await adminPool.end();

  await runMigrations(target);

  const pool = createPool(target);
  const db = createDb(pool);
  return { pool, db, url: target };
}

export async function seedSite(db: ReturnType<typeof createDb>, slug = "portal-a", name = "Portal A") {
  const [row] = await db.insert(sites).values({ slug, name }).returning();
  if (!row) throw new Error("seedSite failed");
  return row;
}
