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
};

export function emptyBatch(sourceName: string): ImportBatch {
  return { sourceName, users: [], categories: [], tags: [], authors: [], media: [], articles: [], redirects: [] };
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
