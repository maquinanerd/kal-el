# Kal El — Known Issues

Gaps, divergences and sharp edges found while documenting the code. **Recorded, not
fixed** — this pass changed no product behaviour.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

Everything below was verified against the implementation at that commit. Items are grouped
by who they hurt.

---

## 1. Contract divergences an external client will hit

### 1.1 `requestId` is not where the contract says it is

`ApiErrorBody` and `apiErrorSchema` declare `requestId` as a sibling of `code` and
`message`. The serialiser calls `errorBody(code, message, { ...details, requestId })`, and
`errorBody` puts its third argument under `details`.

**On the wire the value is always at `error.details.requestId`, and `error.requestId` is
never emitted.** A client generated from the declared type will never find the correlation
id.

*Where:* `packages/contracts/src/errors.ts`, `apps/api/src/plugins/errors.ts`.

### 1.2 Two of the three subscribable webhook events are never emitted

`webhookEventSchema` accepts `article.published`, `article.scheduled` and
`article.updated`. Only `article.published` is ever inserted into the outbox — from
`createArticle`, `publishArticle` and the worker's `promoteOne`. `scheduleArticle` and
`updateArticle` insert nothing.

A subscriber can register for `article.scheduled` or `article.updated` through the API and
the CMS picker, and will receive nothing, forever, with no warning.

*Where:* `packages/contracts/src/webhooks.ts` vs `apps/api/src/services/articles.ts`,
`apps/worker/src/scheduler.ts`.

### 1.3 The webhook payload carries no site id

The delivery body is the raw outbox `payload` — `{articleId, slug, publishedAt, version}` —
with no envelope. The event type is in a header; **the site is nowhere in the delivery**. A
consumer serving several sites must register a different URL per site to tell them apart.

There is also **no timestamp header and no timestamped signature base**, so the signature
alone provides no replay protection.

*Where:* `apps/worker/src/dispatcher.ts`, `packages/events/src/index.ts`.

### 1.4 `sources` is a taxonomy that links to nothing

`sources` has full CRUD, a table and a scope — and **no `article_sources` table, no
`sources` field on the article body, and no `sources` array in the article response**.

The `source` **document node** (`{label, url, kind}`) is free text and carries no reference
to a `sources` row. The two share a name and nothing else.

*Where:* `packages/db/src/schema/editorial.ts`, `packages/contracts/src/editorial.ts`.

### 1.5 Media dedup does not signal reuse

An article created with an existing `externalKey` returns **`200`**; a new one returns
`201`. Media does not follow that convention: a repeat upload under a known `externalKey`
returns the existing row **with `201`**, exactly like a fresh store. A client cannot tell
whether bytes were stored.

There is also **no lookup-by-`externalKey` endpoint for media** — the article list has
`?externalKey=`, media has no equivalent. The only way to ask "do I already have this?" is
to re-`POST` the bytes.

*Where:* `apps/api/src/services/media.ts`, `apps/api/src/routes/site.ts`.

### 1.6 `total` is declared on the article page and never sent

`pageOf()` declares an optional `total`, and `listArticles` explicitly returns
`total: undefined` — so the key is absent from the JSON. Media's list **does** return a real
`total`. Two list endpoints, two shapes.

*Where:* `packages/contracts/src/common.ts`, `apps/api/src/services/articles.ts`.

### 1.7 `Idempotency-Key` is silently ignored on many routes

`PATCH /articles/{id}`, every taxonomy `PATCH`/`DELETE`, `POST`/`DELETE /redirects`,
`PATCH`/`DELETE /media/{id}` and **every `/v1/admin/*` route** accept the header and do
nothing with it. No error, no warning, no protection.

`POST /redirects` in particular has no unique-constraint fallback other than
`(siteId, sourcePath)`, so a retried create is a `409` rather than a replay.

*Where:* `apps/api/src/routes/site.ts`, `apps/api/src/routes/admin.ts`.

### 1.8 Two permissions are declared and checked nowhere

`articles.delete` and `system.manage` are valid scopes — `createServiceToken` accepts them
— and no route consults either. Article removal is done through `archive`.

*Where:* `apps/api/src/auth-context.ts`.

### 1.9 `UNSUPPORTED_MEDIA_TYPE` is declared but effectively unreachable

It is only produced by the status-code fallback for an upstream Fastify `415`. A rejected
image format — the obvious cause — is reported as `VALIDATION_ERROR`/`400`.

*Where:* `packages/contracts/src/errors.ts`, `apps/api/src/plugins/errors.ts`.

