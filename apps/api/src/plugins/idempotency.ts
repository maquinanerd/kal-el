import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { idempotencyKeys } from "@kal-el/db/schema";
import type { FastifyRequest } from "fastify";

import { conflict } from "./errors.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function idempotencyRequestHash(req: FastifyRequest): string {
  return createHash("sha256")
    .update(`${req.method}\n${req.url}\n${JSON.stringify(req.body ?? {})}`)
    .digest("hex");
}

/**
 * Exactly-once execution for retryable writes.
 *
 * A Postgres advisory transaction lock serializes concurrent requests that
 * share the same (actor, key). The winning transaction executes the side
 * effects and stores the response; any other request observes the stored
 * response and replays it without re-running side effects. Both the side
 * effects and the idempotency record commit in the same transaction.
 *
 * `db` is a Drizzle db or transaction; both expose transaction().
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function withIdempotency(
  db: { transaction: <R>(cb: (tx: any) => Promise<R>) => Promise<R> },
  opts: {
    key: string;
    actorKey: string;
    requestHash: string;
    run: (tx: any) => Promise<{ status: number; body: unknown }>;
  },
): Promise<{ status: number; body: unknown; replay: boolean }> {
  const { key, actorKey, requestHash } = opts;
  const lockKey = `${actorKey}:${key}`;
  return db.transaction(async (innerTx) => {
    await innerTx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existing = await innerTx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.actorKey, actorKey)));

    if (existing.length > 0) {
      const row = existing[0];
      if (!row) throw conflict("idempotency state unavailable");
      if (row.requestHash !== requestHash) {
        throw conflict("idempotency key reused with a different request", { code: "IDEMPOTENCY_REPLAY" });
      }
      return { status: row.responseStatus, body: row.responseBody, replay: true };
    }

    const { status, body } = await opts.run(innerTx);
    await innerTx.insert(idempotencyKeys).values({
      key,
      actorKey,
      requestHash,
      responseStatus: status,
      responseBody: body,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
    return { status, body, replay: false };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
