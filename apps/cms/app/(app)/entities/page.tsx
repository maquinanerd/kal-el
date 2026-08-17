"use client";

import { Input } from "@kal-el/design-system";
import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../../../lib/api";

export default function EntitiesPage() {
  return (
    <TaxonomyManager
      title="Entidades"
      slugField={false}
      load={(siteId) => listEntities(siteId).then((rows) => rows.map((r) => ({ ...r, type: r.type })))}
      create={createEntity}
      update={updateEntity}
      remove={deleteEntity}
      columns={[{ key: "type", header: "Tipo", render: (r) => <span className="peg-table__muted">{String(r.type ?? "—")}</span> }]}
      createExtras={(form, set) => <Input label="Tipo (ex: person, org)" value={form.type ?? ""} onChange={(e) => set("type", e.target.value)} />}
    />
  );
}
