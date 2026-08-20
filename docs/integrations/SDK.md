# Kal El — TypeScript SDK

What `@kal-el/sdk` implements, what it does not, and what a non-TypeScript client should
copy from it.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

> **A Python client does not need this package.** It is TypeScript, it is `private` to the
> monorepo, and it is not published. Read it as the reference implementation of the client
> behaviours the API expects — key generation, retry policy, `If-Match` handling — and
> implement the same in your language. The contract is
> [EXTERNAL_CLIENT_API.md](EXTERNAL_CLIENT_API.md).

---

## 1. Shape

`packages/sdk/src/index.ts` is one line — `export * from "./client.js"` — so the whole
surface is `client.ts`.

| Export | Kind |
|---|---|
| `KalElClient` | class, 27 methods |
| `KalElError` | `Error` subclass with `status` and `code` |
| `KalElClientOptions` | type |
| `ArticleStatus` | re-export of the contract type |

### Construction

```ts
const client = new KalElClient({
  baseUrl: "https://api.example.com",   // trailing slashes stripped
  token: "ke_st....",                    // service token, Bearer
  retries: 2,                            // default
  fetchImpl: fetch,                      // injectable, for tests
  logger: (line) => console.log(line),   // default: no-op
});
```

**Service tokens only.** There is no cookie/session mode — the SDK cannot authenticate as a
person.

---

## 2. Methods

All 27 are under `/v1/sites/{siteId}/…`.

### Articles

| Method | Call |
|---|---|
| `getArticle(siteId, articleId)` | `GET /articles/{id}` |
| `listArticles(siteId, query?)` | `GET /articles?…` |
| `createArticle(siteId, body, idempotencyKey?)` | `POST /articles` |
| `updateArticle(siteId, articleId, body, ifMatch?, idempotencyKey?)` | `PATCH /articles/{id}` |
| `listRevisions(siteId, articleId)` | `GET /articles/{id}/revisions` |

### Workflow

`submitArticle`, `approveArticle`, `rejectArticle`, `publishArticle`, `unpublishArticle`,
`archiveArticle` — all `(siteId, articleId, note?, idempotencyKey?)`.

`scheduleArticle(siteId, articleId, scheduledAt, note?)` — **note the missing
`idempotencyKey` parameter**; it still generates one automatically.

### Taxonomy

`listCategories` / `createCategory`, `listTags` / `createTag`,
`listAuthors` / `createAuthor`, `listEntities(siteId, type?)` / `createEntity`,
`listSources` / `createSource`.

**No update or delete method exists for any taxonomy.**

### Media

| Method | Call |
|---|---|
| `listMedia(siteId, query?)` | `GET /media?…` |
| `uploadMedia(siteId, filename, data, mimeType, externalKey?)` | `POST /media` — multipart, field name **`file`**, 30 s timeout. **Bypasses `request()` entirely** — see §4 |
| `updateMedia(siteId, mediaId, body)` | `PATCH /media/{id}` |
| `deleteMedia(siteId, mediaId)` | `DELETE /media/{id}` |

### SEO

`createRedirect(siteId, body, idempotencyKey?)` — `POST /redirects`. No list, no delete.

---

## 3. Behaviours worth copying

The behaviours in this section describe `request()`, which every method except
`uploadMedia` goes through.

### Idempotency keys — per attempt, not per payload

```ts
function attemptKey(): string {
  return `sdk.${randomUUID().replace(/-/g, "")}`;
}
```

Generated **once per `request()` call** and reused across that call's retries.

> This was once a hash of `(method, path, body)`, which made every repetition of the same
> call collide for the server's full 24-hour window. Submit an article, have it rejected,
> fix it, submit again: identical key, identical request hash, so the server replayed the
> first response — no transition, no audit row, and the caller was handed a stale snapshot
> saying it had worked. **A key identifies one attempt at one operation, never the
> operation.**

A key is attached automatically to `POST` and `PUT` only. `PATCH` and `DELETE` do not
honour it server-side, so adding one there would be theatre — though an explicitly passed
key is still sent.

### Retry policy

| Property | Value |
|---|---|
| Attempts | `retries + 1` (default 3) |
| Retryable | network errors, `408`, `429`, `>= 500` |
| Only when | the request is safe (`GET`/`HEAD`) **or** carries a key |
| Backoff | fixed `200 ms`, `400 ms` — **no jitter**, `retry-after` **not honoured** |
| Timeout | 15 s per request; 30 s for uploads |

