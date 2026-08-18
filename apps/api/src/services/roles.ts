import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { permissions, rolePermissions, roles, userRoles, users } from "@kal-el/db/schema";
import type { CreateRoleBody } from "@kal-el/contracts";

import { badRequest, conflict, isForeignKeyViolation, isUniqueViolation, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { PERMISSIONS } from "../auth-context.js";

export const OWNER_ROLE_KEY = "owner";

export async function listRoles(db: Db) {
  const rows = await db.select().from(roles).orderBy(desc(roles.createdAt));
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    key: r.key,
    name: r.name,
    description: r.description ?? undefined,
  }));
}

export async function createRole(
  db: Db,
  body: CreateRoleBody,
  actor?: { kind: "user" | "service" | "system"; actorKey: string; ip?: string; requestId?: string },
) {
  const permRows = await db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, body.permissions));
  const found = new Set(permRows.map((r) => r.key));
  const missing = body.permissions.filter((k) => !found.has(k));
  if (missing.length > 0) {
    throw badRequest(`unknown permissions: ${missing.join(", ")}`);
  }

  let roleId: string;
  try {
    roleId = await db.transaction(async (tx) => {
      const [role] = await tx.insert(roles).values({ key: body.key, name: body.name, description: body.description }).returning();
      if (!role) throw new Error("createRole returned no row");
      await tx.insert(rolePermissions).values(permRows.map((p) => ({ roleId: role.id, permissionId: p.id })));
      return role.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`role key "${body.key}" already exists`, { field: "key" });
    }
    throw err;
  }

  if (actor) {
    await writeAudit(db, {
      actorType: actor.kind,
      actorId: actor.kind === "user" ? actor.actorKey.replace("user:", "") : null,
      action: "roles.create",
      objectType: "role",
      objectId: roleId,
      details: { key: body.key, permissions: body.permissions },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  }

  return listRoles(db).then((all) => all.find((r) => r.id === roleId) ?? ({} as (typeof all)[number]));
}

/**
 * Give a user the preset Owner role on a site. Used when a site is created, so the
 * creator can administer it (site-scoped admin routes require membership).
 */
export async function grantOwnerOnSite(db: Db, userId: string, siteId: string): Promise<void> {
  const role = await db.query.roles.findFirst({ where: eq(roles.key, OWNER_ROLE_KEY) });
  if (!role) throw notFound("owner role not found");
  await db.insert(userRoles).values({ userId, roleId: role.id, siteId }).onConflictDoNothing();
}

/** Permission keys granted by a role. Used to stop privilege escalation on assignment. */
export async function getRolePermissions(db: Db, roleId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));
  return new Set(rows.map((r) => r.key));
}

export async function assignRoleToUser(db: Db, userId: string, roleId: string, siteId: string) {
  await db.query.roles.findFirst({ where: eq(roles.id, roleId) }).then((r) => {
    if (!r) throw notFound("role not found");
  });
  await db.query.users.findFirst({ where: eq(users.id, userId) }).then((u) => {
    if (!u) throw notFound("user not found");
  });
  try {
    await db.insert(userRoles).values({ userId, roleId, siteId }).onConflictDoNothing();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw badRequest("invalid user, role or site");
    }
    throw err;
  }
}

export async function roleHasPermission(db: Db, roleKey: string, permission: string): Promise<boolean> {
  const rows = await db
    .select({ key: permissions.key })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(roles.key, roleKey), eq(permissions.key, permission)));
  return rows.length > 0;
}

export async function ensureOwnerRole(db: Db): Promise<void> {
  const owner = await db.query.roles.findFirst({ where: eq(roles.key, OWNER_ROLE_KEY) });
  if (owner) return;
  await db.transaction(async (tx) => {
    const [role] = await tx.insert(roles).values({ key: OWNER_ROLE_KEY, name: "Owner", description: "Full control within assigned sites" }).returning();
    if (!role) return;
    const all = await tx.select({ id: permissions.id }).from(permissions).where(inArray(permissions.key, Object.values(PERMISSIONS)));
    await tx.insert(rolePermissions).values(all.map((p) => ({ roleId: role.id, permissionId: p.id })));
  });
}

const TAXONOMY = [
  PERMISSIONS.categoryManage,
  PERMISSIONS.tagManage,
  PERMISSIONS.entityManage,
  PERMISSIONS.authorManage,
  PERMISSIONS.sourceManage,
];

const EDITORIAL_BASE = [PERMISSIONS.articleCreate, PERMISSIONS.articleRead, PERMISSIONS.articleUpdate];

/**
 * Preset editorial roles. These are global keys (siteId = null) assignable to
 * any site via POST /v1/admin/users/:id/roles. The permission system remains
 * flexible — custom roles can still be created per-site.
 */
export const PRESET_ROLES: Array<{ key: string; name: string; description: string; permissions: string[] }> = [
  {
    key: "owner",
    name: "Owner",
    description: "Full platform control",
    permissions: Object.values(PERMISSIONS),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Full site control (no platform/system, user or role management)",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      PERMISSIONS.articleDelete,
      ...TAXONOMY,
      PERMISSIONS.seoManage,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
      PERMISSIONS.auditRead,
      PERMISSIONS.siteRead,
    ],
  },
  {
    key: "editor-chefe",
    name: "Editor chefe",
    description: "Approves, publishes and schedules content",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      ...TAXONOMY,
      PERMISSIONS.seoManage,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
      PERMISSIONS.auditRead,
    ],
  },
  {
    key: "editor",
    name: "Editor",
    description: "Edits and reviews content",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      ...TAXONOMY,
      PERMISSIONS.mediaManage,
      PERMISSIONS.mediaRead,
    ],
  },
  {
    key: "autor",
    name: "Autor",
    description: "Writes and submits drafts (cannot publish)",
    permissions: [...EDITORIAL_BASE, PERMISSIONS.articleSubmit, PERMISSIONS.mediaRead],
  },
];

/** Create the preset roles if they do not already exist (idempotent). */
export async function ensurePresetRoles(db: Db): Promise<void> {
  for (const preset of PRESET_ROLES) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (existing) continue;
    const permRows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, preset.permissions));
    await db.transaction(async (tx) => {
      const [role] = await tx.insert(roles).values({ key: preset.key, name: preset.name, description: preset.description }).returning();
      if (!role) return;
      await tx.insert(rolePermissions).values(permRows.map((p) => ({ roleId: role.id, permissionId: p.id })));
    });
  }
}
