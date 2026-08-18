import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { idempotencyKeys } from "@kal-el/db/schema";
import type { FastifyRequest } from "fastify";

import { badRequest, conflict } from "./errors.js";
import { idempotencyKeySchema } from "@kal-el/contracts";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical JSON: object keys sorted, so a retry that re-serialises the same payload in a
 * different key order is recognised as the same request instead of 409-ing.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function idempotencyRequestHash(req: FastifyRequest): string {
  return createHash("sha256")
    .update(`${req.method}\n${req.url}\n${canonical(req.body ?? {})}`)
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

/**
 * Route helper: honours `Idempotency-Key` when the caller sends one, and otherwise runs
 * the handler directly. Every retryable write should go through this - the header was
 * previously read on `POST /articles` alone, so a retried media/entity/source create
 * (none of which have a unique constraint to fall back on) inserted a second row.
 */
export async function respondIdempotent(
  db: { transaction: <R>(cb: (tx: any) => Promise<R>) => Promise<R> },
  req: FastifyRequest,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  actorKey: string,
  run: (tx: any) => Promise<{ status: number; body: unknown }>,
): Promise<unknown> {
  const raw = req.headers["idempotency-key"];
  if (typeof raw !== "string" || raw.length === 0) {
    const direct = await run(db);
    return reply.status(direct.status).send(direct.body);
  }
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) throw badRequest("invalid Idempotency-Key header");
  const result = await withIdempotency(db, {
    key: parsed.data,
    actorKey,
    requestHash: idempotencyRequestHash(req),
    run,
  });
  return reply.status(result.status).send(result.body);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
