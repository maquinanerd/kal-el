import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { freshTestDb } from "@kal-el/testkit";
import { runMigrations } from "@kal-el/db";

const ALL_TABLES = [
  "sites",
  "users",
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "sessions",
  "service_tokens",
  "categories",
  "tags",
  "entities",
  "authors",
  "sources",
  "articles",
  "article_revisions",
  "article_authors",
  "article_categories",
  "article_tags",
  "article_entities",
  "media",
  "audit_log",
  "outbox_events",
  "idempotency_keys",
  "redirects",
  "webhooks",
  "webhook_deliveries",
  "worker_heartbeats",
];

// Reverse of every applied migration: reversibility is a stated engineering rule.
const DOWN_0000 = `
DROP TABLE IF EXISTS "article_entities" CASCADE;
DROP TABLE IF EXISTS "article_tags" CASCADE;
DROP TABLE IF EXISTS "article_categories" CASCADE;
DROP TABLE IF EXISTS "article_authors" CASCADE;
DROP TABLE IF EXISTS "article_revisions" CASCADE;
DROP TABLE IF EXISTS "articles" CASCADE;
DROP TABLE IF EXISTS "sources" CASCADE;
DROP TABLE IF EXISTS "authors" CASCADE;
DROP TABLE IF EXISTS "entities" CASCADE;
DROP TABLE IF EXISTS "tags" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TABLE IF EXISTS "media" CASCADE;
DROP TABLE IF EXISTS "redirects" CASCADE;
DROP TABLE IF EXISTS "outbox_events" CASCADE;
DROP TABLE IF EXISTS "idempotency_keys" CASCADE;
DROP TABLE IF EXISTS "audit_log" CASCADE;
DROP TABLE IF EXISTS "service_tokens" CASCADE;
DROP TABLE IF EXISTS "sessions" CASCADE;
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "permissions" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;
DROP TABLE IF EXISTS "worker_heartbeats" CASCADE;
DROP TABLE IF EXISTS "webhook_deliveries" CASCADE;
DROP TABLE IF EXISTS "webhooks" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "sites" CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
`;

async function publicTables(pool: Pool): Promise<string[]> {
  const res = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  return res.rows.map((r) => r.tablename as string);
}

describe("database migrations", () => {
  let pool: Pool;
  let url: string;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    url = fresh.url;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("applies the complete editorial schema", async () => {
    const tables = await publicTables(pool);
    for (const t of ALL_TABLES) {
      expect(tables).toContain(t);
    }
    expect(tables.length).toBe(ALL_TABLES.length);
  });

  it("records applied migrations", async () => {
    const res = await pool.query(`SELECT count(*)::int AS c FROM "drizzle"."__drizzle_migrations"`);
    expect(res.rows[0]).toBeDefined();
    expect(Number(res.rows[0].c)).toBeGreaterThan(0);
  });

  it("re-running migrations is a no-op", async () => {
    await runMigrations(url);
    const tables = await publicTables(pool);
    expect(tables.length).toBe(ALL_TABLES.length);
  });

  it("down migration is reversible and re-appliable", async () => {
    await pool.query(DOWN_0000);
    expect(await publicTables(pool)).toEqual([]);

    await runMigrations(url);
    expect((await publicTables(pool)).length).toBe(ALL_TABLES.length);
  });

  it("enforces site uniqueness constraints", async () => {
    const res = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('sites_slug_unique', 'users_email_unique', 'roles_site_key_unique')
      ORDER BY indexname
    `);
    const names = res.rows.map((r) => r.indexname as string);
    expect(names).toEqual(["roles_site_key_unique", "sites_slug_unique", "users_email_unique"]);
  });
});
