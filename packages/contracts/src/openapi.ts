import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);
import { apiErrorSchema } from "./common.js";
import {
  articleSchema,
  articleSummarySchema,
  authorSchema,
  categorySchema,
  createArticleBodySchema,
  createAuthorBodySchema,
  createCategoryBodySchema,
  createEntityBodySchema,
  createSourceBodySchema,
  createTagBodySchema,
  entitySchema,
  tagSchema,
  updateArticleBodySchema,
} from "./editorial.js";
import { createRoleBodySchema, createServiceTokenBodySchema, createUserBodySchema, loginBodySchema } from "./identity.js";
import { mediaSchema } from "./media.js";
import { createRedirectBodySchema, redirectSchema, seoMetadataSchema } from "./seo.js";
import { createSiteBodySchema, siteSchema } from "./sites.js";
import { createWebhookBodySchema, webhookDeliverySchema, webhookSchema } from "./webhooks.js";

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "cookieAuth", { type: "apiKey", in: "cookie", name: "ke_session" });
registry.registerComponent("securitySchemes", "serviceAuth", { type: "http", scheme: "bearer" });

export const SCHEMA_NAMES = {
  ApiError: "ApiError",
  Site: "Site",
  User: "User",
  Role: "Role",
  ServiceToken: "ServiceToken",
  Session: "Session",
  Media: "Media",
  Category: "Category",
  Tag: "Tag",
  Entity: "Entity",
  Author: "Author",
  Source: "Source",
  Article: "Article",
  ArticleSummary: "ArticleSummary",
  SeoMetadata: "SeoMetadata",
  Redirect: "Redirect",
} as const;

registry.register("ApiError", apiErrorSchema);
registry.register("Site", siteSchema);
registry.register("User", z.object({ id: z.string().uuid(), email: z.string().email(), name: z.string(), status: z.string() }));
registry.register("Role", createRoleBodySchema.partial().extend({ id: z.string().uuid() }));
registry.register("ServiceToken", z.object({ id: z.string().uuid(), name: z.string(), scopes: z.array(z.string()), expiresAt: z.string().nullable() }));
registry.register("Session", z.object({ id: z.string().uuid(), userId: z.string().uuid(), expiresAt: z.string() }));
registry.register("Media", mediaSchema);
registry.register("Category", categorySchema);
registry.register("Tag", tagSchema);
registry.register("Entity", entitySchema);
registry.register("Author", authorSchema);
registry.register("Source", createSourceBodySchema.extend({ id: z.string().uuid(), createdAt: z.string() }));
registry.register("Article", articleSchema);
registry.register("ArticleSummary", articleSummarySchema);
registry.register("SeoMetadata", seoMetadataSchema);
registry.register("Redirect", redirectSchema);
registry.register("Webhook", webhookSchema);
registry.register("WebhookDelivery", webhookDeliverySchema);

function registerCorePaths() {
  registry.registerPath({
    method: "get",
    path: "/v1/health",
    summary: "Liveness probe",
    responses: { 200: { description: "healthy", content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/auth/login",
    summary: "Human login",
    request: { body: { content: { "application/json": { schema: loginBodySchema } } } },
    responses: {
      200: { description: "logged in", content: { "application/json": { schema: z.object({ data: z.object({ user: z.unknown() }) }) } } },
      401: { description: "bad credentials", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/sites",
    summary: "Create site",
    request: { body: { content: { "application/json": { schema: createSiteBodySchema } } } },
    responses: {
      201: { description: "created", content: { "application/json": { schema: z.object({ data: siteSchema }) } } },
      409: { description: "slug conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/users",
    summary: "Create user",
    request: { body: { content: { "application/json": { schema: createUserBodySchema } } } },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/roles",
    summary: "Create role",
    request: { body: { content: { "application/json": { schema: createRoleBodySchema } } } },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/service-tokens",
    summary: "Create scoped service token",
    request: { body: { content: { "application/json": { schema: createServiceTokenBodySchema } } } },
    responses: { 201: { description: "created with token secret", content: { "application/json": { schema: z.unknown() } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/articles",
    summary: "Create article",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      headers: z.object({ "Idempotency-Key": z.string().optional() }),
      body: { content: { "application/json": { schema: createArticleBodySchema } } },
    },
    responses: {
      201: { description: "created", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      200: { description: "idempotent replay", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      409: { description: "conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/articles",
    summary: "List articles",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: {
      200: { description: "list", content: { "application/json": { schema: z.object({ data: z.object({ items: z.array(articleSummarySchema) }) }) } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/articles/{articleId}",
    summary: "Get article",
    request: { params: z.object({ siteId: z.string().uuid(), articleId: z.string().uuid() }) },
    responses: { 200: { description: "article", content: { "application/json": { schema: z.object({ data: articleSchema }) } } } },
  });

  registry.registerPath({
    method: "patch",
    path: "/v1/sites/{siteId}/articles/{articleId}",
    summary: "Update article (optimistic concurrency via version)",
    request: {
      params: z.object({ siteId: z.string().uuid(), articleId: z.string().uuid() }),
      headers: z.object({ "If-Match": z.string().optional() }),
      body: { content: { "application/json": { schema: updateArticleBodySchema } } },
    },
    responses: {
      200: { description: "updated", content: { "application/json": { schema: z.object({ data: articleSchema }) } } },
      409: { description: "version conflict", content: { "application/json": { schema: apiErrorSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/categories",
    summary: "Create category",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createCategoryBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: categorySchema }) } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/categories",
    summary: "List categories",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: { 200: { description: "list", content: { "application/json": { schema: z.object({ data: z.array(categorySchema) }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/tags",
    summary: "Create tag",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createTagBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: tagSchema }) } } } },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/sites/{siteId}/tags",
    summary: "List tags",
    request: { params: z.object({ siteId: z.string().uuid() }) },
    responses: { 200: { description: "list", content: { "application/json": { schema: z.object({ data: z.array(tagSchema) }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/entities",
    summary: "Create entity",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createEntityBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: entitySchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/authors",
    summary: "Create author",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createAuthorBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: authorSchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/sources",
    summary: "Create source",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createSourceBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: z.unknown() }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/sites/{siteId}/redirects",
    summary: "Create redirect",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createRedirectBodySchema } } },
    },
    responses: { 201: { description: "created", content: { "application/json": { schema: z.object({ data: redirectSchema }) } } } },
  });

  registry.registerPath({
    method: "post",
    path: "/v1/admin/sites/{siteId}/webhooks",
    summary: "Create webhook subscription",
    request: {
      params: z.object({ siteId: z.string().uuid() }),
      body: { content: { "application/json": { schema: createWebhookBodySchema } } },
    },
    responses: { 201: { description: "created (secret returned once)", content: { "application/json": { schema: z.object({ data: webhookSchema }) } } } },
  });
}

registerCorePaths();

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3["generateDocument"]> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Kal El Editorial API",
      version: "1.0.0",
      description:
        "API-first editorial CMS. REST /v1 is canonical. All write endpoints require auth, authorization, validation, audit and idempotency where retryable.",
    },
    servers: [{ url: "/" }],
    security: [{ cookieAuth: [] }, { serviceAuth: [] }],
  });
}
