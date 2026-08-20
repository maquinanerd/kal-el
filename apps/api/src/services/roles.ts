import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { permissions, rolePermissions, roles, userRoles, users } from "@kal-el/db/schema";
import type { CreateRoleBody } from "@kal-el/contracts";

import { badRequest, conflict, isForeignKeyViolation, isUniqueViolation, notFound } from "../plugins/errors.js";
import { writeAudit } from "../plugins/audit.js";
import { PERMISSIONS } from "../auth-context.js";

/**
 * Who performed a role change, for the audit trail.
 *
 * `actorKey` used to be the only identity available here and the audit row derived the
 * user id by string-stripping its `user:` prefix - which produced `null` for a service
 * token (whose key is `service:<id>`) and would have silently produced garbage had the
 * prefix ever changed. The id and the label are carried explicitly instead.
 */
export type RoleAuditActor = {
  kind: "user" | "service" | "system";
  actorKey: string;
  /** `users.id` or `service_tokens.id`, depending on `kind`. */
  id?: string | null;
  /** Display name recorded with the action. Never a secret. */
  label?: string | null;
  ip?: string;
  requestId?: string;
};

function actorRefId(actor: RoleAuditActor): string | null {
  return actor.id ?? null;
}

export const OWNER_ROLE_KEY = "owner";

/**
 * Roles with the permission keys each one grants.
 *
 * The CMS role screen could only show a name and a key, which is precisely the part an
 * administrator already knows. "What can `editor` actually do" was answerable only from
 * the database. One grouped query rather than N+1 - the set is small and read rarely, but
 * a per-role round trip in a list is a habit worth not starting.
 */
export async function listRoles(db: Db) {
  const rows = await db.select().from(roles).orderBy(desc(roles.createdAt));
  if (rows.length === 0) return [];

  const grants = await db
    .select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      inArray(
        rolePermissions.roleId,
        rows.map((r) => r.id),
      ),
    );

  const byRole = new Map<string, string[]>();
  for (const g of grants) {
    const list = byRole.get(g.roleId);
    if (list) list.push(g.key);
    else byRole.set(g.roleId, [g.key]);
  }

  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    key: r.key,
    name: r.name,
    description: r.description ?? undefined,
    permissions: (byRole.get(r.id) ?? []).sort(),
  }));
}

/**
 * Every user's role grants, keyed by user.
 *
 * The users screen let an administrator assign a role without showing which roles the
 * person already held, so the same grant was applied twice and a mistaken one was
 * invisible. Site-scoped, because a role means nothing without the site it applies to.
 */
export async function listUserMemberships(db: Db) {
  const rows = await db
    .select({
      userId: userRoles.userId,
      siteId: userRoles.siteId,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));

  const byUser = new Map<string, { siteId: string; roleId: string; roleKey: string; roleName: string }[]>();
  for (const r of rows) {
    const entry = { siteId: r.siteId, roleId: r.roleId, roleKey: r.roleKey, roleName: r.roleName };
    const list = byUser.get(r.userId);
    if (list) list.push(entry);
    else byUser.set(r.userId, [entry]);
  }
  return byUser;
}

/** All permission keys the platform knows about, for building a custom role. */
export async function listPermissions(db: Db) {
  const rows = await db.select({ key: permissions.key, description: permissions.description }).from(permissions);
  return rows
    .map((r) => ({ key: r.key, description: r.description ?? undefined }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function createRole(
  db: Db,
  body: CreateRoleBody,
  actor?: RoleAuditActor,
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
      // inside the transaction: written against `db` and after the commit, a failing
      // audit insert returned 500 for a role that did exist, and the retry then 409ed
      if (actor) {
        await writeAudit(tx, {
          actorType: actor.kind,
          actorId: actorRefId(actor),
          actorLabel: actor.label ?? null,
          action: "roles.create",
          objectType: "role",
          objectId: role.id,
          details: { key: body.key, permissions: body.permissions },
          ip: actor.ip ?? null,
          requestId: actor.requestId ?? null,
        });
      }
      return role.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw conflict(`role key "${body.key}" already exists`, { field: "key" });
    }
    throw err;
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

/**
 * Grant a role on a site.
 *
 * This is the highest-privilege write in the product - it is how someone becomes an owner
 * - and it left no trace at all: there was no audit call here, so a mistaken or malicious
 * grant was invisible in the site audit log and recoverable only from the database.
 */
export async function assignRoleToUser(
  db: Db,
  userId: string,
  roleId: string,
  siteId: string,
  actor?: RoleAuditActor,
) {
  const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
  if (!role) throw notFound("role not found");
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) throw notFound("user not found");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(userRoles).values({ userId, roleId, siteId }).onConflictDoNothing();
      if (actor) {
        await writeAudit(tx, {
          siteId,
          actorType: actor.kind,
          actorId: actorRefId(actor),
          actorLabel: actor.label ?? null,
          action: "roles.assign",
          objectType: "user",
          objectId: userId,
          details: { roleId, roleKey: role.key, targetEmail: target.email },
          ip: actor.ip ?? null,
          requestId: actor.requestId ?? null,
        });
      }
    });
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
    description: "Controle total da plataforma",
    permissions: Object.values(PERMISSIONS),
  },
  {
    key: "admin",
    name: "Admin",
    description: "Controle total do site (sem plataforma, usuários ou papéis)",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      PERMISSIONS.articleDelete,
      PERMISSIONS.articleRecover,
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
    description: "Aprova, publica e agenda conteúdo",
    permissions: [
      ...EDITORIAL_BASE,
      PERMISSIONS.articlePublish,
      PERMISSIONS.articleSchedule,
      PERMISSIONS.articleSubmit,
      PERMISSIONS.articleApprove,
      // the editor-in-chief is the editorial role that answers for a broken article body
      PERMISSIONS.articleRecover,
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
    description: "Edita e revisa conteúdo",
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
    description: "Escreve e envia rascunhos (não publica)",
    permissions: [...EDITORIAL_BASE, PERMISSIONS.articleSubmit, PERMISSIONS.mediaRead],
  },
];

/**
 * The English descriptions these presets shipped with, so an install seeded before they
 * were translated can be migrated without touching anything an operator has since edited.
 * A blind overwrite would silently revert a renamed or re-described role.
 */
const LEGACY_PRESET_DESCRIPTIONS: Record<string, string> = {
  owner: "Full platform control",
  admin: "Full site control (no platform/system, user or role management)",
  "editor-chefe": "Approves, publishes and schedules content",
  editor: "Edits and reviews content",
  autor: "Writes and submits drafts (cannot publish)",
};

/** Create the preset roles if they do not already exist (idempotent). */
export async function ensurePresetRoles(db: Db): Promise<void> {
  for (const preset of PRESET_ROLES) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (existing) {
      // Only our own untouched default is replaced, matched exactly. Permissions are never
      // rewritten here: revoking a grant an operator added is not a copy change.
      if (existing.description === LEGACY_PRESET_DESCRIPTIONS[preset.key]) {
        await db.update(roles).set({ description: preset.description }).where(eq(roles.id, existing.id));
      }
      continue;
    }
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
