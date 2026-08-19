import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articles, authors, categories, entities, sources, tags, userRoles } from "@kal-el/db/schema";
import type {
  CreateAuthorBody,
  CreateCategoryBody,
  CreateEntityBody,
  CreateSourceBody,
  CreateTagBody,
  UpdateAuthorBody,
  UpdateCategoryBody,
  UpdateEntityBody,
  UpdateSourceBody,
  UpdateTagBody,
} from "@kal-el/contracts";

import { badRequest, conflict, isUniqueViolation, notFound, pgConstraint } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import type { ActorRef } from "./articles.js";

/**
 * A byline may only be linked to an account that actually belongs to this site -
 * otherwise linking would hand a user from another tenant edit rights here.
 */
/** Distinguishes the two unique constraints on `authors` so the message is not a lie. */
function authorConflict(err: unknown, slug?: string) {
  if (pgConstraint(err) === "authors_site_user_unique") {
    return conflict("this account already has an author byline on this site", { field: "userId" });
  }
  return conflict(slug ? `author slug "${slug}" already exists` : "author already exists", { field: "slug" });
}

async function assertUserIsSiteMember(db: Db, siteId: string, userId: string): Promise<void> {
  const membership = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.siteId, siteId)),
  });
  if (!membership) throw badRequest("user is not a member of this site", { userId });
}

function iso(row: { createdAt: Date; updatedAt: Date }) {
  return { createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function createCategory(db: Db, siteId: string, actor: ActorRef, body: CreateCategoryBody) {
  if (body.parentId) {
    const parent = await db.query.categories.findFirst({ where: and(eq(categories.id, body.parentId), eq(categories.siteId, siteId)) });
    if (!parent) throw notFound("parent category not found");
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(categories)
        .values({ siteId, name: body.name, slug: body.slug, parentId: body.parentId ?? null, description: body.description ?? null })
        .returning();
      if (!inserted) throw new Error("createCategory failed");
      await writeAudit(tx, {
        siteId,
        actorType: actor.kind,
        actorId: actor.kind === "user" ? actor.userId ?? null : null,
        action: "categories.create",
        objectType: "category",
        objectId: inserted.id,
        details: { name: body.name, slug: body.slug },
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      });
      return inserted;
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`category slug "${body.slug}" already exists`, { field: "slug" });
    }
    throw err;
  }
}

export async function listCategories(db: Db, siteId: string) {
  const rows = await db.select().from(categories).where(eq(categories.siteId, siteId)).orderBy(asc(categories.position), asc(categories.name));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    parentId: r.parentId,
    name: r.name,
    slug: r.slug,
    description: r.description ?? null,
    ...iso(r),
  }));
}

export async function createTag(db: Db, siteId: string, actor: ActorRef, body: CreateTagBody) {
  try {
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(tags).values({ siteId, name: body.name, slug: body.slug }).returning();
      if (!inserted) throw new Error("createTag failed");
      await writeAudit(tx, {
        siteId,
        actorType: actor.kind,
        actorId: actor.kind === "user" ? actor.userId ?? null : null,
        action: "tags.create",
        objectType: "tag",
        objectId: inserted.id,
        details: { name: body.name, slug: body.slug },
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      });
      return inserted;
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`tag slug "${body.slug}" already exists`, { field: "slug" });
    }
    throw err;
  }
}

export async function listTags(db: Db, siteId: string) {
  const rows = await db.select().from(tags).where(eq(tags.siteId, siteId)).orderBy(asc(tags.name));
  return rows.map((r) => ({ id: r.id, siteId: r.siteId, name: r.name, slug: r.slug, ...iso(r) }));
}

export async function createEntity(db: Db, siteId: string, actor: ActorRef, body: CreateEntityBody) {
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(entities).values({ siteId, name: body.name, type: body.type, description: body.description ?? null, externalRefs: body.externalRefs }).returning();
    if (!inserted) throw new Error("createEntity failed");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "entities.create",
      objectType: "entity",
      objectId: inserted.id,
      details: { name: body.name, type: body.type, externalRefs: body.externalRefs },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return inserted;
  });
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    type: row.type,
    description: row.description ?? null,
    externalRefs: row.externalRefs,
    ...iso(row),
  };
}

