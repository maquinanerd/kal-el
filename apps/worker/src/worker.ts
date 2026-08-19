import { loadConfig } from "./config.js";
import { createDb, createPool } from "@kal-el/db";
import { processDueEvents } from "./dispatcher.js";
import { promoteScheduledArticles } from "./scheduler.js";
import { purgeExpiredIdempotencyKeys } from "./maintenance.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

const INTERVAL_MS = config.POLL_INTERVAL_MS;
const SHUTDOWN = async (signal: string) => {
  console.log(`[worker] ${signal} — shutting down`);
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void SHUTDOWN("SIGINT"));
process.on("SIGTERM", () => void SHUTDOWN("SIGTERM"));

console.log(`[worker] outbox dispatcher polling every ${INTERVAL_MS}ms`);

/**
 * Each job gets its own try. They shared one, so a throw escaping the dispatcher skipped
 * scheduled publishing and the idempotency purge for that whole tick.
 */
async function run(label: string, job: () => Promise<void>) {
  try {
    await job();
  } catch (err) {
    console.error(`[worker] ${label} failed`, err);
  }
}

let ticking = false;

async function tick() {
  // the poll interval is shorter than the delivery timeout, so overlapping ticks would
  // race on the same claimed rows
  if (ticking) return;
  ticking = true;
  try {
    await run("dispatch", async () => {
      const summary = await processDueEvents(db);
      if (summary.claimed > 0) console.log(`[worker] ${JSON.stringify(summary)}`);
    });
    await run("scheduled-publish", async () => {
      const promoted = await promoteScheduledArticles(db);
      // a tick in which every due article was refused used to print nothing at all
      if (promoted.promoted > 0 || promoted.blocked > 0) console.log(`[worker] scheduled publish ${JSON.stringify(promoted)}`);
    });
    await run("idempotency-purge", async () => {
      const purged = await purgeExpiredIdempotencyKeys(db);
      if (purged > 0) console.log(`[worker] purged ${purged} expired idempotency keys`);
    });
  } finally {
    ticking = false;
  }
}

setInterval(() => void tick(), INTERVAL_MS);
void tick();
