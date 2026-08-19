import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articleRevisions, articles } from "@kal-el/db/schema";
import type { ArticleDocument, ArticleDocumentV2 } from "@kal-el/contracts";
import { migrateDocumentToV2 } from "@kal-el/contracts";

import { badRequest, notFound, versionConflict } from "../plugins/errors.js";
import { auditActorFields, writeAudit } from "../plugins/audit.js";
import type { ActorRef } from "./articles.js";

/**
 * Controlled recovery of an unreadable article body.
 *
 * A `NOT NULL jsonb` column accepts `'null'`, `'{}'` and anything else that is valid JSON
 * but not a valid ArticleDocument. A restore from an older backup, a hand-run statement or
 * a partial migration can leave one behind. Every reader in the product degrades such a
 * document to an empty one so the row stays reachable - which is the right call for
 * display, and means the original bytes are visible nowhere at all.
 *
 * Before this module the bytes existed in the table and the only way to see them was
 * direct SQL against production. These two operations close that: read exactly what is
 * stored, and replace it deliberately, with the previous value preserved as a revision
 * first and the whole thing recorded in the audit log.
 */

export type RawDocument = {
  articleId: string;
  siteId: string;
  title: string;
  status: string;
  version: number;
  /** Whether the stored value parses as an ArticleDocument. */
  readable: boolean;
  /** Why it does not, when it does not. */
  reason: string | null;
  /** Exactly what is in the column - no normalisation, no migration. */
  raw: unknown;
  updatedAt: string;
  /** Revisions whose own stored document is also unreadable, so an operator can tell
   *  whether the history offers anything to restore from. */
  revisions: { id: string; revisionNumber: number; note: string | null; readable: boolean; createdAt: string }[];
};

function inspect(value: unknown): { readable: boolean; reason: string | null } {
  if (!value) return { readable: true, reason: null };
  try {
    migrateDocumentToV2(value as ArticleDocument);
    return { readable: true, reason: null };
  } catch (err) {
    return { readable: false, reason: err instanceof Error ? err.message.slice(0, 500) : String(err) };
  }
}

/**
 * The stored document exactly as it is, plus the readability of every revision.
 *
 * Site-scoped in the WHERE clause, not checked afterwards: this returns raw unvalidated
 * content, and a route that fetched first and compared the site second would have already
 * read another tenant's bytes into memory before refusing.
 */
export async function readRawDocument(db: Db, siteId: string, articleId: string): Promise<RawDocument> {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");

  const { readable, reason } = inspect(row.document);
  const revisions = await db
    .select({
      id: articleRevisions.id,
      revisionNumber: articleRevisions.revisionNumber,
      note: articleRevisions.note,
      document: articleRevisions.document,
      createdAt: articleRevisions.createdAt,
    })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(desc(articleRevisions.revisionNumber))
    .limit(50);

  return {
    articleId: row.id,
    siteId: row.siteId,
    title: row.title,
    status: row.status,
    version: row.version,
    readable,
    reason,
    raw: row.document ?? null,
    updatedAt: row.updatedAt.toISOString(),
    revisions: revisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      note: r.note,
      readable: inspect(r.document).readable,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** The raw bytes of one revision, for recovering from history rather than retyping. */
export async function readRawRevision(db: Db, siteId: string, articleId: string, revisionId: string) {
  const owner = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!owner) throw notFound("article not found");
  const row = await db.query.articleRevisions.findFirst({
    where: and(eq(articleRevisions.id, revisionId), eq(articleRevisions.articleId, articleId)),
  });
  if (!row) throw notFound("revision not found");
  const { readable, reason } = inspect(row.document);
  return {
    id: row.id,
    articleId: row.articleId,
    revisionNumber: row.revisionNumber,
    note: row.note,
    readable,
    reason,
    raw: row.document,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ReplaceDocumentResult = {
  articleId: string;
  version: number;
  /** Revision number the previous bytes were filed under, so the operator can find them. */
  preservedAs: number;
  document: ArticleDocumentV2;
};

/**
 * Replace an article's document, preserving the previous bytes first.
 *
 * Deliberately explicit, never automatic. The ordering matters and is the whole point:
 *
 *   1. the current column value is written to a revision *verbatim*, before anything
 *      overwrites it - after the UPDATE there is no other copy;
 *   2. the replacement is written;
 *   3. the replacement is filed as its own revision, so the history reads correctly;
 *   4. an audit row records who did it and what the previous state was.
 *
 * `expectedVersion` is honoured so two operators repairing the same article cannot
 * silently overwrite one another.
 */
export async function replaceDocument(
  db: Db,
  siteId: string,
  articleId: string,
  actor: ActorRef,
  input: { document: ArticleDocument; note?: string },
  expectedVersion?: number,
): Promise<ReplaceDocumentResult> {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, articleId), eq(articles.siteId, siteId)),
  });
  if (!row) throw notFound("article not found");
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw versionConflict("version mismatch: the article was modified by another actor", {
      currentVersion: row.version,
      expectedVersion,
    });
  }

  let document: ArticleDocumentV2;
  try {
    document = migrateDocumentToV2(input.document);
  } catch (err) {
    // Refusing here is the point: the replacement for an unreadable document must not
    // itself be unreadable, or the repair leaves the article in the same state with the
    // original bytes now one revision further back.
    throw badRequest("the replacement document is not a valid article document", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const before = inspect(row.document);

  return db.transaction(async (tx) => {
    const nextRevision = async () => {
      const max = await tx
        .select({ n: sql<number>`coalesce(max(${articleRevisions.revisionNumber}), 0)` })
        .from(articleRevisions)
        .where(eq(articleRevisions.articleId, articleId));
      return Number(max[0]?.n ?? 0) + 1;
    };

    // 1. preserve the bytes about to be destroyed, whatever they are
    const preservedAs = await nextRevision();
    await tx.insert(articleRevisions).values({
      articleId,
      revisionNumber: preservedAs,
      document: (row.document ?? { version: 2, nodes: [] }) as never,
      createdBy: actor.kind === "user" ? (actor.userId ?? null) : null,
      note: before.readable
        ? "documento substituido por recuperacao (preservado)"
        : "documento ilegivel preservado antes da recuperacao",
    });

    // 2. write the replacement, guarded on the version we read
    const [updated] = await tx
      .update(articles)
      .set({
        document,
        updatedBy: actor.kind === "user" ? (actor.userId ?? null) : null,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(articles.id, articleId), eq(articles.siteId, siteId), eq(articles.version, row.version)))
      .returning();
    if (!updated) {
      throw versionConflict("article changed concurrently", { expectedVersion: row.version });
    }

    // 3. file the replacement as a revision of its own
    await tx.insert(articleRevisions).values({
      articleId,
      revisionNumber: preservedAs + 1,
      document,
      createdBy: actor.kind === "user" ? (actor.userId ?? null) : null,
      note: input.note ?? "documento recuperado",
    });

    // 4. record it
    await writeAudit(tx, {
      siteId,
      ...auditActorFields(actor),
      action: "articles.recover",
      objectType: "article",
      objectId: articleId,
      details: {
        previousReadable: before.readable,
        previousReason: before.reason,
        preservedRevision: preservedAs,
        version: updated.version,
        note: input.note ?? null,
      },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });

    return { articleId, version: updated.version, preservedAs, document };
  });
}
