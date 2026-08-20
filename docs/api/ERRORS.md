# Kal El — Error Model

Every machine-readable error the API can return, when it fires, and what a client should
do about it.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The error envelope

Every refusal that reaches a route — validation, auth, conflict, rate limit, crash — is
serialised by one handler (`registerErrorHandler` in `apps/api/src/plugins/errors.ts`)
into one shape:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "version mismatch: the article was modified by another actor",
    "details": {
      "expectedVersion": 5,
      "currentVersion": 7,
      "requestId": "9f2c4a1e7b8d0c3f5a6e2b1d4c8f0a37"
    }
  }
}
```

| Field | Type | Always present | Notes |
|---|---|---|---|
| `error.code` | string | yes | the machine-readable value — **branch on this, never on `message`** |
| `error.message` | string | yes | human-readable English; wording is not part of the contract |
| `error.details` | object | in practice yes | free-form; `requestId` is always inside it |
| `error.requestId` | string | **no — never emitted** | declared in the contract type but not produced |

> ### The correlation id lives in `details`
>
> `ApiErrorBody` and `apiErrorSchema` both declare `requestId` as a sibling of `code` and
> `message`. The serialiser calls `errorBody(code, message, { ...details, requestId })`,
> and `errorBody` places its third argument under `details`. So on the wire the value is
> at **`error.details.requestId`**, and `error.requestId` is always absent.
>
> A client should read `error.details.requestId` (falling back to `error.requestId` costs
> nothing). Quote it in any bug report — it is also on the API's own log line for the
> request. Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

There is no `success: false`, no top-level `status`, and no array of errors.

> ### One exception: an unmatched route
>
> The app installs **no** `setNotFoundHandler`, and Fastify's built-in 404 handler does not
> run through `setErrorHandler`. A request to a path with no matching route therefore gets
> Fastify's own body:
>
> ```json
> { "statusCode": 404, "error": "Not Found", "message": "Route POST:/v1/foo not found" }
> ```
>
> Here **`error` is a string**, there is no `error.code` and no `details`. A client that
> does `response.json()["error"]["code"]` crashes on this shape instead of reporting a 404.
> Always check that `error` is an object before reading `code` — the snippet in
> [§7](#7-error-handling-for-a-client) does.

---

## 2. Complete code table

The full set is `API_ERROR_CODES` in `packages/contracts/src/errors.ts`. Nothing outside
this table is ever emitted as a `code`.

| HTTP | Code | Meaning | Retryable? | Client action |
|---|---|---|---|---|
| 400 | `VALIDATION_ERROR` | body/query/header failed validation, an unknown field was sent, a referenced id is not in this site, malformed `If-Match` or `Idempotency-Key`, unsupported or mismatched image bytes, invalid cursor | **No** | Fix the request. Inspect `details.issues` or `details.validation`. |
| 401 | `UNAUTHENTICATED` | no credential, unknown token, expired service token, expired/idle/absolute-timed-out session, invalid or expired preview token | **No** | Re-check the credential. Do not loop. |
| 403 | `FORBIDDEN` | missing permission/scope, revoked service token, disabled account, CSRF failure (sessions), ownership refusal, role-escalation refusal, bootstrap refusal, and a service token aimed at the wrong site on an `/v1/admin/*` route | **No** | Human action: grant the scope or fix the credential. |
| 403 | `SITE_SCOPE_MISMATCH` | the credential does not reach this `siteId` | **No** | Configuration error — wrong site or wrong token. |
| 404 | `NOT_FOUND` | the resource does not exist **in this site** | **No** | Wrong id, or it belongs to another tenant. |
| 409 | `CONFLICT` | a genuine state clash — see [§4](#4-every-409-conflict-in-the-system) | **Not blindly** | Resolve the clash, then send a *different* request. |
| 409 | `VERSION_CONFLICT` | `If-Match` did not match, or a guarded transition lost its race | **Not blindly** | Re-`GET`, re-apply, retry with the new version. |
| 409 | `IDEMPOTENCY_REPLAY` | the same `Idempotency-Key` arrived with a **different** request | **No** | Client bug — use a new key. |
| 409 | `INVALID_TRANSITION` | the workflow transition is illegal from the current status | **No** | Read `details.from`/`details.to`, re-`GET`, decide. |
| 413 | `PAYLOAD_TOO_LARGE` | body over 5 MiB, or upload over `MEDIA_MAX_BYTES` | **No** | Send less. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | mapped from an upstream Fastify 415 | **No** | Fix `Content-Type`. **Not** used for a rejected image format — that is a 400. |
| 429 | `RATE_LIMITED` | the rate limiter refused | **Yes** | Back off; honour `retry-after` when present. |
| 500 | `INTERNAL_ERROR` | anything unhandled | **Yes** | Retry with backoff. Report `details.requestId`. |

---

## 3. How each code is produced

### Zod validation — `400 VALIDATION_ERROR`

Route handlers parse with `safeParse` and throw `badRequest("validation failed", { issues: error.issues })`.
`details.issues` is the raw **zod issue array**:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "validation failed",
  "details": { "issues": [
      { "code": "unrecognized_keys", "keys": ["status"], "path": [], "message": "Unrecognized key(s) in object: 'status'" },
      { "code": "too_small", "minimum": 1, "path": ["title"], "message": "String must contain at least 1 character(s)" }
  ], "requestId": "..." } } }
```

`issues[].path` is the field path as an array. Because both article body schemas are
`.strict()`, sending an unknown field produces `unrecognized_keys` — this is the single
most common first-run failure for a new client.

The handler also has a branch for a validation failure raised by **Fastify itself**, which
returns `message: "request validation failed"` with `details.validation` instead of
`details.issues`. No route currently declares a Fastify `schema`, so this shape is **not
emitted today** — defensive clients may still handle it.

Handlers also raise targeted 400s with a `field` marker instead of `issues`:

| Situation | `details` |
|---|---|
| `status:"scheduled"` without `scheduledAt` | `{ "field": "scheduledAt" }` |
| unknown scope on token creation | `{ "field": "scopes" }` |
| referenced author/category/tag/entity not in this site | `{ "authorId": "<id>" }` etc. |
| referenced media missing or in another site | `{ "mediaId": "<id>" }` |
| primary category not in this site | `{ "categoryId": "<id>" }` |
| image bytes do not match the declared type | `{ "declared": "image/png", "detected": "image/jpeg" }` |
| image bytes are not a supported image | `{ "declared": "image/png" }` |

### PostgreSQL errors, mapped

The handler unwraps Drizzle's `DrizzleQueryError` to the underlying `pg` error and maps it:

| pg code | Meaning | Becomes | `details` |
|---|---|---|---|
| `23505` | unique violation | `409 CONFLICT` — "a resource with this identifier already exists" | `{ "constraint": "<index name>" }` |
| `23503` | foreign key violation | `400 VALIDATION_ERROR` — "referenced resource does not exist" | `{ "constraint": "..." }` |
| `23502` | not-null violation | `400 VALIDATION_ERROR` — "a required field is missing" | `{ "constraint": "..." }` |

`details.constraint` names the index, which tells a client exactly what clashed — e.g.
`articles_site_slug_unique`, `articles_site_external_key_unique`,
`categories_site_slug_unique`, `media_site_external_key_unique`.

### Status-code fallbacks

Anything that reaches the handler with a `statusCode` but no `ApiHttpError` is re-shaped:

| Incoming | Emitted code |
|---|---|
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` |
| any other 4xx | `VALIDATION_ERROR` |
| anything else | `INTERNAL_ERROR` (logged as `unhandled error`) |

Malformed JSON, which Fastify reports as a bare 400, therefore arrives as
`VALIDATION_ERROR`; the rate limiter's own 429 arrives as `RATE_LIMITED`.

---

## 4. Every `409 CONFLICT` in the system

`CONFLICT` is the generic 409 — the three specific 409s have their own codes. These are
all the places it is raised:

| Message | Where | `details` |
|---|---|---|
| `the stored document cannot be read; fix the article body before publishing` | publish | `{ articleId, field: "document" }` |
| `scheduledAt must be in the future` | schedule | — |
| `media is in use` | media delete | — |
| `source path "<p>" already has a redirect` | redirect create | `{ field: "sourcePath" }` |
| `category slug "<s>" already exists` | category create | `{ field: "slug" }` |
| `tag slug "<s>" already exists` | tag create | `{ field: "slug" }` |
| `author slug "<s>" already exists` | author create **or update** | `{ field: "slug" }` |
| `author already exists` | author update whose body omits `slug` | `{ field: "slug" }` |
| `this account already has an author byline on this site` | author create/update with `userId` | `{ field: "userId" }` |
| `category is the primary category of at least one article` | category delete | `{ field: "primaryCategoryId" }` |
| `role key "<k>" already exists` | role create | `{ field: "key" }` |
| `site slug "<s>" already exists` | site create | `{ field: "slug" }` |
| `email "<e>" is already registered` | user create | `{ field: "email" }` |
| `a resource with this identifier already exists` | any unique-index violation not caught above | `{ constraint }` |
| `idempotency state unavailable` | idempotency plugin, defensive | — |

---

## 5. The three specific 409s

### `VERSION_CONFLICT`

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "version mismatch: the article was modified by another actor",
  "details": { "expectedVersion": 5, "currentVersion": 7, "requestId": "..." } } }
```

Two producers:

1. **`If-Match` mismatch** on `PATCH /articles/{id}` or `POST .../document/replace` —
   checked before any write; `details` carries `currentVersion` and `expectedVersion`.
2. **A guarded `UPDATE` that matched no row**, i.e. another actor committed between the
   read and the write. On `PATCH /articles/{id}` and every workflow transition the code
   re-reads, so `details` additionally carries `currentStatus`:

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "article changed concurrently",
  "details": { "expectedVersion": 5, "currentVersion": 6, "currentStatus": "published", "requestId": "..." } } }
```

> **`POST .../document/replace` is the exception.** Its lost-race path raises the same code
> and message but does **not** re-read, so `details` carries `expectedVersion` alone — no
> `currentVersion`, no `currentStatus`. Never assume `details.currentVersion` is present on
> every `VERSION_CONFLICT`; re-`GET` the article instead.

See [CONCURRENCY.md](CONCURRENCY.md).

### `IDEMPOTENCY_REPLAY`

```json
{ "error": { "code": "IDEMPOTENCY_REPLAY", "message": "idempotency key reused with a different request",
  "details": { "requestId": "..." } } }
```

The stored request hash for `(key, actor@site)` does not match this request's hash.
**A successful replay is not an error** — an identical retry returns the stored response
with its original status. See [IDEMPOTENCY.md](IDEMPOTENCY.md).

### `INVALID_TRANSITION`

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "cannot transition article from \"archived\" to \"published\"",
  "details": { "from": "archived", "to": "published", "requestId": "..." } } }
```

`approve` from an unapprovable state adds the permitted set:

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "cannot approve an article in \"draft\"",
  "details": { "from": "draft", "to": "draft", "expected": ["in_review", "blocked"], "requestId": "..." } } }
```

See [../editor/WORKFLOW.md](../editor/WORKFLOW.md).

---

## 6. Authentication and authorisation messages

Codes are stable; the messages below are the current wording and are useful for diagnosis,
not for branching.

| Code | HTTP | Message | Cause |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | `unauthenticated` | no usable credential |
| `UNAUTHENTICATED` | 401 | `invalid service token` | no `service_tokens` row for this hash |
| `UNAUTHENTICATED` | 401 | `service token expired` | `expires_at` in the past |
| `UNAUTHENTICATED` | 401 | `invalid or expired session` | no session row for this token, or its user row is gone |
| `UNAUTHENTICATED` | 401 | `session expired` | past `expires_at`, or past the absolute or idle timeout |
| `UNAUTHENTICATED` | 401 | `invalid or expired preview token` | bad signature or past `e` |
| `FORBIDDEN` | 403 | `service token revoked` | `revoked_at` set |
| `FORBIDDEN` | 403 | `user is not active` | the session's account was disabled; every session for it is revoked |
| `FORBIDDEN` | 403 | `missing permission: <key>` | scope/permission absent |
| `FORBIDDEN` | 403 | `missing scope: <key>` | same, on admin routes |
| `FORBIDDEN` | 403 | `CSRF validation failed` | session request without a matching `x-kal-el-csrf` |
| `FORBIDDEN` | 403 | `you can only edit your own articles` | non-privileged session user, not creator or listed author |
| `FORBIDDEN` | 403 | `cannot grant permissions you do not hold at this site` | role assignment escalation; `details.missing` lists them |
| `FORBIDDEN` | 403 | `you are not a member of this site` | admin route, no membership |
| `FORBIDDEN` | 403 | `bootstrap is not available` | wrong/absent bootstrap token **or** already initialised — deliberately identical |
| `SITE_SCOPE_MISMATCH` | 403 | `token is not scoped to this site` | service token bound elsewhere |
| `SITE_SCOPE_MISMATCH` | 403 | `no access to this site` | session user with no role at that site |

Note `FORBIDDEN` covers both "wrong credential state" (revoked) and "insufficient rights".
Only revocation is fixable by re-issuing a token; the rest need a permissions change.

---

## 7. Error handling for a client

```python
class KalElError(Exception):
    def __init__(self, status, code, message, details):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message, self.details = status, code, message, details

    @property
    def request_id(self):
        return (self.details or {}).get("requestId")


def raise_for_error(response):
    if response.ok:
        return
    try:
        raw = response.json().get("error")
    except ValueError:
        # A proxy answering 502/413 with HTML never reaches the API's serialiser.
        raw = None
    # Fastify's built-in 404 sends {"error": "Not Found"} - a STRING, not an object.
    err = raw if isinstance(raw, dict) else {"code": "UNKNOWN",
                                            "message": str(raw or response.text[:500])}
    raise KalElError(response.status_code, err.get("code", "UNKNOWN"),
                     err.get("message", ""), err.get("details") or {})
```

**Never assume the body is JSON.** A reverse proxy, a gateway timeout or a body-size
rejection upstream of the API can return HTML or nothing at all. Read the status first,
parse defensively.

Branch on `code`, never on `message`. Codes are contract; messages are prose and will
change.

---

## 8. Codes declared but not currently emitted

| Code | Status |
|---|---|
| `UNSUPPORTED_MEDIA_TYPE` | Reachable only from an upstream Fastify 415. A rejected image type produces `VALIDATION_ERROR`/400. |
| `VALIDATION_ERROR` with `details.validation` | The Fastify-schema branch — no route declares a Fastify `schema`, so it never fires today. |

Everything else in `API_ERROR_CODES` has at least one live producer, including
`RATE_LIMITED` (the handler maps the limiter's 429 onto it).

---

## Implementation references

- `apps/api/src/plugins/errors.ts` — `ApiHttpError`, the constructors, pg-error mapping, the handler
- `packages/contracts/src/errors.ts` — `API_ERROR_CODES`, `ApiErrorBody`, `errorBody()`
- `packages/contracts/src/common.ts` — `apiErrorSchema`
- `apps/api/src/auth-context.ts` — `permissionDenied()`
- `apps/api/src/plugins/auth.ts` — `SITE_SCOPE_MISMATCH`, revocation and expiry refusals
- `apps/api/src/plugins/idempotency.ts` — `IDEMPOTENCY_REPLAY`
- `apps/api/src/services/articles.ts` — `VERSION_CONFLICT`, `INVALID_TRANSITION`, publish/schedule conflicts
- `apps/api/src/services/media.ts` — media conflicts and image validation
- `apps/api/src/services/taxonomy.ts`, `redirects.ts`, `sites.ts`, `users.ts`, `roles.ts` — uniqueness conflicts
