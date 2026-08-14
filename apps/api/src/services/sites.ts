import { asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { sites } from "@kal-el/db/schema";
import type { CreateSiteBody, UpdateSiteBody } from "@kal-el/contracts";

import { conflict, isUniqueViolation, notFound } from "../plugins/errors.js";

export async function listSites(db: Db) {
  return db.select().from(sites).orderBy(asc(sites.slug));
}

export async function getSite(db: Db, siteId: string) {
  const row = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!row) throw notFound("site not found");
  return row;
}

export async function createSite(db: Db, body: CreateSiteBody) {
  try {
    const [row] = await db.insert(sites).values(body).returning();
    if (!row) throw new Error("createSite returned no row");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`site slug "${body.slug}" already exists`, { field: "slug" });
    }
    throw err;
  }
}

export async function updateSite(db: Db, siteId: string, body: UpdateSiteBody) {
  await getSite(db, siteId);
  const [row] = await db.update(sites).set({ ...body, updatedAt: new Date() }).where(eq(sites.id, siteId)).returning();
  if (!row) throw notFound("site not found");
  return row;
}