export async function listEntities(db: Db, siteId: string, type?: string) {
  const conditions = [eq(entities.siteId, siteId)];
  if (type) conditions.push(eq(entities.type, type));
  const rows = await db.select().from(entities).where(and(...conditions)).orderBy(asc(entities.name));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    name: r.name,
    type: r.type,
    description: r.description ?? null,
    externalRefs: r.externalRefs,
    ...iso(r),
  }));
}

export async function createAuthor(db: Db, siteId: string, actor: ActorRef, body: CreateAuthorBody) {
  try {
    const row = await db.transaction(async (tx) => {
      if (body.userId) await assertUserIsSiteMember(tx as unknown as Db, siteId, body.userId);
      const [inserted] = await tx
        .insert(authors)
        .values({ siteId, name: body.name, slug: body.slug, bio: body.bio ?? null, email: body.email ?? null, userId: body.userId ?? null })
        .returning();
      if (!inserted) throw new Error("createAuthor failed");
      await writeAudit(tx, {
        siteId,
        actorType: actor.kind,
        actorId: actor.kind === "user" ? actor.userId ?? null : null,
        action: "authors.create",
        objectType: "author",
        objectId: inserted.id,
        details: { name: body.name, slug: body.slug },
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      });
      return inserted;
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw authorConflict(err, body.slug);
    throw err;
  }
}

export async function listAuthors(db: Db, siteId: string) {
  const rows = await db.select().from(authors).where(eq(authors.siteId, siteId)).orderBy(asc(authors.name));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    name: r.name,
    slug: r.slug,
    bio: r.bio ?? null,
    email: r.email ?? null,
    userId: r.userId ?? null,
    avatarMediaId: r.avatarMediaId ?? null,
    ...iso(r),
  }));
}

export async function createSource(db: Db, siteId: string, actor: ActorRef, body: CreateSourceBody) {
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(sources).values({ siteId, name: body.name, url: body.url ?? null, kind: body.kind }).returning();
    if (!inserted) throw new Error("createSource failed");
    await writeAudit(tx, {
      siteId,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.userId ?? null : null,
      action: "sources.create",
      objectType: "source",
      objectId: inserted.id,
      details: { name: body.name },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return inserted;
  });
  return { id: row.id, siteId: row.siteId, name: row.name, url: row.url ?? null, kind: row.kind, ...iso(row) };
}

