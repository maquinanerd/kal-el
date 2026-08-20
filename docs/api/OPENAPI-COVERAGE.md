# Kal El — OpenAPI and its Coverage

Where the OpenAPI document lives, what it covers, and — more importantly — what it does
not.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

> **Do not generate an external client from this OpenAPI document.**
> The hand-written registry describes 27 of the 76 implemented operations, and the document
> served over HTTP has the opposite problem: it lists all 76 but replaces the hand-written
> schemas with empty stubs. Neither form is a usable client-generation source.
> **[../integrations/EXTERNAL_CLIENT_API.md](../integrations/EXTERNAL_CLIENT_API.md) is the
> reference contract.**

---

## 1. Where it lives

| Question | Answer |
|---|---|
| Source | `packages/contracts/src/openapi.ts` — built in code, not a file |
| Library | `@asteasolutions/zod-to-openapi`, `OpenApiGeneratorV3` |
| Entry point | `buildOpenApiDocument()` |
| Written to disk | **no** — no script generates `openapi.json` or `openapi.yaml`, and no such file exists in the repo |
| OpenAPI version | `3.0.3` |
| `info.title` | `Kal El Editorial API` |
| `info.version` | `1.0.0` |
| `servers` | `[{ "url": "/" }]` |
| Document-level `security` | `[{ "cookieAuth": [] }, { "serviceAuth": [] }]` |

Security schemes:

| Name | Definition |
|---|---|
| `cookieAuth` | `{ "type": "apiKey", "in": "cookie", "name": "ke_session" }` |
| `serviceAuth` | `{ "type": "http", "scheme": "bearer" }` |

The CSRF cookie `ke_csrf` and its `x-kal-el-csrf` header are **not** declared as a security
scheme, even though they are mandatory for every mutating session request.

### How to view it

```
GET /docs        Swagger UI
GET /docs/json   the document, JSON
GET /docs/yaml   the document, YAML
```

Mounted only when `ENABLE_DOCS=true` **or** `NODE_ENV != "production"` — so docs are on by
default outside production and off by default in it. The `/json` and `/yaml` sub-paths come
from `@fastify/swagger-ui`, not from project code.

There is no generation command. To read the hand-written document without a running server,
call `buildOpenApiDocument()` from `@kal-el/contracts`.

---

## 2. The served document is not the authored document

`@fastify/swagger` runs in its default **dynamic mode**: an `onRoute` hook collects every
registered Fastify route and merges it into the base document, and for any path+method that
is also a live route, **the generated entry overwrites the authored one**.

Kal El's routes declare no Fastify `schema` (they validate with zod inside the handler), so
the generated entries are bare stubs.

| | Authored document (`buildOpenApiDocument()`) | Served document (`/docs/json`) |
|---|---|---|
| Operations listed | 27 | **all 76** |
| Request/response schemas | hand-written, accurate | **stubs for every live route** |
| `components.schemas` | 18 registered | preserved |
| `info`, `servers`, `security` | as authored | preserved |

So `/docs/json` looks complete and is nearly contentless, while the authored document is
detailed and incomplete. Neither is a client-generation source.

---

## 3. Coverage summary

| | Count |
|---|---|
| Operations implemented by the API | **76** |
| Operations in the authored OpenAPI | **27** (22 unique paths) |
| Methods on the TypeScript SDK | **27** |
| In both OpenAPI and SDK | **20** |
| In OpenAPI only | 7 |
| In SDK only | 7 |
| **Implemented but in neither** | **42** |

### Registered component schemas — 18

`ApiError`, `Site`, `User`, `Role`, `ServiceToken`, `Session`, `Media`, `Category`, `Tag`,
`Entity`, `Author`, `Source`, `Article`, `ArticleSummary`, `SeoMetadata`, `Redirect`,
`Webhook`, `WebhookDelivery`.

`Webhook` and `WebhookDelivery` are registered but missing from the `SCHEMA_NAMES` map.
`SeoMetadata` is registered but referenced by no path.

---

## 4. Route-by-route coverage

Legend: **OAS** = present in the authored OpenAPI · **SDK** = has a `KalElClient` method ·
**EXT** = relevant to an external automation client.

### Health — `apps/api/src/routes/health.ts`

| Method | Path | OAS | SDK | EXT |
|---|---|---|---|---|
| GET | `/v1/health` | yes | no | yes |
| GET | `/health` | no | no | yes |
| GET | `/v1/ready` | no | no | yes |
| GET | `/ready` | no | no | yes |

### Auth — `apps/api/src/routes/auth.ts`

| Method | Path | OAS | SDK | EXT |
|---|---|---|---|---|
| POST | `/v1/auth/login` | yes | no | no (browser only) |
| POST | `/v1/auth/logout` | no | no | no |
| POST | `/v1/auth/logout-all` | no | no | no |
| GET | `/v1/auth/me` | no | no | **yes — startup self-check** |
| GET | `/v1/me/sites` | no | no | no (session only) |
| POST | `/v1/bootstrap/init` | no | no | provisioning only |

