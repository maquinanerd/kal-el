import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/health", async () => ({ status: "ok" }));

  app.get("/v1/ready", async (_req, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { status: "ready" };
    } catch {
      reply.status(503);
      return { status: "not_ready" };
    }
  });
}
