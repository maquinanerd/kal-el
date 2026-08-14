import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { authors, categories, entities, sources, tags } from "@kal-el/db/schema";
import type { CreateAuthorBody, CreateCategoryBody, CreateEntityBody, CreateSourceBody, CreateTagBody } from "@kal-el/contracts";

import { conflict, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import type { ActorRef } from "./articles.js";

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
    if ((err as { code?: string }).code === "23505") {
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
    if ((err as { code?: string }).code === "23505") {
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
      const [inserted] = await tx.insert(authors).values({ siteId, name: body.name, slug: body.slug, bio: body.bio ?? null, email: body.email ?? null }).returning();
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
    if ((err as { code?: string }).code === "23505") {
      throw conflict(`author slug "${body.slug}" already exists`, { field: "slug" });
    }
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


