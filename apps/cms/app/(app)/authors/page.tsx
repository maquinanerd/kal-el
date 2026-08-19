"use client";

import { Input, Textarea } from "@kal-el/design-system";
import { TaxonomyManager } from "../../../components/TaxonomyManager";
import { createAuthor, deleteAuthor, listAuthors, updateAuthor } from "../../../lib/api";

/**
 * Author management, limited to what the model actually stores: name, slug, email, bio.
 *
 * The full specification describes an author platform - avatar, social links, content
 * count, recent articles. Building the UI for fields the schema does not have would mean
 * inventing half a dozen columns to satisfy a screenshot, which this round is explicitly
 * not for. Bio and email are now editable rather than write-once, which is the real gap.
 */
export default function AuthorsPage() {
  return (
    <TaxonomyManager
      title="Autores"
      description="Quem assina o conteúdo do site."
      extraKeys={["email", "bio"]}
      load={(siteId) => listAuthors(siteId).then((rows) => rows.map((r) => ({ ...r, email: r.email ?? "", bio: r.bio ?? "" })))}
      create={createAuthor}
      update={updateAuthor}
      remove={deleteAuthor}
      columns={[
        {
          key: "email",
          header: "E-mail",
          render: (r) => (r.email ? <span className="peg-table__muted">{String(r.email)}</span> : <span className="peg-table__muted">—</span>),
        },
        {
          key: "bio",
          header: "Bio",
          render: (r) =>
            r.bio ? (
              <span className="kalel-author__bio" title={String(r.bio)}>
                {String(r.bio)}
              </span>
            ) : (
              <span className="peg-table__muted">—</span>
            ),
        },
      ]}
      createExtras={(form, set) => (
        <Input label="E-mail" optional value={form.email ?? ""} type="email" onChange={(e) => set("email", e.target.value)} />
      )}
      editExtras={(form, set) => (
        <>
          <Input label="E-mail" optional value={form.email ?? ""} type="email" onChange={(e) => set("email", e.target.value)} />
          <Textarea
            label="Bio"
            optional
            rows={3}
            value={form.bio ?? ""}
            hint="Uma ou duas frases, exibidas junto às matérias assinadas."
            onChange={(e) => set("bio", e.target.value)}
          />
        </>
      )}
    />
  );
}
