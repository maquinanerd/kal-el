"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, listAudit, type AuditEntry } from "../../../lib/api";

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
    { key: "actor", header: "Ator", render: (r) => `${r.actorType}:${r.actorId ?? "system"}` },
    { key: "action", header: "Ação", render: (r) => r.action },
    { key: "object", header: "Objeto", render: (r) => <span className="peg-table__muted">{r.objectType} {r.objectId.slice(0, 8)}…</span> },
  ];

  return (
    <>
      <PageHead title="Audit log" description="Trilha de ações no site." />
      {error && <p className="peg-field__error">{error}</p>}
      {rows.length === 0 ? <EmptyState title="Sem eventos" body="Nenhuma ação registrada ainda." /> : <Table columns={columns} rows={rows} selectable={false} />}
    </>
  );
}
