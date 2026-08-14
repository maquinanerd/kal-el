import { and, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { permissions, rolePermissions, userRoles } from "@kal-el/db/schema";

/**
 * Effective permission keys for `userId` acting on `siteId`.
 * A user's permissions are the union of permissions of every role
 * assigned to the user at that site. Roles may be global (siteId null)
 * or site-scoped; assignments are always per-site.
 */
export async function getEffectivePermissions(
  db: Db,
  userId: string,
  siteId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.siteId, siteId)));

  return new Set(rows.map((r) => r.key));
}

export function hasPermission(userPermissions: Set<string>, required: string): boolean {
  return userPermissions.has(required);
}

export function assertPermission(userPermissions: Set<string>, required: string): void {
  if (!hasPermission(userPermissions, required)) {
    const err = new Error(`missing permission: ${required}`) as Error & { code?: string };
    err.code = "FORBIDDEN";
    throw err;
  }
}

/**
 * Service tokens carry scopes (strings). A required permission is satisfied
 * when the scope set contains it.
 */
export function hasScope(tokenScopes: Set<string>, required: string): boolean {
  return tokenScopes.has(required);
}