### 1.10 Reading a taxonomy requires the write scope

There is no `taxonomy.*.read`. A client that only resolves category ids must hold
`taxonomy.categories.manage`. This is the single most common surprise for a new
integration.

### 1.11 `entities` and `sources` have no unique constraint

Every other taxonomy is unique on `(siteId, slug)`. These two are not, so a retried create
without an `Idempotency-Key` inserts a duplicate — and `entities.externalRefs` is not
indexed, not unique and not filterable, so it cannot be used to find one either.

---

## 2. OpenAPI and SDK

### 2.1 The authored OpenAPI covers 27 of 76 operations

Missing: `POST .../articles/{id}/schedule` (a whole workflow transition the SDK ships), all
three document-recovery routes, the article revisions list, article preview, every taxonomy
`PATCH`/`DELETE`, three taxonomy `GET`s, media detail/file/update/delete, redirect
read/delete, `stats`, `ops-status`, both audit-log routes, 11 admin routes, 5 auth routes,
3 health routes, and the preview endpoint — 49 in all.

`Idempotency-Key` is declared on only 8 of the 15 routes that honour it, and
`GET /articles` has **no query parameters declared** even though the route enforces nine.

### 2.2 The served document is not the authored document

`@fastify/swagger` runs in dynamic mode and overwrites any authored operation whose
path+method is also a live route. Kal El's routes declare no Fastify `schema`, so
`/docs/json` lists **all 76 operations with stub schemas** while the authored document has
27 accurate ones. Neither form is usable for client generation.

### 2.3 Conformance is enforced in one direction only

`apps/api/tests/pipeline-contract.test.ts` asserts every OpenAPI path resolves to a real
route. **Nothing asserts the reverse**, so adding a route without documenting it breaks no
test — which is how the gap reached 49.

### 2.4 The SDK discards the HTTP status and `error.details`

`KalElClient.request()` returns `json.data`. So `createArticle` cannot distinguish `201`
(created) from `200` (already existed), and a `VERSION_CONFLICT` reaches the caller without
`currentVersion`, `expectedVersion` or `requestId`.

### 2.5 The SDK covers no admin route

All 16 are absent, including service-token minting and revocation — **the SDK cannot create
the credential it requires**. It also has no method for any taxonomy `PATCH`/`DELETE`, no
health check, and no auth/session support.

### 2.6 SDK retry policy is weaker than the retry matrix

Fixed 200 ms / 400 ms backoff, no jitter, `retry-after` ignored, two retries.

### 2.7 `ArticleStatus` re-export

`packages/sdk/src/client.ts` re-exports a type-only import in value position. With
`isolatedModules` this is the TS1205 pattern; it should be `export type`.

---

## 3. Operational

### 3.1 `.env` is not loaded by the API, worker or scripts

No `dotenv` dependency, no `import "dotenv/config"`, no `node --env-file`. A root `.env`
file exists, is gitignored, and **is read by nothing** in the API/worker/scripts source.

Running `pnpm start:api` in a shell that has not exported the variables silently uses the
schema defaults — including `DATABASE_URL=postgresql://kalel:kalel@localhost:5432/kalel`
and `SESSION_SECRET=development-only-secret`. In development that is a confusing
"connected to the wrong database"; in production the guards catch it.

The CMS is different: Next.js loads `.env` itself, but `NEXT_PUBLIC_API_BASE_URL` is inlined
at **build** time, so a runtime `.env` cannot change it in a built image.

*Where:* `apps/api/src/config.ts`, `apps/worker/src/config.ts`, `scripts/*`.

### 3.2 API and worker disagree on shared variables

| Variable | API | Worker |
|---|---|---|
| `LOG_LEVEL` | enum includes `fatal`, `trace` | **narrower** — `silent`/`error`/`warn`/`info`/`debug` only |
| `SHUTDOWN_GRACE_MS` | default 15000, read with a bare `Number()`, **unvalidated** (a non-numeric value yields `NaN`) | default 20000, zod-validated |
| `ALLOW_PRIVATE_WEBHOOKS` | accepts `true`, `"true"`, `"1"` | **only the literal `"true"`** |
| `NODE_ENV` | a strict enum | a plain string — any value parses |

A shared environment with `LOG_LEVEL=trace` boots the API and **crashes the worker**.

### 3.3 `RUN_MIGRATIONS` is a strict literal comparison

`process.env.RUN_MIGRATIONS === "true"`. `"1"` and `"TRUE"` silently skip migrations.

