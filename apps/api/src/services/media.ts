import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { imageSize } from "image-size";
import type { Db } from "@kal-el/db";
import { articles, authors, media } from "@kal-el/db/schema";
import type { UpdateMediaBody } from "@kal-el/contracts";

import { badRequest, conflict, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import type { StorageProvider } from "../storage/provider.js";
import type { ArticleDocumentV2 } from "@kal-el/contracts";
import type { ActorRef } from "./articles.js";

// Raster formats only. SVG is deliberately excluded (XSS surface).
export const MEDIA_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

type MediaRow = typeof media.$inferSelect;

export function sanitizeFilename(raw: string): string {
  const base = path
    .basename(raw.replace(/\\/g, "/"))
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return base || "file";
}

function readDimensions(buffer: Buffer): { width: number | null; height: number | null } {
  try {
    const dim = imageSize(buffer);
    return { width: dim.width ?? null, height: dim.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export function mediaUrl(baseUrl: string, siteId: string, mediaId: string): string {
  return `${baseUrl}/v1/sites/${siteId}/media/${mediaId}/file`;
}

function mediaDto(row: MediaRow, baseUrl: string) {
  return {
    id: row.id,
    siteId: row.siteId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    altText: row.altText,
    caption: row.caption,
    credit: row.credit,
    focalX: row.focalX,
    focalY: row.focalY,
    storageKey: row.storageKey,
    provider: row.provider,
    url: mediaUrl(baseUrl, row.siteId, row.id),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function uploadMedia(
  db: Db,
  storage: StorageProvider,
  siteId: string,
  actor: ActorRef,
  input: { filename: string; mimeType: string; data: Buffer },
  opts: { maxBytes: number; baseUrl: string },
) {
  if (!MEDIA_MIME_TYPES.has(input.mimeType)) {
    throw badRequest(`unsupported media type: ${input.mimeType}`);
  }
  if (input.data.length === 0) throw badRequest("empty file");
  if (input.data.length > opts.maxBytes) throw badRequest(`file exceeds the ${opts.maxBytes} byte limit`);

  const ext = EXT_BY_MIME[input.mimeType] ?? "bin";
  const key = `sites/${siteId}/${randomUUID()}.${ext}`;
  const { width, height } = readDimensions(input.data);

  await storage.put({ key, data: input.data, mimeType: input.mimeType });

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(media)
      .values({
        siteId,
        filename: sanitizeFilename(input.filename),
        mimeType: input.mimeType,
        sizeBytes: input.data.length,
        width,
        height,
        storageKey: key,
        provider: storage.name,
        createdBy: actor.kind === "user" ? actor.userId ?? null : null,
      })
      .returning();
    if (!inserted) throw new Error("uploadMedia returned no row");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.upload",
      objectType: "media",
      objectId: inserted.id,
      details: { filename: inserted.filename, mimeType: inserted.mimeType, sizeBytes: inserted.sizeBytes },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return inserted;
  });

  return mediaDto(row, opts.baseUrl);
}

export async function listMedia(db: Db, siteId: string, baseUrl: string, limit = 100) {
  const rows = await db
    .select()
    .from(media)
    .where(eq(media.siteId, siteId))
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => mediaDto(r, baseUrl));
}

export async function getMedia(db: Db, siteId: string, mediaId: string, baseUrl: string) {
  const row = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!row) throw notFound("media not found");
  return mediaDto(row, baseUrl);
}

export async function updateMedia(db: Db, siteId: string, mediaId: string, actor: ActorRef, body: UpdateMediaBody, baseUrl: string) {
  const existing = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!existing) throw notFound("media not found");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(media)
      .set({
        altText: body.altText !== undefined ? body.altText : existing.altText,
        caption: body.caption !== undefined ? body.caption : existing.caption,
        credit: body.credit !== undefined ? body.credit : existing.credit,
        focalX: body.focalX !== undefined ? body.focalX : existing.focalX,
        focalY: body.focalY !== undefined ? body.focalY : existing.focalY,
        updatedAt: new Date(),
      })
      .where(and(eq(media.id, mediaId), eq(media.siteId, siteId)))
      .returning();
    if (!row) throw notFound("media not found");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.update",
      objectType: "media",
      objectId: mediaId,
      details: { changedFields: Object.keys(body) },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return row;
  });

  return mediaDto(updated, baseUrl);
}

export async function deleteMedia(db: Db, storage: StorageProvider, siteId: string, mediaId: string, actor: ActorRef) {
  const existing = await db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.siteId, siteId)) });
  if (!existing) throw notFound("media not found");

  const pattern = `%"mediaId":"${mediaId}"%`;
  const usedByArticle = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.siteId, siteId), or(eq(articles.featuredMediaId, mediaId), sql`${articles.document}::text like ${pattern}`)))
    .limit(1);
  const usedByAuthor = await db
    .select({ id: authors.id })
    .from(authors)
    .where(and(eq(authors.siteId, siteId), eq(authors.avatarMediaId, mediaId)))
    .limit(1);
  if (usedByArticle.length > 0 || usedByAuthor.length > 0) {
    throw conflict("media is in use");
  }

  await storage.delete(existing.storageKey);
  await db.transaction(async (tx) => {
    await tx.delete(media).where(and(eq(media.id, mediaId), eq(media.siteId, siteId)));
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "media.delete",
      objectType: "media",
      objectId: mediaId,
      details: { storageKey: existing.storageKey },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  });

  return { id: mediaId, deleted: true };
}

/**
 * Verify that every referenced media id exists and belongs to `siteId`.
 * Blocks cross-site media attachment for featured images and document nodes.
 */
export async function assertMediaInSite(db: Db, siteId: string, mediaIds: string[]): Promise<void> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (ids.length === 0) return;
  const rows = await db.select({ id: media.id, siteId: media.siteId }).from(media).where(inArray(media.id, ids));
  const found = new Map(rows.map((r) => [r.id, r.siteId]));
  for (const id of ids) {
    const site = found.get(id);
    if (!site) throw badRequest("referenced media does not exist", { mediaId: id });
    if (site !== siteId) throw badRequest("referenced media does not belong to this site", { mediaId: id });
  }
}

/** Collect every media id referenced by image/gallery document nodes. */
export function collectDocumentMediaIds(document: ArticleDocumentV2): string[] {
  const ids: string[] = [];
  for (const node of document.nodes ?? []) {
    if (node.type === "image") ids.push(node.attrs.mediaId);
    if (node.type === "gallery") ids.push(...node.attrs.mediaIds);
  }
  return ids;
}
