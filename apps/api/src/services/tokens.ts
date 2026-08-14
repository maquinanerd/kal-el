import { desc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { serviceTokens } from "@kal-el/db/schema";
import { generateOpaqueToken, hashToken, serviceTokenPrefix } from "@kal-el/auth";
import type { CreateServiceTokenBody } from "@kal-el/contracts";

import { badRequest, notFound } from "../plugins/errors.js";

const VALID_SCOPES = [
  "system.manage",
  "articles.create",
  "articles.read",
  "articles.update",
  "articles.publish",
  "articles.schedule",
  "media.manage",
  "seo.manage",
  "taxonomy.categories.manage",
  "taxonomy.tags.manage",
  "taxonomy.entities.manage",
  "taxonomy.authors.manage",
  "taxonomy.sources.manage",
];

export async function createServiceToken(db: Db, siteId: string, body: CreateServiceTokenBody) {
  const invalid = body.scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) {
    throw badRequest(`unknown scopes: ${invalid.join(", ")}`, { field: "scopes" });
  }

  const token = generateOpaqueToken(serviceTokenPrefix());
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const [row] = await db
    .insert(serviceTokens)
    .values({ siteId, name: body.name, tokenHash: hashToken(token), scopes: body.scopes, expiresAt })
    .returning();
  if (!row) throw new Error("createServiceToken returned no row");

  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    token,
  };
}

export async function listServiceTokens(db: Db, siteId: string) {
  const rows = await db
    .select()
    .from(serviceTokens)
    .where(eq(serviceTokens.siteId, siteId))
    .orderBy(desc(serviceTokens.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function revokeServiceToken(db: Db, siteId: string, tokenId: string) {
  const [row] = await db
    .update(serviceTokens)
    .set({ revokedAt: new Date() })
    .where(eq(serviceTokens.id, tokenId))
    .returning();
  if (!row) throw notFound("service token not found");
  if (row.siteId !== siteId) throw notFound("service token not found");
  return { id: row.id, revokedAt: row.revokedAt?.toISOString() ?? null };
}
