import { asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { redirects } from "@kal-el/db/schema";
import type { CreateRedirectBody } from "@kal-el/contracts";

import { conflict, notFound } from "../plugins/errors.js";

function dto(row: typeof redirects.$inferSelect) {
  return {
    id: row.id,
    siteId: row.siteId,
    sourcePath: row.sourcePath,
    targetPath: row.targetPath,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createRedirect(db: Db, siteId: string, body: CreateRedirectBody) {
  try {
    const [row] = await db.insert(redirects).values({ siteId, sourcePath: body.sourcePath, targetPath: body.targetPath, kind: body.kind }).returning();
    if (!row) throw new Error("createRedirect returned no row");
    return dto(row);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw conflict(`source path "${body.sourcePath}" already has a redirect`, { field: "sourcePath" });
    }
    throw err;
  }
}

export async function listRedirects(db: Db, siteId: string) {
  const rows = await db.select().from(redirects).where(eq(redirects.siteId, siteId)).orderBy(asc(redirects.sourcePath));
  return rows.map(dto);
}

export async function deleteRedirect(db: Db, siteId: string, redirectId: string) {
  const [row] = await db.delete(redirects).where(eq(redirects.id, redirectId)).returning();
  if (!row || row.siteId !== siteId) throw notFound("redirect not found");
  return { id: row.id, deleted: true };
}

/**
 * SEO contract: when an article slug changes, keep the old URL alive with a
 * permanent (301) redirect to the new slug (docs/03-SEO.md).
 */
export async function upsertSlugRedirect(db: Db, siteId: string, fromSlug: string, toSlug: string): Promise<void> {
  if (fromSlug === toSlug) return;
  const sourcePath = `/${fromSlug}`;
  const targetPath = `/${toSlug}`;
  await db
    .insert(redirects)
    .values({ siteId, sourcePath, targetPath, kind: "301" })
    .onConflictDoUpdate({
      target: [redirects.siteId, redirects.sourcePath],
      set: { targetPath, kind: "301", updatedAt: new Date() },
    });
}
