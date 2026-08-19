import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "@kal-el/db";
import { auditLog } from "@kal-el/db/schema";
import {
  articleListQuerySchema,
  createArticleBodySchema,
  createAuthorBodySchema,
  createCategoryBodySchema,
  createEntityBodySchema,
  createRedirectBodySchema,
  createSourceBodySchema,
  createTagBodySchema,
  idempotencyKeySchema,
  publishArticleBodySchema,
  scheduleArticleBodySchema,
  updateArticleBodySchema,
  updateAuthorBodySchema,
  updateCategoryBodySchema,
  updateEntityBodySchema,
  updateMediaBodySchema,
  updateSourceBodySchema,
  updateTagBodySchema,
  uuidSchema,
} from "@kal-el/contracts";

import { permissionDenied } from "../auth-context.js";
import { badRequest, notFound } from "../plugins/errors.js";
import { requireSiteScope } from "../plugins/auth.js";
import { idempotencyRequestHash, respondIdempotent, withIdempotency } from "../plugins/idempotency.js";
import {
  approveArticle,
  archiveArticle,
  createArticle,
  getArticle,
  listArticles,
  listRevisions,
  publishArticle,
  rejectArticle,
  scheduleArticle,
  submitArticle,
  unpublishArticle,
  updateArticle,
  type ActorRef,
} from "../services/articles.js";
import {
  createAuthor,
  createCategory,
  createEntity,
  createSource,
  createTag,
  deleteAuthor,
  deleteCategory,
  deleteEntity,
  deleteSource,
  deleteTag,
  listAuthors,
  listCategories,
  listEntities,
  listSources,
  listTags,
  updateAuthor,
  updateCategory,
  updateEntity,
  updateSource,
  updateTag,
} from "../services/taxonomy.js";
import { createRedirect, deleteRedirect, listRedirects } from "../services/redirects.js";
import { deleteMedia, getMedia, listMedia, updateMedia, uploadMedia } from "../services/media.js";
import { siteStats } from "../services/stats.js";
import { createPreviewToken } from "../services/preview.js";

