"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import {
  ApiError,
  WEBHOOK_EVENTS,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
  type Webhook,
} from "../../../lib/api";

function relative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  return `há ${Math.floor(seconds / 86400)} d`;
}

/**
 * Health of the last delivery, not of the subscription.
 *
 * A hook with no deliveries yet is neither healthy nor broken - saying "ok" there would
 * be the one claim this panel cannot support, and it is exactly the case an operator
 * checks right after registering one.
 */
function DeliveryBadge({ hook }: { hook: Webhook }) {
  if (!hook.lastDelivery) return <Badge tone="neutral">sem entregas</Badge>;
  const d = hook.lastDelivery;
  if (d.status === "success") return <Badge tone="success">ok · {relative(d.at)}</Badge>;
  if (d.status === "failed") return <Badge tone="danger">dead-letter · tentativa {d.attempt}</Badge>;
  return <Badge tone="warning">a repetir · tentativa {d.attempt}</Badge>;
}

export default function WebhooksPage() {
  const { activeSiteId } = useAuth();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<Set<string>>(new Set(["article.published"]));
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeSiteId) return;
    setLoading(true);
    try {
      setHooks(await listWebhooks(activeSiteId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar webhooks");
    } finally {
      setLoading(false);
    }
  }, [activeSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleEvent(name: string) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function onCreate() {
    if (!activeSiteId) return;
    setCreating(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const created = await createWebhook(activeSiteId, { url, events: [...events], description: description || undefined });
      // Shown once, exactly like a service token. There is no endpoint that returns it
      // again, and rotating it would silently break the subscriber's verification.
      setCreatedSecret(created.secret);
      setUrl("");
      setDescription("");
      setEvents(new Set(["article.published"]));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao registrar webhook");
    } finally {
      setCreating(false);
    }
  }

  async function onToggleEnabled(hook: Webhook) {
    if (!activeSiteId) return;
    try {
      await updateWebhook(activeSiteId, hook.id, { enabled: !hook.enabled });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao alterar o webhook");
    }
  }

  async function onDelete(hook: Webhook) {
    if (!activeSiteId) return;
    // Deleting destroys the signing secret, so the subscriber has to be reconfigured on
    // the other end. Pausing is the reversible action and is one click away.
    if (!window.confirm(`Remover o webhook para ${hook.url}? O segredo de assinatura é perdido e não pode ser recuperado.`)) return;
    try {
      await deleteWebhook(activeSiteId, hook.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao remover o webhook");
    }
  }

  const columns: Column<Webhook>[] = [
    {
      key: "target",
      header: "Destino",
      render: (h) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {h.description && <strong>{h.description}</strong>}
          <code style={{ wordBreak: "break-all", fontSize: 12 }}>{h.url}</code>
        </div>
      ),
    },
    {
      key: "events",
      header: "Eventos",
      render: (h) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {h.events.map((e) => (
            <Badge key={e} tone="neutral">
              {e}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: "state", header: "Estado", render: (h) => (h.enabled ? <Badge tone="success">ativo</Badge> : <Badge tone="warning">pausado</Badge>) },
    { key: "delivery", header: "Última entrega", render: (h) => <DeliveryBadge hook={h} /> },
    {
      key: "error",
      header: "Último erro",
      render: (h) =>
        h.lastDelivery?.error ? (
          <span style={{ fontSize: 12, color: "var(--peg-text-secondary)", wordBreak: "break-word" }}>{h.lastDelivery.error}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      render: (h) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="xs" variant="secondary" onClick={() => void onToggleEnabled(h)}>
            {h.enabled ? "Pausar" : "Reativar"}
          </Button>
          <Button size="xs" variant="destructive" onClick={() => void onDelete(h)}>
            Remover
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="Webhooks"
        description="Assinantes que recebem eventos editoriais deste site. O segredo de assinatura é mostrado apenas uma vez."
      />
      {error && <Alert tone="danger">{error}</Alert>}

      {createdSecret && (
        <Alert tone="success">
          Webhook registrado. Guarde o segredo de assinatura agora — ele não é exibido novamente:{" "}
          <code style={{ wordBreak: "break-all" }}>{createdSecret}</code>
        </Alert>
      )}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="URL de destino" placeholder="https://frontend.example.com/api/revalidate" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Input label="Descrição" optional hint="Como este assinante aparece na lista." value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <span className="peg-field__label">Eventos</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {WEBHOOK_EVENTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={events.has(e)}
                  className={`peg-badge ${events.has(e) ? "peg-badge--accent" : "peg-badge--neutral"}`}
                  onClick={() => toggleEvent(e)}
                  style={{ cursor: "pointer", border: 0 }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !url || events.size === 0 || !activeSiteId}>
            {creating ? "Registrando…" : "Registrar webhook"}
          </Button>
        </div>
      </div>

      {loading ? <p>Carregando…</p> : <Table columns={columns} rows={hooks} selectable={false} />}
      {!loading && hooks.length === 0 && <p style={{ color: "var(--peg-text-secondary)" }}>Nenhum webhook registrado neste site.</p>}
    </>
  );
}
