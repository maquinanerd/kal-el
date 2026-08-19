import { runMigrations } from "@kal-el/db";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { seedPermissions } from "./services/seed.js";
import { ensurePresetRoles } from "./services/roles.js";

const config = loadConfig();

// RUN_MIGRATIONS=true lets containers apply migrations idempotently on boot.
if (process.env.RUN_MIGRATIONS === "true") {
  await runMigrations(config.DATABASE_URL);
}

const app = await buildApp({ connectionString: config.DATABASE_URL, config });
await seedPermissions(app.db);
await ensurePresetRoles(app.db);

/**
 * Orderly shutdown.
 *
 * `app.close()` stops accepting connections, drains the ones in flight and runs the
 * `onClose` hooks - which is where the pg pool is ended (see plugins/db.ts). Calling
 * `process.exit` before that resolves cuts live requests mid-response and can leave a
 * transaction open until the server-side timeout, so the exit waits for it.
 *
 * A second signal is a deliberate operator override: exit immediately rather than hang.
 */
let shuttingDown = false;
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 15_000);

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    app.log.warn({ signal }, "second signal received, exiting immediately");
    process.exit(1);
  }
  shuttingDown = true;
  app.log.info({ signal, graceMs: SHUTDOWN_GRACE_MS }, "shutting down");

  // A request that never finishes must not keep the process alive forever; the orchestrator
  // would SIGKILL it anyway, and doing it here at least leaves a log line saying why.
  const forced = setTimeout(() => {
    app.log.error({ signal }, "graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  try {
    await app.close();
    app.log.info({ signal }, "shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err, signal }, "shutdown failed");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT, host: config.HOST, env: config.NODE_ENV }, "api listening");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
