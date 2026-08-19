# Kal El — Release-Readiness Report

Status: **code ready for a production deploy; no deploy performed.**
Date: 2026-08-19
Branch: `claude/kal-el-final-implementation-de143b`

This round was implementation, not audit. It closed the four items the staging audit left
open (A6, F7, F9, F10), the four PROD blockers, and the P2 set that had operational
consequences. Everything below is in the code; the evidence is the gates in §5.

---

## 1. Architecture (implemented)

```
apps/api      Fastify REST /v1  (auth, RBAC, sites, articles, taxonomy, SEO, media,
                                 webhooks, recovery, audit, ops status, OpenAPI /docs)
apps/cms      Next.js editorial application (editor, media, workflow, taxonomy, admin)
apps/worker   outbox dispatcher + scheduled-publish promotion + idempotency GC + heartbeat
apps/fixture  reference delivery/revalidation fixture (cache + signed webhook consumer)
packages/contracts  zod schemas + types + OpenAPI generator
packages/db   Drizzle schema, versioned migrations, migration runner, backup/restore
packages/auth Argon2id, opaque session/service tokens, RBAC helpers
packages/sdk  typed MN26/MNScr service client (idempotent, retrying)
packages/events  webhook signature (HMAC-SHA256) + header contract
packages/importer  WordPress pipeline + Payload adapter framework
packages/design-system  PEG tokens, primitives, app shell, calibration harness
packages/testkit  embedded PostgreSQL (free-port), fresh-test-db
```

Frozen decisions honored: PostgreSQL only, Node+TS, Next.js for the CMS, monorepo, REST v1
canonical, frontends never touch PostgreSQL, WordPress/Payload are import sources only,
multi-site isolation, local media behind a `StorageProvider`, no e-commerce.

## 2. What this round implemented

### Closed from the staging audit

| id | item | what was done |
|---|---|---|
| **A6** | unreadable document recoverable only by direct SQL | `articles.recover` permission and three site-scoped routes: read the raw stored bytes, read a revision's raw bytes, replace the document. The previous bytes are filed as a revision *before* the update, the replacement is filed as its own, and the whole thing is one audited transaction. `qualityFlags: ["document_unreadable"]` drives a repair banner in the editor. |
| **F7** | no index served the scheduler's query | Partial index on `scheduled_at WHERE status = 'scheduled'` — matches the predicate exactly and provides the ordering, so the plan is an index scan with no sort. Previously 86,400 sequential scans of `articles` per day at the default poll interval. Batch sizes moved to configuration. |
| **F9** | every service-token action audited with `actor_id = NULL` | `auditActorFields` resolves `users.id` or `service_tokens.id`, plus `actor_label` — the credential's operator-chosen name, copied in so a revoked and deleted token does not make its history unreadable. `worker` separated from `system`. |
| **F10** | `createUser` / `createSite` wrote no audit row | Both now audit inside the same transaction as the insert, along with `sites.update`. |

### Closed from the production blockers

| id | item | what was done |
|---|---|---|
| **PROD-1** | `logger: false` in every deployment | Structured logging in both processes: JSON in production, readable lines in development, no extra dependency. Mandatory redaction of authorization/cookie/CSRF/bootstrap headers and anything named like a password, token or secret. Production refuses to boot with `LOG_LEVEL=silent`. One completion line per request with requestId, actor and site. |
| **PROD-2** | rate limit keyed on `req.ip` with no proxy policy | `TRUST_PROXY` is mandatory in production and `true` is rejected (it makes the forwarded address client-controlled). Service tokens bucket by credential, so one integration cannot exhaust another's budget behind shared egress. |
| **PROD-3** | bootstrap oracle, no dedicated limit | 5/minute limit, constant-time comparison (already present), and one identical refusal for a bad token, a missing token and an already-provisioned system — the distinction goes to the server log. Advisory lock and singleton check stay in one transaction. |
| **PROD-4** | no session lifecycle | Idle timeout, absolute timeout, token rotation with a grace window sized for in-flight requests, deletion of expired rows, revocation on account-disable, and `POST /v1/auth/logout-all`. All resolution centralised in one service. |

