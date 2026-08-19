# Security and Reliability Baseline

Use strong password hashing, secure human sessions, scoped service tokens, server-side RBAC, CSRF protection where applicable, strict validation/sanitization, no arbitrary scripts, SSRF defenses, upload MIME/size/dimension validation, audit logs, idempotent retriable writes, transactional outbox, tested backups/restores, health/readiness checks, structured logs/correlation IDs, metrics, environment/secret injection and dependency/supply-chain checks.

---

## How each of those is implemented

This section records the decisions that are not obvious from reading the code, and the
failure each one exists to prevent.

### Sessions

Resolved in exactly one place (`apps/api/src/services/sessions.ts`), consulted by every
reader. Three routes previously ran their own token lookup with different subsets of the
checks, which is how `/v1/auth/me` and `/v1/me/sites` came to answer for disabled accounts
until that was patched into each of them separately.

Three clocks, answering different questions:

| clock | source | bounds |
|---|---|---|
| `expiresAt` | set at login from `SESSION_TTL_DAYS` | the ceiling |
| absolute | `createdAt` + `SESSION_ABSOLUTE_TIMEOUT_MINUTES` | a stolen cookie, even for an active attacker |
| idle | `lastSeenAt` + `SESSION_IDLE_TIMEOUT_MINUTES` | the unattended browser |

An expired session row is deleted, not merely refused, and the cookies are cleared so the
browser stops sending a dead credential.

**Rotation** replaces the token every `SESSION_ROTATE_MINUTES` and keeps the previous one
valid for a two-minute grace window. The grace is not a nicety: the CMS issues several
requests in parallel, and without it, two crossing the rotation threshold together means
one wins the guarded update and the rest are holding a token that no longer exists — half
a page load 401s. The update is guarded on `rotated_at`, so exactly one rotation happens.

**Revocation.** Disabling an account deletes its sessions on every device.
`POST /v1/auth/logout-all` does the same deliberately: a password compromise is not
answered by changing the password while every previously issued cookie keeps working.

### Bootstrap

The one secret compared against an unauthenticated caller's input, and it creates a
full-permission owner.

- constant-time comparison
- dedicated 5/minute rate limit (under the global limit alone it was guessable at 600
  attempts a minute)
- **identical refusal for every failure mode.** Answering "bootstrap token required" for a
  bad token and "system is already initialized" for a good one tells a caller their guess
  was correct — the exact signal a search needs. The distinction goes to the server log.
- the already-initialized check and an advisory lock inside one transaction, so two
  concurrent calls cannot both create an owner

### Rate limiting behind a proxy

