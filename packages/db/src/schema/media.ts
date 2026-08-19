import { doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { sites } from "./sites";
import { users } from "./identity";

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    caption: text("caption"),
    credit: text("credit"),
    focalX: doublePrecision("focal_x"),
    focalY: doublePrecision("focal_y"),
    storageKey: text("storage_key").notNull(),
    provider: text("provider").notNull().default("local"),
    /**
     * Stable identity in the system this asset came from (e.g. `wp:media:42`).
     *
     * Without it a re-import had no way to recognise an already-imported asset and
     * re-downloaded plus re-uploaded every binary on every run - unreferenced, so not
     * even reclaimable by the in-use delete check.
     */
    externalKey: text("external_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_site_created_idx").on(t.siteId, t.createdAt),
    uniqueIndex("media_site_external_key_unique").on(t.siteId, t.externalKey),
  ],
);

export type MediaRow = typeof media.$inferSelect;
