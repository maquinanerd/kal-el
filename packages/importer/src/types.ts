import type { ArticleStatus, ArticleType, SeoMetadata } from "@kal-el/contracts";
import type { IntermediateNode } from "./html.js";

/** Neutral normalized import model shared by every adapter. */

export type NormalizedUser = {
  externalId: string;
  email: string;
  name: string;
};

export type NormalizedTaxonomy = {
  externalId: string;
  kind: "category" | "tag";
  name: string;
  slug: string;
  parentExternalId?: string;
};

export type NormalizedAuthor = {
  externalId: string;
  name: string;
  slug: string;
  email?: string;
};

export type NormalizedMedia = {
  externalId: string;
  filename: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  altText?: string;
  caption?: string;
};

export type NormalizedRedirect = {
  sourcePath: string;
  targetPath: string;
};

export type NormalizedArticle = {
  externalId: string;
  type: ArticleType;
  title: string;
  slug: string;
  dek?: string;
  excerpt?: string;
  /** intermediate nodes; image/gallery source URLs are resolved to mediaIds at import */
  intermediateNodes: IntermediateNode[];
  status: ArticleStatus;
  publishedAt?: string;
  scheduledAt?: string;
  authorExternalIds: string[];
  categoryExternalIds: string[];
  tagExternalIds: string[];
  featuredMediaExternalId?: string;
  seo?: Partial<SeoMetadata>;
  externalUrl: string;
};

export type ImportBatch = {
  sourceName: string;
  users: NormalizedUser[];
  categories: NormalizedTaxonomy[];
  tags: NormalizedTaxonomy[];
  authors: NormalizedAuthor[];
  media: NormalizedMedia[];
  articles: NormalizedArticle[];
  redirects: NormalizedRedirect[];
  /** Constructs the adapter could not represent. Merged into the import report. */
  warnings: string[];
};

/** Entity kinds that get a durable external identity in Kal El. */
export type ExternalEntityKind = "article" | "media";

/**
 * The stored identity of an imported record.
 *
 * `{prefix}:{externalId}` alone shared one namespace across every entity type. Articles
 * and media happen to sit in different tables with their own unique indexes, so nothing
 * collided in practice - but an adapter whose source ids are not type-prefixed (which the
 * neutral model never required) produced the same string for article 123 and media 123,
 * and `reconcile` decides what belongs to an import by matching that string. The kind is
 * now part of the key, so the identity is unambiguous by construction rather than by the
 * accident of which table it lives in.
 *
 * There is no migration path and none is needed: the key is only ever compared against
 * keys this function produced, and no deployed database exists.
 */
export function externalKeyFor(prefix: string, kind: ExternalEntityKind, externalId: string): string {
  return `${prefix}:${kind}:${externalId}`;
}

/** Prefix that matches every key of one kind, for reconciliation. */
export function externalKeyPrefixFor(prefix: string, kind: ExternalEntityKind): string {
  return `${prefix}:${kind}:`;
}

export function emptyBatch(sourceName: string): ImportBatch {
  return { sourceName, users: [], categories: [], tags: [], authors: [], media: [], articles: [], redirects: [], warnings: [] };
}

export function batchCounts(batch: ImportBatch) {
  return {
    users: batch.users.length,
    categories: batch.categories.length,
    tags: batch.tags.length,
    authors: batch.authors.length,
    media: batch.media.length,
    articles: batch.articles.length,
    redirects: batch.redirects.length,
  };
}
