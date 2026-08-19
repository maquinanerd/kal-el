import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { idempotencyKeys } from "@kal-el/db/schema";
import type { FastifyRequest } from "fastify";

import { badRequest, conflict, idempotencyReplay } from "./errors.js";
import { idempotencyKeySchema } from "@kal-el/contracts";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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
 * Identity of an idempotency record.
 *
 * Scoped by actor AND site. Scoping by actor alone meant the same key aimed at two
 * different sites collided: the stored `requestHash` embeds the URL (which carries the
 * siteId), so the second site got a 409 "reused with a different request" for a
 * legitimately different write. Service tokens were accidentally safe because a token is
 * pinned to one site - so the guarantee silently changed shape with the credential type.
 */
export function idempotencyScope(actorKey: string, siteId?: string): string {
  return siteId ? `${actorKey}@site:${siteId}` : actorKey;
}

/** siteId from a `/v1/sites/:siteId/...` route, when there is one. */
function siteOf(req: FastifyRequest): string | undefined {
  const p = req.params as { siteId?: string } | undefined;
  return typeof p?.siteId === "string" ? p.siteId : undefined;
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
    // An expired record must behave as if it were absent: the TTL was written but never
    // compared, so a key reused months later replayed a stale response body forever.
    const existing = await innerTx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.actorKey, actorKey),
          gt(idempotencyKeys.expiresAt, new Date()),
        ),
      );

    if (existing.length > 0) {
      const row = existing[0];
      if (!row) throw conflict("idempotency state unavailable");
      if (row.requestHash !== requestHash) {
        throw idempotencyReplay("idempotency key reused with a different request");
      }
      return { status: row.responseStatus, body: row.responseBody, replay: true };
    }

    const { status, body } = await opts.run(innerTx);
    // clear any expired row for this identity before re-inserting (unique on key+actor)
    await innerTx
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.actorKey, actorKey)));
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
    actorKey: idempotencyScope(actorKey, siteOf(req)),
    requestHash: idempotencyRequestHash(req),
    run,
  });
  return reply.status(result.status).send(result.body);
}

/**
 * Same contract as `respondIdempotent`, but returns the produced value instead of
 * sending it.
 *
 * IMPORTANT: `run` must return the FINISHED response value, not a database row. The value
 * is persisted as JSONB and replayed verbatim, so anything that only survives in memory -
 * a `Date`, a `Buffer`, a class instance - comes back as a plain string or object on the
 * replay. Shaping the DTO after this call worked on the first request and threw
 * `row.createdAt.toISOString is not a function` on every retry.
 */
export async function respondIdempotentValue<T>(
  db: { transaction: <R>(cb: (tx: any) => Promise<R>) => Promise<R> },
  req: FastifyRequest,
  actorKey: string,
  run: (tx: any) => Promise<T>,
): Promise<T> {
  const raw = req.headers["idempotency-key"];
  if (typeof raw !== "string" || raw.length === 0) return run(db);

  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) throw badRequest("invalid Idempotency-Key header");
  const result = await withIdempotency(db, {
    key: parsed.data,
    actorKey: idempotencyScope(actorKey, siteOf(req)),
    requestHash: idempotencyRequestHash(req),
    run: async (tx) => ({ status: 200, body: await run(tx) }),
  });
  return result.body as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
