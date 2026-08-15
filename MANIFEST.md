# Manifest

## Bootstrap documents (imported from `kal-el-repository-v2`)

- `.env.example`
- `.gitignore`
- `AGENTS.md`
- `README.md`
- `agents/*.md` (architect, backend, design-system, editor, frontend-cms, migration, qa, reviewer, security, seo)
- `design-system/*` (PEG Product Design System: specs, tokens, references, QA)
- `docs/00-..12-*.md`
- `prompts/00-..06-*.md`
- `apps/.gitkeep`, `packages/.gitkeep`, `docs/adr/.gitkeep`, `docs/progress/.gitkeep`

## Repository tooling

- `.gitattributes`
- `.npmrc`
- `.prettierrc.json`
- `docker-compose.yml`
- `eslint.config.mjs`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.github/workflows/ci.yml`

## Applications

- `apps/api` — Fastify REST `/v1` service (auth, admin, articles, taxonomy, audit, webhooks).
- `apps/worker` — outbox dispatcher: webhook delivery, retry/backoff, dead-letter.
- `apps/fixture` — reference delivery/revalidation fixture (webhook consumer + cache).

## Packages

- `packages/contracts` — zod schemas, types, OpenAPI document.
- `packages/db` — Drizzle schema, migrations, client, migration runner.
- `packages/auth` — Argon2id, opaque tokens, RBAC helpers.
- `packages/testkit` — embedded PostgreSQL, fresh-test-db, seed helpers.
- `packages/design-system` — PEG implementation tokens, primitives, calibration harness.
- `packages/events` — webhook signature (HMAC) + header contract.
- `packages/sdk` — typed MN26/MNScr service client (idempotent, retrying).
- `packages/importer` — WordPress/Payload import pipeline (normalize → dry-run → import → reconcile).
- `packages/editor` — editor engine prototype (TipTap vs Lexical) + ADR-0007.

## Decisions & evidence

- `docs/adr/ADR-0001-..ADR-0006-*.md`
- `scripts/backup.ts` — `pnpm backup <backup|restore> <file.json>`
- `docs/progress/PHASE-0-PREFLIGHT.md`
- `docs/progress/PHASE-1-3-FOUNDATION.md`
