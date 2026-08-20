# Kal El — Local Development

Getting the API, CMS and worker running, with the real commands.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. Prerequisites

| Requirement | Version |
|---|---|
| Node.js | **≥ 22** (`engines.node`) |
| pnpm | **11.15.1** (`packageManager`) |
| PostgreSQL | 16/17 — or none, if you use the embedded database |

`.npmrc` sets `strict-peer-dependencies=true` and `auto-install-peers=true`.

---

## 2. Fastest path — one command, no database

```bash
pnpm install
```

```bash
pnpm dev:api
```

`scripts/dev-api.ts` is a complete local stack in one process. In order it:

1. starts an **embedded PostgreSQL** if `DATABASE_URL` is unset, and writes the URL into
   `process.env`;
2. injects development defaults for `BOOTSTRAP_TOKEN`, `ALLOW_PRIVATE_WEBHOOKS` and
   `SESSION_SECRET`;
3. applies all migrations;
4. seeds permissions and preset roles;
5. **bootstraps the first site and owner if the `users` table is empty**;
6. listens, and prints the API URL, the `/docs` URL and the login line.

It creates site `portal-a` ("Portal A") and owner `owner@kalel.dev` with the fixed
development password printed on startup. These are hard-coded and not configurable.

The CMS is a separate process:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @kal-el/cms dev
```

---

## 3. Full stack — API + CMS + worker on a shared database

The worker needs the *same* database as the API, so the embedded-per-process database of
`dev:api` will not do. Start a persistent local cluster first:

```bash
node packages/testkit/dev-db.mjs
```

It prints `[dev-db] ready: postgresql://kalel:kalel@localhost:55432/kalel`.
Port is `KALEL_DEV_DB_PORT` (default **55432**), data directory `KALEL_DEV_DB_DIR`
(default `%LOCALAPPDATA%/kal-el-local-pg`), and it is persistent across restarts.

Then, in three terminals, **with the environment exported** (see
[ENVIRONMENT.md](ENVIRONMENT.md) — nothing loads `.env` for you):

```bash
set -a && . ./.env && set +a && pnpm dev:api
```

```bash
set -a && . ./.env && set +a && pnpm --filter @kal-el/worker dev
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @kal-el/cms dev
```

On Windows PowerShell there is no `set -a`; export each variable, or run through Git Bash.

---

## 4. Docker PostgreSQL instead

`docker-compose.yml` contains **one** service — the database. There is no api/cms/worker
service in the development compose file.

```bash
docker compose up -d db
```

`postgres:16-alpine`, published on **5432**, user/password/db all `kalel`, volume
`kalel_pgdata`, healthcheck `pg_isready`.

Then:

```bash
DATABASE_URL=postgresql://kalel:kalel@localhost:5432/kalel pnpm migrate
```

---

## 5. Root scripts

| Script | Command |
|---|---|
| `pnpm build` | `pnpm -r build` |
| `pnpm dev` | `pnpm -r --parallel dev` |
| `pnpm typecheck` | `pnpm -r typecheck` |
| `pnpm lint` | `pnpm -r lint` |
| `pnpm test` | `pnpm -r test` |
| `pnpm test:unit` | `pnpm -r test:unit` |
| `pnpm test:integration` | `pnpm -r test:integration` |
| `pnpm test:e2e` | `pnpm --filter @kal-el/cms test:e2e` |
| `pnpm format` / `format:check` | prettier |
| `pnpm migrate` | `pnpm --filter @kal-el/db migrate` → `drizzle-kit migrate` |
| `pnpm backup` | `tsx scripts/backup.ts` |
| `pnpm bootstrap` | `tsx scripts/bootstrap.ts` |
| `pnpm dev:api` | `tsx scripts/dev-api.ts` |
| `pnpm dev:site` | design-system harness (Vite) |
| `pnpm start:api` / `start:worker` / `start:cms` | run **compiled** output |

> **`pnpm build` must precede any `start:*`.** The start scripts run compiled output —
> `dist/` for the API and worker, `apps/cms/.next` for the CMS — not source.

---

## 6. Database

### Migrations

Drizzle SQL files in `packages/db/drizzle/` (`0000_furry_psynapse.sql` …
`0005_hot_sabretooth.sql`, plus `meta/`).

| Mechanism | How |
|---|---|
| CLI | `pnpm migrate` |
| Programmatic | `runMigrations(connectionString)` from `@kal-el/db` |
| On API boot | `RUN_MIGRATIONS=true` (strict literal — `"1"` does not work) |
| `pnpm dev:api` | always, unconditionally |
| Tests | `freshTestDb()` drops `public` and `drizzle`, recreates, migrates |

The folder is `MIGRATIONS_FOLDER`, defaulting next to the package.

Generating a new migration after a schema change:

```bash
pnpm --filter @kal-el/db generate
```

> **There is no down-migration runner.** A destructive schema change needs its reverse
> written and tested before it ships. Reverse SQL exists only as fixtures inside
> `packages/db/tests/migration.test.ts`.

### Seeding

The API seeds on every boot, idempotently:

- `seedPermissions()` — inserts any permission key from `ALL_PERMISSIONS` not already present;
- `ensurePresetRoles()` — creates the preset roles and their permission sets.

### Bootstrap — the first site and owner

There is exactly one way to create the first user: `POST /v1/bootstrap/init`, guarded by
the `x-bootstrap-token` header. `pnpm bootstrap` wraps it:

