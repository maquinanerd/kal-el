# Phase 11 — Production Hardening (backend)

Status: complete (backend hardening)
Date: 2026-08-14
Prompt: prompts/06-MIGRATION-HARDENING.md (hardening half)

## What was added

- **Backup / restore** (`packages/db/src/backup.ts` + `scripts/backup.ts`,
  `pnpm backup`):
  - Logical, parameterized data dump of all public tables in FK-safe order.
  - Restore truncates and re-inserts (no SQL injection; parameterized values).
  - JSON round-trip (the CLI file format) validated.
  - `pnpm backup backup <file.json>` / `pnpm backup restore <file.json>`.
- **Backup rehearsal tests** (`packages/db/tests/backup.test.ts`, 3 tests):
  - export captures seeded content;
  - full disaster wipe (public + migration journal schemas) → re-migrate →
    restore → byte-identical content;
  - JSON-serialized (CLI path) round-trip identical.
- **Dependency hardening**: upgraded `drizzle-orm` 0.36 → **0.45.2** (fixes a
  high SQL-injection advisory) and `@fastify/swagger-ui` → 6.1.1 (fixes
  `@fastify/static` path-traversal + auth-bypass). `pnpm audit --prod` →
  **no known vulnerabilities**. Drizzle's error wrapping (`DrizzleQueryError`)
  is unwrapped in the API error handler + services so 23505/23503 still map to
  409/400.
- **Rate limiting**: global per-IP limit (600/min) added; login keeps a
  stricter 10/min limit.
- **CI hardening** (`.github/workflows/ci.yml`): added `pnpm audit --prod
  --audit-level high` and **gitleaks** secret scanning.

## Evidence

| Gate | Result |
|---|---|
| `pnpm audit --prod` | no known vulnerabilities |
| backup/restore rehearsal | 3 tests pass (in-memory + disaster + JSON round-trip) |
| full test suite | 80 tests pass (contracts 9, auth 5, db 8, design-system 5, sdk 5, worker 8, api 31, fixture 2, importer 8) |
| typecheck / lint / build | pass |

## Migration implication

The drizzle upgrade regenerated the single baseline migration
(`drizzle/0000_*.sql`). No deployed database exists yet; for any pre-existing
database the runbook must re-apply migrations from scratch (documented in the
final report).
