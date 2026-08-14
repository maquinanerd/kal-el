import { auditLog } from "@kal-el/db/schema";

export type AuditEntry = {
  siteId?: string | null;
  actorType: "user" | "service" | "system";
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
};

export function auditRow(entry: AuditEntry): typeof auditLog.$inferInsert {
  return {
    siteId: entry.siteId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
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