### 3.4 `ENABLE_DOCS` is not the only gate on `/docs`

The condition is `ENABLE_DOCS || NODE_ENV !== "production"`, so Swagger UI is **on by
default in development, test and any unset `NODE_ENV`** regardless of the flag.

### 3.5 Five environment variables are absent from `.env.example`

`MIGRATIONS_FOLDER` (set to `/app/drizzle` in production compose), **`KALEL_OWNER_PASSWORD`**
(required by `pnpm bootstrap`, and a secret), **`NEXT_OUTPUT`** (`standalone` in the CMS
Dockerfile), `KALEL_DEV_DB_PORT`, `KALEL_DEV_DB_DIR`.

### 3.6 Only one media storage provider exists

`MEDIA_STORAGE_PROVIDER` is an enum whose only accepted value is `local`. The
`StorageProvider` interface exists for an S3/R2 backend; **no such implementation is
written**. Consequences: a multi-replica API needs a shared volume, and media is served
through the API rather than a CDN.

### 3.7 Deleting a media row does not delete the file

`deleteMedia` removes the row and writes an audit entry. The stored object stays on disk
forever. There is no garbage collector and no orphan report.

### 3.8 Nothing prunes the audit log

`audit_log` grows without bound. There is no retention policy, no rotation and no pruning
task; `idempotency_keys` **is** collected (the worker purges expired rows every tick), but
the audit table is not.

### 3.9 No down-migration runner

Reverse SQL exists only as fixtures inside `packages/db/tests/migration.test.ts`. A
destructive schema change needs its reverse written and tested before it ships.

### 3.10 Backup gaps

- **No schedule.** `pnpm backup` exists; no cron, container or worker task runs it.
- **No media.** The `media` table is captured; the files under `MEDIA_LOCAL_PATH` are not.
- **No schema.** Logical data only — restore requires a migrated database.
- **No encryption.** The file contains password hashes, session token hashes and
  service-token hashes.
- **Restore truncates every table**, including ones the snapshot never mentions.
- No incremental, no PITR, no compression, no `pg_dump` compatibility.

### 3.11 The worker has no healthcheck

No HTTP surface, and no `healthcheck` in production compose. Liveness is observable only
through `worker_heartbeats`, surfaced by `GET /ops-status` — which itself requires
`audit.read` and a site id.

### 3.12 No metrics or tracing

Structured logs only. No Prometheus endpoint, no OpenTelemetry, no request histogram.

---

## 4. Behaviour worth knowing before it surprises you

### 4.1 Webhook delivery gives up after ~15 seconds

Five attempts with backoff 1 s, 2 s, 4 s, 8 s and no jitter. A subscriber down for more
than about twenty seconds **loses the event permanently**: dead-lettering is final, there
is no replay endpoint and no re-delivery API.

A `4xx` is retried on exactly the same ladder as a `5xx` — there is no permanent-failure
fast path — and an SSRF refusal **consumes an attempt** although no request was made.

### 4.2 `sites.status` is not enforced

`inactive` is a marker. No route consults it; an inactive site still accepts writes.

### 4.3 There is no delete-site endpoint

Removing a site means direct SQL, and the cascades destroy all of its content, media rows,
tokens and webhooks. Audit rows survive with `site_id = NULL`.

### 4.4 Redirect writes leave no audit trail, and a taxonomy delete does not record what it detached

Redirect creation and deletion write **no audit row** at all (`services/redirects.ts` never
calls `writeAudit`).

Taxonomy create, update **and** delete are all audited (`categories.update`,
`tags.delete`, …, with `details.changedFields` on updates). What is not recorded is *which
articles* a deletion detached — and deleting a tag or category silently removes it from
every article that used it, with no confirmation step and no usage-count endpoint.

### 4.5 The audit log is not queryable

Fixed caps of 200 and 100 rows; no pagination, no filtering by actor, action or date. `ip`
and `request_id` are stored but **not returned**. Rows with `site_id = NULL` (user creation,
role creation) are unreachable over HTTP. No retention or pruning.

### 4.6 `document` is nullable jsonb with no shape constraint

A restore, a hand-run statement or a partial migration can leave a value that is not a valid
article document. Readers degrade it to an empty document and flag `document_unreadable`;
publishing is refused; repair goes through the `articles.recover` routes.

An ordinary `PATCH` carrying a document does file the unreadable raw bytes as a preserved
revision first, so they are not lost — but the live column is still replaced by the
client's payload. **A client should check `qualityFlags` and route repair through
`articles.recover` rather than overwriting blindly.**

