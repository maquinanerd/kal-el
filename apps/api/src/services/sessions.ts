import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { sessions, users } from "@kal-el/db/schema";
import { generateCsrfToken, generateOpaqueToken, hashToken, sessionTokenPrefix } from "@kal-el/auth";

import type { AppConfig } from "../config.js";

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export type SessionResolution =
  | { ok: true; session: SessionRow; user: UserRow }
  | { ok: false; status: 401 | 403; code: string; message: string };

const MINUTE_MS = 60_000;

/**
 * How long a token stays usable after it has been rotated away.
 *
 * Sized for in-flight requests, not for convenience: long enough that a page issuing
 * several parallel requests across the rotation boundary completes, short enough that it
 * does not meaningfully extend the life of a copied token.
 */
export const ROTATION_GRACE_MS = 2 * MINUTE_MS;

/**
 * Resolve, validate and age a session in one place.
 *
 * Before this, three routes each did their own `findFirst` on the token hash and applied
 * a different subset of the checks - `/v1/auth/me` and `/v1/me/sites` had to have the
 * disabled-account check added to them individually, which is exactly the shape of gap
 * that recurs every time a fourth reader appears. Everything that decides whether a
 * cookie is still a valid credential is here.
 *
 * Three separate clocks apply, and they answer different questions:
 *
 *   - `expiresAt`      the ceiling set at login (SESSION_TTL_DAYS)
 *   - absolute timeout time since the session was created, regardless of use - bounds how
 *                      long a stolen cookie is useful even for an active attacker
 *   - idle timeout     time since the session was last used - closes the unattended
 *                      browser case, which the other two do not touch
 */
export async function resolveSession(db: Db, config: AppConfig, token: string): Promise<SessionResolution> {
  const hash = hashToken(token);
  const now = new Date();

  const session = await db.query.sessions.findFirst({
    where: or(
      eq(sessions.tokenHash, hash),
      // the previous token is honoured only inside its grace window
      and(eq(sessions.previousTokenHash, hash), isNotNull(sessions.previousTokenExpiresAt), gt(sessions.previousTokenExpiresAt, now)),
    ),
  });
  if (!session) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "invalid or expired session" };

  const idleMs = config.SESSION_IDLE_TIMEOUT_MINUTES * MINUTE_MS;
  const absoluteMs = config.SESSION_ABSOLUTE_TIMEOUT_MINUTES * MINUTE_MS;
  const lastUsed = session.lastSeenAt ?? session.createdAt;

  const expired =
    session.expiresAt <= now ||
    now.getTime() - session.createdAt.getTime() > absoluteMs ||
    now.getTime() - lastUsed.getTime() > idleMs;

  if (expired) {
    // Delete rather than leave it: an expired row is a credential that only a clock stands
    // between, and the table would otherwise accumulate one per login forever.
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "session expired" };
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "invalid or expired session" };
  if (user.status === "disabled") {
    // Disabling an account has to end its sessions, not merely refuse the current request:
    // otherwise the cookie stays live until SESSION_TTL_DAYS and any route that forgets
    // this check keeps answering.
    await revokeUserSessions(db, user.id);
    return { ok: false, status: 403, code: "FORBIDDEN", message: "user is not active" };
  }

  return { ok: true, session, user };
}

/** Record use, for the idle clock. */
export async function touchSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}

export function rotationDue(config: AppConfig, session: SessionRow, now = new Date()): boolean {
  const since = session.rotatedAt ?? session.createdAt;
  return now.getTime() - since.getTime() > config.SESSION_ROTATE_MINUTES * MINUTE_MS;
}

/**
 * Replace a session's token, keeping the old one alive for the grace window.
 *
 * The UPDATE is guarded on the value of `rotated_at` that was read, so when several
 * concurrent requests all decide rotation is due exactly one wins. The losers get `null`
 * and keep using the token they already have, which the winner has just moved into
 * `previous_token_hash` - so they stay authenticated instead of 401-ing halfway through a
 * page load.
 */
export async function rotateSessionToken(db: Db, session: SessionRow): Promise<string | null> {
  const now = new Date();
  const token = generateOpaqueToken(sessionTokenPrefix());
  const rows = await db
    .update(sessions)
    .set({
      tokenHash: hashToken(token),
      previousTokenHash: session.tokenHash,
      previousTokenExpiresAt: new Date(now.getTime() + ROTATION_GRACE_MS),
      rotatedAt: now,
      lastSeenAt: now,
    })
    .where(
      and(
        eq(sessions.id, session.id),
        session.rotatedAt ? eq(sessions.rotatedAt, session.rotatedAt) : sql`${sessions.rotatedAt} is null`,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length > 0 ? token : null;
}

/**
 * End every session belonging to a user.
 *
 * Used when an account is disabled and when its password changes: both mean the previously
 * issued cookies must stop working, on every device, immediately.
 */
export async function revokeUserSessions(db: Db, userId: string, opts: { exceptSessionId?: string } = {}): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(
      opts.exceptSessionId
        ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${opts.exceptSessionId}`)
        : eq(sessions.userId, userId),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/** Create a session for a freshly authenticated user. */
export async function createSession(
  db: Db,
  config: AppConfig,
  user: UserRow,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ session: SessionRow; token: string; csrf: string }> {
  const token = generateOpaqueToken(sessionTokenPrefix());
  const csrf = generateCsrfToken();
  const now = new Date();
  // The row's own ceiling is the shorter of the configured TTL and the absolute timeout;
  // leaving `expiresAt` at the TTL alone would let a row outlive the policy that governs
  // it if the two are ever configured inconsistently.
  const ttlMs = Math.min(
    config.SESSION_TTL_DAYS * 24 * 60 * MINUTE_MS,
    config.SESSION_ABSOLUTE_TIMEOUT_MINUTES * MINUTE_MS,
  );
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(csrf),
      expiresAt: new Date(now.getTime() + ttlMs),
      lastSeenAt: now,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    .returning();
  if (!session) throw new Error("login failed to create session");
  return { session, token, csrf };
}
