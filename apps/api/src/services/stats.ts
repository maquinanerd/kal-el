import { eq, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articles, authors, categories, media, tags } from "@kal-el/db/schema";

export async function siteStats(db: Db, siteId: string) {
  const [articleRows, mediaCount, categoryCount, tagCount, authorCount] = await Promise.all([
    db
      .select({ status: articles.status, n: sql<number>`count(*)` })
      .from(articles)
      .where(eq(articles.siteId, siteId))
      .groupBy(articles.status),
    db.select({ n: sql<number>`count(*)` }).from(media).where(eq(media.siteId, siteId)),
    db.select({ n: sql<number>`count(*)` }).from(categories).where(eq(categories.siteId, siteId)),
    db.select({ n: sql<number>`count(*)` }).from(tags).where(eq(tags.siteId, siteId)),
    db.select({ n: sql<number>`count(*)` }).from(authors).where(eq(authors.siteId, siteId)),
  ]);

  const byStatus: Record<string, number> = {};
  let totalArticles = 0;
  for (const r of articleRows) {
    byStatus[r.status] = Number(r.n);
    totalArticles += Number(r.n);
  }

  return {
    articles: { total: totalArticles, byStatus },
    media: Number(mediaCount[0]?.n ?? 0),
    categories: Number(categoryCount[0]?.n ?? 0),
    tags: Number(tagCount[0]?.n ?? 0),
    authors: Number(authorCount[0]?.n ?? 0),
  };
}