### 4.7 Two columns are unreachable through the API

`categories.position` (ordering) and `authors.avatarMediaId` are stored and never writable
through any endpoint.

### 4.8 Slug-change redirects assume a flat URL space

`upsertSlugRedirect` writes `/{oldSlug}` → `/{newSlug}`. If your public URLs carry a date or
section segment, those rows will not match them. Nothing prunes redirects or detects chains.

### 4.9 A request to an unmatched route bypasses the error contract

The app installs no `setNotFoundHandler`, and Fastify's built-in 404 does not run through
`setErrorHandler`. A request to a path with no matching route returns

```json
{ "statusCode": 404, "error": "Not Found", "message": "Route POST:/v1/foo not found" }
```

where **`error` is a string**, with no `code` and no `details`. Every other refusal in the
system is `{"error": {"code", "message", "details"}}`. A client that reads
`error.code` without a type check crashes on a typo in a URL rather than reporting a 404.

### 4.10 `linkHrefSchema` accepts protocol-relative URLs

The check is `^https?://` **or** `startsWith("/")`. `mailto:`, `tel:` and `javascript:` are
rejected — but `//evil.com/x` starts with `/` and passes, so a document can carry a link
that looks internal to the schema and resolves off-origin in a browser. A renderer must
check for a leading `//` itself.

### 4.11 Enum columns are not constrained in the database

Every "enum" is a plain `text` column. There is no PostgreSQL enum type and **no `CHECK`
constraint anywhere in the schema or the migrations** — the value set exists only in
drizzle's TypeScript `enum` option and in the zod contracts. Anything writing to the
database outside the API can store an arbitrary `status`, `type` or `kind`.

### 4.12 The same refusal carries two different codes

A service token aimed at the wrong site gets `403 SITE_SCOPE_MISMATCH` on
`/v1/sites/{siteId}/…` and `403 FORBIDDEN` on `/v1/admin/sites/{siteId}/…` — same message
("token is not scoped to this site"), different machine-readable code. A client branching
on `code`, as the error documentation instructs, has to handle both.

### 4.13 `attrs` is required on `list` and `table`, optional on `paragraph` and `quote`

`paragraph` and `quote` declare `attrs` with `.default({})`, so it may be omitted. `list`
and `table` declare a typed `attrs` object **without** a default — only its inner keys have
one — so omitting `attrs` entirely is a `400`. The asymmetry is invisible from the field
tables and catches every hand-written document.

### 4.14 Three creates store an idempotency status they never use

`POST /categories`, `POST /tags` and `POST /authors` go through `respondIdempotentValue`,
which hard-codes `status: 200` into the stored record, while the routes themselves always
answer `201`. The stored status is dead data for those three.

### 4.15 The media `externalKey` length is documented but not enforced

`mediaSchema.externalKey` caps it at 200 characters, but that schema only describes the
response. The upload route reads the value straight from the query string with no
validation and the column is untyped `text`, so a longer key is accepted and stored.

### 4.16 Duplicate relation ids are not de-duplicated on write

`assertRelationsInSite` de-duplicates for its existence check, but `replaceRelations`
inserts the array as given. A repeated id in `authors`, `categories`, `tags` or `entities`
violates the relation table's composite primary key and surfaces as
`409 CONFLICT` / "a resource with this identifier already exists".

### 4.17 `SESSION_SECRET` does not sign sessions, and rotating it logs nobody out

The name says otherwise, and so does most operational intuition. Its **only** two runtime
uses are `createPreviewToken` and `verifyPreviewToken`. Session and CSRF tokens are random
opaque values stored as **unkeyed** SHA-256 hashes, and `@fastify/cookie` is registered
without a secret, so cookies are unsigned too.

**Rotating `SESSION_SECRET` after a compromise invalidates outstanding preview tokens and
nothing else.** Every stolen session cookie keeps working. To actually revoke sessions,
delete rows from `sessions` (or call `POST /v1/auth/logout-all` per user).

The production guards on it (not-the-default, ≥32 chars) are still right — it is the
preview HMAC key, and a preview URL is handed to external reviewers by design.

*Where:* `apps/api/src/config.ts`, `apps/api/src/services/preview.ts`,
`packages/auth/src/keys.ts`, `apps/api/src/app.ts`.

### 4.18 `TRUST_PROXY=""` bypasses its own production guard

