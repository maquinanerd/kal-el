"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createServiceToken, listServiceTokens, revokeServiceToken, type ServiceToken } from "../../../lib/api";

const SCOPES = ["articles.create", "articles.read", "articles.update", "articles.publish", "articles.schedule", "articles.submit", "articles.approve", "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.entities.manage", "taxonomy.authors.manage", "taxonomy.sources.manage", "media.manage", "media.read", "seo.manage"];

export default function TokensPage() {
  const { activeSiteId } = useAuth();
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeSiteId) return;
    try {
      setTokens(await listServiceTokens(activeSiteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    }
  }, [activeSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(s: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function onCreate() {
    if (!activeSiteId) return;
    setCreating(true);
    setError(null);
    setCreatedToken(null);
    try {
      const t = await createServiceToken(activeSiteId, { name, scopes: [...selected] });
      setCreatedToken(t.token);
      setName(""); setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar token");
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    if (!activeSiteId) return;
    try {
      await revokeServiceToken(activeSiteId, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao revogar");
    }
  }

  const columns: Column<ServiceToken>[] = [
    { key: "name", header: "Nome", render: (t) => t.name },
    { key: "scopes", header: "Escopos", render: (t) => <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{t.scopes.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}</div> },
    { key: "status", header: "Status", render: (t) => (t.revokedAt ? <Badge tone="danger">revogado</Badge> : <Badge tone="success">ativo</Badge>) },
    {
      key: "actions",
      header: "",
      render: (t) => (t.revokedAt ? null : <Button size="xs" variant="destructive" onClick={() => void onRevoke(t.id)}>Revogar</Button>),
    },
  ];

  return (
    <>
      <PageHead title="Service tokens" description="Credenciais de automação escopadas por site." />
      {error && <Alert tone="danger">{error}</Alert>}

      {createdToken && (
        <Alert tone="success">
          Token criado (mostrado apenas uma vez): <code style={{ wordBreak: "break-all" }}>{createdToken}</code>
        </Alert>
      )}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <span className="peg-field__label">Escopos</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {SCOPES.map((s) => (
                <button key={s} type="button" className={`peg-badge ${selected.has(s) ? "peg-badge--accent" : "peg-badge--neutral"}`} onClick={() => toggle(s)} style={{ cursor: "pointer", border: 0 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || selected.size === 0 || !activeSiteId}>
            {creating ? "Criando…" : "Criar token"}
          </Button>
        </div>
      </div>

      <Table columns={columns} rows={tokens} selectable={false} />
    </>
  );
}