### Admin — prefix `/v1/admin`

| Method | Path | OAS | SDK | EXT |
|---|---|---|---|---|
| GET | `/sites` | no | no | yes |
| POST | `/sites` | yes | no | provisioning |
| PATCH | `/sites/{siteId}` | no | no | provisioning |
| GET | `/users` | no | no | no |
| POST | `/users` | yes | no | provisioning |
| POST | `/users/{userId}/roles` | no | no | provisioning |
| GET | `/permissions` | no | no | yes — the live scope list |
| GET | `/roles` | no | no | provisioning |
| POST | `/roles` | yes | no | provisioning |
| GET | `/sites/{siteId}/service-tokens` | no | no | **yes** |
| POST | `/sites/{siteId}/service-tokens` | yes | no | **yes** |
| POST | `/sites/{siteId}/service-tokens/{tokenId}/revoke` | no | no | **yes** |
| GET | `/sites/{siteId}/webhooks` | no | no | yes |
| POST | `/sites/{siteId}/webhooks` | yes | no | yes |
| PATCH | `/sites/{siteId}/webhooks/{webhookId}` | no | no | yes |
| DELETE | `/sites/{siteId}/webhooks/{webhookId}` | no | no | yes |

### Site-scoped — prefix `/v1/sites/{siteId}`

| Method | Path | OAS | SDK | EXT |
|---|---|---|---|---|
| GET | `/articles` | yes | `listArticles` | **yes** |
| POST | `/articles` | yes | `createArticle` | **yes** |
| GET | `/articles/{articleId}` | yes | `getArticle` | **yes** |
| PATCH | `/articles/{articleId}` | yes | `updateArticle` | **yes** |
| GET | `/articles/{articleId}/revisions` | **no** | `listRevisions` | yes |
| POST | `/articles/{articleId}/submit` | yes | `submitArticle` | **yes** |
| POST | `/articles/{articleId}/approve` | yes | `approveArticle` | yes |
| POST | `/articles/{articleId}/reject` | yes | `rejectArticle` | yes |
| POST | `/articles/{articleId}/schedule` | **no** | `scheduleArticle` | **yes** |
| POST | `/articles/{articleId}/publish` | yes | `publishArticle` | **yes** |
| POST | `/articles/{articleId}/unpublish` | yes | `unpublishArticle` | yes |
| POST | `/articles/{articleId}/archive` | yes | `archiveArticle` | yes |
| POST | `/articles/{articleId}/preview` | **no** | no | yes |
| GET | `/articles/{articleId}/document/raw` | **no** | no | recovery |
| GET | `/articles/{articleId}/revisions/{revisionId}/raw` | **no** | no | recovery |
| POST | `/articles/{articleId}/document/replace` | **no** | no | recovery |
| GET | `/categories` | yes | `listCategories` | **yes** |
| POST | `/categories` | yes | `createCategory` | **yes** |
| PATCH / DELETE | `/categories/{id}` | **no** | no | yes |
| GET | `/tags` | yes | `listTags` | **yes** |
| POST | `/tags` | yes | `createTag` | **yes** |
| PATCH / DELETE | `/tags/{id}` | **no** | no | yes |
| GET | `/authors` | **no** | `listAuthors` | **yes** |
| POST | `/authors` | yes | `createAuthor` | **yes** |
| PATCH / DELETE | `/authors/{id}` | **no** | no | yes |
| GET | `/entities` | **no** | `listEntities` | yes |
| POST | `/entities` | yes | `createEntity` | yes |
| PATCH / DELETE | `/entities/{id}` | **no** | no | yes |
| GET | `/sources` | **no** | `listSources` | yes |
| POST | `/sources` | yes | `createSource` | yes |
| PATCH / DELETE | `/sources/{id}` | **no** | no | yes |
| GET | `/redirects` | **no** | no | yes |
| POST | `/redirects` | yes | `createRedirect` | yes |
| DELETE | `/redirects/{redirectId}` | **no** | no | yes |
| GET | `/media` | yes | `listMedia` | **yes** |
| POST | `/media` | yes | `uploadMedia` | **yes** |
| GET | `/media/{mediaId}` | **no** | no | yes |
| GET | `/media/{mediaId}/file` | **no** | no | yes |
| PATCH | `/media/{mediaId}` | **no** | `updateMedia` | **yes** |
| DELETE | `/media/{mediaId}` | **no** | `deleteMedia` | yes |
| GET | `/stats` | **no** | no | no |
| GET | `/ops-status` | **no** | no | yes |
| GET | `/audit-log` | **no** | no | yes |
| GET | `/audit-log/{objectType}/{objectId}` | **no** | no | yes |

### Preview

