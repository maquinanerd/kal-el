# Kal El — Troubleshooting

Symptom → cause → fix, for the failures the code actually produces.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. First moves

| Question | Command |
|---|---|
| Is the process up? | `GET /health` → `{"status":"ok"}` |
| Can it reach the database? | `GET /ready` → `{"status":"ready"}`, else `503` |
| Is my credential valid? | `GET /v1/auth/me` |
| Is the worker alive? | `GET /v1/sites/{siteId}/ops-status` → `worker.status` |
| What happened to this article? | `GET /v1/sites/{siteId}/audit-log/article/{articleId}` |
| Which request failed? | `error.details.requestId` — it is on the API's log line too |

Always capture `error.details.requestId`. It is generated per request and appears in the
error body, the access log and the audit row.

> **If `error` is a plain string rather than an object**, you hit a path with no matching
> route: that is Fastify's built-in 404, which never reaches the API's error handler. Check
> the URL — there is no `code` and no `requestId` on that shape.

---

## 2. The API will not start

| Message | Cause | Fix |
|---|---|---|
| `Invalid environment configuration: {...}` | zod rejected a variable; the field names are in the message | fix that variable |
| `COOKIE_SECURE must be 'true' in production` | production guard | set it — only the literal `"true"` works |
| `SESSION_SECRET must be set to a strong random value in production` | still the development default | generate a real one |
| `SESSION_SECRET must be at least 32 characters in production` | too short | it is the **preview-token** signing key (it does not sign sessions); use ≥32 random chars |
| `ALLOW_PRIVATE_WEBHOOKS must not be enabled in production` | production guard | remove it |
| `LOG_LEVEL must not be 'silent' in production` | production guard | use `info` |
| `TRUST_PROXY must state the reverse-proxy policy in production…` | production guard | a hop count (`1`), a CIDR list, or the literal `direct` |
| `TRUST_PROXY=true is not accepted…` | thrown in **every** environment | `true` trusts a client-writable header; use a hop count |
| `unsupported media storage provider: …` | `MEDIA_STORAGE_PROVIDER` is not `local` | `local` is the only implementation |