### P2 items with operational consequences

- **DNS rebinding on webhook delivery.** `guardedFetch` validates inside the socket's own
  DNS lookup, so the approved address is the dialled address. Checking before connecting
  cannot close this; the checked resolution is not the one the socket uses.
- **WordPress `future` with a past date.** Was mapped to `scheduled` and auto-published on
  the next tick. Now lands in `blocked`, guarded at the import choke point every adapter
  passes through.
- **Shared external-id namespace.** Dry-run identity and stored keys now carry provider,
  entity kind and id.
- **Backup/restore.** Keyset-chunked export, every table truncated on restore (not only
  those the snapshot names), tables absent from the schema skipped and reported, column
  set taken from the union of rows.
- **Webhooks had no UI.** Full admin surface with per-hook delivery health and
  pause/reactivate.
- **`pnpm-workspace.yaml` `allowBuilds`** contained literal `set this to true or false`
  placeholders, so build scripts were silently skipped on every install.
- **`maxParamLength` deprecation** printed on every boot; moved under `routerOptions`.

### Also added

- `/health` and `/ready`, with and without the `/v1` prefix, unauthenticated and unlimited.
- `/ops-status` and a CMS panel: outbox backlog, scheduled backlog, webhook health, blocked
  articles, worker liveness from a per-tick heartbeat.
- Graceful shutdown in both processes.
- A CMS Dockerfile and the CMS in `docker-compose.prod.yml`.
- `pnpm bootstrap`, `start:api`, `start:worker`, `start:cms`, `test:e2e`.

## 3. Schema changes

Migrations `0003` and `0004`:

- `articles_scheduled_due_idx` — partial index for the scheduler
- `audit_log.actor_label`, `audit_log_actor_idx`, `worker` actor type
- `sessions.rotated_at`, `previous_token_hash`, `previous_token_expires_at`
- `webhooks.enabled`, `webhooks.description`
- `worker_heartbeats`

All additive. No deployed database exists, so no data migration is required.

## 4. Acceptance criteria status (docs/10-ACCEPTANCE-CRITERIA.md)

| Criterion | Status |
|---|---|
| site/user/role creation | ✅ bootstrap + admin endpoints + tests |
| document-first article editing | ✅ ProseMirror/TipTap editor, ArticleDocument V2 |
| images / featured media | ✅ upload, library, featured, gallery, focal point |
| YouTube embed / gallery / variants | ✅ |
| categories/tags/entities | ✅ |
| SEO editing/preview | ✅ SERP + social preview, redirects |
| RBAC workflow | ✅ per-site roles/permissions + negative tests |
| revisions/autosave | ✅ |
| secure preview | ✅ HMAC token, `noindex` |
| publish event + frontend revalidation | ✅ outbox → signed webhook → fixture e2e |
| MN26-like idempotent integration | ✅ SDK + exactly-once idempotency |
| duplicate-retry safety | ✅ advisory-lock idempotency, scoped by actor+site, TTL enforced |
| WP import dry-run | ✅ snapshot/normalize/dry-run/import/reconcile |
| site isolation | ✅ negative cross-site tests |
| OpenAPI/integration tests | ✅ `/docs` opt-in; contract test asserts every declared route exists |
| lint/typecheck/unit/integration/e2e/security | ✅ see §5 |
| backup/restore rehearsal | ✅ `backup.test.ts` |
| PEG calibration + UI visual QA | ✅ axe 0 violations, 190/190 navigation, dark mode |
| no production deployment without human instruction | ✅ respected — nothing was deployed |

## 5. Gates

