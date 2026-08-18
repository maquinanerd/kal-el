import type { KalElClient } from "@kal-el/sdk";
import { finalizeDocument } from "./html.js";
import type { ImportBatch, NormalizedAuthor, NormalizedMedia, NormalizedTaxonomy } from "./types.js";

export type ImportReport = {
  source: { categories: number; tags: number; authors: number; media: number; articles: number; redirects: number };
  imported: { categories: number; tags: number; authors: number; articles: number; redirects: number; media: number };
  existing: { categories: number; tags: number; authors: number; articles: number };
  warnings: string[];
  articleIds: string[];
  mediaPending: number;
};

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
  const urlToMediaId = new Map<string, string>();
  if (opts.fetchMedia) {
    for (const m of batch.media) {
      try {
        const { data, mimeType } = await opts.fetchMedia(m);
        const uploaded = await client.uploadMedia(siteId, m.filename, data, mimeType);
        urlToMediaId.set(m.url, uploaded.id);
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
    if (first) {
      report.existing.articles++;
      report.articleIds.push(first.id);
      continue;
    }

    const resolveRelation = (externalIds: string[], res: Resolver, kind: string): string[] => {
      const ids: string[] = [];
      for (const e of externalIds) {
        const id = res.byExternalId.get(e);
        if (id) ids.push(id);
        else report.warnings.push(`${kind} reference dropped on "${article.slug}": ${e} not in batch`);
      }
      return ids;
    };

    const categoryIds = resolveRelation(article.categoryExternalIds, categories, "category");
    const tagIds = resolveRelation(article.tagExternalIds, tags, "tag");
    const authorIds = resolveRelation(article.authorExternalIds, authors, "author");

    const featuredMediaId = article.featuredMediaExternalId ? urlToMediaId.get(batch.media.find((m) => m.externalId === article.featuredMediaExternalId)?.url ?? "") : undefined;

    const document = finalizeDocument(article.intermediateNodes, urlToMediaId, report.warnings);

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
