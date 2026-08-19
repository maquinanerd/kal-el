import { lt } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { idempotencyKeys, workerHeartbeats } from "@kal-el/db/schema";

/**
 * Delete idempotency records past their TTL.
 *
 * The 24h `expiresAt` was written on every record but never compared and never
 * collected, so the table grew one row per write forever - each holding a full response
 * body - and a key reused after the window replayed a stale response instead of
 * executing. The lookup now filters on expiry; this reclaims the space.
 */
export async function purgeExpiredIdempotencyKeys(db: Db): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()))
    .returning({ key: idempotencyKeys.key });
  return deleted.length;
}

/**
 * Record that this background process is alive.
 *
 * One row per role, overwritten every tick. The operational panel reads it to distinguish
 * "the outbox is empty" from "nothing is draining the outbox" - which, before this,
 * looked identical from the API side.
 */
export async function recordHeartbeat(db: Db, id: string, details: Record<string, unknown> = {}): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ id, lastSeenAt: new Date(), details })
    .onConflictDoUpdate({ target: workerHeartbeats.id, set: { lastSeenAt: new Date(), details } });
}
