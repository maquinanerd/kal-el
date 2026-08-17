"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, EmptyState, IconPlus, Input, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export type TaxonomyRow = { id: string; name: string; slug?: string; [k: string]: unknown };

type Props = {
  title: string;
  description?: string;
  slugField?: boolean;
  load: (siteId: string) => Promise<TaxonomyRow[]>;
  create: (siteId: string, body: Record<string, unknown>) => Promise<TaxonomyRow>;
  update: (siteId: string, id: string, body: Record<string, unknown>) => Promise<TaxonomyRow>;
  remove: (siteId: string, id: string) => Promise<unknown>;
  columns?: Column<TaxonomyRow>[];
  createExtras?: (value: Record<string, string>, set: (k: string, v: string) => void) => ReactNode;
};

export function TaxonomyManager({ title, description, slugField = true, load, create, update, remove, columns = [], createExtras }: Props) {
  const { activeSiteId } = useAuth();
  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!activeSiteId) return;
    setLoading(true);
    try {
      setRows(await load(activeSiteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [activeSiteId, load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function setFormKey(k: string, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function onCreate() {
    if (!activeSiteId || !form.name) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: form.name };
      if (slugField) body.slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      for (const [k, v] of Object.entries(form)) {
        if (k !== "name" && k !== "slug" && v) body[k] = v;
      }
      await create(activeSiteId, body);
      setForm({});
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar");
    } finally {
      setCreating(false);
    }
  }

  async function onEdit(id: string) {
    if (!activeSiteId) return;
    setError(null);
    try {
      const body: Record<string, unknown> = { name: editForm.name };
      if (slugField) body.slug = editForm.slug;
      await update(activeSiteId, id, body);
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao editar");
    }
  }

  async function onDelete(id: string) {
    if (!activeSiteId) return;
    setError(null);
    try {
      await remove(activeSiteId, id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  const tableColumns: Column<TaxonomyRow>[] = [
    {
      key: "name",
      header: "Nome",
      render: (r) =>
        editingId === r.id ? (
          <Input value={editForm.name ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
        ) : (
          r.name
        ),
    },
    ...(slugField
      ? [
          {
            key: "slug",
            header: "Slug",
            render: (r: TaxonomyRow) =>
              editingId === r.id ? (
                <Input value={editForm.slug ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, slug: e.target.value }))} />
              ) : (
                <span className="peg-table__muted">{r.slug}</span>
              ),
          } as Column<TaxonomyRow>,
        ]
      : []),
    ...columns,
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div style={{ display: "flex", gap: 6 }}>
          {editingId === r.id ? (
            <>
              <Button size="xs" variant="primary" onClick={() => void onEdit(r.id)}>Salvar</Button>
              <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancelar</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="secondary" onClick={() => { setEditingId(r.id); setEditForm({ name: r.name, slug: r.slug ?? "" }); }}>Editar</Button>
              <Button size="xs" variant="destructive" onClick={() => void onDelete(r.id)}>Excluir</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHead title={title} description={description ?? `${rows.length} item(s)`} />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Input label="Nome" value={form.name ?? ""} onChange={(e) => setFormKey("name", e.target.value)} />
          {slugField && <Input label="Slug (opcional)" value={form.slug ?? ""} onChange={(e) => setFormKey("slug", e.target.value)} />}
          {createExtras?.(form, setFormKey)}
          <Button variant="primary" icon={<IconPlus />} onClick={() => void onCreate()} disabled={creating || !activeSiteId}>
            {creating ? "Criando…" : "Criar"}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nada por aqui" body="Crie o primeiro item acima." />
      ) : (
        <Table columns={tableColumns} rows={rows} selectable={false} />
      )}
    </>
  );
}
