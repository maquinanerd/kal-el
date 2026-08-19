import { createHash } from "node:crypto";
import type { KalElClient } from "@kal-el/sdk";
import { finalizeDocument } from "./html.js";
import type { ImportBatch, NormalizedAuthor, NormalizedMedia, NormalizedTaxonomy } from "./types.js";

export type ImportReport = {
  source: { categories: number; tags: number; authors: number; media: number; articles: number; redirects: number };
  imported: { categories: number; tags: number; authors: number; articles: number; redirects: number; media: number };
  existing: { categories: number; tags: number; authors: number; articles: number };
  /** Existing articles whose source content changed and were synchronized. */
  updated: { articles: number };
  /** Existing articles whose source content was identical - no write performed. */
  unchanged: { articles: number };
  failed: { articles: number };
  /** Media rows reused because they were already imported under the same source id. */
  reusedMedia: number;
  warnings: string[];
  articleIds: string[];
  mediaPending: number;
};

/**
 * Content fingerprint used to decide whether an already-imported article actually needs
 * a write. Key order is normalised so an equal payload always hashes equal.
 */
function contentHash(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (Array.isArray(v)) return `[${[...v].map(canonical).join(",")}]`;
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function slugToId<T extends { id: string; slug: string }>(rows: T[]): Map<string, string> {
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/**
 * Resolution maps for a taxonomy kind.
 *
 * `bySlug` answers "does this row already exist here?" (Kal El rows carry no external
 * id, so slug is the only stable join back to the source).
 *
 * `byExternalId` answers "which Kal El id does this source reference point at?" and is
 * what article relations are resolved through. Articles reference taxonomy by the
 * source's external id (`wp:cat:5`), never by slug, so resolving relations through
 * `bySlug` silently drops every category, tag and author on every article.
 */
type Resolver = { bySlug: Map<string, string>; byExternalId: Map<string, string> };

function resolver(rows: { id: string; slug: string }[]): Resolver {
  return { bySlug: slugToId(rows), byExternalId: new Map() };
}

async function ensureTaxonomyRows<T extends { externalId: string; name: string; slug: string }>(
  items: T[],
  res: Resolver,
  report: ImportReport,
  label: "categories" | "tags" | "authors",
  create: (item: T) => Promise<{ id: string; slug: string }>,
): Promise<void> {
  for (const item of items) {
    const known = res.bySlug.get(item.slug);
    if (known) {
      res.byExternalId.set(item.externalId, known);
      continue;
    }
    try {
      const created = await create(item);
      res.bySlug.set(created.slug, created.id);
      res.byExternalId.set(item.externalId, created.id);
      report.imported[label]++;
    } catch (err) {
      // Never silent: an unresolvable taxonomy row means articles lose that relation.
      report.warnings.push(
        `${label} not resolved: ${item.slug} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
}

async function ensureCategories(client: KalElClient, siteId: string, items: NormalizedTaxonomy[], report: ImportReport, res: Resolver): Promise<void> {
  // parents first so hierarchies exist
  const ordered = [...items].sort((a, b) => (a.parentExternalId ? 1 : 0) - (b.parentExternalId ? 1 : 0));
  await ensureTaxonomyRows(ordered, res, report, "categories", (item) =>
    client.createCategory(siteId, { name: item.name, slug: item.slug }),
  );
}

async function ensureTags(client: KalElClient, siteId: string, items: NormalizedTaxonomy[], report: ImportReport, res: Resolver): Promise<void> {
  await ensureTaxonomyRows(items, res, report, "tags", (item) =>
    client.createTag(siteId, { name: item.name, slug: item.slug }),
  );
}

async function ensureAuthors(client: KalElClient, siteId: string, items: NormalizedAuthor[], report: ImportReport, res: Resolver): Promise<void> {
  await ensureTaxonomyRows(items, res, report, "authors", (item) =>
    client.createAuthor(siteId, { name: item.name, slug: item.slug, email: item.email }),
  );
}

/**
 * Import a normalized batch through the public REST API (never PostgreSQL
 * directly). Article `externalKey = {prefix}:{externalId}` makes re-import
 * idempotent; already-imported articles are skipped and counted as existing.
 */
export async function importBatch(
  client: KalElClient,
  siteId: string,
  batch: ImportBatch,
  opts: { externalKeyPrefix?: string; fetchMedia?: (media: NormalizedMedia) => Promise<{ data: Buffer; mimeType: string }> } = {},
): Promise<ImportReport> {
  const prefix = opts.externalKeyPrefix ?? "imp";
  const report: ImportReport = {
    source: {
      categories: batch.categories.length,
      tags: batch.tags.length,
      authors: batch.authors.length,
      media: batch.media.length,
      articles: batch.articles.length,
      redirects: batch.redirects.length,
    },
    imported: { categories: 0, tags: 0, authors: 0, articles: 0, redirects: 0, media: 0 },
    existing: { categories: 0, tags: 0, authors: 0, articles: 0 },
    updated: { articles: 0 },
    unchanged: { articles: 0 },
    failed: { articles: 0 },
    reusedMedia: 0,
    // adapter-level losses (unsupported richtext nodes, etc.) surface in the same report
    warnings: [...(batch.warnings ?? [])],
    articleIds: [],
    mediaPending: 0,
  };

  const categories = resolver(await client.listCategories(siteId));
  const tags = resolver(await client.listTags(siteId));
  const authors = resolver(await client.listAuthors(siteId));
  report.existing = {
    categories: categories.bySlug.size,
    tags: tags.bySlug.size,
    authors: authors.bySlug.size,
    articles: 0,
  };

  await ensureCategories(client, siteId, batch.categories, report, categories);
  await ensureTags(client, siteId, batch.tags, report, tags);
  await ensureAuthors(client, siteId, batch.authors, report, authors);

  // media: when a fetchMedia provider is given, download + upload binaries so
  // image/gallery nodes and featured images survive the import.
  const seenMediaIds = new Set<string>();
  const urlToMediaId = new Map<string, string>();
  if (opts.fetchMedia) {
    for (const m of batch.media) {
      try {
        const { data, mimeType } = await opts.fetchMedia(m);
        // the source identity makes the upload reuse an already-imported asset instead
        // of writing a second copy of the same bytes on every run
        const uploaded = await client.uploadMedia(siteId, m.filename, data, mimeType, `${prefix}:${m.externalId}`);
        urlToMediaId.set(m.url, uploaded.id);
        if (seenMediaIds.has(uploaded.id)) report.reusedMedia++;
        seenMediaIds.add(uploaded.id);
        report.imported.media++;
      } catch (err) {
        report.warnings.push(`media failed: ${m.url} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  report.mediaPending = batch.media.length - report.imported.media;

  for (const article of batch.articles) {
    const externalKey = `${prefix}:${article.externalId}`;
    const existing = await client.listArticles(siteId, { externalKey });
    const first = existing.items[0];

    /**
     * Resolves source references to Kal El ids.
     *
     * `complete` matters on update: an unresolved reference means the batch does not
     * actually know this article's full relation set, and writing the partial list would
     * DELETE the rest (replaceRelations is delete-then-insert). A partial list is fine on
     * create - there is nothing to lose - but on update the field is left out entirely.
     */
    const resolveRelation = (externalIds: string[], res: Resolver, kind: string) => {
      const ids: string[] = [];
      let complete = true;
      for (const e of externalIds) {
        const id = res.byExternalId.get(e);
        if (id) ids.push(id);
        else {
          complete = false;
          report.warnings.push(`${kind} reference dropped on "${article.slug}": ${e} not in batch`);
        }
      }
      return { ids, complete };
    };

    const categoryRel = resolveRelation(article.categoryExternalIds, categories, "category");
    const tagRel = resolveRelation(article.tagExternalIds, tags, "tag");
    const authorRel = resolveRelation(article.authorExternalIds, authors, "author");
    const categoryIds = categoryRel.ids;
    const tagIds = tagRel.ids;
    const authorIds = authorRel.ids;

    const featuredMediaId = article.featuredMediaExternalId ? urlToMediaId.get(batch.media.find((m) => m.externalId === article.featuredMediaExternalId)?.url ?? "") : undefined;
    // the source names a featured image this run could not resolve - a transient media
    // failure, never a signal that the article should lose the one it already has
    const featuredResolved = !article.featuredMediaExternalId || featuredMediaId !== undefined;

    // Per-article, not a scan of batch-scoped warnings: one article losing an image
    // must not freeze the document of every other article in the run.
    const droppedMedia = { value: false };
    const document = finalizeDocument(article.intermediateNodes, urlToMediaId, report.warnings, droppedMedia);

    if (first) {
      // Import used to be insert-only: a changed title, slug, body, status or SEO field
      // in the source was never propagated, so the second run of a weekly sync silently
      // did nothing.
      //
      // The diff is field-by-field over exactly what an update can carry. Comparing whole
      // objects would report "changed" every run, because the stored article carries the
      // normalised full SEO shape while the source supplies only a few keys.
      report.existing.articles++;
      report.articleIds.push(first.id);

      const full = await client.getArticle(siteId, first.id);
      const sorted = (ids: readonly string[]) => [...ids].sort();

      const desired: Record<string, unknown> = {
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt ?? null,
        document,
        categories: sorted(categoryIds),
        tags: sorted(tagIds),
        authors: sorted(authorIds),
        featuredMediaId: featuredMediaId ?? null,
      };
      const current: Record<string, unknown> = {
        title: full.title,
        slug: full.slug ?? null,
        excerpt: full.excerpt ?? null,
        document: full.document,
        categories: sorted(full.categories ?? []),
        tags: sorted(full.tags ?? []),
        authors: sorted(full.authors ?? []),
        featuredMediaId: full.featuredMediaId ?? null,
      };

      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(desired)) {
        if (contentHash(desired[key]) !== contentHash(current[key])) patch[key] = desired[key];
      }

      // An incompletely resolved relation would clear the ones the batch could not see.
      const incomplete: [string, boolean][] = [
        ["categories", categoryRel.complete],
        ["tags", tagRel.complete],
        ["authors", authorRel.complete],
        ["featuredMediaId", featuredResolved],
        // finalizeDocument DROPS image and gallery nodes whose media did not resolve.
        // Patching that would delete images out of a live article body because a CDN
        // was down for one run, and file the degraded version as a revision.
        ["document", !droppedMedia.value],
      ];
      for (const [field, complete] of incomplete) {
        if (!complete && field in patch) {
          delete patch[field];
          report.warnings.push(
            `${field} left untouched on "${article.slug}": the batch resolved only part of them`,
          );
        }
      }

      // relations are sent unsorted; the sort exists only to make the comparison stable
      if ("categories" in patch) patch.categories = categoryIds;
      if ("tags" in patch) patch.tags = tagIds;
      if ("authors" in patch) patch.authors = authorIds;

      if (article.seo) {
        const storedSeo = (full.seo ?? {}) as Record<string, unknown>;
        const seoPatch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(article.seo as Record<string, unknown>)) {
          if (value === undefined) continue;
          if (contentHash(value) !== contentHash(storedSeo[key] ?? null)) seoPatch[key] = value;
        }
        if (Object.keys(seoPatch).length > 0) patch.seo = { ...storedSeo, ...seoPatch };
      }

      if (Object.keys(patch).length === 0) {
        report.unchanged.articles++;
        continue;
      }

      try {
        await client.updateArticle(siteId, first.id, patch, String(full.version));
        report.updated.articles++;
      } catch (err) {
        // counted, not only warned: a re-sync whose token lost `articles.update` produced
        // 500 warnings, zero updates and `failed.articles === 0` - a clean-looking run in
        // which nothing synchronized
        report.failed.articles++;
        report.warnings.push(`update failed for "${article.slug}": ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    // Media fetch, update and redirects were each guarded; this call was not. One 403 -
    // a token without `articles.schedule` meeting a single source article that carries a
    // scheduled date, say - threw out of the loop, so every remaining article was skipped
    // and the report, with all its warnings, was never returned to the caller.
    try {
      const created = await client.createArticle(siteId, {
        type: article.type,
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        document,
        status: article.status,
        publishedAt: article.publishedAt,
        scheduledAt: article.scheduledAt,
        categories: categoryIds,
        tags: tagIds,
        authors: authorIds,
        featuredMediaId,
        externalKey,
        provenance: {
          system: batch.sourceName.toLowerCase(),
          sources: [{ provider: batch.sourceName.toLowerCase(), externalId: article.externalId, externalUrl: article.externalUrl || undefined }],
        },
        seo: article.seo,
      });

      report.imported.articles++;
      report.articleIds.push(created.id);
    } catch (err) {
      report.failed.articles++;
      report.warnings.push(`create failed for "${article.slug}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const redirect of batch.redirects) {
    try {
      await client.createRedirect(siteId, { sourcePath: redirect.sourcePath, targetPath: redirect.targetPath, kind: "301" });
      report.imported.redirects++;
    } catch {
      // duplicate source path already imported
    }
  }

  return report;
}
