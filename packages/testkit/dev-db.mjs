/**
 * Local-only PostgreSQL for the smoke-test stack. Not part of the product.
 *
 * The API, the worker and the migration runner are three separate processes that must
 * share one database, so the per-process embedded instance `dev-api.ts` starts is not
 * enough. This runs a standalone cluster on a fixed port with a persistent data
 * directory, so restarting any of the three does not lose what you typed into the CMS.
 *
 * It deliberately does not touch a PostgreSQL you already have: different port, its own
 * data directory under LOCALAPPDATA.
 *
 *   node scripts/dev-db.mjs        keeps running until stopped
 */
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.KALEL_DEV_DB_PORT ?? 55432);
const DIR = process.env.KALEL_DEV_DB_DIR ?? join(process.env.LOCALAPPDATA ?? process.cwd(), "kal-el-local-pg");
const DB = "kalel";

const fresh = !existsSync(DIR);
mkdirSync(DIR, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: DIR,
  port: PORT,
  user: "kalel",
  password: "kalel",
  authMethod: "password",
  persistent: true,
  onLog: () => {},
  onError: (e) => {
    if (typeof e === "string" && /already exists|listening|database system is ready/i.test(e)) return;
    console.error("[dev-db]", e);
  },
});

if (fresh) {
  console.log(`[dev-db] initialising a new cluster in ${DIR}`);
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(DB);
  console.log(`[dev-db] created database ${DB}`);
} catch {
  console.log(`[dev-db] database ${DB} already exists`);
}

console.log(`[dev-db] ready: postgresql://kalel:kalel@localhost:${PORT}/${DB}`);

const stop = async (signal) => {
  console.log(`[dev-db] ${signal} - stopping`);
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
  process.exit(0);
};
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

// hold the process open
setInterval(() => {}, 1 << 30);