A stricter client should use full-jitter exponential backoff and honour `retry-after`. See
[EXTERNAL_CLIENT_API.md §18](EXTERNAL_CLIENT_API.md#18-retry-matrix).

### Defensive response parsing

```ts
const text = await res.text();
let json;
try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
```

> A proxy answering `502` or `413` with HTML used to throw `SyntaxError` here **before
> `res.status` was read** — so the one thing an integrator switches on never materialised,
> and the parse error was retried as if transient. Read the status first; parse
> defensively. Copy this.

### Error surface

```ts
throw new KalElError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
```

`code` is the branch point. Note the SDK **discards `error.details`**, so
`currentVersion`, `expectedVersion`, `issues`, `constraint` and `requestId` are not
available to its callers. A serious client should keep them.

### `If-Match`

Passed through verbatim as a string; the API parses it as a bare integer. A quoted ETag is
a `400`.

---

## 4. Gaps

### Not covered at all — 49 of 76 operations

| Surface | Count | Consequence |
|---|---|---|
| `/v1/admin/*` | 16 | **the SDK cannot mint or revoke the service token it requires**, create sites/users/roles, or manage webhooks |
| `/v1/auth/*`, `/v1/me/sites` | 6 | no self-check, no human login |
| health / ready | 4 | no readiness helper |
| `/v1/preview/{token}` | 1 | |
| Site-scoped remainder | 22 | all taxonomy `PATCH`/`DELETE`, document recovery, article preview, redirect read/delete, media detail/file, `stats`, `ops-status`, both audit-log routes |

### Behavioural gaps

| Gap | Impact |
|---|---|
| **`request()` returns `json.data` and discards the status** | `createArticle` cannot tell `201` (created) from `200` (an article with this `externalKey` already existed). A synchronising client written on the SDK cannot distinguish create from no-op. |
| **`error.details` is dropped** | no `currentVersion` on a `VERSION_CONFLICT`, no `issues` on a validation error, no `requestId` for support |
| **No `retry-after` handling** | a `429` is retried on the fixed schedule |
| **No jitter** | concurrent clients retry in lockstep |
| **`scheduleArticle` takes no `idempotencyKey`** | a caller cannot supply a stable key for that transition |
| **`uploadMedia` bypasses `request()`** | it calls `fetchImpl` directly: **no `Idempotency-Key`**, **no retries** (exactly one attempt regardless of `retries`), and an **unguarded `JSON.parse`** — an HTML `413`/`502` from a proxy throws `SyntaxError` before the status is read, the very failure the rest of the client fixed. Only the 30 s timeout applies. The server *does* honour a key on `POST /media`; the SDK simply never sends one. |
| **`ArticleStatus` re-export** | exported in value position from a type-only import; with `isolatedModules` this is the TS1205 pattern and should be `export type` |

---

## 5. Using it inside the monorepo

`packages/importer` is the only consumer in the tree — though nothing imports the importer
itself, so the chain ends there. It calls `POST /articles`,
`POST /media?externalKey=…` and the taxonomy creates through `KalElClient`, which is why
the importer's own guarantees are exactly the API's.

```ts
import { KalElClient } from "@kal-el/sdk";

const client = new KalElClient({ baseUrl: process.env.KALEL_API!, token: process.env.KALEL_TOKEN! });
const article = await client.createArticle(siteId, {
  title: "A headline",
  externalKey: "my-system:article:123",
  document: { version: 2, nodes: [] },
});
```

Add `"@kal-el/sdk": "workspace:*"` to the consuming package. It is `private` and not
published to any registry.

---

## 6. Should a new client use it?

| Situation | Answer |
|---|---|
| TypeScript, inside this monorepo | yes |
| TypeScript, outside | possible but unpublished — vendor it, and re-add status access |
| **Python** | **no.** Follow [EXTERNAL_CLIENT_API.md](EXTERNAL_CLIENT_API.md) and [PYTHON_CLIENT_EXAMPLE.md](PYTHON_CLIENT_EXAMPLE.md) |
| Any language, needing admin routes | no — write direct HTTP |
| Any language, needing created-vs-existing | no — you need the status code |

---

## Implementation references

- `packages/sdk/src/client.ts` — the whole implementation
- `packages/sdk/src/index.ts` — the barrel
- `packages/importer/src/import.ts` — the only in-repo consumer
- `packages/contracts/src/editorial.ts` — the types its signatures use
- [OPENAPI-COVERAGE.md](../api/OPENAPI-COVERAGE.md) — the route-by-route coverage table
