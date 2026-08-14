import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { webhooks } from "@kal-el/db/schema";
import type { CreateWebhookBody } from "@kal-el/contracts";

import { notFound } from "../plugins/errors.js";

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

export async function createWebhook(db: Db, siteId: string, body: CreateWebhookBody) {
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
  const [row] = await db
    .delete(webhooks)
    .where(eq(webhooks.id, webhookId))
    .returning();
  if (!row || row.siteId !== siteId) throw notFound("webhook not found");
  return { id: row.id, deleted: true };
}
