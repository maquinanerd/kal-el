# Kal El — Autonomous Session Report

Date: 2026-08-14
Branches: `main` (bootstrap) → `feat/foundation-phase-1-3`
Start: bootstrap-only repository. No Git repository existed; `maquinanerd/kal-el` remote is empty.

## What was executed (roadmap order)

| Item | Status | Evidence |
|---|---|---|
| Phase 0 — Preflight | done | `docs/progress/PHASE-0-PREFLIGHT.md`, ADR-0001, git initialized, secret scan clean, PEG SHA-256 35/35 |
| Phase 1 — Foundation | done | monorepo (pnpm), `contracts`/`db`/`auth`/`testkit`, Drizzle schema+migration, Fastify API, OpenAPI, CI, docker-compose |
| Phase 2 — Identity & site isolation | done | bootstrap, email/password sessions + CSRF, scoped service tokens, RBAC per site, negative cross-site tests (403 SITE_SCOPE_MISMATCH) |
| Phase 3 — Editorial core | done | articles (create/get/update/list/cursor), revisions, publish/schedule, taxonomy (categories/tags/entities/authors/sources), audit log, idempotency (advisory-lock), optimistic concurrency |
| DS-0 — Reference audit | done | `docs/progress/DESIGN-SYSTEM-AUDIT.md` |
| DS-1 — Tokens/primitives | done | `packages/design-system` (tokens.css, styles.css, React primitives, 5 unit tests) |
| DS-2 — Calibration screen | done | `dev/main.tsx` harness; desktop/mobile × light/dark screenshots in `docs/progress/calibration-shots/` |
| DS-3 — Visual QA gate | **BLOCKED** | tooling + shots delivered; pixel classification requires a vision-capable reviewer (this model has no image input). Per AGENTS.md 17–18, the full CMS UI inventory is gated until it passes. |
| Phase 6 — SEO | done | redirect CRUD, automatic 301 on slug change, editorial SEO metadata; 3 tests |
| Phase 7 — Workflow/publication | done | outbox dispatcher worker (`apps/worker`), signed webhooks, retry/backoff/dead-letter, exactly-once publish; 5 tests |
| Phase 8–9 — SDK + integrations | done | `@kal-el/sdk` (typed, idempotent, retrying), `@kal-el/events`, `apps/fixture` revalidation proof; 7 tests incl. end-to-end |
| Phase 4–5 — Editor/Media | pending | blocked by DS-3 gate (and editor engine ADR requires prototyping, Phase 4) |
| Phase 10–12 — Importers/hardening/RC | pending | large remaining scope |

## Final gate

- Tests: **67 pass** (contracts 9, auth 5, db 5, design-system 5, sdk 5, worker 5, api 31, fixture 2)
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: all green
- Migration reversibility tested (full down + re-up)
- End-to-end MN26 path proven: SDK create → publish (exactly-once) → outbox → signed webhook → fixture revalidation

## Commits (conventional)

```
chore: import Kal El bootstrap …
chore: monorepo tooling, CI, docker, ADRs and phase evidence
feat: contracts, db schema/migrations, auth core and testkit packages
feat(api): Fastify REST service with auth, RBAC, site isolation, articles and audit
feat(design-system): PEG tokens, primitives, app shell and calibration harness with screenshots
chore: lockfile after design-system deps
feat(worker): outbox dispatcher with signed webhooks, retry/backoff and dead-letter
chore: re-export webhook signature via @kal-el/events; contracts input types and webhook secret
feat(sdk+fixture): typed MN26 service client and signed revalidation fixture with e2e proof
feat(api): editorial SEO redirect lifecycle and automatic 301 on slug change
docs: manifest refresh with new packages
```

## ADRs

ADR-0001 (monorepo/tooling), ADR-0002 (Drizzle), ADR-0003 (Fastify),
ADR-0004 (auth/sessions/tokens), ADR-0005 (idempotency/outbox).

## Known limitations

- **DS-3 visual QA**: blocked on image-capable review (screenshots + procedure provided).
- Embedded-postgres "close timed out" warning on Windows is cosmetic (CI uses DATABASE_URL).
- Editor engine, media (crop/focal), WP/Payload importers, scheduled-publish
  promotion, hardening and the release-candidate report remain for later phases.
