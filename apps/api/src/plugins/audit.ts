import { auditLog } from "@kal-el/db/schema";

export type AuditActorType = "user" | "service" | "system" | "worker";

export type AuditEntry = {
  siteId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  /** Display name of the actor at the time of the action. Never a secret. */
  actorLabel?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
};

/**
 * The subset of an authenticated actor the audit log records.
 *
 * Structurally compatible with both `ActorContext` (what the auth plugin resolves) and
 * `ActorRef` (what the services take), so neither has to be imported here.
 */
export type AuditableActor = {
  kind: "user" | "service";
  userId?: string | null;
  tokenId?: string | null;
  name?: string | null;
};

/**
 * Identity fields for one audit row.
 *
 * Every service-token action used to be written with `actor_id = NULL`, because the only
 * helper available returned the user id and a token has none. A site running three
 * integrations therefore could not say which credential published, imported or deleted
 * anything. A token has a stable id and an operator-chosen name; both are safe to record,
 * and neither is the secret or its hash.
 */
export function auditActorFields(actor: AuditableActor): Pick<AuditEntry, "actorType" | "actorId" | "actorLabel"> {
  if (actor.kind === "service") {
    return { actorType: "service", actorId: actor.tokenId ?? null, actorLabel: actor.name ?? null };
  }
  return { actorType: "user", actorId: actor.userId ?? null, actorLabel: actor.name ?? null };
}

export function auditRow(entry: AuditEntry): typeof auditLog.$inferInsert {
  return {
    siteId: entry.siteId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId ?? null,
    details: entry.details ?? {},
    ip: entry.ip ?? null,
    requestId: entry.requestId ?? null,
  };
}

// `tx` is either a Db or a drizzle PgTransaction; both expose insert().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeAudit(tx: any, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values(auditRow(entry));
}
