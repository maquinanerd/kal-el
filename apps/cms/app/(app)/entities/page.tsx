"use client";

import { CreatableSelect } from "@kal-el/design-system";
import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../../../lib/api";

/**
 * The editorial vocabulary for an entity.
 *
 * `type` is a free string on the API (1-64 chars) and deliberately extensible, so this is
 * a creatable combobox rather than a closed enum: the known kinds are one click, anything
 * else is still possible. It was a bare text input, which meant "Pessoa", "pessoa" and
 * "person" all coexisted as distinct types in the same site.
 */
const ENTITY_TYPES = ["person", "organization", "work", "place", "event", "product"];

const TYPE_LABEL: Record<string, string> = {
  person: "Pessoa",
  organization: "Organização",
  work: "Obra",
  place: "Lugar",
  event: "Evento",
  product: "Produto",
};

export default function EntitiesPage() {
  return (
    <TaxonomyManager
      title="Entidades"
      description="Pessoas, organizações e obras que o conteúdo cita."
      slugField={false}
      extraKeys={["type"]}
      load={(siteId) => listEntities(siteId).then((rows) => rows.map((r) => ({ ...r, type: r.type })))}
      create={createEntity}
      update={updateEntity}
      remove={deleteEntity}
      columns={[
        {
          key: "type",
          header: "Tipo",
          render: (r) => {
            const t = String(r.type ?? "");
            return t ? <span className="peg-chip">{TYPE_LABEL[t] ?? t}</span> : <span className="peg-table__muted">—</span>;
          },
        },
      ]}
      createExtras={(form, set) => (
        <CreatableSelect
          label="Tipo"
          value={form.type ?? ""}
          options={ENTITY_TYPES}
          hint="Escolha um tipo conhecido ou crie um novo."
          onChange={(v) => set("type", v)}
        />
      )}
      editExtras={(form, set) => (
        <CreatableSelect label="Tipo" value={form.type ?? ""} options={ENTITY_TYPES} onChange={(v) => set("type", v)} />
      )}
    />
  );
}
