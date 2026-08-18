import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { webhooks } from "@kal-el/db/schema";
import type { CreateWebhookBody } from "@kal-el/contracts";

import { badRequest, notFound } from "../plugins/errors.js";

function dto(row: typeof webhooks.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    url: row.url,
    events: row.events,
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
  const [row] = await db.insert(webhooks).values({ siteId, url: body.url, events: body.events, secret }).returning();
  if (!row) throw new Error("createWebhook returned no row");
  return { ...dto(row), secret };
}

export async function listWebhooks(db: Db, siteId: string) {
  const rows = await db.select().from(webhooks).where(eq(webhooks.siteId, siteId)).orderBy(asc(webhooks.createdAt));
  return rows.map(dto);
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
