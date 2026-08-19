"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button } from "@kal-el/design-system";

import { ApiError, opsStatus, type OpsStatus } from "../lib/api";

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

function Metric({ label, value, tone, hint }: { label: string; value: string | number; tone?: "neutral" | "warning" | "danger" | "success"; hint?: string }) {
  return (
    <div className="peg-card" style={{ minWidth: 160, flex: "1 1 160px" }}>
      <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--peg-text-secondary)" }}>{label}</span>
        <strong style={{ fontSize: 24 }}>{value}</strong>
        {tone && tone !== "neutral" && <Badge tone={tone}>{tone === "success" ? "ok" : "atenção"}</Badge>}
        {hint && <span style={{ fontSize: 12, color: "var(--peg-text-secondary)" }}>{hint}</span>}
      </div>
    </div>
  );
}

/**
 * Operational state of this site, for the person who has to keep it running.
 *
 * Every figure comes from a row the product actually acts on - the outbox, the scheduled
 * queue, webhook deliveries, the worker's own heartbeat. Nothing here is a score or an
 * index: a number an operator cannot trace back to a table is a number they cannot act
 * on, and this panel exists to be acted on.
 */
export function OperationalStatus({ siteId }: { siteId: string | null }) {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      setStatus(await opsStatus(siteId));
      setError(null);
    } catch (err) {
      // `audit.read` gates this; an editorial role seeing the dashboard should get a
      // clear "not for you" rather than a broken panel.
      setError(err instanceof ApiError && err.status === 403 ? null : err instanceof ApiError ? err.message : "Falha ao ler o estado operacional");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !status) return null;
  if (!status) return error ? <Alert tone="danger">{error}</Alert> : null;

  const workerTone = status.worker.status === "up" ? "success" : status.worker.status === "stale" ? "danger" : "warning";
  const workerLabel = status.worker.status === "up" ? "ativo" : status.worker.status === "stale" ? "sem sinal" : "nunca visto";

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Estado operacional</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--peg-text-secondary)" }}>Verificado {when(status.checkedAt)}</span>
          <Button size="xs" variant="secondary" onClick={() => void load()} disabled={loading}>
            Atualizar
          </Button>
        </div>
      </div>

      {status.worker.status !== "up" && (
        <Alert tone="danger">
          O worker não está reportando atividade{status.worker.lastSeenAt ? ` desde ${when(status.worker.lastSeenAt)}` : ""}. Publicações
          agendadas e entregas de webhook ficam paradas enquanto isso.
        </Alert>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Metric label="Worker" value={workerLabel} tone={workerTone} hint={status.worker.lastSeenAt ? `visto ${when(status.worker.lastSeenAt)}` : undefined} />
        <Metric
          label="Outbox pendente"
          value={status.outbox.pending}
          tone={status.outbox.due > 0 && status.worker.status !== "up" ? "danger" : "neutral"}
          hint={status.outbox.oldestPendingAt ? `mais antigo: ${when(status.outbox.oldestPendingAt)}` : undefined}
        />
        <Metric label="Outbox com falha" value={status.outbox.failed} tone={status.outbox.failed > 0 ? "danger" : "neutral"} />
        <Metric
          label="Agendados"
          value={status.scheduled.total}
          hint={status.scheduled.nextAt ? `próximo: ${when(status.scheduled.nextAt)}` : undefined}
        />
        <Metric
          label="Agendados vencidos"
          value={status.scheduled.overdue}
          tone={status.scheduled.overdue > 0 ? "warning" : "neutral"}
          hint="passaram da hora e ainda não publicaram"
        />
        <Metric label="Webhooks ativos" value={`${status.webhooks.enabled}/${status.webhooks.total}`} />
        <Metric label="Webhooks em dead-letter" value={status.webhooks.failing} tone={status.webhooks.failing > 0 ? "danger" : "neutral"} />
        <Metric label="Artigos bloqueados" value={status.articles.blocked} tone={status.articles.blocked > 0 ? "warning" : "neutral"} />
      </div>
    </section>
  );
}
