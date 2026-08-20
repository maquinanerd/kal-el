# Kal El — Audit Log

What is recorded, how an automation client appears in it, and how to read it.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The row

Table `audit_log`.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | |
| `site_id` | uuid, nullable | the site the action happened in; `null` for platform-level actions (user creation, role creation). **`ON DELETE SET NULL`** — deleting a site does not erase the record that it existed |
| `actor_type` | text | `user` \| `service` \| `system` \| `worker` |
| `actor_id` | uuid, nullable | `users.id`, or `service_tokens.id`, or `null` |
| `actor_label` | text, nullable | the actor's display name **at the time of the action** |
| `action` | text | e.g. `articles.publish` |
| `object_type` | text | e.g. `article` |
| `object_id` | uuid, nullable | |
| `details` | jsonb, nullable | action-specific |
| `ip` | text, nullable | subject to `TRUST_PROXY` |
| `request_id` | text, nullable | the same value that appears in `error.details.requestId` |
| `created_at` | timestamptz | |

`actor_id` is **deliberately not a foreign key**: an audit row must outlive the credential
it records, and it points at two different tables depending on `actor_type`.

`actor_label` is copied in rather than joined at read time, so a revoked and deleted token
still leaves a readable entry, and the CMS renders one column without a join.

Indexes: `(site_id, created_at)`, `(object_type, object_id)`, and
`(actor_type, actor_id, created_at)` — the last one exists specifically for "what has this
integration been doing".

---

## 2. How each actor appears

| Actor | `actor_type` | `actor_id` | `actor_label` |
|---|---|---|---|
| A person with a session | `user` | `users.id` | the user's `name` |
| A **service token** | `service` | **`service_tokens.id`** | the token's `name` |
| Bootstrap provisioning | `system` | `null` | `"Bootstrap"` |
| The scheduler promoting an article | `worker` | `null` | `"Scheduler (worker)"` |

`worker` is separated from `system` on purpose: both are unattended, but `system` is
provisioning and `worker` is the background process acting on editorial state. An operator
needs to tell "the platform did this at install time" from "the scheduler did this at
03:00".

> ### For an external client, this is the whole reason token names matter
>
> A site running three integrations must be able to say which credential published,
> imported or deleted something. Name tokens after the system that holds them — `"Importer
> X"`, `"Nightly sync"` — because that string is copied verbatim into every row the token
> writes.

**No secret is ever written.** Not the token, not its hash, not a password. The `details`
payloads below carry only identifiers and field names.

---

## 3. Actions recorded

The complete set of `action` literals written anywhere in the API and the worker:

### Articles

