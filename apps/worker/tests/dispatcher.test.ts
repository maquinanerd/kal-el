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

  it("delivers an event to a subscriber with signed, idempotent headers", async () => {
    received = [];
    await seedWebhook();
    const event = await seedEvent({ articleId: "a-1", slug: "gladiador-ii" });

    const summary = await processDueEvents(db);
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

    const first = await processDueEvents(db);
    expect(first.failed).toBe(1);

    const delivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(delivery?.status).toBe("pending");
    expect(delivery?.attempt).toBe(1);
    expect(delivery?.nextAttemptAt).toBeTruthy();

    // the event is not re-claimed before its retry time
    const retrySoon = await processDueEvents(db);
    expect(retrySoon.claimed).toBe(0);

    // simulate the retry window opening and the endpoint recovering
    await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));

    const second = await processDueEvents(db);
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

    const first = await processDueEvents(db, { maxAttempts: 2 });
    expect(first.failed).toBe(1);

    await db.update(outboxEvents).set({ availableAt: new Date(Date.now() - 1000), lockedUntil: null }).where(eq(outboxEvents.id, event.id));
    const second = await processDueEvents(db, { maxAttempts: 2 });
    expect(second.failed).toBe(1);

    const done = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(done?.status).toBe("failed");
    const delivery = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.outboxEventId, event.id),
    });
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attempt).toBe(2);
  });

  it("marks events as published when there are no subscribers", async () => {
    received = [];
    const event = await seedEvent({ articleId: "a-4" });
    const summary = await processDueEvents(db);
    expect(summary.noSubscribers).toBe(1);
    const after = await db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, event.id) });
    expect(after?.status).toBe("published");
  });
});