`req.ip` is what the limiter buckets on, so the reverse-proxy policy is a security control,
not a deployment detail. `TRUST_PROXY` is mandatory in production and `true` is rejected —
see [08-DEPLOYMENT](./08-DEPLOYMENT.md#trust_proxy). Service tokens are bucketed by
credential rather than by IP, so one integration behind a shared egress address cannot
exhaust another's budget. Login and bootstrap keep their own, stricter, route-level limits.

### SSRF on webhook delivery

Three layers, because none of them is sufficient alone:

1. **Registration** validates the URL as supplied, including resolving the name.
2. **Delivery-time re-check** catches a name re-pointed since registration, and rejects
   before a socket is opened — so the common case fails fast with a readable reason.
3. **`guardedFetch`** validates inside the socket's own DNS lookup.

The third is what closes DNS rebinding. Checking before connecting cannot: the checked
resolution is not the one the socket uses, so a TTL-0 record answering public to the check
and `169.254.169.254` to the connection passes everything. Node's `http(s).request` accepts
a `lookup` function and connects to whatever it returns, which makes the approved address
and the dialled address the same address.

The lookup refuses if *any* address in the record set is private, not just the first: with
happy-eyeballs the runtime may try several, so `[public, private]` would otherwise work.
Redirects are never followed — a 302 from a validated public URL into the metadata service
would bypass all three layers. Response bodies are capped; the dispatcher reads the status.

Blocked ranges: loopback, RFC1918, link-local (including the metadata address), CGNAT
100.64/10, multicast and reserved, IPv6 unique-local and link-local, IPv4-mapped IPv6 in
both dotted and hex form, and the `.local` / `.internal` / `localhost` suffixes.

### Audit log

Every write records who did it. "Who" now has four shapes, which the log distinguishes:

| `actor_type` | `actor_id` | `actor_label` |
|---|---|---|
| `user` | `users.id` | display name |
| `service` | `service_tokens.id` | the token's operator-chosen name |
| `system` | null | e.g. `Bootstrap` |
| `worker` | null | e.g. `Scheduler (worker)` |

Service-token actions were previously all written with `actor_id = NULL`, so a site running
three integrations could not say which credential published, imported or deleted anything.
The label is copied in rather than joined at read time, so a revoked and deleted token does
not make its history unreadable. Neither the secret nor its hash is ever recorded.

`worker` is separated from `system` because an operator needs to tell an unattended 03:00
publish from platform provisioning.

### Logging

Production emits one JSON object per line; development emits a readable line. There is no
way to express "no logger" other than `LOG_LEVEL=silent`, which production refuses — the
shipped default used to be `logger: false`, so every real deployment ran mute and the
`requestId` returned in each error body correlated with nothing.

Redaction is not optional: `authorization`, `cookie`, the bootstrap and CSRF headers, and
anything named like a password, token or secret are censored at any depth. The request
serializer emits an allow-list of fields rather than the whole header bag, because that is
where the session cookie and the bearer token live.

Each request logs one completion line carrying `requestId`, method, path, status, duration,
actor type, actor id and site — the fields an operator actually filters on.

### Document integrity

A `NOT NULL jsonb` column accepts `'null'`, `'{}'` and anything else that is valid JSON but
not a valid `ArticleDocument`. Readers degrade such a value to an empty document so the row
stays reachable, and **no path writes a degraded document back**: the worker refuses to
promote, the manual publish refuses, and a metadata-only PATCH does not touch the column.

Recovery is a first-class operation gated on `articles.recover` (owner / admin /
editor-chefe, deliberately not `autor`): read the raw bytes, restore a readable revision, or
replace the body. The previous bytes are filed as a revision *before* the update — after it
there is no other copy — and the whole thing is one audited transaction. Articles carry
`document_unreadable` in `qualityFlags` so the CMS shows a repair banner instead of an empty
editor that looks like an unwritten article.

### Import safety

A `scheduled` article whose date has already passed matches the worker's due query on the
next tick and publishes immediately. A WordPress export from a site whose cron stopped is
full of exactly that, so importing one auto-published every missed post and announced each
to every webhook subscriber. Expired schedules now land in `blocked`, which the workflow
queue surfaces and from which both approve and reject are legal. The guard sits at the
import choke point every adapter passes through, not in one adapter.

`createArticle` refuses `status: "scheduled"` without a `scheduledAt` for the mirror-image
reason: `<=` against NULL is NULL, so such an article was invisible to the worker forever.

### Media references

Deleting media referenced by a live article is refused. The check is structural
(`jsonb_array_elements` over the document nodes, plus `featuredMediaId`, the SEO social
image and author avatars), not a `LIKE` over `document::text` — Postgres re-serialises jsonb
on output with a space after the colon, so the textual pattern matched nothing and the guard
the CMS relies on could never fire.

### Idempotency

Client-generated `Idempotency-Key` is an *attempt* identifier, never a content hash: the SDK
mints `sdk.<uuid>` per call. Records are scoped by actor **and** site, carry a 24h TTL that
is both compared on read and collected by the worker, and the request hash is canonical
(sorted keys) so a client re-serialising the same payload in a different order is recognised
as a retry rather than answered with 409.

Three identities that must not be conflated, and are not:

| identity | what it keys | lives in |
|---|---|---|
| external identity | which source record this is | `external_key` |
| request idempotency | which attempt this is | `Idempotency-Key` |
| content version | which revision this is | `version` / `If-Match` |

Re-applying a workflow transition the article already reached is a 200 no-op — except for
`draft`, which is the target of both `approve` and `unpublish`. Treating status equality as
a retry there turned `approve` on an article that was never submitted into a silent success.
Those two rely on `Idempotency-Key` instead. An illegal transition stays a 409 with `from`
and `to`; retry convenience never manufactures a success.

### Backup / restore

See [08-DEPLOYMENT](./08-DEPLOYMENT.md#backup-and-restore). The reliability-relevant points:
one `REPEATABLE READ` transaction for the whole export, keyset chunking so a large table is
not materialised at once, one transaction for the whole restore, every table truncated
first, and statement chunking under Postgres's 65,535-bind cap.
