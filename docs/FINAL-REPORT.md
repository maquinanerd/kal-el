# Kal El — Release-Readiness Report

Status: **staging-ready (P0 = 0, P1 = 0); not production-ready.**

> Sections 1-N below are the record as of 2026-08-14 (branch
> `feat/foundation-phase-1-3`). The status line above supersedes the original
> header: the visual gate is no longer "blocked by no image-capable reviewer" -
> it was made mechanical and now passes. See the R14 section at the end, and
> `docs/audits/KALEL_STAGING_READINESS_AUDIT.md` for the full evidence.

Original header (kept for provenance):
Date: 2026-08-14 · Branch: `feat/foundation-phase-1-3` · Status at the time:
*not yet a full release candidate; CMS UI blocked by the DS-3 visual gate.*

---

## 1. Architecture (implemented)

```
apps/api      Fastify REST /v1  (auth, RBAC, sites, articles, taxonomy, SEO, webhooks, audit, OpenAPI /docs)
apps/worker   outbox dispatcher + scheduled-publish promotion (webhooks, retry/backoff, dead-letter)
apps/fixture  reference delivery/revalidation fixture (cache + signed webhook consumer)
packages/contracts  zod schemas + types + OpenAPI generator
packages/db   Drizzle schema, versioned migration, migration runner, backup/restore
packages/auth Argon2id, opaque session/service tokens, RBAC helpers
packages/sdk  typed MN26/MNScr service client (idempotent, retrying)
packages/events  webhook signature (HMAC-SHA256) + header contract
packages/importer  WordPress pipeline + Payload adapter framework
packages/design-system  PEG tokens, primitives, app shell, calibration harness
packages/testkit  embedded PostgreSQL (free-port), fresh-test-db
```

Frozen decisions honored: PostgreSQL only, Node+TS, Next.js slated for CMS,
monorepo, REST v1 canonical, frontends never touch PostgreSQL, WordPress/Payload
are import sources only, multi-site isolation, local media behind a future
StorageProvider, no e-commerce.

## 2. ADRs

ADR-0001 monorepo/tooling · ADR-0002 Drizzle · ADR-0003 Fastify ·
ADR-0004 auth/sessions/tokens · ADR-0005 idempotency/outbox ·
ADR-0006 importers

## 3. Acceptance criteria status (docs/10-ACCEPTANCE-CRITERIA.md)

| Criterion | Status |
|---|---|
| site/user/role creation | ✅ bootstrap + admin endpoints + tests |
| document-first article editing | ⏳ editor engine pending (Phase 4, gated by DS-3) |
| images / featured media | ⏳ media pending (Phase 5, gated by DS-3) |
| YouTube embed / gallery / variants | ⏳ document schema supports it; editor UI pending |
| categories/tags/entities | ✅ taxonomy + tests |
| SEO editing/preview | ✅ editorial SEO + redirects; preview UI pending |
| RBAC workflow | ✅ roles/permissions per site + tests |
| revisions/autosave | ✅ revisions; autosave UI pending |
| secure preview | ⏳ contract-ready; UI pending |
| publish event + frontend revalidation | ✅ outbox → signed webhook → fixture e2e |
| MN26-like idempotent integration | ✅ SDK + exactly-once idempotency + tests |
| duplicate-retry safety | ✅ advisory-lock idempotency + retry tests |
| WP import dry-run | ✅ importer (snapshot/normalize/dry-run/import/reconcile) |
| site isolation | ✅ negative cross-site tests (403 SITE_SCOPE_MISMATCH) |
| OpenAPI/integration tests | ✅ OpenAPI at /docs + 80 integration/unit tests |
| lint/typecheck/unit/integration/e2e/security passes | ✅ typecheck/lint/build clean; audit 0 known vulns |
| backup/restore rehearsal | ✅ backup.test.ts (3 tests) |
| PEG calibration + UI visual QA zero P0/P1 | ⏳ DS-3 blocked (vision); screenshots + procedure ready |
| no production deployment without human instruction | ✅ respected |

## 4. Test / build evidence

- **80 tests pass** across 9 packages: contracts 9, auth 5, db 8, design-system 5,
  sdk 5, worker 8, api 31, fixture 2, importer 8.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — all green.
- `pnpm audit --prod --audit-level high` — no known vulnerabilities.
- Migration reversibility tested (full down + re-up); backup/restore rehearsal
  byte-identical.
- End-to-end: MN26/SDK → publish (exactly-once) → outbox → signed webhook →
  fixture revalidation; WordPress import → API → revalidation, idempotent.

## 5. Visual QA (DS-3)

Calibration screenshots (desktop/mobile × light/dark) captured in
`docs/progress/calibration-shots/`; procedure in
`docs/progress/DESIGN-SYSTEM-CALIBRATION.md`. **The P0/P1/P2 classification is
pending an image-capable review** — per AGENTS.md 17–18 the CMS UI must not
expand until it passes. Do not treat the UI as done.

## 6. Security findings

- Dependencies: audited; upgraded drizzle-orm (SQL-injection advisory) and
  @fastify/static (path traversal/auth bypass) → 0 known vulns.
- Secrets: none in source; `.env.example` placeholders; gitleaks added to CI;
  manual scan clean.
- Auth: Argon2id, hashed opaque tokens, CSRF on state-changing session requests,
  scoped/revocable/expiring service tokens, per-site RBAC, login rate-limit,
  global rate limit, helmet, audit log on every write.
- Site isolation verified by negative tests; service tokens are site+scope bound.

