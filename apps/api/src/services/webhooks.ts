import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { outboxEvents, webhookDeliveries, webhooks } from "@kal-el/db/schema";
import type { CreateWebhookBody, UpdateWebhookBody } from "@kal-el/contracts";

import { badRequest, notFound } from "../plugins/errors.js";

/**
 * The signing secret is deliberately absent.
 *
 * It is shown exactly once, in the create response, the same way a service token is. A
 * list endpoint that returns it turns every reader of the admin UI into someone who can
 * forge a signed payload to the subscriber.
 */
function dto(row: typeof webhooks.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    url: row.url,
    events: row.events,
    description: row.description ?? null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isPrivateIpv4(h: string): boolean {
  const parts = h.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    a >= 224 // multicast / reserved
  );
}

/**
 * `::ffff:169.254.169.254` and `::ffff:a9fe:a9fe` are the same address; the WHATWG URL
 * parser normalises the first into the second, so the mapped form has to be decoded
 * before the range check or the IPv4 rules are trivially bypassed.
 */
function unmapIpv4(h: string): string | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") {
    return true;
  }
  const ip = isIP(h);
  if (ip === 4) return isPrivateIpv4(h);
  if (ip === 6) {
    const mapped = unmapIpv4(h);
    if (mapped) return isPrivateIpv4(mapped);
    if (h === "::1" || h === "::") return true;
    // unique-local fc00::/7 and link-local fe80::/10
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

/**
 * Resolve the hostname and check every address it answers with. A name-only check is
 * bypassed by any hostname whose A record points at a private address, and the attacker
 * controls that DNS.
 */
async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  if (isIP(hostname) !== 0) return false; // literal, already checked
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return true;
    return addresses.some((a) => isPrivateHost(a.address));
  } catch {
    // Transient resolver failure must not reject a legitimate URL. The authoritative
    // check is the one the dispatcher runs immediately before each delivery, which is
    // also what closes the DNS-rebinding window this check alone cannot.
    return false;
  }
}

/** Reject webhook URLs that resolve to private/link-local/metadata hosts (SSRF). */
export async function assertSafeWebhookUrl(url: string, allowPrivate = false): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest("invalid webhook url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw badRequest("webhook url must be http(s)");
  if (allowPrivate) return;
  if (isPrivateHost(parsed.hostname)) {
    throw badRequest("webhook url must not point to a private or local address");
  }
  if (await resolvesToPrivateAddress(parsed.hostname)) {
    throw badRequest("webhook url must not point to a private or local address");
  }
}

export async function createWebhook(db: Db, siteId: string, body: CreateWebhookBody, opts: { allowPrivate?: boolean } = {}) {
  await assertSafeWebhookUrl(body.url, opts.allowPrivate);
  const secret = body.secret ?? randomBytes(32).toString("hex");
  const [row] = await db
    .insert(webhooks)
    .values({ siteId, url: body.url, events: body.events, secret, description: body.description ?? null })
    .returning();
  if (!row) throw new Error("createWebhook returned no row");
  // The only time the secret is ever returned. Same contract as a service token.
  return { ...dto(row), secret };
}

export async function updateWebhook(db: Db, siteId: string, webhookId: string, body: UpdateWebhookBody, opts: { allowPrivate?: boolean } = {}) {
  const existing = await db.query.webhooks.findFirst({
    where: and(eq(webhooks.id, webhookId), eq(webhooks.siteId, siteId)),
  });
  if (!existing) throw notFound("webhook not found");
  // Re-point is a change of egress destination, so it goes through the same SSRF check
  // as registration - not just the delivery-time one.
  if (body.url !== undefined && body.url !== existing.url) {
    await assertSafeWebhookUrl(body.url, opts.allowPrivate);
  }
  const [row] = await db
    .update(webhooks)
    .set({
      url: body.url ?? existing.url,
      events: body.events ?? existing.events,
      description: body.description !== undefined ? body.description : existing.description,
      enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
      updatedAt: new Date(),
    })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.siteId, siteId)))
    .returning();
  if (!row) throw notFound("webhook not found");
  return dto(row);
}

export type WebhookWithHealth = ReturnType<typeof dto> & {
  lastDelivery: {
    status: string;
    attempt: number;
    responseStatus: number | null;
    error: string | null;
    at: string | null;
    eventType: string | null;
  } | null;
};

/**
 * Webhooks plus the outcome of their most recent delivery.
 *
 * Without this the admin surface can show that a subscriber exists but not whether it is
 * working - and a dead-lettered endpoint looks exactly like a healthy one that has had no
 * events. One query for the deliveries rather than one per hook.
 */
export async function listWebhooks(db: Db, siteId: string): Promise<WebhookWithHealth[]> {
  const rows = await db.select().from(webhooks).where(eq(webhooks.siteId, siteId)).orderBy(asc(webhooks.createdAt));
  if (rows.length === 0) return [];

  const deliveries = await db
    .select({
      webhookId: webhookDeliveries.webhookId,
      status: webhookDeliveries.status,
      attempt: webhookDeliveries.attempt,
      responseStatus: webhookDeliveries.responseStatus,
      error: webhookDeliveries.error,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
      eventType: outboxEvents.eventType,
    })
    .from(webhookDeliveries)
    .innerJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.outboxEventId))
    .where(inArray(webhookDeliveries.webhookId, rows.map((r) => r.id)))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(rows.length * 20);

  const latest = new Map<string, (typeof deliveries)[number]>();
  for (const d of deliveries) {
    if (!latest.has(d.webhookId)) latest.set(d.webhookId, d);
  }

  return rows.map((r) => {
    const d = latest.get(r.id);
    return {
      ...dto(r),
      lastDelivery: d
        ? {
            status: d.status,
            attempt: d.attempt,
            responseStatus: d.responseStatus,
            error: d.error,
            at: (d.deliveredAt ?? d.createdAt).toISOString(),
            eventType: d.eventType,
          }
        : null,
    };
  });
}

export async function deleteWebhook(db: Db, siteId: string, webhookId: string) {
  // The site filter belongs in the WHERE clause: checking it after the DELETE would
  // already have destroyed another site's webhook by the time we throw.
  const [row] = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.siteId, siteId)))
    .returning();
  if (!row) throw notFound("webhook not found");
  return { id: row.id, deleted: true };
}
