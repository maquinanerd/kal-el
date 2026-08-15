import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Folder with the generated SQL migrations. Overridable via MIGRATIONS_FOLDER
 * so container images can carry the migration folder independently of the
 * bundled entry point location.
 */
export function migrationsFolder() {
  return process.env.MIGRATIONS_FOLDER ?? path.resolve(here, "../drizzle");
}

/**
 * Apply all pending migrations to the database at `connectionString`.
 * Returns the applied migration folder names. Safe to call repeatedly.
 */
export async function runMigrations(connectionString: string) {
  const pool = createPool(connectionString);
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: migrationsFolder() });
  const applied = (await readdir(path.join(migrationsFolder(), "meta"))).filter((f) => f.endsWith("_snapshot.json")).length;
  await pool.end();
  return { applied };
}

export async function ensureMigrationFolder() {
  await mkdir(migrationsFolder(), { recursive: true });
}
