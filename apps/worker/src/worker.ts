import { loadConfig } from "./config.js";
import { createDb, createPool } from "@kal-el/db";
import { processDueEvents } from "./dispatcher.js";
import { promoteScheduledArticles } from "./scheduler.js";
import { purgeExpiredIdempotencyKeys, recordHeartbeat } from "./maintenance.js";
import { createLogger, nullLogger } from "./logger.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

const log =
  config.LOG_LEVEL === "silent"
    ? nullLogger
    : createLogger({ level: config.LOG_LEVEL, json: config.NODE_ENV === "production", name: "worker" });

const INTERVAL_MS = config.POLL_INTERVAL_MS;

/**
 * Each job gets its own try. They shared one, so a throw escaping the dispatcher skipped
 * scheduled publishing and the idempotency purge for that whole tick.
 */
async function run(label: string, job: () => Promise<void>) {
  try {
    await job();
  } catch (err) {
    log.error({ job: label, err }, "worker job failed");
  }
}

let ticking: Promise<void> | null = null;
let stopping = false;

async function runTick(): Promise<void> {
  await run("dispatch", async () => {
    const summary = await processDueEvents(db, { limit: config.OUTBOX_BATCH_SIZE, onLog: (line) => log.debug({}, line) });
    if (summary.claimed > 0) log.info({ ...summary }, "outbox dispatch");
  });
  await run("scheduled-publish", async () => {
    const promoted = await promoteScheduledArticles(db, { limit: config.SCHEDULER_BATCH_SIZE, log });
    // a tick in which every due article was refused used to print nothing at all
    if (promoted.promoted > 0 || promoted.blocked > 0) log.info({ ...promoted }, "scheduled publish");
  });
  await run("idempotency-purge", async () => {
    const purged = await purgeExpiredIdempotencyKeys(db);
    if (purged > 0) log.debug({ purged }, "purged expired idempotency keys");
  });
  await run("heartbeat", async () => {
    // The CMS operational panel can read the outbox backlog from the database, but not
    // whether anything is draining it: a stopped worker and an empty queue look the same
    // from the API side. This is the difference.
    await recordHeartbeat(db, "worker", { pollIntervalMs: INTERVAL_MS, pid: process.pid });
  });
}

async function tick() {
  // the poll interval is shorter than the delivery timeout, so overlapping ticks would
  // race on the same claimed rows
  if (ticking || stopping) return;
  ticking = runTick().finally(() => {
    ticking = null;
  });
  await ticking;
}

const timer = setInterval(() => void tick(), INTERVAL_MS);

/**
 * Orderly shutdown.
 *
 * `process.exit` in the signal handler killed the tick mid-flight. An outbox event claimed
 * in that tick keeps `locked_until` set for the full lock window, so every restart during
 * a deploy delayed those deliveries by a minute or more, and a scheduled publish
 * interrupted between the UPDATE and the outbox insert would have committed the status
 * change with no event. Stop claiming new work, let the current tick finish, then close.
 */
async function shutdown(signal: string) {
  if (stopping) {
    log.warn({ signal }, "second signal received, exiting immediately");
    process.exit(1);
  }
  stopping = true;
  clearInterval(timer);
  log.info({ signal, graceMs: config.SHUTDOWN_GRACE_MS }, "shutting down");

  const forced = setTimeout(() => {
    log.error({ signal }, "graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, config.SHUTDOWN_GRACE_MS);
  forced.unref();

  try {
    if (ticking) await ticking;
    await pool.end();
    log.info({ signal }, "shutdown complete");
    process.exit(0);
  } catch (err) {
    log.error({ signal, err }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info(
  {
    pollIntervalMs: INTERVAL_MS,
    outboxBatchSize: config.OUTBOX_BATCH_SIZE,
    schedulerBatchSize: config.SCHEDULER_BATCH_SIZE,
    env: config.NODE_ENV,
  },
  "worker started",
);

void tick();
