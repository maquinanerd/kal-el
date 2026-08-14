import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@kal-el/db";
import { outboxEvents, webhookDeliveries, webhooks } from "@kal-el/db/schema";

import { signWebhook } from "./signature.js";

export type DispatchOptions = {
  fetchImpl?: typeof fetch;
  limit?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onLog?: (line: string) => void;
};

export type DispatchSummary = {
  claimed: number;
  delivered: number;
  failed: number;
  noSubscribers: number;
};

const LOCK_MS = 60_000;

/**
 * Claim due outbox events (SKIP LOCKED) and dispatch them to matching
 * webhooks. Delivery is at-least-once and idempotent: every request carries
 * `X-Kal-El-Idempotency` so subscribers can dedupe, and deliveries upsert on
 * (webhook, event).
 */
export async function processDueEvents(db: Db, opts: DispatchOptions = {}): Promise<DispatchSummary> {
  const { fetchImpl = fetch, limit = 20, maxAttempts = 5, baseDelayMs = 1_000, timeoutMs = 10_000, onLog = () => {} } = opts;
  const now = new Date();

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
        .set({ lockedUntil: new Date(now.getTime() + LOCK_MS) })
        .where(inArray(outboxEvents.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  const summary: DispatchSummary = { claimed: due.length, delivered: 0, failed: 0, noSubscribers: 0 };

  for (const event of due) {
    const subscribers = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.siteId, event.siteId), sql`${webhooks.events} ? ${event.eventType}`));

    if (subscribers.length === 0) {
      await db.update(outboxEvents).set({ status: "published", publishedAt: new Date() }).where(eq(outboxEvents.id, event.id));
      summary.noSubscribers++;
      summary.delivered++;
      continue;
    }

    let allSuccess = true;
    for (const hook of subscribers) {
      const ok = await dispatchOne(db, event, hook, { fetchImpl, maxAttempts, baseDelayMs, timeoutMs, onLog });
      if (ok) summary.delivered++;
      else {
        summary.failed++;
        allSuccess = false;
      }
    }

    if (allSuccess) {
      await db.update(outboxEvents).set({ status: "published", publishedAt: new Date() }).where(eq(outboxEvents.id, event.id));
    } else {
      // leave pending; clear the claim so the next poll can retry
      await db.update(outboxEvents).set({ lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    }
  }

  return summary;
}

type OutboxRow = typeof outboxEvents.$inferSelect;
type WebhookRow = typeof webhooks.$inferSelect;

async function dispatchOne(
  db: Db,
  event: OutboxRow,
  hook: WebhookRow,
  opts: { fetchImpl: typeof fetch; maxAttempts: number; baseDelayMs: number; timeoutMs: number; onLog: (l: string) => void },
): Promise<boolean> {
  const body = JSON.stringify(event.payload);
  const signature = signWebhook(hook.secret, body);
  const deliveryId = randomUUID();
  const idempotencyKey = event.idempotencyKey ?? `${event.id}`;

  const existing = await db.query.webhookDeliveries.findFirst({
    where: and(eq(webhookDeliveries.webhookId, hook.id), eq(webhookDeliveries.outboxEventId, event.id)),
  });
  const attempt = existing ? existing.attempt + 1 : 1;

  try {
    const res = await opts.fetchImpl(hook.url, {
      method: "POST",
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
          set: { status: "success", attempt, responseStatus: res.status, deliveredAt: new Date(), error: null },
        });
      return true;
    }

    const willRetry = await recordFailure(db, hook, event, attempt, res.status, `HTTP ${res.status}`, opts);
    opts.onLog(`delivery ${deliveryId} -> ${hook.url}: HTTP ${res.status} (${willRetry ? "retrying" : "dead-letter"})`);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    const willRetry = await recordFailure(db, hook, event, attempt, null, message, opts);
    opts.onLog(`delivery ${deliveryId} -> ${hook.url}: ${message} (${willRetry ? "retrying" : "dead-letter"})`);
    return false;
  }
}

async function recordFailure(
  db: Db,
  hook: WebhookRow,
  event: OutboxRow,
  attempt: number,
  responseStatus: number | null,
  error: string,
  opts: { maxAttempts: number; baseDelayMs: number },
): Promise<boolean> {
  const willRetry = attempt < opts.maxAttempts;
  const nextAttemptAt = new Date(Date.now() + opts.baseDelayMs * 2 ** (attempt - 1));

  await db
    .insert(webhookDeliveries)
    .values({
      webhookId: hook.id,
      outboxEventId: event.id,
      status: willRetry ? "pending" : "failed",
      attempt,
      responseStatus,
      error,
      nextAttemptAt: willRetry ? nextAttemptAt : null,
    })
    .onConflictDoUpdate({
      target: [webhookDeliveries.webhookId, webhookDeliveries.outboxEventId],
      set: {
        status: willRetry ? "pending" : "failed",
        attempt,
        responseStatus,
        error,
        nextAttemptAt: willRetry ? nextAttemptAt : null,
      },
    });

  if (willRetry) {
    await db
      .update(outboxEvents)
      .set({ availableAt: nextAttemptAt, attempts: event.attempts + 1, lastError: error })
      .where(eq(outboxEvents.id, event.id));
  } else {
    await db.update(outboxEvents).set({ status: "failed", attempts: event.attempts + 1, lastError: error }).where(eq(outboxEvents.id, event.id));
  }

  return willRetry;
}
