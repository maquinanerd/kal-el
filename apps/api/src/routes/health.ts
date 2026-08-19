import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

/**
 * Liveness and readiness.
 *
 * Both are registered with and without the `/v1` prefix: orchestrators, load balancers
 * and panel health checks are configured with a bare path far more often than a versioned
 * one, and a probe pointed at `/health` returning the API's 404 body reads as a hard
 * failure. Neither is rate limited - a probe running every few seconds would otherwise
 * consume the global budget - and neither discloses anything about the deployment.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const noLimit = { config: { rateLimit: false } } as const;

  // Liveness: the process is up and the event loop is turning. Deliberately does NOT
  // touch the database - a health check that fails during a brief database blip gets the
  // container killed and restarted into the same blip.
  const health = async () => ({ status: "ok" });

  // Readiness: this instance can actually serve traffic. The database is the only hard
  // dependency; media storage is local disk and its failure is per-request, not fatal.
  const ready = async (_req: unknown, reply: { status: (n: number) => unknown }) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ready" };
    } catch (err) {
      // Logged, not returned: the body must not leak the connection string or the
      // driver's error text to an unauthenticated caller.
      app.log.error({ err }, "readiness check failed");
      reply.status(503);
      return { status: "not_ready" };
    }
  };

  app.get("/v1/health", noLimit, health);
  app.get("/health", noLimit, health);
  app.get("/v1/ready", noLimit, ready as never);
  app.get("/ready", noLimit, ready as never);
}
