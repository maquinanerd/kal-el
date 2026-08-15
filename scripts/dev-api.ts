import { runMigrations } from "../packages/db/src/index.js";
import { users } from "../packages/db/src/schema/index.js";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { seedPermissions } from "../apps/api/src/services/seed.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    const { ensureTestPostgres } = await import("../packages/testkit/src/index.js");
    const url = await ensureTestPostgres();
    process.env.DATABASE_URL = url;
    console.log(`[dev] embedded postgres on ${url}`);
  }
  if (!process.env.BOOTSTRAP_TOKEN) process.env.BOOTSTRAP_TOKEN = "dev-bootstrap-token";
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = "dev-session-secret-change-me";

  await runMigrations(process.env.DATABASE_URL);
  console.log("[dev] migrations applied");

  const config = loadConfig(process.env);
  const app = await buildApp({ connectionString: config.DATABASE_URL, config });
  await seedPermissions(app.db);

  // one-shot local bootstrap so the API is immediately usable
  const existing = await app.db.select({ id: users.id }).from(users).limit(1);
  if (existing.length === 0) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      headers: { "x-bootstrap-token": config.BOOTSTRAP_TOKEN as string },
      payload: {
        site: { slug: "portal-a", name: "Portal A" },
        user: { email: "owner@kalel.dev", name: "Owner", password: "kalel-dev-password-1" },
      },
    });
    console.log(`[dev] bootstrap -> HTTP ${res.statusCode}`);
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[dev] API on http://localhost:${config.PORT}`);
  console.log(`[dev] OpenAPI/Swagger: http://localhost:${config.PORT}/docs`);
  console.log(`[dev] login: owner@kalel.dev / kalel-dev-password-1`);
}

void main();
