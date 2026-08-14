import type { Db } from "@kal-el/db";
import { permissions } from "@kal-el/db/schema";
import { ALL_PERMISSIONS } from "../auth-context.js";

export async function seedPermissions(db: Db): Promise<void> {
  const existing = await db.select({ key: permissions.key }).from(permissions);
  const existingKeys = new Set(existing.map((r) => r.key));
  const missing = ALL_PERMISSIONS.filter((key) => !existingKeys.has(key));
  if (missing.length > 0) {
    await db.insert(permissions).values(missing.map((key) => ({ key }))).onConflictDoNothing();
  }
}
