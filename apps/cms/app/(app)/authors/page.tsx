"use client";

import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createAuthor, deleteAuthor, listAuthors, updateAuthor } from "../../../lib/api";

export default function AuthorsPage() {
  return (
    <TaxonomyManager
      title="Autores"
      load={(siteId) => listAuthors(siteId).then((rows) => rows.map((r) => ({ ...r, email: r.email ?? "" })))}
      create={createAuthor}
      update={updateAuthor}
      remove={deleteAuthor}
      columns={[{ key: "email", header: "E-mail", render: (r) => <span className="peg-table__muted">{r.email ? String(r.email) : "—"}</span> }]}
    />
  );
}
