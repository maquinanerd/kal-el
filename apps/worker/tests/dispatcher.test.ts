import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { freshTestDb, seedSite } from "@kal-el/testkit";
import { createDb, createPool, type Db } from "@kal-el/db";
import { outboxEvents, webhookDeliveries, webhooks } from "@kal-el/db/schema";

import { processDueEvents } from "../src/dispatcher.js";
import { signWebhook, verifyWebhookSignature } from "../src/signature.js";

describe("webhook signature", () => {
  it("signs and verifies with timing-safe comparison", () => {
    const secret = "test-secret";
    const body = JSON.stringify({ a: 1 });
    const sig = signWebhook(secret, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, body, signWebhook(secret, JSON.stringify({ a: 2 })))).toBe(false);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
  });
});

describe("outbox dispatcher", () => {
  let pool: ReturnType<typeof createPool>;
  let db: Db;
  let siteId: string;
  let secret: string;
  let received: { body: unknown; headers: Record<string, string | string[] | undefined> }[] = [];
  let failUntil = 0;
  let calls = 0;
  let server: Server;

  beforeAll(async () => {
    const fresh = await freshTestDb();
    pool = fresh.pool;
    db = createDb(pool);
    const site = await seedSite(db);
    siteId = site.id;

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        calls++;
        received.push({ body: JSON.parse(raw || "{}"), headers: req.headers });
        if (calls <= failUntil) {
          res.writeHead(500);
          res.end("boom");
        } else {
          res.writeHead(200);
          res.end("ok");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(async () => {
    received = [];
    calls = 0;
    failUntil = 0;
    await db.delete(webhookDeliveries);
    await db.delete(outboxEvents);
    await db.delete(webhooks);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  const webhookUrl = () => {
    const addr = server.address() as import("node:net").AddressInfo | null;
    return `http://127.0.0.1:${addr?.port ?? 1}/hook`;
  };

  async function seedWebhook(events: string[] = ["article.published"]) {
    secret = `wh-${Math.random().toString(36).slice(2)}`;
    const [row] = await db
      .insert(webhooks)
      .values({ siteId, url: webhookUrl(), events, secret })
      .returning();
    if (!row) throw new Error("webhook insert failed");
    return row;
  }

  async function seedEvent(payload: Record<string, unknown> = { articleId: "a", slug: "x" }, eventType = "article.published") {
    const [row] = await db
      .insert(outboxEvents)
      .values({
        siteId,
        aggregateType: "article",
        aggregateId: "00000000-0000-0000-0000-000000000001",
        eventType,
        payload,
        idempotencyKey: `event-${Math.random()}`,
        // explicit past availability avoids millisecond-boundary flakiness
        availableAt: new Date(Date.now() - 5000),
      })
      .returning();
    if (!row) throw new Error("outbox insert failed");
    return row;
  }

  it("tracks retry state per hook: a broken subscriber neither re-delivers to a healthy one nor kills the event", async () => {
    // Retry state used to live on the shared event row while delivery was per hook. With
    // two subscribers - a healthy CDN hook and a partner endpoint that has been down for
    // a week - the event stayed pending for the broken one, so every pass re-POSTed to
    // the healthy one, and the moment the broken one ran out of attempts the whole event
    // went to `failed` and stopped being claimed at all.
    const dead = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(500);
      res.end("down");
    });
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const deadAddr = dead.address() as import("node:net").AddressInfo;

    try {
      const healthy = await seedWebhook();
      await db
        .insert(webhooks)
        .values({ siteId, url: `http://127.0.0.1:${deadAddr.port}/hook`, events: ["article.published"], secret: "broken-secret" });
      const event = await seedEvent();

      const first = await processDueEvents(db, { allowPrivateTargets: true, maxAttempts: 2, baseDelayMs: 1 });
      expect(first.delivered).toBe(1);
      expect(first.failed).toBe(1);
      expect(calls).toBe(1);

      // one subscriber still has attempts left, so the event is not dead yet
      const afterFirst = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
      expect(afterFirst?.status).toBe("pending");

      await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 5_000) }).where(eq(outboxEvents.id, event.id));
      const second = await processDueEvents(db, { allowPrivateTargets: true, maxAttempts: 2, baseDelayMs: 1 });

      // the healthy subscriber is never asked twice
      expect(calls).toBe(1);
      expect(second.alreadyDelivered).toBe(1);
      const okRow = await db.query.webhookDeliveries.findFirst({ where: eq(webhookDeliveries.webhookId, healthy.id) });
      expect(okRow?.status).toBe("success");
      expect(okRow?.attempt).toBe(1);

      // and only now, with every failing subscriber exhausted, is the event itself failed
      const afterSecond = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
      expect(afterSecond?.status).toBe("failed");
    } finally {
      await new Promise<void>((resolve) => dead.close(() => resolve()));
    }
  });

  it("delivers an event to a subscriber with signed, idempotent headers", async () => {
    received = [];
    await seedWebhook();
    const event = await seedEvent({ articleId: "a-1", slug: "gladiador-ii" });

    const summary = await processDueEvents(db, { allowPrivateTargets: true });
    expect(summary.delivered).toBe(1);
    expect(summary.failed).toBe(0);

    const after = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(after?.status).toBe("published");

    const delivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(delivery?.status).toBe("success");
    expect(delivery?.attempt).toBe(1);

    expect(received.length).toBe(1);
    const h = received[0]?.headers ?? {};
    expect(h["x-kal-el-event"]).toBe("article.published");
    expect(h["x-kal-el-idempotency"]).toBe(event.idempotencyKey);
    const sig = String(h["x-kal-el-signature"] ?? "");
    expect(verifyWebhookSignature(secret, JSON.stringify(event.payload), sig)).toBe(true);
  });

  it("retries transient failures and converges on success", async () => {
    received = [];
    failUntil = 1;
    calls = 0;
    await seedWebhook();
    const event = await seedEvent({ articleId: "a-2" });

    const first = await processDueEvents(db, { allowPrivateTargets: true });
    expect(first.failed).toBe(1);

    const delivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(delivery?.status).toBe("pending");
    expect(delivery?.attempt).toBe(1);
    expect(delivery?.nextAttemptAt).toBeTruthy();

    // the event is not re-claimed before its retry time
    const retrySoon = await processDueEvents(db, { allowPrivateTargets: true });
    expect(retrySoon.claimed).toBe(0);

    // opening only the event window is not enough: each hook carries its own backoff, so
    // a sibling with a shorter one cannot drag this hook into an early retry
    await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    const tooEarly = await processDueEvents(db, { allowPrivateTargets: true });
    expect(tooEarly.waiting).toBe(1);
    expect(calls).toBe(1);

    // simulate the hook's retry window opening and the endpoint recovering
    await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.outboxEventId, event.id));

    const second = await processDueEvents(db, { allowPrivateTargets: true });
    expect(second.delivered).toBe(1);

    const done = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(done?.status).toBe("published");
    const finalDelivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(finalDelivery?.status).toBe("success");
    expect(finalDelivery?.attempt).toBe(2);
    expect(received.length).toBe(2);
  });

  it("dead-letters an event that exceeds max attempts", async () => {
    received = [];
    failUntil = 999;
    calls = 0;
    await seedWebhook();
    const event = await seedEvent({ articleId: "a-3" });

    const first = await processDueEvents(db, { allowPrivateTargets: true, maxAttempts: 2 });
    expect(first.failed).toBe(1);

    await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.outboxEventId, event.id));
    const second = await processDueEvents(db, { allowPrivateTargets: true, maxAttempts: 2 });
    expect(second.failed).toBe(1);

    const done = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(done?.status).toBe("failed");
    const delivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attempt).toBe(2);

    // and a dead-lettered hook is never contacted again, however long the event lives
    const callsAtDeath = calls;
    await db.update(outboxEvents).set({ status: "pending", availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    const third = await processDueEvents(db, { allowPrivateTargets: true, maxAttempts: 2 });
    expect(third.deadLettered).toBe(1);
    expect(calls).toBe(callsAtDeath);
  });

  it("marks events as published when there are no subscribers", async () => {
    received = [];
    const event = await seedEvent({ articleId: "a-4" });
    const summary = await processDueEvents(db, { allowPrivateTargets: true });
    expect(summary.noSubscribers).toBe(1);
    const after = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(after?.status).toBe("published");
  });
});