export async function listSources(db: Db, siteId: string) {
  const rows = await db.select().from(sources).where(eq(sources.siteId, siteId)).orderBy(asc(sources.name));
  return rows.map((r) => ({ id: r.id, siteId: r.siteId, name: r.name, url: r.url ?? null, kind: r.kind, ...iso(r) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeUpdateAudit(tx: any, siteId: string, actor: ActorRef, action: string, objectType: string, objectId: string, changed: string[]) {
  await writeAudit(tx, {
    siteId,
    actorType: actor.kind,
    actorId: actor.kind === "user" ? actor.userId ?? null : null,
    action,
    objectType,
    objectId,
    details: { changedFields: changed },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}

export async function updateCategory(db: Db, siteId: string, categoryId: string, actor: ActorRef, body: UpdateCategoryBody) {
  const existing = await db.query.categories.findFirst({ where: and(eq(categories.id, categoryId), eq(categories.siteId, siteId)) });
  if (!existing) throw notFound("category not found");
  if (body.parentId) {
    const parent = await db.query.categories.findFirst({ where: and(eq(categories.id, body.parentId), eq(categories.siteId, siteId)) });
    if (!parent) throw notFound("parent category not found");
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({
        name: body.name ?? existing.name,
        slug: body.slug ?? existing.slug,
        parentId: body.parentId !== undefined ? body.parentId : existing.parentId,
        description: body.description !== undefined ? body.description : existing.description,
        updatedAt: new Date(),
      })
      .where(and(eq(categories.id, categoryId), eq(categories.siteId, siteId)))
      .returning();
    if (!row) throw notFound("category not found");
    await writeUpdateAudit(tx, siteId, actor, "categories.update", "category", categoryId, Object.keys(body));
    return row;
  });
  return {
    id: updated.id,
    siteId: updated.siteId,
    parentId: updated.parentId,
    name: updated.name,
    slug: updated.slug,
    description: updated.description ?? null,
    ...iso(updated),
  };
}

/**
 * An article's `seo.primaryCategoryId` is validated on every update, including one that
 * does not mention SEO at all - `seo` falls back to the stored value. Deleting a category
 * some article points at therefore made every later PATCH to that article return 400,
 * with the CMS re-sending the dead id because its Select renders blank while the state
 * still holds it. The article could not be edited back into a valid state.
 */
async function assertNotPrimaryCategory(db: Db, siteId: string, categoryId: string) {
  const used = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.siteId, siteId), sql`${articles.seo} ->> 'primaryCategoryId' = ${categoryId}`))
    .limit(1);
  if (used.length > 0) {
    throw conflict("category is the primary category of at least one article", { field: "primaryCategoryId" });
  }
}

export async function deleteCategory(db: Db, siteId: string, categoryId: string, actor: ActorRef) {
  const existing = await db.query.categories.findFirst({ where: and(eq(categories.id, categoryId), eq(categories.siteId, siteId)) });
  if (!existing) throw notFound("category not found");
  await assertNotPrimaryCategory(db, siteId, categoryId);
  await db.transaction(async (tx) => {
    await tx.update(categories).set({ parentId: null }).where(and(eq(categories.siteId, siteId), eq(categories.parentId, categoryId)));
    await tx.delete(categories).where(and(eq(categories.id, categoryId), eq(categories.siteId, siteId)));
    await writeUpdateAudit(tx, siteId, actor, "categories.delete", "category", categoryId, []);
  });
  return { id: categoryId, deleted: true };
}

export async function updateTag(db: Db, siteId: string, tagId: string, actor: ActorRef, body: UpdateTagBody) {
  const existing = await db.query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.siteId, siteId)) });
  if (!existing) throw notFound("tag not found");
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tags)
      .set({ name: body.name ?? existing.name, slug: body.slug ?? existing.slug, updatedAt: new Date() })
      .where(and(eq(tags.id, tagId), eq(tags.siteId, siteId)))
      .returning();
    if (!row) throw notFound("tag not found");
    await writeUpdateAudit(tx, siteId, actor, "tags.update", "tag", tagId, Object.keys(body));
    return row;
  });
  return { id: updated.id, siteId: updated.siteId, name: updated.name, slug: updated.slug, ...iso(updated) };
}

export async function deleteTag(db: Db, siteId: string, tagId: string, actor: ActorRef) {
  const existing = await db.query.tags.findFirst({ where: and(eq(tags.id, tagId), eq(tags.siteId, siteId)) });
  if (!existing) throw notFound("tag not found");
  await db.transaction(async (tx) => {
    await tx.delete(tags).where(and(eq(tags.id, tagId), eq(tags.siteId, siteId)));
    await writeUpdateAudit(tx, siteId, actor, "tags.delete", "tag", tagId, []);
  });
  return { id: tagId, deleted: true };
}

export async function updateEntity(db: Db, siteId: string, entityId: string, actor: ActorRef, body: UpdateEntityBody) {
  const existing = await db.query.entities.findFirst({ where: and(eq(entities.id, entityId), eq(entities.siteId, siteId)) });
  if (!existing) throw notFound("entity not found");
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(entities)
      .set({
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        description: body.description !== undefined ? body.description : existing.description,
        externalRefs: body.externalRefs ?? existing.externalRefs,
        updatedAt: new Date(),
      })
      .where(and(eq(entities.id, entityId), eq(entities.siteId, siteId)))
      .returning();
    if (!row) throw notFound("entity not found");
    await writeUpdateAudit(tx, siteId, actor, "entities.update", "entity", entityId, Object.keys(body));
    return row;
  });
  return {
    id: updated.id,
    siteId: updated.siteId,
    name: updated.name,
    type: updated.type,
    description: updated.description ?? null,
    externalRefs: updated.externalRefs,
    ...iso(updated),
  };
}

