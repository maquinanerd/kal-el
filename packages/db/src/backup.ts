import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/**
 * Canonical table order so that FK parents are inserted before children.
 */
const TABLE_ORDER = [
  "sites",
  "users",
  "media",
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
  "audit_log",
  "outbox_events",
  "idempotency_keys",
  "redirects",
  "webhooks",
  "webhook_deliveries",
  "worker_heartbeats",
];

export type Backup = {
  exportedAt: string;
  data: Record<string, unknown[]>;
};

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function publicTables(db: Db): Promise<string[]> {
  const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  return res.rows.map((r) => String(r.tablename));
}

/**
 * Logical data backup: exports every public table as parameterized rows.
 * Schema is recreated from migrations; this captures content.
 */
/** Rows read per statement. Bounds peak memory on a table with a large history. */
const EXPORT_CHUNK_ROWS = 5_000;

export async function exportBackup(db: Db, opts: { tables?: string[]; chunkRows?: number } = {}): Promise<Backup> {
  const tables = opts.tables ?? (await publicTables(db)).filter((t) => !t.startsWith("__drizzle"));
  const chunkRows = Math.max(1, opts.chunkRows ?? EXPORT_CHUNK_ROWS);
  const data: Record<string, unknown[]> = {};
  // One snapshot for every table. Each SELECT used to run in its own implicit transaction,
  // in alphabetical order - `article_revisions` before `articles` - so a delete landing
  // between two reads produced a dump with revisions whose article is absent. Restoring it
  // hits a foreign key and, because the restore is one transaction, rolls the whole thing
  // back. The opposite ordering loses the relation silently, which is worse.
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"));
    for (const name of tables) {
      /**
       * Read in keyset chunks rather than one `SELECT *`.
       *
       * The driver buffers a result set entirely, so a single statement over a table with
       * a few hundred thousand audit rows materialises the whole thing at once - the
       * mirror of the bind-limit failure already fixed on the restore side.
       *
       * `ctid` is the physical row locator, present on every table regardless of what its
       * primary key looks like (several here are composite, and it must not matter). It
       * can change when a row is updated, but the REPEATABLE READ snapshot fixes the set
       * of visible tuples for the whole transaction, so within this loop it is a stable
       * total order - which is exactly what keyset pagination needs, and what OFFSET
       * would have given up (both in correctness and in being O(n^2)).
       */
      const rows: unknown[] = [];
      let after: string | null = null;
      for (;;) {
        const page = after
          ? await tx.execute(
              sql.raw(`SELECT ctid::text AS __ctid, * FROM ${quote(name)} WHERE ctid > '${after}'::tid ORDER BY ctid LIMIT ${chunkRows}`),
            )
          : await tx.execute(sql.raw(`SELECT ctid::text AS __ctid, * FROM ${quote(name)} ORDER BY ctid LIMIT ${chunkRows}`));
        const batch = page.rows as Record<string, unknown>[];
        if (batch.length === 0) break;
        after = String(batch[batch.length - 1]?.__ctid ?? "");
        for (const row of batch) {
          // the locator is a read cursor, not data: it must not reach the dump, where it
          // would become a column no table has
          delete row.__ctid;
          rows.push(row);
        }
        if (batch.length < chunkRows) break;
      }
      data[name] = rows;
    }
  });
  return { exportedAt: new Date().toISOString(), data };
}

/**
 * Restore a backup: truncate public tables (cascading) and re-insert rows in
 * dependency order. Rows are parameterized (no SQL injection).
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<{ restoredTables: number; rows: number; skippedTables: string[] }> {
  // A snapshot taken before a migration names tables this database no longer has, and
  // TRUNCATE against a missing table aborts the whole single-transaction restore with a
  // driver error rather than a usable message. Skip them and report which, so an operator
  // reading the result can see what the backup contained that this schema does not.
  const present = new Set(await publicTables(db));
  const named = Object.keys(backup.data);
  const skippedTables = named.filter((n) => !present.has(n));
  const names = named
    .filter((n) => present.has(n))
    .sort((a, b) => {
      const ia = TABLE_ORDER.indexOf(a);
      const ib = TABLE_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

  /**
   * Tables this database has that the snapshot does not mention.
   *
   * The loop below only truncates tables the backup names, so a table added since the
   * snapshot was taken kept its live rows - and restoring a clean snapshot over a
   * compromised database is exactly the case where leftover rows matter. They are
   * truncated in reverse dependency order first, before any insert.
   */
  const unmentioned = [...present]
    .filter((n) => !n.startsWith("__drizzle") && !backup.data[n])
    .sort((a, b) => {
      const ia = TABLE_ORDER.indexOf(a);
      const ib = TABLE_ORDER.indexOf(b);
      return (ib === -1 ? 999 : ib) - (ia === -1 ? 999 : ia);
    });

  let rows = 0;

  /**
   * Objects and arrays are jsonb columns and have to be sent as JSON text with a cast.
   * Interpolated raw, the driver renders a JS array as a Postgres *array* literal -
   * `service_tokens.scopes` became `{"articles.read",...}` and the insert failed with
   * `invalid input syntax for type json`, taking the whole single-transaction restore with
   * it, while `[]` became `{}`: valid JSON, silently restored as an object where the
   * contract declares an array.
   */
  const bind = (value: unknown) =>
    value !== null && typeof value === "object" ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`;

  // One transaction for the whole restore: a failure partway used to leave the tail of
  // the table list truncated and empty, with no rollback and a reported success.
  await db.transaction(async (tx) => {
    for (const name of unmentioned) {
      await tx.execute(sql.raw(`TRUNCATE ${quote(name)} CASCADE`));
    }

    for (const name of names) {
      const dataRows = backup.data[name] ?? [];

      // TRUNCATE happens even when the snapshot has no rows for this table. Skipping it
      // meant a table that is empty in the backup kept its live rows - restoring a clean
      // snapshot over a compromised database left the attacker's sessions and service
      // tokens in place, and reported success.
      await tx.execute(sql.raw(`TRUNCATE ${quote(name)} CASCADE`));
      if (dataRows.length === 0) continue;

      // Column set from the first row alone assumed every row is shaped identically.
      // That holds for a dump this module produced, but not for a hand-edited file or one
      // concatenated from two runs - and the mismatch surfaced as a bind-count error
      // rather than as anything an operator could act on. Take the union, and give
      // missing values an explicit null so the positional binds still line up.
      const columnSet = new Set<string>();
      for (const r of dataRows) for (const c of Object.keys(r as Record<string, unknown>)) columnSet.add(c);
      const columns = [...columnSet];
      if (columns.length === 0) continue;

      // Postgres caps a statement at 65535 bind parameters. One INSERT for the whole table
      // meant `audit_log` (11 columns) broke at 5,958 rows - a real site crosses that in
      // days - and because the restore is a single transaction, the whole thing rolled back.
      const perStatement = Math.max(1, Math.floor(60_000 / columns.length));
      for (let start = 0; start < dataRows.length; start += perStatement) {
        const chunk = dataRows.slice(start, start + perStatement);
        const values = sql.join(
          chunk.map((r) => sql`(${sql.join(columns.map((c) => bind((r as Record<string, unknown>)[c] ?? null)), sql`, `)})`),
          sql`, `,
        );
        await tx.execute(sql`INSERT INTO ${sql.raw(quote(name))} (${sql.raw(columns.map(quote).join(", "))}) VALUES ${values}`);
      }
      rows += dataRows.length;
    }
  });

  return { restoredTables: names.filter((n) => (backup.data[n]?.length ?? 0) > 0).length, rows, skippedTables };
}