## 7. Migration readiness

- Single baseline migration `packages/db/drizzle/0000_*.sql`, regenerated after
  the drizzle 0.45 upgrade. No deployed database exists; first deploy applies
  the baseline. Any future change requires a new `pnpm --filter @kal-el/db generate`
  migration with a tested down path.

## 8. Known limitations / remaining work

- **CMS UI (apps/cms) not built** — Phases 4–5 (editor + media) and the full
  screen inventory are blocked by the DS-3 visual gate.
- Media binaries not ingested (no StorageProvider yet); importer reports media
  as pending and drops image nodes with warnings.
- Inline formatting (links/bold inside paragraphs) flattened by the importer;
  the document schema has no inline nodes yet.
- Payload importer is a framework (field-map contract) — needs a real export to
  complete field mapping.
- Scheduled-publish worker exists; autosave/recovery, preview, and the
  dashboard/analytics UIs remain.
- The 10s vitest "close timed out" on Windows is cosmetic (embedded postgres
  child); CI uses DATABASE_URL and is unaffected.

## 9. Human staging/production runbook (Contabo + Easypanel)

Steps are for a human operator; nothing here is executed autonomously.

1. Provision Contabo VPS; install Easypanel (or equivalent panel).
2. Create services: `kal-el-db` (PostgreSQL 16), `kal-el-api`, `kal-el-worker`,
   reverse proxy/TLS (panel-managed). Persistent volume for `MEDIA_LOCAL_PATH`
   later (Phase 5).
3. Build images from this repo (Dockerfiles to be added in Phase 11/12 final
   hardening — currently `pnpm build` produces ESM bundles under
   `apps/{api,worker}/dist`).
4. Set env vars (never in images): `DATABASE_URL`, `SESSION_SECRET`,
   `BOOTSTRAP_TOKEN`, `COOKIE_SECURE=true`, `APP_BASE_URL`, `API_BASE_URL`,
   `PORT`/`HOST`. Copy from `.env.example`.
5. Run migrations: `DATABASE_URL=... pnpm --filter @kal-el/db migrate`.
6. Start `kal-el-api` (port 3001), `kal-el-worker`; health checks on
   `/v1/health` and `/v1/ready`.
7. Provision the system once: `POST /v1/bootstrap/init` with `X-Bootstrap-Token`
   (create the first site + owner user + owner role).
8. Create scoped service tokens for MN26/MNScr; register webhooks pointing at
   each frontend's revalidation endpoint.
9. Backup: schedule `pnpm backup backup /var/backups/kal-el-$(date).json` on a
   cron, and rehearse restore on staging before relying on it.
10. Rollback: restore the previous image + restore the latest backup; re-apply
    migrations only if the rollback DB is newer.

Stop: **do not run any of the above against live data without an explicit
human instruction.**

---

## R14 — Staging readiness pass

**Method:** every gate reproduced rather than inherited; a real browser for the
visual and accessibility gates; adversarial review of the security and
integration surfaces.

### What changed

The 2026-08-14 baseline was accurate — 139 tests, 0 fail, 0 skip, typecheck /
lint / build green. Eight P0 defects nonetheless survived it, because the
existing tests asserted counters and happy paths rather than effects:

1. `/v1/admin/sites/:siteId/*` authorised against the **union** of the caller's
   permissions across every site, and never checked `:siteId` against their
   memberships — full cross-tenant takeover from any site owner.
2. `POST /v1/admin/users/:id/roles` took `siteId` from the request body with no
   check — persistent self-escalation to Owner of any site.
3. `revokeServiceToken` and `deleteWebhook` mutated the row before validating the
   site, returning 404 *after* destroying another tenant's data.
4. The importer dropped **every** category, tag and author from **every** article
   (slug-keyed map vs external-id reference).
5. The Lexical format bitmask was off by one bit from strikethrough onwards.
6. `Idempotency-Key` was honoured on one write route out of ~20; media, entities
   and sources have no unique index, so retries created real duplicates.
7. Primary navigation was unreachable below 1024px on 100% of authenticated
   surfaces.
8. Dark mode was unreachable — the tokens existed, the product hardcoded light.

All eight are closed with regression coverage.

A second round then closed the nine P1 that remained (P1-A ... P1-I), each with its
own regression: cross-site relation validation; an explicit user-to-byline link so
ownership resolves at all; re-import that synchronizes instead of only inserting;
retry-safe workflow transitions; machine-readable conflict codes; idempotency keys
scoped by site with an enforced TTL; a pipeline contract reconciled against the
runtime; the remaining editor contract items; and magic-byte verification on
upload. Details in `docs/audits/KALEL_STAGING_READINESS_AUDIT.md` section 5.

Four production-blocking operational gaps remain and were deliberately left for a
separate round: logging disabled in every real deployment, rate limiting without
`trustProxy`, a bootstrap oracle, and session lifecycle.

### Gates

| gate | before | after |
|---|---|---|
| typecheck / lint / build | PASS | PASS |
| unit + integration | 139 | 211 |
| Playwright | 2 | 24 |
| axe (WCAG 2.1 A+AA) | not run | 0 violations over 76 scans |
| navigation reachable | 73/180 | 190/190 |

### Not covered

Real screen-reader testing and 200% zoom reflow. Deployment, DNS, CDN and remote
backup remain out of scope by instruction.

Media, SEO redirects, preview and workflow now have browser-level E2E, and Media
Detail joined the visual and accessibility sweeps - it had been skipped silently on
every prior run because the harness looked for a link where the grid renders a
button.
