# Phase 0 — Repository Preflight

Status: complete
Date: 2026-08-14

## Mechanical state found

| Item | Finding |
|---|---|
| Git repo | None present at `C:\Users\pablo\Documents\OpenCode\Kal El` or parents; bootstrap-only checkout |
| Remote | `github.com/maquinanerd/kal-el` exists, `isEmpty: true` |
| gh auth | `maquinanerd` authenticated (scopes: gist, read:org, repo, workflow) |
| Toolchain | git 2.55.0, node v24.19.0, npm 11.17.0, pnpm 11.15.1, yarn 1.22.22, docker 29.6.1; no `psql`, no `bun` |
| PEG assets | 20 reference `.webp`; SHA-256 verified 35/35 against `design-system/SHA256SUMS.txt` |
| `.env.example` | Placeholder-only (no secrets) |
| Secret scan | Clean (AWS/Google/GitHub/OpenSSH/Slack patterns across tracked files) |
| Existing code | None (docs/prompts/agents/design-system only) |
| `.gitignore` | Covers node_modules/.next/dist/build/coverage/.env/secret materials |

## Actions taken

1. `git init -b main` — safe: remote is empty, nothing to overwrite.
2. Added `.gitattributes` (`* text=auto eol=lf`, binaries marked binary).
3. Baseline commit: bootstrap import (docs, agents, prompts, PEG design system).
4. Created `docs/adr/ADR-0001-monorepo-and-tooling.md`.
5. This evidence file.

## Decisions recorded

- pnpm workspaces, no Turbo/Nx in v1 (ADR-0001).
- Node >= 22, TS strict, Vitest, ESLint 9 flat + typescript-eslint, Prettier.

## Open items entering Phase 1

- Monorepo scaffold (`apps/*`, `packages/*`), shared tsconfig/eslint/prettier.
- ORM (Drizzle) and API framework (Fastify) ADRs.
- PostgreSQL dev/test via Docker Compose.
- Migration tests, negative site-isolation tests, idempotent automation writes,
  optimistic concurrency.
- CI skeleton (GitHub Actions).

## Verification commands used

```text
git init -b main
git status
Get-FileHash -Algorithm SHA256 (all 35 PEG files, 0 mismatches)
git rev-parse --short HEAD   (baseline commit)
```
