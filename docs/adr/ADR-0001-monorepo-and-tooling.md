# ADR-0001 — Monorepo, package manager and build/test tooling

Status: Accepted
Date: 2026-08-14
Related: docs/01-ARCHITECTURE.md, docs/11-OPEN-DECISIONS.md

## Context

Kal El is a monorepo with `apps/cms`, `apps/api`, `apps/worker` and multiple
shared packages (`db`, `contracts`, `auth`, `editor`, `media`, `seo`,
`design-system`, `observability`, `testkit`). Open decisions in
`docs/11-OPEN-DECISIONS.md` require choosing package manager/build
orchestration, ORM, auth and queue technology with maturity, security,
maintainability, TypeScript quality, migration ergonomics, testability,
vendor independence and operational simplicity as criteria.

## Decision

- **Package manager:** pnpm workspaces (installed on the machine as v11).
- **Build orchestration:** plain `pnpm -r` scripts. No Turborepo/Nx in v1;
  add caching only when a demonstrated need appears (YAGNI).
- **Runtime:** Node.js >= 22 (LTS baseline; local v24).
- **Language:** TypeScript strict, shared `tsconfig.base.json`.
- **Test runner:** Vitest (unit + integration), with PostgreSQL integration
  tests via Docker.
- **Linting:** ESLint 9 flat config + `typescript-eslint`.
- **Formatting:** Prettier.
- **Engine field:** enforce Node >= 22 via `packageManager`/`engines`.

## Consequences

- Fast, isolated installs; strict `node_modules` prevents phantom dependency
  leakage between packages.
- No build-cache layer in v1; CI times remain acceptable for current size.
- Single package manager (pnpm) enforced with `onlyBuiltDependencies` policy
  for supply-chain hygiene.
- Monorepo script conventions: `dev`, `build`, `typecheck`, `lint`, `test`,
  `migrate` run recursively with `--filter`.
