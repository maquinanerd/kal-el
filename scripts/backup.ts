import { readFile, writeFile } from "node:fs/promises";
import { createDb, createPool, exportBackup, restoreBackup } from "../packages/db/src/index.js";

async function main(): Promise<void> {
  const [action, file] = process.argv.slice(2);
  if (!action || !file || !["backup", "restore"].includes(action)) {
    console.error("usage: pnpm backup <backup|restore> <file.json>");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = createPool(url);
  const db = createDb(pool);

  try {
    if (action === "backup") {
      const backup = await exportBackup(db);
      await writeFile(file, JSON.stringify(backup, null, 2));
      console.log(`backup written to ${file} (${Object.keys(backup.data).length} tables)`);
    } else {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Parameters<typeof restoreBackup>[1];
      const result = await restoreBackup(db, parsed);
      console.log(`restored ${result.rows} rows across ${result.restoredTables} tables`);
      // A snapshot taken before a migration names tables this schema no longer has. The
      // restore skips them rather than aborting, which is only safe if it says so.
      if (result.skippedTables.length > 0) {
        console.warn(`skipped ${result.skippedTables.length} table(s) absent from this schema: ${result.skippedTables.join(", ")}`);
      }
    }
  } finally {
    await pool.end();
  }
}

void main();
