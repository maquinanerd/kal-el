# ADR-0003 — HTTP API framework

Status: Accepted
Date: 2026-08-14
Related: docs/01-ARCHITECTURE.md, ADR-0001

## Context

The canonical REST `/v1` API (docs/01-ARCHITECTURE.md) requires OpenAPI,
schema validation, consistent errors, plugin isolation, rate limiting and
strong TypeScript. Candidates: Fastify, Hono, Express, NestJS.

## Decision

- **Fastify v5** with official plugins: `@fastify/cors`, `@fastify/helmet`,
  `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/swagger` + swagger-ui,
  and `fastify-plugin` for encapsulated plugins.

## Rationale

- Mature, maintained, high-performance core with a stable plugin ecosystem.
- Request/response lifecycle supports per-route preHandlers (auth, site-scope,
  permission guards) that fit the RBAC model.
- OpenAPI/JSON-Schema tooling is first-class (`@fastify/swagger`).
- Encapsulation (register + prefix) matches the site-scoped router design.
- Hono was not chosen because the project targets a long-lived REST/OpenAPI
  server where Fastify's plugin lifecycle and schema tooling are more mature.

## Consequences

- OpenAPI document is generated from the `@kal-el/contracts` zod registry and
  served at `/docs` (Swagger UI); runtime validation of request bodies is done
  with the same zod schemas in handlers.
- Error responses follow a single `{ error: { code, message, details, requestId } }`
  envelope via a global error handler.
