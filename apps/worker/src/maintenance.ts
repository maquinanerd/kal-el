import { lt } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { idempotencyKeys } from "@kal-el/db/schema";

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
