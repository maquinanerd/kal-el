import { sites } from "./sites";
import { users, roles, permissions, rolePermissions, userRoles, sessions, serviceTokens } from "./identity";
import {
  articles,
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articleTags,
  authors,
  categories,
  entities,
  sources,
  tags,
} from "./editorial";
import { media } from "./media";
import { auditLog, idempotencyKeys, outboxEvents, redirects, webhookDeliveries, webhooks, workerHeartbeats } from "./system";

export { sites };
export { users, roles, permissions, rolePermissions, userRoles, sessions, serviceTokens };
export {
  articles,
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articleTags,
  authors,
  categories,
  entities,
  sources,
  tags,
};
export { media };
export { auditLog, idempotencyKeys, outboxEvents, redirects, webhookDeliveries, webhooks, workerHeartbeats };

export const schema = {
  sites,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  sessions,
  serviceTokens,
  articles,
  articleAuthors,
  articleCategories,
  articleEntities,
  articleRevisions,
  articleTags,
  authors,
  categories,
  entities,
  sources,
  tags,
  media,
  auditLog,
  idempotencyKeys,
  outboxEvents,
  redirects,
  webhookDeliveries,
  webhooks,
  workerHeartbeats,
};
