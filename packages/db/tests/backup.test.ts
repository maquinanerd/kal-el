import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb } from "@kal-el/testkit";
import { exportBackup, restoreBackup, runMigrations, type Backup } from "@kal-el/db";
import { articleRevisions, articles, entities, serviceTokens, sites, users } from "@kal-el/db/schema";

describe("backup / restore rehearsal", () => {
  let pool: ReturnType<typeof import("pg").Pool>;
  let db: import("@kal-el/db").Db;
  let url: string;
  let backup: Backup;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    db = fresh.db;
    url = fresh.url;

    const [site] = await db.insert(sites).values({ slug: "backup-a", name: "Backup A" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "backup@kalel.test", name: "Backup", passwordHash: "x".repeat(60) })
      .returning();
    const [article] = await db
      .insert(articles)
      .values({
        siteId: site?.id ?? "",
        title: "Artigo para backup",
        slug: "artigo-backup",
        status: "published",
        publishedAt: new Date("2024-01-02T03:04:05Z"),
        document: { version: 1, nodes: [{ type: "paragraph", attrs: {}, content: "conteúdo" }] },
        createdBy: user?.id ?? null,
        version: 2,
      })
      .returning();
    await db.insert(articleRevisions).values({
      articleId: article?.id ?? "",
      revisionNumber: 3,
      document: { version: 1, nodes: [] },
      note: "backup",
    });

    // A jsonb ARRAY column: interpolated raw, the driver renders it as a Postgres array
    // literal - `{"articles.read",...}` - and the insert fails with `invalid input syntax
    // for type json`, rolling back the entire single-transaction restore. An empty array
    // was worse: it became `{}`, valid JSON, silently restored as an object.
    await db.insert(serviceTokens).values({
      siteId: site?.id ?? "",
      name: "backup-token",
      tokenHash: "h".repeat(64),
      prefix: "ke_st.bk",
      scopes: ["articles.read", "articles.create"],
    });
    await db.insert(entities).values({ siteId: site?.id ?? "", type: "person", name: "Sem refs", externalRefs: [] });

    backup = await exportBackup(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("exports the seeded content", () => {
    expect(backup.data["sites"]?.length).toBe(1);
    expect(backup.data["users"]?.length).toBe(1);
    expect(backup.data["articles"]?.length).toBe(1);
    expect(backup.data["article_revisions"]?.length).toBe(1);
  });

  it("restores into a wiped database and reproduces identical content", async () => {
    // wipe the schema (simulates disaster) and rebuild from migrations
    const admin = await import("pg");
    const adminPool = new admin.Pool({ connectionString: url });
    // full disaster: drop both the public schema and the migration journal
    await adminPool.query(`DROP SCHEMA IF EXISTS public CASCADE`);
    await adminPool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await adminPool.query(`CREATE SCHEMA public`);
    await adminPool.end();
    await runMigrations(url);

    const restored = await restoreBackup(db, backup);
    expect(restored.rows).toBe(6);

    const after = await exportBackup(db);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(backup.data));

    const article = await db.query.articles.findFirst({ where: eq(articles.slug, "artigo-backup") });
    expect(article?.status).toBe("published");
    expect(article?.publishedAt?.toISOString()).toBe("2024-01-02T03:04:05.000Z");
    expect(article?.version).toBe(2);
  });

  it("round-trips through JSON serialization (the CLI backup/restore path)", async () => {
    // the CLI writes JSON.stringify(backup) and reads JSON.parse(file)
    const serialized = JSON.stringify(backup);
    const parsed = JSON.parse(serialized) as Backup;

    const admin = await import("pg");
    const adminPool = new admin.Pool({ connectionString: url });
    await adminPool.query(`DROP SCHEMA IF EXISTS public CASCADE`);
    await adminPool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await adminPool.query(`CREATE SCHEMA public`);
    await adminPool.end();
    await runMigrations(url);

    const restored = await restoreBackup(db, parsed);
    expect(restored.rows).toBe(6);

    const after = await exportBackup(db);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(parsed.data));
    expect(parsed.exportedAt).toBeTruthy();
  });
});
