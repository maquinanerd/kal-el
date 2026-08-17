"use client";

import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createSource, deleteSource, listSources, updateSource } from "../../../lib/api";

export default function SourcesPage() {
  return (
    <TaxonomyManager
      title="Fontes"
      slugField={false}
      load={(siteId) => listSources(siteId).then((rows) => rows.map((r) => ({ ...r, url: r.url ?? "" })))}
      create={createSource}
      update={updateSource}
      remove={deleteSource}
      columns={[{ key: "url", header: "URL", render: (r) => <span className="peg-table__muted">{r.url ? String(r.url) : "—"}</span> }]}
    />
  );
}
