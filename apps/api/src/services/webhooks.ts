import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
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

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return true;
  const ip = isIP(h);
  if (ip === 4) {
    const parts = h.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (ip === 6) {
    return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  }
  return false;
}

/** Reject webhook URLs that resolve to private/link-local/metadata hosts (SSRF). */
export function assertSafeWebhookUrl(url: string, allowPrivate = false): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest("invalid webhook url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw badRequest("webhook url must be http(s)");
  if (!allowPrivate && isPrivateHost(parsed.hostname)) {
    throw badRequest("webhook url must not point to a private or local address");
  }
}

export async function createWebhook(db: Db, siteId: string, body: CreateWebhookBody, opts: { allowPrivate?: boolean } = {}) {
  assertSafeWebhookUrl(body.url, opts.allowPrivate);
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
