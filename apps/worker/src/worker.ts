import { loadConfig } from "./config.js";
import { createDb, createPool } from "@kal-el/db";
import { processDueEvents } from "./dispatcher.js";
import { promoteScheduledArticles } from "./scheduler.js";

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

async function tick() {
  try {
    const summary = await processDueEvents(db);
    if (summary.claimed > 0) {
      console.log(`[worker] ${JSON.stringify(summary)}`);
    }
    const promoted = await promoteScheduledArticles(db);
    if (promoted.promoted > 0) {
      console.log(`[worker] scheduled publish ${JSON.stringify(promoted)}`);
    }
  } catch (err) {
    console.error("[worker] tick failed", err);
  }
}

setInterval(() => void tick(), INTERVAL_MS);
void tick();