The guard is `if (config.TRUST_PROXY === "false")`. An empty string is a valid value, so
zod's `.default("false")` never applies, the guard does not fire, and the API boots in
production — while `trustProxySetting` maps `""` to `false` anyway. Setting the variable to
nothing therefore produces exactly the unsafe state the guard exists to prevent: every
caller shares the proxy's rate-limit bucket.

*Where:* `apps/api/src/config.ts`.

### 4.19 Five platform audit actions are written after the change commits

`bootstrap.init`, `sites.create`, `sites.update`, `users.create`, `roles.create` and
`roles.assign` are written inside the same transaction as the change. But `tokens.create`,
`tokens.revoke`, `webhooks.create`, `webhooks.update` and `webhooks.delete` call
`writeAudit(app.db, …)` on the pool **after** the change has committed. A failing audit
insert there leaves a minted or revoked service token — or a created, updated or deleted
webhook — with no record that it happened.

*Where:* `apps/api/src/routes/admin.ts`.

### 4.20 Roles cannot be site-scoped, though the column allows it

`roles.site_id` is nullable and exists to support per-site roles, but no code path ever
sets it: `createRoleBodySchema` is `.strict()` with no `siteId`, and every `insert(roles)`
in the tree omits it. Every role in the system is global; scoping happens only through the
per-site assignment in `user_roles`.

*Where:* `packages/contracts/src/identity.ts`, `apps/api/src/services/roles.ts`.

### 4.21 Media ids are a cross-tenant existence oracle

`assertRelationsInSite` deliberately returns one message whether a referenced author,
category, tag or entity is missing or belongs to another site — so it cannot be used to
probe another tenant. `assertMediaInSite` does not follow that rule: it looks the row up
**without a site filter** and answers `referenced media does not exist` for an unknown id
and `referenced media does not belong to this site` for a foreign one. The difference
confirms the existence of another site's media id.

*Where:* `apps/api/src/services/media.ts` vs `apps/api/src/services/articles.ts`.

### 4.22 The SDK's `uploadMedia` bypasses its own client

It calls `fetchImpl` directly rather than going through `request()`, so it sends **no
`Idempotency-Key`** (the server honours one there), performs **no retries** regardless of
the `retries` option, and parses the response with an **unguarded `JSON.parse`** — an HTML
`413` or `502` from a proxy throws `SyntaxError` before the status is read, which is the
exact failure the rest of the client was fixed to avoid.

*Where:* `packages/sdk/src/client.ts`.

---

## 5. Code hygiene noticed in passing

- **`packages/importer` has no consumer.** No file under `apps/` or `packages/` imports
  `@kal-el/importer`; outside its own `package.json` the name appears only in
  `docs/progress/` as a `pnpm --filter` command line. It is a library with no caller outside
  its own tests.
- **`packages/importer/src/lexical.ts` is not re-exported** from the package entry point —
  reachable only by deep import.
- **The importer drops category hierarchy**: `parentExternalId` is used only to sort, and
  `createCategory` is called with `{name, slug}` only, although the API accepts `parentId`.
- **`NormalizedArticle.dek` is never sent** to `createArticle` or `updateArticle`.
- **`ImportBatch.users` is never read** by `importBatch`.
- **`packages/testkit/dev-db.mjs` has a stale docstring** — it says `node scripts/dev-db.mjs`.
- **`apps/api/tests/media.test.ts` contains a duplicated `it.each` block** (lines 256–299 and
  301–344 are verbatim identical).
- **`@kal-el/cms` has no `test` script** (only `test:e2e`); `@kal-el/events` and
  `@kal-el/testkit` have none at all.

---

## 6. Documentation superseded by this pass

`docs/integrations/PIPELINE_API.md` (pt-BR) covers the same ground as
[integrations/EXTERNAL_CLIENT_API.md](integrations/EXTERNAL_CLIENT_API.md). It was
reconciled against the code and remains broadly accurate; where it and the new document
differ, the new one was re-derived from the implementation at this commit. Its own
"Divergências conhecidas" section is the ancestor of this file. Both were left in place —
removing it is a decision for the maintainers.

Its route count ("16 of 59 routes") differs from the count here (**27 of 76 operations**)
because it counted paths rather than method+path operations and predates several routes.

---

## 7. Not documented in this pass

By instruction, and to be documented separately: the MN26 and MNSCR architectures, RSS
ingestion, scraping, the AI writing pipeline, and the editorial validation pipeline. This
pass documents the **Kal El external contract** only.
