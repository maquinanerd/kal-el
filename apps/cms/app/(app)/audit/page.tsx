"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHead, Table, type BadgeTone, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, listAudit, type AuditEntry } from "../../../lib/api";

/** `worker` is separated from `system`: unattended editorial work vs. provisioning. */
const ACTOR_LABEL: Record<string, string> = {
  user: "usuário",
  service: "integração",
  system: "sistema",
  worker: "worker",
};
const ACTOR_TONE: Record<string, BadgeTone> = {
  user: "info",
  service: "accent",
  system: "neutral",
  worker: "warning",
};

export default function AuditPage() {
  const { activeSiteId } = useAuth();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeSiteId) return;
    try {
      setRows(await listAudit(activeSiteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    }
  }, [activeSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<AuditEntry>[] = [
    { key: "createdAt", header: "Quando", render: (r) => <span className="peg-table__muted">{new Date(r.createdAt).toLocaleString("pt-BR")}</span> },
    {
      key: "actor",
      header: "Ator",
      // `service:<uuid>` was unreadable and, before actorLabel existed, service-token
      // actions had no id at all - a site with three integrations could not tell which
      // one had acted. The label is the operator-chosen name of the credential.
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>
            <Badge tone={ACTOR_TONE[r.actorType] ?? "neutral"}>{ACTOR_LABEL[r.actorType] ?? r.actorType}</Badge>{" "}
            {r.actorLabel ?? (r.actorId ? `${r.actorId.slice(0, 8)}…` : "—")}
          </span>
          {r.actorLabel && r.actorId && <span className="peg-table__muted" style={{ fontSize: 11 }}>{r.actorId.slice(0, 8)}…</span>}
        </div>
      ),
    },
    { key: "action", header: "Ação", render: (r) => r.action },
    { key: "object", header: "Objeto", render: (r) => <span className="peg-table__muted">{r.objectType} {r.objectId ? `${r.objectId.slice(0, 8)}…` : ""}</span> },
  ];

  return (
    <>
      <PageHead title="Audit log" description="Trilha de ações no site." />
      {error && <p className="peg-field__error">{error}</p>}
      {rows.length === 0 ? <EmptyState title="Sem eventos" body="Nenhuma ação registrada ainda." /> : <Table columns={columns} rows={rows} selectable={false} />}
    </>
  );
}