| Action | Written by | `details` |
|---|---|---|
| `articles.create` | `POST /articles` | `title`, `slug`, `status`, `publishedAt`, `externalKey`, `provenance` |
| `articles.update` | `PATCH /articles/{id}` | `version`, `changedFields` (the body's keys) |
| `articles.submit` | `POST .../submit` | `from`, `to`, `note` |
| `articles.approve` | `POST .../approve` | `from`, `to`, `note` |
| `articles.reject` | `POST .../reject` | `from`, `to`, `note` |
| `articles.schedule` | `POST .../schedule` | `scheduledAt`, `note` |
| `articles.publish` | `POST .../publish` | `publishedAt`, `version` |
| `articles.publish` | the worker | `via: "scheduler"`, `scheduledAt`, `version` |
| `articles.unpublish` | `POST .../unpublish` | `from`, `to`, `note` |
| `articles.archive` | `POST .../archive` | `from`, `to`, `note` |
| `articles.block` | **the worker**, when a scheduled article's document cannot be read | the failure reason |
| `articles.recover` | `POST .../document/replace` | previous state and the preserved revision number |

### Media

| Action | `details` |
|---|---|
| `media.upload` | `filename`, `mimeType`, `sizeBytes` |
| `media.update` | `changedFields` |
| `media.delete` | `storageKey` |

### Taxonomy

Create, update and delete are all recorded, for all five taxonomies:

| Action | `details` |
|---|---|
| `categories.create`, `tags.create`, `authors.create` | `name`, `slug` |
| `entities.create` | `name`, `type`, `externalRefs` |
| `sources.create` | `name` |
| `categories.update`, `tags.update`, `authors.update`, `entities.update`, `sources.update` | `changedFields` — the body's keys |
| `categories.delete`, `tags.delete`, `authors.delete`, `entities.delete`, `sources.delete` | `changedFields: []` |

Updates and deletes are written by `writeUpdateAudit`, inside the same transaction as the
change. What is **not** recorded is which articles a deletion detached.

### Platform and security

| Action | `details` | Note |
|---|---|---|
| `bootstrap.init` | `site`, `user` | `actor_type = "system"` |
| `sites.create` | the site payload | |
| `sites.update` | changed fields | |
| `users.create` | `email`, `name`, `status` — **never the password or its hash** | `site_id` is null: an account is a platform object |
| `roles.create` | role key and permissions | |
| `roles.assign` | user, role, site | |
| `tokens.create` | `name`, `scopes` — **never the secret** | minting a credential that can outlive its creator |
| `tokens.revoke` | `{}` | |
| `webhooks.create` | url, events — **never the signing secret** | |
| `webhooks.update` | changed fields | |
| `webhooks.delete` | — | |

`bootstrap.init`, `sites.create`, `sites.update`, `users.create`, `roles.create` and
`roles.assign` are written **in the same transaction** as the change they record.

> The token and webhook actions — `tokens.create`, `tokens.revoke`, `webhooks.create`,
> `webhooks.update`, `webhooks.delete` — are written against the pool **after** the change
> has committed (`writeAudit(app.db, …)` in `routes/admin.ts`). A failing audit insert
> there leaves a minted or revoked token, or a created/updated/deleted webhook, with no
> record of it. Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

---

## 4. Reading it

Two endpoints, both scoped to a site, both permission `audit.read`.

### Site-wide

```
GET /v1/sites/{siteId}/audit-log
```

Returns the newest **200** rows for the site, `created_at` descending:

```json
{ "data": [ { "id": "…", "siteId": "…", "actorType": "service", "actorId": "…",
              "actorLabel": "Importer X", "action": "articles.publish",
              "objectType": "article", "objectId": "…",
              "details": { "publishedAt": "…", "version": 3 },
              "createdAt": "…" } ] }
```

### One object's history

```
GET /v1/sites/{siteId}/audit-log/{objectType}/{objectId}
```

Newest **100** rows for that object. `{objectId}` must be a UUID. The response omits
`siteId`, `objectType` and `objectId` (they are in the path):

```json
{ "data": [ { "id": "…", "action": "articles.publish", "actorType": "service",
              "actorId": "…", "actorLabel": "Importer X",
              "details": { "…": "…" }, "createdAt": "…" } ] }
```

### Limitations

| Limitation | Detail |
|---|---|
| **No pagination** | fixed caps of 200 and 100; no `cursor`, `limit`, `offset` |
| **No filtering** | no `actorId`, `action` or date-range parameter |
| **No platform-level endpoint** | rows with `site_id = NULL` (user creation, role creation) are unreachable over HTTP |
| **No export** | direct SQL, or a `pnpm backup` snapshot |
| **`ip` and `requestId` are stored but not returned** | both endpoints omit them |
| **No retention or rotation** | the table grows without bound; pruning is an operator task (unlike `idempotency_keys`, which the worker purges) |

For anything beyond "the last 200 things that happened here", query the table directly.

---

## 5. Using it as an external client

The audit log is a **read-only, best-effort observability surface**, not a state store or
an event stream. It is polled, capped and unfiltered — do not build reconciliation on it.

| You want | Use |
|---|---|
| Confirm a write landed | the response of the write itself, or `GET /articles?externalKey=…` |
| React to publication | [WEBHOOKS.md](WEBHOOKS.md), or poll `GET /articles?status=published` |
| Show an operator what your integration did | `GET /audit-log/article/{articleId}` |
| Prove who published something | the same, filtering on `actorType = "service"` client-side |
| Watch for stuck work | `GET /v1/sites/{siteId}/ops-status` |

If you need durable provenance, put it in the article's own `provenance` field — it is
returned by every single-article read (`GET /articles/{id}`) and by every write response
(the list endpoint returns summaries without it), is not capped at 200 rows, and is yours
to shape.

---

## 6. What the audit log does not cover

| Not recorded |
|---|
| Reads of any kind — no access log for `GET` |
| **Redirect creation and deletion** — `services/redirects.ts` writes no audit row |
| Which articles a taxonomy deletion detached |
| Login, logout, and failed login attempts (those go to the application log) |
| Session creation, rotation and expiry |
| Preview token minting |
| Webhook **delivery** attempts — those live in `webhook_deliveries` |

The application log (Pino, JSON in production) carries request lines with the same
`requestId`, so a suspicious audit row can be correlated with the HTTP request that caused
it.

---

## Implementation references

- `apps/api/src/plugins/audit.ts` — `AuditEntry`, `auditActorFields`, `auditRow`, `writeAudit`
- `packages/db/src/schema/system.ts` — the `audit_log` table and its three indexes
- `apps/api/src/routes/site.ts` — the two read endpoints
- `apps/api/src/services/articles.ts` — `articles.create`, `.update`, `.publish`, `.schedule` and the shared transition writer
- `apps/api/src/services/media.ts` — upload, update, delete
- `apps/api/src/services/taxonomy.ts` — the five create actions plus `writeUpdateAudit`, which records every update and delete
- `apps/api/src/services/recovery.ts` — `articles.recover`
- `apps/api/src/services/roles.ts` — `roles.create`, `roles.assign`
- `apps/api/src/routes/admin.ts` — sites, users, tokens, webhooks
- `apps/api/src/routes/auth.ts` — `bootstrap.init`
- `apps/worker/src/scheduler.ts` — the worker's `articles.publish` and `articles.block`