| gate | result |
|---|---|
| `pnpm -r typecheck` | PASS — 13 projects |
| `pnpm -r lint` | PASS — 13 projects |
| `pnpm -r build` | PASS |
| `pnpm -r test` | **248 passed, 0 failed, 0 skipped** |
| `pnpm test:e2e` (Playwright) | **25 passed, 0 failed, 0 flaky** |

Distribution: api 161 · importer 21 · contracts 15 · worker 13 · editor 9 · db 8 · sdk 7 ·
auth 5 · design-system 5 · fixture 4.

The e2e sweep — accessibility (axe, WCAG 2.1 A+AA), horizontal overflow and navigation
reachability at five widths in both themes — now includes the new `/webhooks` surface, for
the same reason it includes every other page reachable from the sidebar: a surface excluded
from the scan is a surface nothing checks.

**No new test suites were written this round** — the instruction was implementation, not
another QA campaign, and the count is unchanged from the staging audit's 248 for that
reason. Four existing tests were updated where they asserted behaviour this round
deliberately changed:

| test | why it changed |
|---|---|
| `worker/tests/scheduler.test.ts` | the block audit row is now `actorType: "worker"` with a label, not `"system"` with a null actor |
| `importer/tests/import.test.ts` | external keys are typed (`imp:article:…`); the test now derives them from `externalKeyFor` rather than hardcoding the old shape |
| `db/tests/migration.test.ts` | `worker_heartbeats` added to the table inventory and to the down-migration |
| `api/tests/hardening.test.ts` | production now also requires `TRUST_PROXY` and a non-silent `LOG_LEVEL` |

## 6. What remains future work

Recorded rather than hidden.

- **OpenAPI covers a subset of the routes.** A test asserts every declared route exists;
  the inverse is not asserted. `docs/integrations/PIPELINE_API.md` is the reference.
- **The SDK discards the HTTP status**, so created-versus-existing is not observable
  through it, and it has no `/v1/admin/*` methods.
- **`articles.delete` exists as a permission with no route** — deletion is `archive`.
- **`UNSUPPORTED_MEDIA_TYPE`** is declared and never emitted.
- **Media is local disk** behind `StorageProvider`. An S3-compatible provider is a
  self-contained addition; the interface already exists.
- **No metrics endpoint.** `/ops-status` answers the operational questions from the
  database; a Prometheus surface would be a separate decision.
- **`Tabs` has an incomplete ARIA pattern** — the component is not used by any screen.
- **Heading hierarchy** skips `h1 → h3` on some surfaces.

## 7. Deploying it

Full runbook in [docs/08-DEPLOYMENT.md](./08-DEPLOYMENT.md). In short:

```bash
pnpm install && pnpm build
DATABASE_URL=... pnpm migrate
pnpm start:api        # or the container images
pnpm start:worker
pnpm start:cms
API_BASE_URL=... BOOTSTRAP_TOKEN=... KALEL_OWNER_PASSWORD=... pnpm bootstrap \
  --site-slug portal --site-name "Portal" --email owner@example.com --name "Owner"
```

Or `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`.

Production will refuse to boot without `NODE_ENV=production`, `COOKIE_SECURE=true`, a
32-character `SESSION_SECRET`, a `TRUST_PROXY` policy, and a non-silent `LOG_LEVEL`. That
is deliberate: a misconfigured instance should not start rather than start insecurely.

Remove `BOOTSTRAP_TOKEN` from the environment once provisioning is done.

## 8. Verdict

| | |
|---|---|
| Known P0 | **0** |
| Known P1 | **0** |
| P2 / future | §6 |
| **READY FOR STAGING** | **YES** |
| **CODE READY FOR PRODUCTION DEPLOY** | **YES** |
| **DEPLOY EXECUTED** | **NO** — requires explicit human instruction |

The honest form of the P0/P1 claim is the one the staging audit arrived at: zero known
after the work recorded here, with the discovery history in
`docs/audits/KALEL_STAGING_READINESS_AUDIT.md`. Stopping the audit loop was a scope
decision, not a proof that no defects remain.
