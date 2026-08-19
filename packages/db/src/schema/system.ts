import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { sites } from "./sites";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
    /**
     * `worker` separated from `system`: both are unattended, but `system` is provisioning
     * (bootstrap, seeding) and `worker` is the background process acting on editorial
     * state. An operator reading the log needs to tell "the platform did this at install
     * time" from "the scheduler did this at 03:00".
     */
    actorType: text("actor_type", { enum: ["user", "service", "system", "worker"] }).notNull(),
    /**
     * `users.id` for a session actor, `service_tokens.id` for a token actor, null for
     * system/worker. Deliberately not a foreign key: an audit row must outlive the
     * credential it records, and pointing at two different tables rules one out anyway.
     */
    actorId: uuid("actor_id"),
    /**
     * Human-readable name of the actor as it was at the time of the action.
     *
     * Every service-token action was written with `actor_id = NULL`, so a site with three
     * integrations could not say which credential did what. Resolving the id at read time
     * is not enough either: a revoked and deleted token would leave the row unreadable,
     * and the CMS would have to join two tables to render one column. The label is copied
     * in - "Pipeline MN26", "Importer X" - and never carries the secret or its hash.
     */
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_site_created_idx").on(t.siteId, t.createdAt),
    index("audit_log_object_idx").on(t.objectType, t.objectId),
    // "what has this integration been doing" is the question F9 exists to answer
    index("audit_log_actor_idx").on(t.actorType, t.actorId, t.createdAt),
  ],
);

/**
 * Liveness of each background process, for the operational status surface.
 *
 * One row per worker role, rewritten on every tick. Without it the CMS could report the
 * outbox backlog but not whether anything was draining it - a stopped worker and an empty
 * queue look identical from the API side.
 */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: text("id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, unknown>>(),
});

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text("idempotency_key"),
    status: text("status", { enum: ["pending", "published", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_status_available_idx").on(t.status, t.availableAt),
    uniqueIndex("outbox_idempotency_key_unique").on(t.idempotencyKey),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    actorKey: text("actor_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("idempotency_keys_scope_key_unique").on(t.key, t.actorKey)],
);

export const redirects = pgTable(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    sourcePath: text("source_path").notNull(),
    targetPath: text("target_path").notNull(),
    kind: text("kind", { enum: ["301", "302"] }).notNull().default("301"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("redirects_site_source_unique").on(t.siteId, t.sourcePath)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    secret: text("secret").notNull(),
    /** Optional operator-facing name, so the admin list is not a column of URLs. */
    description: text("description"),
    /**
     * Pausing a subscriber had to be done by deleting it, which loses the signing secret
     * and every subscriber has to be reconfigured on the other end to restore it.
     */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_site_idx").on(t.siteId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    outboxEventId: uuid("outbox_event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "success", "failed"] }).notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    responseStatus: integer("response_status"),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_deliveries_pending_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("webhook_deliveries_hook_event_unique").on(t.webhookId, t.outboxEventId),
  ],
);
