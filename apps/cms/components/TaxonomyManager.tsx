"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, EmptyState, IconPlus, Input, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export type TaxonomyRow = { id: string; name: string; slug?: string; [k: string]: unknown };

/**
 * Same rules as the server (`slugify` in apps/api/src/services/articles.ts). The local
 * version skipped NFD normalization and hyphen trimming, in an all-pt-BR interface: it
 * turned "Política" into `pol-tica` and "Ação" into `a-o`. The server stores whatever
 * slug the body carries and this component always sends one, so those became the
 * permanent public URLs - while the same names created through the API got correct ones.
 */
function slugify(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      // the tightest taxonomy slug contract is `tagSchema` at 100 (categories, authors
      // and sources allow 140), and the server stores what the client sends - so an
      // over-long tag name used to come back as a raw English 400. Names themselves are
      // still sent unmodified and can still be refused on length.
      .slice(0, 100) || "untitled"
  );
}

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
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // returned before clearing `loading`, which initialises true: a user with no site
    // membership sat on "Carregando…" for the rest of the session
    if (!activeSiteId) {
      setRows([]);
      setLoading(false);
      return;
    }
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
      if (slugField) body.slug = form.slug ? slugify(form.slug) : slugify(form.name);
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
    if (!activeSiteId || busyId) return;
    setError(null);
    setBusyId(id);
    try {
      const body: Record<string, unknown> = { name: editForm.name };
      if (slugField) body.slug = editForm.slug ? slugify(editForm.slug) : slugify(editForm.name ?? "");
      await update(activeSiteId, id, body);
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao editar");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    // without an in-flight guard a double click fired two DELETEs and the second 404ed,
    // painting a red error over a deletion that had in fact succeeded
    if (!activeSiteId || busyId) return;
    setError(null);
    setBusyId(id);
    try {
      await remove(activeSiteId, id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    } finally {
      setBusyId(null);
    }
  }

  const tableColumns: Column<TaxonomyRow>[] = [
    {
      key: "name",
      header: "Nome",
      render: (r) =>
        editingId === r.id ? (
          <Input aria-label="Nome" value={editForm.name ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
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
                <Input aria-label="Slug" value={editForm.slug ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, slug: e.target.value }))} />
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
              <Button size="xs" variant="primary" disabled={busyId !== null} onClick={() => void onEdit(r.id)}>Salvar</Button>
              <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancelar</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="secondary" onClick={() => { setEditingId(r.id); setEditForm({ name: r.name, slug: r.slug ?? "" }); }}>Editar</Button>
              <Button size="xs" variant="destructive" disabled={busyId !== null} onClick={() => void onDelete(r.id)}>Excluir</Button>
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