export async function deleteEntity(db: Db, siteId: string, entityId: string, actor: ActorRef) {
  const existing = await db.query.entities.findFirst({ where: and(eq(entities.id, entityId), eq(entities.siteId, siteId)) });
  if (!existing) throw notFound("entity not found");
  await db.transaction(async (tx) => {
    await tx.delete(entities).where(and(eq(entities.id, entityId), eq(entities.siteId, siteId)));
    await writeUpdateAudit(tx, siteId, actor, "entities.delete", "entity", entityId, []);
  });
  return { id: entityId, deleted: true };
}

export async function updateAuthor(db: Db, siteId: string, authorId: string, actor: ActorRef, body: UpdateAuthorBody) {
  const existing = await db.query.authors.findFirst({ where: and(eq(authors.id, authorId), eq(authors.siteId, siteId)) });
  if (!existing) throw notFound("author not found");
  if (body.userId) await assertUserIsSiteMember(db, siteId, body.userId);

  const next = {
    name: body.name ?? existing.name,
    slug: body.slug ?? existing.slug,
    bio: body.bio !== undefined ? body.bio : existing.bio,
    email: body.email !== undefined ? body.email : existing.email,
    userId: body.userId !== undefined ? body.userId : existing.userId,
    updatedAt: new Date(),
  };

  let updated: typeof authors.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(authors)
        .set(next)
        .where(and(eq(authors.id, authorId), eq(authors.siteId, siteId)))
        .returning();
      if (!row) throw notFound("author not found");
      await writeUpdateAudit(tx, siteId, actor, "authors.update", "author", authorId, Object.keys(body));
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw authorConflict(err, body.slug);
    throw err;
  }

  return {
    id: updated.id,
    siteId: updated.siteId,
    name: updated.name,
    slug: updated.slug,
    bio: updated.bio ?? null,
    email: updated.email ?? null,
    userId: updated.userId ?? null,
    avatarMediaId: updated.avatarMediaId ?? null,
    ...iso(updated),
  };
}

export async function deleteAuthor(db: Db, siteId: string, authorId: string, actor: ActorRef) {
  const existing = await db.query.authors.findFirst({ where: and(eq(authors.id, authorId), eq(authors.siteId, siteId)) });
  if (!existing) throw notFound("author not found");
  await db.transaction(async (tx) => {
    await tx.delete(authors).where(and(eq(authors.id, authorId), eq(authors.siteId, siteId)));
    await writeUpdateAudit(tx, siteId, actor, "authors.delete", "author", authorId, []);
  });
  return { id: authorId, deleted: true };
}

export async function updateSource(db: Db, siteId: string, sourceId: string, actor: ActorRef, body: UpdateSourceBody) {
  const existing = await db.query.sources.findFirst({ where: and(eq(sources.id, sourceId), eq(sources.siteId, siteId)) });
  if (!existing) throw notFound("source not found");
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(sources)
      .set({
        name: body.name ?? existing.name,
        url: body.url !== undefined ? body.url : existing.url,
        kind: body.kind ?? existing.kind,
        updatedAt: new Date(),
      })
      .where(and(eq(sources.id, sourceId), eq(sources.siteId, siteId)))
      .returning();
    if (!row) throw notFound("source not found");
    await writeUpdateAudit(tx, siteId, actor, "sources.update", "source", sourceId, Object.keys(body));
    return row;
  });
  return { id: updated.id, siteId: updated.siteId, name: updated.name, url: updated.url ?? null, kind: updated.kind, ...iso(updated) };
}

export async function deleteSource(db: Db, siteId: string, sourceId: string, actor: ActorRef) {
  const existing = await db.query.sources.findFirst({ where: and(eq(sources.id, sourceId), eq(sources.siteId, siteId)) });
  if (!existing) throw notFound("source not found");
  await db.transaction(async (tx) => {
    await tx.delete(sources).where(and(eq(sources.id, sourceId), eq(sources.siteId, siteId)));
    await writeUpdateAudit(tx, siteId, actor, "sources.delete", "source", sourceId, []);
  });
  return { id: sourceId, deleted: true };
}


