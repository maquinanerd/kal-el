"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, PageHead, Select, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createSite, listSites, updateSite, type SiteInfo } from "../../../lib/api";

export default function SitesPage() {
  const { activeSiteId, setActiveSite } = useAuth();
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("active");

  const load = useCallback(async () => {
    try {
      setSites(await listSites());
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para gerenciar sites" : err.message) : "Falha ao carregar");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      await createSite({ slug, name });
      setSlug(""); setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar site");
    } finally {
      setCreating(false);
    }
  }

  async function onSave(id: string) {
    setError(null);
    try {
      await updateSite(id, { name: editName, status: editStatus });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    }
  }

  const columns: Column<SiteInfo>[] = [
    { key: "name", header: "Nome", render: (s) => (editingId === s.id ? <Input value={editName} onChange={(e) => setEditName(e.target.value)} /> : s.name) },
    { key: "slug", header: "Slug", render: (s) => <span className="peg-table__muted">{s.slug}</span> },
    { key: "status", header: "Status", render: (s) => (editingId === s.id ? <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}><option value="active">ativo</option><option value="inactive">inativo</option></Select> : <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status}</Badge>) },
    {
      key: "actions",
      header: "",
      render: (s) =>
        editingId === s.id ? (
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="xs" variant="primary" onClick={() => void onSave(s.id)}>Salvar</Button>
            <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancelar</Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="xs" variant="secondary" onClick={() => { setEditingId(s.id); setEditName(s.name); setEditStatus(s.status); }}>Editar</Button>
            <Button size="xs" variant="secondary" onClick={() => setActiveSite(s.id)} disabled={s.id === activeSiteId}>Usar</Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHead title="Sites" description="Gerenciar portais da instalação." />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || !slug}>{creating ? "Criando…" : "Criar site"}</Button>
        </div>
      </div>

      <Table columns={columns} rows={sites} selectable={false} />
    </>
  );
}
