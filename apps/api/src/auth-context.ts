export const PERMISSIONS = {
  systemManage: "system.manage",
  siteCreate: "sites.create",
  siteRead: "sites.read",
  userCreate: "users.create",
  userRead: "users.read",
  roleManage: "roles.manage",
  tokenManage: "tokens.manage",
  articleCreate: "articles.create",
  articleRead: "articles.read",
  articleUpdate: "articles.update",
  articlePublish: "articles.publish",
  articleSchedule: "articles.schedule",
  articleDelete: "articles.delete",
  categoryManage: "taxonomy.categories.manage",
  tagManage: "taxonomy.tags.manage",
  entityManage: "taxonomy.entities.manage",
  authorManage: "taxonomy.authors.manage",
  sourceManage: "taxonomy.sources.manage",
  mediaManage: "media.manage",
  mediaRead: "media.read",
  seoManage: "seo.manage",
  auditRead: "audit.read",
} as const;

export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

export type ActorContext =
  | {
      kind: "user";
      userId: string;
      name: string;
      siteId: string;
      permissions: Set<string>;
      actorKey: string;
      ip: string;
      requestId: string;
    }
  | {
      kind: "service";
      tokenId: string;
      name: string;
      siteId: string;
      scopes: Set<string>;
      actorKey: string;
      ip: string;
      requestId: string;
    };

export type Credentials =
  | { kind: "session"; token: string }
  | { kind: "service"; token: string }
  | null;

export type SiteScopeResolution =
  | { ok: true; actor: ActorContext }
  | { ok: false; status: 401 | 403 | 404; code: string; message: string };

import { ApiHttpError } from "./plugins/errors.js";

export function permissionDenied(req: { actor?: ActorContext }, permission: string): void {
  if (!req.actor) {
    throw new ApiHttpError(403, "FORBIDDEN", "actor missing");
  }
  const ok = req.actor.kind === "user" ? req.actor.permissions.has(permission) : req.actor.scopes.has(permission);
  if (!ok) {
    throw new ApiHttpError(403, "FORBIDDEN", `missing permission: ${permission}`);
  }
}
