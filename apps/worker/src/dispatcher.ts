import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@kal-el/db";
import { outboxEvents, webhookDeliveries, webhooks } from "@kal-el/db/schema";

import { signWebhook } from "./signature.js";
import { guardedFetch } from "./safe-fetch.js";
import { assertDeliverableUrl } from "./ssrf.js";

export type DispatchOptions = {
  fetchImpl?: typeof fetch;
  limit?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onLog?: (line: string) => void;
  /** Permit private/loopback delivery targets (local development and tests only). */
  allowPrivateTargets?: boolean;
};

export type DispatchSummary = {
  claimed: number;
  delivered: number;
  failed: number;
  noSubscribers: number;
  /** hooks skipped because they already succeeded for that event in an earlier pass */
  alreadyDelivered: number;
  /** hooks that are out of attempts for that event and are no longer contacted */
  deadLettered: number;
  /** hooks skipped because their own backoff has not elapsed yet */
  waiting: number;
};

const LOCK_FLOOR_MS = 60_000;

/**
 * Claim due outbox events (SKIP LOCKED) and dispatch them to matching
 * webhooks. Delivery is at-least-once and idempotent: every request carries
 * `X-Kal-El-Idempotency` so subscribers can dedupe, and deliveries upsert on
 * (webhook, event).
 *
 * Retry state is tracked per (hook, event) in `webhook_deliveries`; the event row only
 * carries the aggregate. Reading it the other way around - one shared retry counter for
 * every subscriber of an event - made a single broken hook corrupt its healthy siblings:
 * they were re-POSTed on every pass, their attempt counter climbed with each one, and the
 * moment the broken hook exhausted its budget the whole event went to `failed`, which the
 * claim query never looks at again.
 */
