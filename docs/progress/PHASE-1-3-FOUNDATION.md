# Phase 1–3 — Foundation, Identity & Site Isolation, Editorial Core

Status: complete
Date: 2026-08-14
Prompt: prompts/02-FOUNDATION.md
Evidence: tests, typecheck, lint, build

## What was built

- **Monorepo** (pnpm workspaces, ADR-0001): `apps/api`, `packages/{contracts,db,auth,testkit}`.
- **`@kal-el/contracts`**: zod schemas + types + OpenAPI generator (served at `/docs`).
- **`@kal-el/db`**: Drizzle schema for the full editorial domain and versioned
  SQL migration `drizzle/0000_*.sql`; programmatic `runMigrations`; migration
  reversibility tested (down + re-up).
- **`@kal-el/auth`**: Argon2id passwords, opaque session/service tokens, RBAC helpers.
- **`@kal-el/testkit`**: embedded PostgreSQL for local integration tests
  (Docker is also supported via DATABASE_URL; used in CI).
- **`@kal-el/api`** (Fastify): health/ready, bootstrap, login/logout/me,
  admin (sites/users/roles/service-tokens), site-scoped articles + taxonomy +
  audit log; CSRF; scoped service auth; rate limiting on login; OpenAPI.

## Acceptance evidence

| Gate | Command | Result |
|---|---|---|
| Unit + integration tests | `pnpm test` | 47 tests pass (contracts 9, auth 5, db migration 5, api 28) |
| Typecheck | `pnpm typecheck` | all packages pass |
| Lint | `pnpm lint` | all packages pass |
| Build | `pnpm build` | api ESM bundle + package tsc pass |
| Migration reversibility | `packages/db` tests | drop-all down migration re-applies cleanly |
| Negative site isolation | `apps/api` isolation tests | cross-site user/token → 403 `SITE_SCOPE_MISMATCH` |
| Idempotent automation | `apps/api` idempotency tests | replay returns same article; one row; 409 on key reuse |
| Optimistic concurrency | `articles` tests | wrong `If-Match` → 409; correct → version+1 |
| Exactly-once publish | `articles` tests | duplicate publish converges; one `article.published` outbox row |

## Key contracts implemented

- `POST /v1/bootstrap/init` (gated by BOOTSTRAP_TOKEN, once).
- `POST /v1/auth/login|logout`, `GET /v1/auth/me`.
- `POST|PATCH /v1/sites/:siteId/articles`, `GET .../articles` (cursor, filters),
  `.../articles/:id`, `.../revisions`, `.../publish`, `.../schedule`.
- `.../categories|tags|entities|authors|sources` (list + create).
- `.../audit-log` (+ per-object).
- Admin: sites, users, roles, role assignment, service tokens.
- OpenAPI at `/docs`.

## Known limitations / next

- Publish emits outbox events; the worker (`apps/worker`) and webhook delivery
  are Phase 7.
- The 10s "close timed out" vitest warning on Windows is cosmetic: the embedded
  postgres child keeps the event loop alive after tests. CI uses DATABASE_URL
  (no embedded) and is unaffected.
- SEO/redirect schema exists but the SEO lifecycle is Phase 6.
