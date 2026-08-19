import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articles, outboxEvents, webhookDeliveries, webhooks, workerHeartbeats } from "@kal-el/db/schema";

/**
 * How stale a heartbeat may be before the worker counts as down.
 *
 * The worker writes one every tick (default 1s), so a minute is ~60 missed ticks - long
 * enough not to flap during a restart, short enough that an operator notices within one
 * editorial cycle.
 */
const HEARTBEAT_STALE_MS = 60_000;

export type OperationalStatus = {
  checkedAt: string;
  worker: { status: "up" | "stale" | "unknown"; lastSeenAt: string | null; details: Record<string, unknown> | null };
  outbox: { pending: number; due: number; failed: number; oldestPendingAt: string | null };
  scheduled: { total: number; overdue: number; nextAt: string | null };
  webhooks: { total: number; enabled: number; failing: number };
  articles: { blocked: number };
};

function count(rows: { n: unknown }[]): number {
  return Number(rows[0]?.n ?? 0);
}

/**
 * Operational snapshot for one site.
 *
 * Every number is read from the tables that actually drive behaviour - no derived
 * "health score" and no metric that cannot be traced back to a row. The panel exists so
 * an operator can answer "is anything stuck?" after a deploy without opening psql.
 */
export async function operationalStatus(db: Db, siteId: string): Promise<OperationalStatus> {
  const now = new Date();

  const [heartbeat, outboxPending, outboxDue, outboxFailed, oldestPending, scheduledTotal, scheduledOverdue, nextScheduled, hookRows, failingHooks, blocked] =
    await Promise.all([
      db.query.workerHeartbeats.findFirst({ where: eq(workerHeartbeats.id, "worker") }),
      db.select({ n: sql<number>`count(*)` }).from(outboxEvents).where(and(eq(outboxEvents.siteId, siteId), eq(outboxEvents.status, "pending"))),
      db
        .select({ n: sql<number>`count(*)` })
        .from(outboxEvents)
        .where(and(eq(outboxEvents.siteId, siteId), eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, now))),
      db.select({ n: sql<number>`count(*)` }).from(outboxEvents).where(and(eq(outboxEvents.siteId, siteId), eq(outboxEvents.status, "failed"))),
      db
        .select({ at: sql<Date | null>`min(${outboxEvents.createdAt})` })
        .from(outboxEvents)
        .where(and(eq(outboxEvents.siteId, siteId), eq(outboxEvents.status, "pending"))),
      db.select({ n: sql<number>`count(*)` }).from(articles).where(and(eq(articles.siteId, siteId), eq(articles.status, "scheduled"))),
      db
        .select({ n: sql<number>`count(*)` })
        .from(articles)
        .where(and(eq(articles.siteId, siteId), eq(articles.status, "scheduled"), lte(articles.scheduledAt, now))),
      db
        .select({ at: sql<Date | null>`min(${articles.scheduledAt})` })
        .from(articles)
        .where(and(eq(articles.siteId, siteId), eq(articles.status, "scheduled"))),
      db.select({ id: webhooks.id, enabled: webhooks.enabled }).from(webhooks).where(eq(webhooks.siteId, siteId)),
      db
        .select({ n: sql<number>`count(distinct ${webhookDeliveries.webhookId})` })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(and(eq(webhooks.siteId, siteId), eq(webhookDeliveries.status, "failed"))),
      db.select({ n: sql<number>`count(*)` }).from(articles).where(and(eq(articles.siteId, siteId), eq(articles.status, "blocked"))),
    ]);

  const lastSeenAt = heartbeat?.lastSeenAt ?? null;
  const workerStatus: OperationalStatus["worker"]["status"] = !lastSeenAt
    ? "unknown"
    : now.getTime() - lastSeenAt.getTime() > HEARTBEAT_STALE_MS
      ? "stale"
      : "up";

  const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

  return {
    checkedAt: now.toISOString(),
    worker: { status: workerStatus, lastSeenAt: lastSeenAt?.toISOString() ?? null, details: heartbeat?.details ?? null },
    outbox: {
      pending: count(outboxPending),
      due: count(outboxDue),
      failed: count(outboxFailed),
      oldestPendingAt: toIso(oldestPending[0]?.at),
    },
    scheduled: {
      total: count(scheduledTotal),
      // due but not yet promoted: the number that says whether the worker is keeping up
      overdue: count(scheduledOverdue),
      nextAt: toIso(nextScheduled[0]?.at),
    },
    webhooks: {
      total: hookRows.length,
      enabled: hookRows.filter((h) => h.enabled).length,
      failing: count(failingHooks),
    },
    articles: { blocked: count(blocked) },
  };
}
