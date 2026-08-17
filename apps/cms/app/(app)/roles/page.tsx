"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, PageHead, Table, type Column } from "@kal-el/design-system";
import { ApiError, createRole, listRoles, type Role } from "../../../lib/api";

const KNOWN_PERMISSIONS = [
  "articles.create", "articles.read", "articles.update", "articles.publish", "articles.schedule", "articles.submit", "articles.approve", "articles.delete",
  "taxonomy.categories.manage", "taxonomy.tags.manage", "taxonomy.entities.manage", "taxonomy.authors.manage", "taxonomy.sources.manage",
  "media.manage", "media.read", "seo.manage", "audit.read",
  "sites.create", "sites.read", "users.create", "users.read", "roles.manage", "tokens.manage", "system.manage",
];

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRoles(await listRoles());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      await createRole({ key, name, permissions: [...selected] });
      setKey(""); setName(""); setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar papel");
    } finally {
      setCreating(false);
    }
  }

  const columns: Column<Role>[] = [
    { key: "name", header: "Nome", render: (r) => r.name },
    { key: "key", header: "Chave", render: (r) => <span className="peg-table__muted">{r.key}</span> },
  ];

  return (
    <>
      <PageHead title="Papéis & Permissões" description="Papéis globais (presets + custom)." />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Chave (ex: editor-chefe)" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div>
            <span className="peg-field__label">Permissões</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {KNOWN_PERMISSIONS.map((p) => (
                <button key={p} type="button" className={`peg-badge ${selected.has(p) ? "peg-badge--accent" : "peg-badge--neutral"}`} onClick={() => toggle(p)} style={{ cursor: "pointer", border: 0 }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || !key || selected.size === 0}>
            {creating ? "Criando…" : "Criar papel"}
          </Button>
        </div>
      </div>

      <Table columns={columns} rows={roles} selectable={false} />
    </>
  );
}
