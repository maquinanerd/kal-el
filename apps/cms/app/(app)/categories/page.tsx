"use client";

import { useEffect, useState } from "react";
import { Select } from "@kal-el/design-system";
import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createCategory, deleteCategory, listCategories, updateCategory, type Category } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function CategoriesPage() {
  return (
    <TaxonomyManager
      title="Categorias"
      load={async (siteId) => {
        const rows = await listCategories(siteId);
        const nameById = new Map(rows.map((r) => [r.id, r.name]));
        return rows.map((r) => ({ ...r, parentId: r.parentId ?? "", parentName: r.parentId ? (nameById.get(r.parentId) ?? "—") : "—" }));
      }}
      create={createCategory}
      update={updateCategory}
      remove={deleteCategory}
      columns={[
        {
          key: "parent",
          header: "Categoria pai",
          render: (r) => <span className="peg-table__muted">{r.parentName ? String(r.parentName) : "—"}</span>,
        },
      ]}
      createExtras={(form, set) => <CategoryParentSelect value={form.parentId ?? ""} onChange={(v) => set("parentId", v)} />}
    />
  );
}

function CategoryParentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { activeSiteId } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);

  useEffect(() => {
    if (activeSiteId) listCategories(activeSiteId).then(setCats).catch(() => {});
  }, [activeSiteId]);

  return (
    <Select label="Categoria pai (opcional)" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {cats.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </Select>
  );
}