export async function processDueEvents(db: Db, opts: DispatchOptions = {}): Promise<DispatchSummary> {
  const {
    limit = 20,
    maxAttempts = 5,
    baseDelayMs = 1_000,
    timeoutMs = 10_000,
    onLog = () => {},
    allowPrivateTargets = process.env.ALLOW_PRIVATE_WEBHOOKS === "true",
  } = opts;
  // Not the global `fetch` by default: it re-resolves the hostname to open the socket, so
  // the address `assertDeliverableUrl` approved is not necessarily the one connected to.
  // `guardedFetch` validates inside the socket's own DNS lookup, which is what actually
  // closes rebinding. When private targets are deliberately permitted - local development
  // and the fixture e2e, which delivers to a loopback server - the guard would refuse
  // every delivery, so that path keeps the platform fetch. Tests that inject their own
  // implementation are unaffected either way.
  const fetchImpl = opts.fetchImpl ?? (allowPrivateTargets ? fetch : guardedFetch);
  const now = new Date();
  // The loop below is sequential over every claimed event, so a flat minute was well
  // short of the worst case and let a second replica claim rows still in flight. This is
  // a heuristic, not a bound - it cannot know the subscriber count up front - so the
  // per-event loop releases its own claim on the way out, including on error.
  const lockMs = Math.max(LOCK_FLOOR_MS, limit * timeoutMs * 2);

  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.status, "pending"),
          lte(outboxEvents.availableAt, now),
          or(isNull(outboxEvents.lockedUntil), lt(outboxEvents.lockedUntil, now)),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length > 0) {
      await tx
        .update(outboxEvents)
        .set({ lockedUntil: new Date(now.getTime() + lockMs) })
        .where(inArray(outboxEvents.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  const summary: DispatchSummary = { claimed: due.length, delivered: 0, failed: 0, noSubscribers: 0, alreadyDelivered: 0, deadLettered: 0, waiting: 0 };

  for (const event of due) {
    // The whole per-event pass is guarded, not just the hook loop: a throw in the
    // subscriber lookup or in any of the terminal updates rejected processDueEvents and
    // left every row claimed in this batch locked for the full window.
    try {
      const subscribers = await db
        .select()
        .from(webhooks)
        // A paused subscriber is skipped entirely rather than attempted and failed: the
        // point of pausing is to stop an endpoint burning its retry budget while it is
        // being fixed, and a paused hook that accumulated dead-letters would come back
        // already exhausted.
        .where(and(eq(webhooks.siteId, event.siteId), eq(webhooks.enabled, true), sql`${webhooks.events} ? ${event.eventType}`))
        // heap order made which hook ran first - and so which one shaped the shared state -
        // effectively random between passes
        .orderBy(asc(webhooks.createdAt), asc(webhooks.id));

      if (subscribers.length === 0) {
        await db.update(outboxEvents).set({ status: "published", publishedAt: new Date(), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
        summary.noSubscribers++;
        continue;
      }

      const pendingRetries: Date[] = [];
      let lastError: string | null = null;
      let exhausted = 0;
      let failures = 0;
      let attempted = false;

      for (const hook of subscribers) {
        const outcome = await dispatchOne(db, event, hook, { fetchImpl, maxAttempts, baseDelayMs, timeoutMs, onLog, allowPrivateTargets });
        if (outcome.kind === "skipped") {
          summary.alreadyDelivered++;
          continue;
        }
        if (outcome.kind === "success") {
          summary.delivered++;
          attempted = true;
          continue;
        }
        if (outcome.kind === "waiting") {
          // still failing, but this hook is inside its own backoff window
          summary.waiting++;
          failures++;
          pendingRetries.push(outcome.retryAt);
          continue;
        }
        if (outcome.kind === "dead") {
          summary.deadLettered++;
          failures++;
          exhausted++;
          lastError = outcome.error;
          continue;
        }
        summary.failed++;
        failures++;
        attempted = true;
        lastError = outcome.error;
        if (outcome.retryAt) pendingRetries.push(outcome.retryAt);
        else exhausted++;
      }

      if (failures === 0) {
        await db.update(outboxEvents).set({ status: "published", publishedAt: new Date(), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
      } else if (pendingRetries.length === 0) {
        // every failing subscriber is out of attempts - only now is the event itself dead
        await db
          .update(outboxEvents)
          .set({ status: "failed", attempts: attempted ? event.attempts + 1 : event.attempts, lastError: lastError ?? event.lastError, lockedUntil: null })
          .where(eq(outboxEvents.id, event.id));
      } else {
        const soonest = pendingRetries.reduce((a, b) => (a < b ? a : b));
        await db
          .update(outboxEvents)
          // a pass in which every failing hook was inside its own backoff made no request,
          // so it is neither an attempt nor a reason to forget the error already recorded
          .set({ availableAt: soonest, attempts: attempted ? event.attempts + 1 : event.attempts, lastError: lastError ?? event.lastError, lockedUntil: null })
          .where(eq(outboxEvents.id, event.id));
        if (exhausted > 0) {
          onLog(`event ${event.id}: ${exhausted} subscriber(s) dead-lettered, ${pendingRetries.length} still retrying`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
      onLog(`event ${event.id}: pass aborted: ${message}`);
      // Release the claim and hold the event back, with the delay growing each time.
      // Clearing the lock alone re-claimed it on the next tick and span on whatever was
      // throwing; dead-lettering here was worse, because `attempts` is also spent by every
      // normal pass and `maxAttempts` is the per-hook budget - one transient error on the
      // fifth pass would terminate an event whose remaining subscriber still had attempts
      // left, with no requeue path. A pass that could not run is not a delivery attempt
      // against any hook, so it only backs off.
      const attempts = event.attempts + 1;
      const backoff = Math.min(baseDelayMs * 2 ** Math.min(attempts, 10), 60 * 60_000);
      await db
        .update(outboxEvents)
        .set({ attempts, lastError: message, lockedUntil: null, availableAt: new Date(Date.now() + backoff) })
        .where(eq(outboxEvents.id, event.id));
    }
  }

  return summary;
}

type OutboxRow = typeof outboxEvents.$inferSelect;
type WebhookRow = typeof webhooks.$inferSelect;

type HookOutcome =
  | { kind: "success" }
  | { kind: "skipped" }
  | { kind: "dead"; error: string }
  | { kind: "waiting"; retryAt: Date }
  | { kind: "failure"; retryAt: Date | null; error: string };

async function dispatchOne(
  db: Db,
  event: OutboxRow,
  hook: WebhookRow,
  opts: {
    fetchImpl: typeof fetch;
    maxAttempts: number;
    baseDelayMs: number;
    timeoutMs: number;
    onLog: (l: string) => void;
    allowPrivateTargets: boolean;
  },
): Promise<HookOutcome> {
  const existing = await db.query.webhookDeliveries.findFirst({
    where: and(eq(webhookDeliveries.webhookId, hook.id), eq(webhookDeliveries.outboxEventId, event.id)),
  });
  // A hook that already took this event must never see it again. The event stays pending
  // while any sibling is still failing, so without this a healthy subscriber received the
  // same `article.published` once per retry cycle.
  if (existing?.status === "success") return { kind: "skipped" };

  // Nor must a hook that is out of attempts. Re-delivery to a dead-lettered endpoint used
  // to be stopped by killing the whole event on its first exhaustion; moving that decision
  // to the aggregate removed the stop without replacing it, so a formally dead-lettered
  // partner kept receiving the payload on every pass while a sibling was still retrying.
  if (existing?.status === "failed") return { kind: "dead", error: existing.error ?? "dead-lettered" };

  // Each hook carries its own exponential backoff, but the event wakes at the soonest of
  // them. Without this the hook with the longest backoff was retried on the shortest
  // one's schedule and burned its remaining attempts in seconds.
  if (existing?.nextAttemptAt && existing.nextAttemptAt > new Date()) {
    return { kind: "waiting", retryAt: existing.nextAttemptAt };
  }

  const body = JSON.stringify(event.payload);
  const signature = signWebhook(hook.secret, body);
  const deliveryId = randomUUID();
  const idempotencyKey = event.idempotencyKey ?? `${event.id}`;
  const attempt = existing ? existing.attempt + 1 : 1;

  try {
    // Three layers, each closing a window the previous one cannot:
    //
    //  1. registration validates the URL when it is first supplied;
    //  2. this re-check catches a name that has been re-pointed since then, and rejects
    //     the request before any socket is opened - so the common case fails fast and
    //     cheaply, with a readable reason;
    //  3. `guardedFetch` validates inside the socket's own DNS lookup, which is the only
    //     layer that survives a TTL-0 record answering public here and private a
    //     millisecond later. Checking before connecting cannot close that on its own,
    //     because the checked resolution is not the one the socket uses.
    //
    // Redirects are not followed either: a 302 from a validated public URL into the
    // metadata service would otherwise bypass all three.
    if (!opts.allowPrivateTargets) await assertDeliverableUrl(hook.url);

    const res = await opts.fetchImpl(hook.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-kal-el-event": event.eventType,
        "x-kal-el-delivery": deliveryId,
        "x-kal-el-idempotency": idempotencyKey,
        "x-kal-el-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    if (res.ok) {
      await db
        .insert(webhookDeliveries)
        .values({
          webhookId: hook.id,
          outboxEventId: event.id,
          status: "success",
          attempt,
          responseStatus: res.status,
          deliveredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [webhookDeliveries.webhookId, webhookDeliveries.outboxEventId],
          set: { status: "success", attempt, responseStatus: res.status, deliveredAt: new Date(), error: null, nextAttemptAt: null },
        });
      return { kind: "success" };
    }

    const retryAt = await recordFailure(db, hook, event, attempt, res.status, `HTTP ${res.status}`, opts);
    opts.onLog(`delivery ${deliveryId} -> ${hook.url}: HTTP ${res.status} (${retryAt ? "retrying" : "dead-letter"})`);
    return { kind: "failure", retryAt, error: `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    const retryAt = await recordFailure(db, hook, event, attempt, null, message, opts);
    opts.onLog(`delivery ${deliveryId} -> ${hook.url}: ${message} (${retryAt ? "retrying" : "dead-letter"})`);
    return { kind: "failure", retryAt, error: message };
  }
}

/** Records the per-hook attempt. Returns when this hook may be retried, or null if spent. */
async function recordFailure(
  db: Db,
  hook: WebhookRow,
  event: OutboxRow,
  attempt: number,
  responseStatus: number | null,
  error: string,
  opts: { maxAttempts: number; baseDelayMs: number },
): Promise<Date | null> {
  const willRetry = attempt < opts.maxAttempts;
  const nextAttemptAt = willRetry ? new Date(Date.now() + opts.baseDelayMs * 2 ** (attempt - 1)) : null;

  await db
    .insert(webhookDeliveries)
    .values({
      webhookId: hook.id,
      outboxEventId: event.id,
      status: willRetry ? "pending" : "failed",
      attempt,
      responseStatus,
      error,
      nextAttemptAt,
    })
    .onConflictDoUpdate({
      target: [webhookDeliveries.webhookId, webhookDeliveries.outboxEventId],
      set: { status: willRetry ? "pending" : "failed", attempt, responseStatus, error, nextAttemptAt },
    });

  return nextAttemptAt;
}