| Method | Path | OAS | SDK | EXT |
|---|---|---|---|---|
| GET | `/v1/preview/{token}` | **no** | no | yes |

---

## 5. The gaps, grouped

### Implemented but absent from the authored OpenAPI — 49

| Group | Count | Notable |
|---|---|---|
| Health | 3 | `/health`, `/ready`, `/v1/ready` |
| Auth | 5 | including `GET /v1/auth/me` — the startup self-check |
| Admin | 11 | including **service-token listing and revocation** and all webhook read/update/delete |
| Articles | 6 | **`POST .../schedule`** — a whole workflow transition; plus revisions, preview and the three recovery routes |
| Taxonomy reads | 3 | `GET /entities`, `/authors`, `/sources` |
| Taxonomy writes | 10 | every `PATCH`/`DELETE` |
| SEO | 2 | `GET /redirects`, `DELETE /redirects/{id}` |
| Media | 4 | detail, file, update, delete |
| Observability | 4 | `stats`, `ops-status`, both audit-log routes |
| Preview | 1 | |

Highest impact: **`POST /articles/{id}/schedule`** (the SDK ships it, the document denies
it), and the entire webhook read/update/delete surface — whose schemas *are* registered but
whose paths are not.

### Implemented but absent from the SDK — 49

The SDK covers only `/v1/sites/{siteId}/…`, and only 27 of those 49 routes. Entirely
uncovered: all 4 health routes, all 6 auth routes, **all 16 admin routes**, preview, and 22
site-scoped routes (recovery, all taxonomy `PATCH`/`DELETE`, redirect read/delete, media
detail/file, stats, ops-status, both audit-log routes).

Notably the SDK **cannot mint or revoke the very service token it requires** — that is an
admin route.

### In OpenAPI but not the SDK — 7

`GET /v1/health`, `POST /v1/auth/login`, `POST /v1/admin/sites`, `POST /v1/admin/users`,
`POST /v1/admin/roles`, `POST /v1/admin/sites/{siteId}/service-tokens`,
`POST /v1/admin/sites/{siteId}/webhooks`.

### In the SDK but not OpenAPI — 7

`GET .../articles/{id}/revisions`, `POST .../articles/{id}/schedule`, `GET .../entities`,
`GET .../authors`, `GET .../sources`, `PATCH .../media/{id}`, `DELETE .../media/{id}`.

---

## 6. Documented details that only exist in OpenAPI

Two headers are declared, and only on some operations:

| Header | Declared on |
|---|---|
| `Idempotency-Key` (optional) | create article, the six documented transitions, upload media |
| `If-Match` (optional) | patch article |

`Idempotency-Key` is **not** declared on create category / tag / entity / author / source /
redirect — even though the site-scoped ones do honour it. Anyone generating a client from
the document would silently lose idempotency on those calls.

Query parameters are declared for `GET /media` (`q`, `limit`, `offset`) and
`POST /media` (`externalKey`), but **not** for `GET /articles` — the whole
`articleListQuerySchema` (status, type, authorId, categoryId, tagId, externalKey, q, cursor,
limit) is absent from the document although the route enforces it.

Three descriptions in the document capture real behaviour worth repeating:

- create article `200`: *"an article with this externalKey already existed and was returned
  unchanged. Note: an Idempotency-Key replay returns the STORED status, so a replayed
  create answers 201, not 200."*
- create article `409`: *"CONFLICT (slug) or IDEMPOTENCY_REPLAY (same key, different body)"*
- upload media `413`: *"over MEDIA_MAX_BYTES"*

---

## 7. What keeps the document honest

`apps/api/tests/pipeline-contract.test.ts` asserts that **every path declared in OpenAPI
resolves to a real route**. So the document can never describe something that does not
exist.

**There is no test in the other direction.** Adding a route without documenting it breaks
nothing, which is how the gap reached 49.

---

## 8. Guidance

| You want to | Do this |
|---|---|
| Write an external client | Follow [../integrations/EXTERNAL_CLIENT_API.md](../integrations/EXTERNAL_CLIENT_API.md) |
| Explore the API interactively | `ENABLE_DOCS=true`, open `/docs` — but treat the schemas as stubs |
| Generate typed models | Use `packages/contracts` (zod) as the source of truth, not the OpenAPI JSON |
| Check whether a route exists | This document's §4, or `apps/api/src/routes/` |

---

## Implementation references

- `packages/contracts/src/openapi.ts` — the registry, `buildOpenApiDocument()`
- `apps/api/src/app.ts` — swagger / swagger-ui registration and the `ENABLE_DOCS` gate
- `apps/api/tests/pipeline-contract.test.ts` — the one-way conformance test
- `apps/api/src/routes/health.ts`, `auth.ts`, `admin.ts`, `site.ts`, `preview.ts` — the 76 implemented operations
- `packages/sdk/src/client.ts` — the 27 SDK methods
