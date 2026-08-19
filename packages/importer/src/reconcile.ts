import { createHash } from "node:crypto";
import type { KalElClient } from "@kal-el/sdk";
import type { ImportBatch } from "./types.js";

export type ReconcileReport = {
  source: Record<string, number>;
  imported: Record<string, number>;
  missingArticles: string[];
  extraArticles: string[];
  sourceHash: string;
  importedHash: string;
  deterministic: boolean;
};

function hashOf(items: { title: string; slug: string }[]): string {
  const canonical = [...items]
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((i) => `${i.slug}|${i.title}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Compare the source batch against the imported state via the REST API. */
export async function reconcile(client: KalElClient, siteId: string, batch: ImportBatch, opts: { externalKeyPrefix?: string } = {}): Promise<ReconcileReport> {
  const prefix = opts.externalKeyPrefix ?? "imp";
  const sourceKeys = new Set(batch.articles.map((a) => `${prefix}:${a.externalId}`));

  // fetch all articles for the site (paginated)
  const importedKeys = new Map<string, string>();
  const importedTitles = new Map<string, { title: string; slug: string }>();
  let cursor: string | null = null;
  for (;;) {
    const page = await client.listArticles(siteId, { limit: 100, cursor: cursor ?? undefined });
    for (const item of page.items) {
      if (item.externalKey) {
        importedKeys.set(item.externalKey, item.id);
        importedTitles.set(item.externalKey, { title: item.title, slug: item.slug ?? "" });
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const missing = [...sourceKeys].filter((k) => !importedKeys.has(k));
  // `startsWith(prefix)` also claimed keys from a different prefix that happens to share
  // the same leading characters ("wp" matching "wpx:123"); the separator has to be part
  // of the comparison.
  const extra = [...importedKeys.keys()].filter((k) => k.startsWith(`${prefix}:`) && !sourceKeys.has(k));

  const sourceArticles = batch.articles.map((a) => ({ title: a.title, slug: a.slug }));
  const importedArticles = [...sourceKeys].map((k) => importedTitles.get(k) ?? { title: "", slug: "" });
  const sourceHash = hashOf(sourceArticles);
  const importedHash = hashOf(importedArticles);

  return {
    source: {
      categories: batch.categories.length,
      tags: batch.tags.length,
      authors: batch.authors.length,
      articles: batch.articles.length,
    },
    imported: {
      categories: (await client.listCategories(siteId)).length,
      tags: (await client.listTags(siteId)).length,
      authors: (await client.listAuthors(siteId)).length,
      articles: importedKeys.size,
    },
    missingArticles: missing,
    extraArticles: extra,
    sourceHash,
    importedHash,
    deterministic: sourceHash === importedHash,
  };
}
