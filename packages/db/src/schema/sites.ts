import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /**
     * The site's canonical host, e.g. `maquinanerd.com.br`. Stored bare: no scheme, no
     * trailing slash, lowercased.
     *
     * A site knew only its name and its slug, so nothing downstream could build a real
     * URL for it: the SERP preview printed a hardcoded `exemplo.com`, the social preview
     * a hardcoded `kalel.app`, and canonical defaults had no host to default to. On a
     * multi-site CMS that is the difference between a preview and a guess.
     *
     * Nullable because an existing site has no domain until someone sets one, and a
     * newsroom should not be blocked from creating a site before DNS exists.
     */
    primaryDomain: text("primary_domain"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sites_slug_unique").on(t.slug)],
);

export type SiteRow = typeof sites.$inferSelect;