function guard(permission: string) {
  return async (req: FastifyRequest) => {
    if (!req.actor) throw badRequest("actor missing");
    permissionDenied(req, permission);
  };
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.register(
    async (siteApp) => {
      siteApp.addHook("preHandler", async (req) => {
        const params = req.params as { siteId: string; articleId?: string };
        if (!uuidSchema.safeParse(params.siteId).success) throw badRequest("invalid siteId");
        if (params.articleId && !uuidSchema.safeParse(params.articleId).success) {
          throw notFound("article not found");
        }
        await requireSiteScope(app, req, params.siteId);
      });

      // ---- Articles ----
      siteApp.get("/articles", { preHandler: guard("articles.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = articleListQuerySchema.safeParse({ ...(req.query as object) });
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const page = await listArticles(app.db, siteId, parsed.data);
        return { data: page };
      });

      siteApp.post("/articles", { preHandler: guard("articles.create") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        // R0.1: creating directly into a published/scheduled state is a privileged
        // transition and must not be reachable with articles.create alone.
        const wantsPublished = parsed.data.status === "published" || parsed.data.publishedAt != null;
        const wantsScheduled = parsed.data.status === "scheduled" || parsed.data.scheduledAt != null;
        if (wantsPublished) permissionDenied(req, "articles.publish");
        if (wantsScheduled) permissionDenied(req, "articles.schedule");
        const actor = req.actor as ActorRef;
        const key = req.headers["idempotency-key"];

        if (typeof key === "string" && key.length > 0) {
          const parsedKey = idempotencyKeySchema.safeParse(key);
          if (!parsedKey.success) throw badRequest("invalid Idempotency-Key header");
          const result = await withIdempotency(app.db, {
            key: parsedKey.data,
            actorKey: actor.actorKey,
            requestHash: idempotencyRequestHash(req),
            run: async (tx) => {
              const { article, created } = await createArticle(tx as unknown as Db, siteId, actor, parsed.data);
              return { status: created ? 201 : 200, body: { data: article } };
            },
          });
          return reply.status(result.status).send(result.body);
        }

        const { article, created } = await createArticle(app.db, siteId, actor, parsed.data);
        return reply.status(created ? 201 : 200).send({ data: article });
      });

      siteApp.get("/articles/:articleId", { preHandler: guard("articles.read") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        return { data: await getArticle(app.db, siteId, articleId) };
      });

      siteApp.patch("/articles/:articleId", { preHandler: guard("articles.update") }, async (req, reply) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = updateArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const actor = req.actor as ActorRef;

        const ifMatch = req.headers["if-match"];
        let expectedVersion: number | undefined;
        if (typeof ifMatch === "string" && ifMatch.length > 0) {
          expectedVersion = Number(ifMatch);
          if (!Number.isInteger(expectedVersion)) throw badRequest("invalid If-Match header");
        }

        const ctx = req.actor;
        if (!ctx) throw badRequest("actor missing");
        const privileged =
          ctx.kind === "service" ||
          (ctx.kind === "user" &&
            (ctx.permissions.has("articles.publish") || ctx.permissions.has("articles.approve") || ctx.permissions.has("articles.schedule")));
        const requireOwnership = ctx.kind === "user" && !privileged;

        const article = await updateArticle(app.db, siteId, articleId, actor, parsed.data, expectedVersion, { requireOwnership });
        return reply.send({ data: article });
      });

      siteApp.get("/articles/:articleId/revisions", { preHandler: guard("articles.read") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        return { data: await listRevisions(app.db, siteId, articleId) };
      });

      siteApp.post("/articles/:articleId/publish", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const article = await publishArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note);
        return { data: article };
      });

      siteApp.post("/articles/:articleId/schedule", { preHandler: guard("articles.schedule") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = scheduleArticleBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const scheduledAt = new Date(parsed.data.scheduledAt);
        if (Number.isNaN(scheduledAt.getTime())) throw badRequest("invalid scheduledAt");
        const article = await scheduleArticle(app.db, siteId, articleId, scheduledAt, req.actor as ActorRef, parsed.data.note);
        return { data: article };
      });

      // ---- Editorial workflow ----
      siteApp.post("/articles/:articleId/submit", { preHandler: guard("articles.submit") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await submitArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/approve", { preHandler: guard("articles.approve") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await approveArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/reject", { preHandler: guard("articles.approve") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await rejectArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/unpublish", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await unpublishArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/archive", { preHandler: guard("articles.publish") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const parsed = publishArticleBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await archiveArticle(app.db, siteId, articleId, req.actor as ActorRef, parsed.data.note) };
      });

      siteApp.post("/articles/:articleId/preview", { preHandler: guard("articles.read") }, async (req) => {
        const { siteId, articleId } = req.params as { siteId: string; articleId: string };
        const token = createPreviewToken(app.config.SESSION_SECRET, siteId, articleId);
        return { data: { url: `${app.config.API_BASE_URL}/v1/preview/${token}` } };
      });

      // ---- Taxonomy ----
      siteApp.get("/categories", { preHandler: guard("taxonomy.categories.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listCategories(app.db, siteId) };
      });
      siteApp.post("/categories", { preHandler: guard("taxonomy.categories.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createCategoryBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createCategory(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            parentId: row.parentId,
            name: row.name,
            slug: row.slug,
            description: row.description ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/tags", { preHandler: guard("taxonomy.tags.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listTags(app.db, siteId) };
      });
      siteApp.post("/tags", { preHandler: guard("taxonomy.tags.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createTagBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createTag(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            name: row.name,
            slug: row.slug,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/entities", { preHandler: guard("taxonomy.entities.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const type = typeof req.query === "object" && req.query && "type" in req.query ? String((req.query as { type?: string }).type) : undefined;
        return { data: await listEntities(app.db, siteId, type) };
      });
      siteApp.post("/entities", { preHandler: guard("taxonomy.entities.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createEntityBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const actor = req.actor as ActorRef;
        return respondIdempotent(app.db, req, reply, actor.actorKey, async (tx) => ({
          status: 201,
          body: { data: await createEntity(tx as unknown as Db, siteId, actor, parsed.data) },
        }));
      });

      siteApp.get("/authors", { preHandler: guard("taxonomy.authors.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listAuthors(app.db, siteId) };
      });
      siteApp.post("/authors", { preHandler: guard("taxonomy.authors.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createAuthorBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const row = await createAuthor(app.db, siteId, req.actor as ActorRef, parsed.data);
        return reply.status(201).send({
          data: {
            id: row.id,
            siteId: row.siteId,
            name: row.name,
            slug: row.slug,
            bio: row.bio ?? null,
            email: row.email ?? null,
            userId: row.userId ?? null,
            avatarMediaId: row.avatarMediaId ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        });
      });

      siteApp.get("/sources", { preHandler: guard("taxonomy.sources.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listSources(app.db, siteId) };
      });
      siteApp.post("/sources", { preHandler: guard("taxonomy.sources.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createSourceBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const actor = req.actor as ActorRef;
        return respondIdempotent(app.db, req, reply, actor.actorKey, async (tx) => ({
          status: 201,
          body: { data: await createSource(tx as unknown as Db, siteId, actor, parsed.data) },
        }));
      });

      // ---- Taxonomy update/delete ----
      siteApp.patch("/categories/:id", { preHandler: guard("taxonomy.categories.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("category not found");
        const parsed = updateCategoryBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateCategory(app.db, siteId, id, req.actor as ActorRef, parsed.data) };
      });
      siteApp.delete("/categories/:id", { preHandler: guard("taxonomy.categories.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("category not found");
        return { data: await deleteCategory(app.db, siteId, id, req.actor as ActorRef) };
      });

      siteApp.patch("/tags/:id", { preHandler: guard("taxonomy.tags.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("tag not found");
        const parsed = updateTagBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateTag(app.db, siteId, id, req.actor as ActorRef, parsed.data) };
      });
      siteApp.delete("/tags/:id", { preHandler: guard("taxonomy.tags.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("tag not found");
        return { data: await deleteTag(app.db, siteId, id, req.actor as ActorRef) };
      });

      siteApp.patch("/entities/:id", { preHandler: guard("taxonomy.entities.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("entity not found");
        const parsed = updateEntityBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateEntity(app.db, siteId, id, req.actor as ActorRef, parsed.data) };
      });
      siteApp.delete("/entities/:id", { preHandler: guard("taxonomy.entities.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("entity not found");
        return { data: await deleteEntity(app.db, siteId, id, req.actor as ActorRef) };
      });

      siteApp.patch("/authors/:id", { preHandler: guard("taxonomy.authors.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("author not found");
        const parsed = updateAuthorBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateAuthor(app.db, siteId, id, req.actor as ActorRef, parsed.data) };
      });
      siteApp.delete("/authors/:id", { preHandler: guard("taxonomy.authors.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("author not found");
        return { data: await deleteAuthor(app.db, siteId, id, req.actor as ActorRef) };
      });

      siteApp.patch("/sources/:id", { preHandler: guard("taxonomy.sources.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("source not found");
        const parsed = updateSourceBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateSource(app.db, siteId, id, req.actor as ActorRef, parsed.data) };
      });
      siteApp.delete("/sources/:id", { preHandler: guard("taxonomy.sources.manage") }, async (req) => {
        const { siteId, id } = req.params as { siteId: string; id: string };
        if (!uuidSchema.safeParse(id).success) throw notFound("source not found");
        return { data: await deleteSource(app.db, siteId, id, req.actor as ActorRef) };
      });

      // ---- Redirects (SEO) ----
      siteApp.get("/redirects", { preHandler: guard("seo.manage") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await listRedirects(app.db, siteId) };
      });
      siteApp.post("/redirects", { preHandler: guard("seo.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const parsed = createRedirectBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        const redirect = await createRedirect(app.db, siteId, parsed.data);
        return reply.status(201).send({ data: redirect });
      });
      siteApp.delete("/redirects/:redirectId", { preHandler: guard("seo.manage") }, async (req) => {
        const { siteId, redirectId } = req.params as { siteId: string; redirectId: string };
        if (!uuidSchema.safeParse(redirectId).success) throw badRequest("invalid redirectId");
        return { data: await deleteRedirect(app.db, siteId, redirectId) };
      });

      // ---- Media ----
      siteApp.get("/media", { preHandler: guard("media.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const query = req.query as { q?: string; limit?: string; offset?: string } | undefined;
        const q = typeof query?.q === "string" && query.q.length > 0 ? query.q : undefined;
        const limit = query?.limit ? Number(query.limit) : undefined;
        const offset = query?.offset ? Number(query.offset) : undefined;
        return { data: await listMedia(app.db, siteId, app.config.API_BASE_URL, { q, limit, offset }) };
      });

      siteApp.post("/media", { preHandler: guard("media.manage") }, async (req, reply) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const part = await req.file();
        if (!part) throw badRequest("file is required");
        const data = await part.toBuffer();
        const actor = req.actor as ActorRef;
        return respondIdempotent(app.db, req, reply, actor.actorKey, async (tx) => ({
          status: 201,
          body: {
            data: await uploadMedia(
              tx as unknown as Db,
              app.storage,
              siteId,
              actor,
              { filename: part.filename || "file", mimeType: part.mimetype || "application/octet-stream", data },
              { maxBytes: app.config.MEDIA_MAX_BYTES, baseUrl: app.config.API_BASE_URL },
            ),
          },
        }));
      });

      siteApp.get("/media/:mediaId", { preHandler: guard("media.read") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        return { data: await getMedia(app.db, siteId, mediaId, app.config.API_BASE_URL) };
      });

      siteApp.get("/media/:mediaId/file", { preHandler: guard("media.read") }, async (req, reply) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        const mediaRow = await getMedia(app.db, siteId, mediaId, app.config.API_BASE_URL);
        const buf = await app.storage.get(mediaRow.storageKey);
        if (!buf) throw notFound("media not found");
        return reply.type(mediaRow.mimeType).send(buf);
      });

      siteApp.patch("/media/:mediaId", { preHandler: guard("media.manage") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        const parsed = updateMediaBodySchema.safeParse(req.body);
        if (!parsed.success) throw badRequest("validation failed", { issues: parsed.error.issues });
        return { data: await updateMedia(app.db, siteId, mediaId, req.actor as ActorRef, parsed.data, app.config.API_BASE_URL) };
      });

      siteApp.delete("/media/:mediaId", { preHandler: guard("media.manage") }, async (req) => {
        const { siteId, mediaId } = req.params as { siteId: string; mediaId: string };
        if (!uuidSchema.safeParse(mediaId).success) throw notFound("media not found");
        return { data: await deleteMedia(app.db, app.storage, siteId, mediaId, req.actor as ActorRef) };
      });

      // ---- Site stats (dashboard, real data) ----
      siteApp.get("/stats", { preHandler: guard("articles.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        return { data: await siteStats(app.db, siteId) };
      });

      // ---- Audit log (site-scoped) ----
      siteApp.get("/audit-log", { preHandler: guard("audit.read") }, async (req) => {
        const siteId = (req.params as { siteId: string }).siteId;
        const rows = await app.db.select().from(auditLog).where(eq(auditLog.siteId, siteId)).orderBy(desc(auditLog.createdAt)).limit(200);
        return {
          data: rows.map((r) => ({
            id: r.id,
            siteId: r.siteId,
            actorType: r.actorType,
            actorId: r.actorId,
            action: r.action,
            objectType: r.objectType,
            objectId: r.objectId,
            details: r.details,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      });

      siteApp.get("/audit-log/:objectType/:objectId", { preHandler: guard("audit.read") }, async (req) => {
        const { siteId, objectType, objectId } = req.params as { siteId: string; objectType: string; objectId: string };
        if (!uuidSchema.safeParse(objectId).success) throw badRequest("invalid objectId");
        const rows = await app.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.siteId, siteId), eq(auditLog.objectType, objectType), eq(auditLog.objectId, objectId)))
          .orderBy(desc(auditLog.createdAt))
          .limit(100);
        return { data: rows.map((r) => ({ id: r.id, action: r.action, actorType: r.actorType, actorId: r.actorId, details: r.details, createdAt: r.createdAt.toISOString() })) };
      });
    },
    { prefix: "/v1/sites/:siteId" },
  );
}
