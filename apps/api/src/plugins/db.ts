import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createDb, createPool } from "@kal-el/db";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>;
    pool: ReturnType<typeof createPool>;
  }
}

export const dbPlugin = fp(async (app: FastifyInstance, opts: { connectionString: string }) => {
  const pool = createPool(opts.connectionString);
  app.decorate("pool", pool);
  app.decorate("db", createDb(pool));
  app.addHook("onClose", async () => {
    await pool.end();
  });
});