```bash
API_BASE_URL=http://localhost:3001 BOOTSTRAP_TOKEN=... KALEL_OWNER_PASSWORD=... pnpm bootstrap --site-slug portal --site-name "Portal" --email owner@example.com --name "Owner"
```

- `BOOTSTRAP_TOKEN` and `KALEL_OWNER_PASSWORD` are **required** and read from the
  environment (the env var wins over the flag). Prefer the env var — a command-line
  argument is visible in the process list and shell history.
- Required flags: `--site-slug`, `--site-name`, `--email`, `--name`.
- The endpoint is **one-shot**: once any user exists it refuses.
- A wrong token and an already-provisioned system produce the **identical** refusal, so the
  endpoint cannot confirm a guessed token. The distinction is in the server log.

After provisioning, mint a service token for automation:
`POST /v1/admin/sites/{siteId}/service-tokens` — see
[../integrations/EXTERNAL_CLIENT_API.md §4](../integrations/EXTERNAL_CLIENT_API.md#4-service-tokens).

---

## 7. Ports

| Service | Port |
|---|---|
| API | **3001** (`PORT`), host `0.0.0.0` |
| CMS | **3000** |
| Swagger UI | `/docs` on the API (on by default outside production) |
| Docker PostgreSQL | 5432 |
| `dev-db.mjs` PostgreSQL | **55432** |
| Playwright API / CMS | 3101 / 3100 |

---

## 8. Tests

| Command | Scope |
|---|---|
| `pnpm test` | every package's `test` script |
| `pnpm test:unit` | pure unit tests (`auth`, `contracts`, `editor`, `sdk`) |
| `pnpm test:integration` | anything needing a database (`api`, `worker`, `db`, `importer`) |
| `pnpm test:e2e` | Playwright, from `apps/cms` |

Integration tests **do not need a running database**: `packages/testkit` starts an embedded
PostgreSQL on a free port when `DATABASE_URL` is unset, and `freshTestDb()` gives each run
a clean schema.

Playwright overrides a fixed set of variables per web server **on top of the inherited
shell environment** — API on 3101, CMS on 3100, `ENABLE_DOCS=true`, an empty
`DATABASE_URL` so an embedded database starts. Anything outside that list (`NODE_ENV`,
`LOG_LEVEL`, `RUN_MIGRATIONS`, `COOKIE_SECURE`, `TRUST_PROXY`, `MEDIA_*`) is inherited, so
an exported `NODE_ENV=production` reaches the e2e API and trips its production guards.

`@kal-el/cms` has **no** `test` script (only `test:e2e`); `@kal-el/events` and
`@kal-el/testkit` have none at all.

---

## 9. Known traps

| Trap | Detail |
|---|---|
| **`.env` is not loaded** | The API, worker and scripts read `process.env` only. Export the variables — see [ENVIRONMENT.md §1](ENVIRONMENT.md#1-env-is-not-loaded-automatically). |
| **`next build` while `next dev` runs** | Both use `apps/cms/.next`; the build corrupts the running dev server. Stop `dev` first. |
| **`pnpm start:*` without `pnpm build`** | The start scripts run compiled output (`dist/` for API and worker, `apps/cms/.next` for the CMS), which will not exist. |
| **`RUN_MIGRATIONS=1`** | Only the literal `"true"` works. |
| **`LOG_LEVEL=trace` or `fatal`** | Valid for the API, **rejected by the worker** — the worker's enum is narrower. |
| **`ALLOW_PRIVATE_WEBHOOKS=1`** | Truthy for the API, falsy for the worker. Use `true`. |
| **Worker on a different database from the API** | `pnpm dev:api` starts its own embedded instance. Use `dev-db.mjs` and point both at it. |
| **Stale docstring** | `packages/testkit/dev-db.mjs` says `node scripts/dev-db.mjs`; the file is at `packages/testkit/dev-db.mjs`. |

---

## 10. Repository layout

```
apps/
  api/        Fastify HTTP API — the only writer of record
  cms/        Next.js editorial interface
  worker/     scheduler + outbox dispatcher (no HTTP surface)
  fixture/    reference webhook consumer, used by the e2e tests
packages/
  auth/       password hashing, token generation, RBAC resolution
  contracts/  zod schemas + OpenAPI registry — the shared contract
  db/         drizzle schema, migrations, client, backup/restore
  design-system/  PEG React components and tokens
  editor/     Tiptap and Lexical bindings for the document schema
  events/     webhook signing and header constants
  importer/   HTML/WordPress → article document conversion (library)
  sdk/        TypeScript client for the API
  testkit/    embedded PostgreSQL and test helpers
scripts/
  backup.ts   logical backup/restore CLI
  bootstrap.ts  first site + owner
  dev-api.ts  single-command local stack
```

---

## Implementation references

- `package.json` — root scripts, engines, packageManager
- `scripts/dev-api.ts`, `scripts/bootstrap.ts`, `scripts/backup.ts`
- `packages/testkit/dev-db.mjs`, `packages/testkit/src/index.ts`
- `packages/db/src/migrate.ts`, `packages/db/drizzle.config.ts`, `packages/db/drizzle/`
- `apps/api/src/server.ts` — boot order, migrations, seeding, graceful shutdown
- `apps/api/src/services/seed.ts`, `apps/api/src/services/roles.ts`
- `apps/cms/playwright.config.ts`, `apps/cms/next.config.mjs`
- `docker-compose.yml`
