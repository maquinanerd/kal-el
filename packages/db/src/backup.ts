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
export async function exportBackup(db: Db, opts: { tables?: string[] } = {}): Promise<Backup> {
  const tables = opts.tables ?? (await publicTables(db)).filter((t) => !t.startsWith("__drizzle"));
  const data: Record<string, unknown[]> = {};
  for (const name of tables) {
    const res = await db.execute(sql.raw(`SELECT * FROM ${quote(name)}`));
    data[name] = res.rows as unknown[];
  }
  return { exportedAt: new Date().toISOString(), data };
}

/**
 * Restore a backup: truncate public tables (cascading) and re-insert rows in
 * dependency order. Rows are parameterized (no SQL injection).
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<{ restoredTables: number; rows: number }> {
  const names = Object.keys(backup.data).sort((a, b) => {
    const ia = TABLE_ORDER.indexOf(a);
    const ib = TABLE_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  let rows = 0;

  // One transaction for the whole restore: a failure partway used to leave the tail of
  // the table list truncated and empty, with no rollback and a reported success.
  await db.transaction(async (tx) => {
    for (const name of names) {
      const dataRows = backup.data[name] ?? [];

      // TRUNCATE happens even when the snapshot has no rows for this table. Skipping it
      // meant a table that is empty in the backup kept its live rows - restoring a clean
      // snapshot over a compromised database left the attacker's sessions and service
      // tokens in place, and reported success.
      await tx.execute(sql.raw(`TRUNCATE ${quote(name)} CASCADE`));
      if (dataRows.length === 0) continue;

      const columns = Object.keys(dataRows[0] as Record<string, unknown>);
      if (columns.length === 0) continue;
      const values = sql.join(
        dataRows.map((r) => sql`(${sql.join(columns.map((c) => sql`${(r as Record<string, unknown>)[c]}`), sql`, `)})`),
        sql`, `,
      );
      await tx.execute(sql`INSERT INTO ${sql.raw(quote(name))} (${sql.raw(columns.map(quote).join(", "))}) VALUES ${values}`);
      rows += dataRows.length;
    }
  });

  return { restoredTables: names.filter((n) => (backup.data[n]?.length ?? 0) > 0).length, rows };
}
