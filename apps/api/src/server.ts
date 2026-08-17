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

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