> **If a variable seems to be ignored, it probably is.** Nothing loads `.env` for the API,
> worker or scripts — see [ENVIRONMENT.md §1](ENVIRONMENT.md#1-env-is-not-loaded-automatically).

---

## 3. The worker will not start, or the API is fine and the worker is not

| Symptom | Cause |
|---|---|
| Worker exits with a config error while the API booted on the same env | `LOG_LEVEL=trace` or `fatal` — **the worker's enum is narrower** |
| Webhooks to loopback are refused in development | `ALLOW_PRIVATE_WEBHOOKS=1` is truthy for the API and **falsy for the worker** — use `true` |
| Worker shuts down sooner/later than expected | `SHUTDOWN_GRACE_MS` defaults to 20000 in the worker and 15000 in the API |

---

## 4. Authentication and permissions

| Response | Meaning | Fix |
|---|---|---|
| `401 UNAUTHENTICATED` "unauthenticated" | no usable credential | a `Bearer` token **not** starting with `ke_st.` counts as *no credential*, not a bad one |
| `401` "invalid service token" | no row for that hash | wrong token, wrong environment, or it was deleted |
| `401` "service token expired" | `expires_at` passed | mint a new one |
| `403 FORBIDDEN` "service token revoked" | `revoked_at` set | mint a new one — revocation is not reversible |
| `403` `missing permission: <key>` | the scope is absent | check `GET /v1/auth/me` → `scopes` |
| `403 SITE_SCOPE_MISMATCH` | the token belongs to another site | one token per site; verify `data.siteId` |
| `403` "CSRF validation failed" | session request without a matching `x-kal-el-csrf` | browser only — send the `ke_csrf` cookie value as that header |
| `403` "you can only edit your own articles" | non-privileged session user, not the creator and not a listed author | service tokens are exempt |
| `403` "cannot grant permissions you do not hold at this site" | role-assignment escalation | `details.missing` lists them |
| `403` "bootstrap is not available" | wrong token **or** already provisioned — deliberately identical | check the server log |

### "My token has `articles.create` but creating fails with 403"

The body probably sets `status: "published"`/`publishedAt` (needs `articles.publish`) or
`status: "scheduled"`/`scheduledAt` (needs `articles.schedule`).

### "Reading categories returns 403"

There is no `taxonomy.*.read`. Reading requires `taxonomy.categories.manage`.

---

## 5. Writes rejected

| Response | Cause | Fix |
|---|---|---|
| `400` with `issues[].code = "unrecognized_keys"` | both article body schemas are `.strict()` | remove the unknown field. On `PATCH`, `status`, `publishedAt`, `scheduledAt` and `externalKey` are all unknown. |
| `400` "at least one field is required" | empty `PATCH` body | send something |
| `400` `details.field = "scheduledAt"` | `status: "scheduled"` without a time | a schedule without a time is invisible to the worker forever |
| `400` `details.mediaId` | media missing **or** in another site | upload to this site first |
| `400` `details.authorId` / `categoryId` / `tagId` / `entityId` | same, for taxonomy | resolve ids per site |
| `400` "invalid If-Match header" | quoted ETag | send a **bare integer** |
| `400` "invalid Idempotency-Key header" | outside `[A-Za-z0-9._-]{8,128}` | `uuid4().hex` is safe |
| `400` "invalid cursor" | hand-built or truncated cursor | only ever echo `nextCursor` |
| `400` "file content does not match the declared media type" | the `Content-Type` disagrees with the bytes | the bytes win; send the real type |
| `400` "file content is not a supported image" | not JPEG/PNG/WEBP/GIF/AVIF — or an SVG | convert it |
| `409 CONFLICT` `details.constraint` | a unique index — including a **repeated id inside `authors`/`categories`/`tags`/`entities`**, which hits the relation table's composite primary key | de-duplicate client-side; see [../architecture/DATABASE.md §8](../architecture/DATABASE.md#8-where-a-client-can-collide) |
| `409` "media is in use" | referenced by an article, its SEO image, a document node or an author avatar | detach first |
| `409` "scheduledAt must be in the future" | past date on `/schedule` | (a past date **is** accepted at create time and publishes on the next tick) |
| `413 PAYLOAD_TOO_LARGE` | over 5 MiB body or `MEDIA_MAX_BYTES` | |
| `429 RATE_LIMITED` | 600 req/min per token | pace or batch; honour `retry-after` |

---

## 6. Conflicts

### `409 VERSION_CONFLICT`

Somebody wrote first. **Never retry the same body.** Re-`GET`, re-apply your change onto the
new state, retry with the new `If-Match`. `details` carries `currentVersion`,
`expectedVersion` and — on the lost-race variant — `currentStatus`.

It can fire on a workflow transition too, even though those endpoints do not accept
`If-Match`: the internal guard is unconditional.

### `409 IDEMPOTENCY_REPLAY`

The same key arrived with a **different** request. This is a client bug: a key identifies
one attempt at one operation. Generate a new one. Note that array order is part of the hash;
object key order is not.

### `409 INVALID_TRANSITION`

Read `details.from` and `details.to`. Common cases: `archived` is terminal; `published` can
only go to `draft`; `approve` is legal only from `in_review` or `blocked` (`details.expected`
lists them).

---

## 7. "It worked but nothing happened"

| Symptom | Cause |
|---|---|
| Re-`POST` with the same `externalKey` returned `200` and the article is unchanged | **create-with-existing-key is a lookup, not an upsert.** Follow with a `PATCH` to synchronise. |
| A retried create produced no second article and no error | the `Idempotency-Key` replayed the stored response — the intended behaviour |
| `submit`/`publish`/`archive` returned `200` and the version did not move | the article was already in the target state; the no-op path returns early |
| `approve` or `unpublish` returned `409` on an article already in `draft` | `draft` is excluded from the no-op path, so neither is absorbed — use an `Idempotency-Key` for retry safety |
| An `Idempotency-Key` on `PATCH` had no effect | `PATCH` ignores it silently. Use `If-Match`. |
| A media upload with a known `externalKey` returned `201` but stored nothing | reuse always answers `201`; the status does not distinguish |
| The document came back different from what was sent | normalisation sorts marks and merges adjacent text nodes. Never byte-compare a round trip. |

---

## 8. Scheduling and publication

| Symptom | Diagnosis |
|---|---|
| A scheduled article never publishes | check `ops-status`: `worker.status` (`stale`/`unknown` = the worker is down) and `scheduled.overdue` |
| It publishes immediately | `scheduledAt` was in the past at create time — the due query is `<= now()` |
| It moved to `blocked` on its own | the worker refused it: the stored document could not be parsed. Look for `articles.block` in the audit log and `document_unreadable` in `qualityFlags`. |
| Publishing by hand returns `409 CONFLICT` "the stored document cannot be read" | same cause — repair via the `articles.recover` routes before publishing |
| `scheduled.overdue` is climbing | the worker is down, or `SCHEDULER_BATCH_SIZE` is too small for the volume |

---

## 9. Webhooks

| Symptom | Diagnosis |
|---|---|
| Subscribed to `article.scheduled` or `article.updated`, receiving nothing | **nothing emits those events.** Only `article.published` exists. |
| Nothing arrives at all | `GET /ops-status` → `webhooks.enabled`, `outbox.pending`, `outbox.failed`, `worker.status` |
| Deliveries stopped after a brief outage | five attempts over ~15 s, then **permanent dead-letter**. There is no replay endpoint — re-publish, or reconcile by polling. |
| Signature verification fails | you are hashing re-serialised JSON. Use the **raw body bytes**. |
| Duplicate processing | delivery is at-least-once. Dedupe on **`x-kal-el-idempotency`**, never on `x-kal-el-delivery` (that one changes per attempt). |
| Cannot tell which site an event is for | the payload has no site id — register one URL per site |
| Local endpoint refused | set `ALLOW_PRIVATE_WEBHOOKS=true` (exactly `true`) in development; production refuses to boot with it |
| `outbox.failed` climbing | every subscriber for those events is exhausted; fix the endpoint and re-publish |

---

## 10. Media

| Symptom | Cause |
|---|---|
| `400` "unsupported media type" for an SVG | deliberate — SVG is an XSS surface |
| `400` "unsupported media type: image/jpg" | the allow-list holds `image/jpeg`; `image/jpg` is checked against the raw header before detection and never normalised |
| `413` on a file under 25 MiB | check `MEDIA_MAX_BYTES` for this deployment |
| `width`/`height` are `null` | dimension reading is best-effort and swallows failures |
| The image `url` 404s from a browser | it requires `media.read`; it is not a public URL |
| Two API replicas disagree about a file | the media volume is not shared — only the `local` provider exists |
| Uploads duplicate on every run | you are not sending `?externalKey=` |
| Disk fills after deleting media | deleting a row does **not** delete the file |
| `409` "media is in use" and you cannot find the reference | the guard also checks `seo.socialImageMediaId`, `gallery` nodes and author avatars |

---

## 11. Pagination and listing

| Symptom | Cause |
|---|---|
| `total` is missing from an article page | it is never sent; only media's list has one |
| A full scan sees an item twice or misses one | ordering is `updatedAt DESC` — a row edited mid-scan moves. Reconcile by `externalKey`. |
| `?q=` does not find an obvious article | it matches **title only**, case-insensitive substring |
| Media search misses an alt text | media `?q=` matches **filename only** |
| A tag filter returns nothing | `?tagId=` takes a uuid, not a slug |

---

## 12. Local development

| Symptom | Cause |
|---|---|
| Connected to the wrong database | `.env` is not loaded — export the variables |
| The worker sees no articles the API created | `pnpm dev:api` starts its **own embedded** database. Use `node packages/testkit/dev-db.mjs` and point both at it. |
| `pnpm start:api` fails with "cannot find dist" | run `pnpm build` first |
| The CMS dev server breaks mid-session | a `next build` ran while `next dev` was running — both use `apps/cms/.next` |
| Migrations did not run on boot | `RUN_MIGRATIONS` must be exactly `"true"` |
| `/docs` is missing | it is off in production unless `ENABLE_DOCS=true` |
| Everything shares one rate-limit bucket behind a proxy | `TRUST_PROXY` is unset or wrong |

---

## 13. Escalation checklist

Before filing a bug, collect:

1. `error.details.requestId`;
2. the exact request — method, full path, headers **with the token redacted**, body;
3. the exact response — status, `error.code`, `error.details`;
4. `GET /v1/auth/me` output (scopes and `siteId`);
5. `GET /v1/sites/{siteId}/ops-status`;
6. `GET /v1/sites/{siteId}/audit-log/article/{articleId}` for the object involved;
7. the API log line for that `requestId`.

**Never include the token, a session cookie or a webhook secret.**

---

## Implementation references

- `apps/api/src/config.ts` — every startup guard and its exact message
- `apps/api/src/plugins/errors.ts` — how each failure becomes a code
- `apps/api/src/routes/health.ts` — liveness and readiness
- `apps/api/src/services/ops.ts` — the `ops-status` payload
- `apps/worker/src/scheduler.ts` — why an article gets blocked
- `apps/worker/src/dispatcher.ts` — the retry ladder and dead-lettering
- [../api/ERRORS.md](../api/ERRORS.md), [../api/IDEMPOTENCY.md](../api/IDEMPOTENCY.md), [../api/CONCURRENCY.md](../api/CONCURRENCY.md)
- [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md)
