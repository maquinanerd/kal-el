# Kal El — Environment Variables

Every variable the code actually reads, with its real default, validation and effect.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

> **No secret value appears in this document.** Only variable names.

---

## 1. `.env` is not loaded automatically

**The API, the worker and the scripts do not read a `.env` file. At all.**

There is no `dotenv` dependency, no `import "dotenv/config"`, no `dotenv.config()` call and
no `node --env-file` flag anywhere in the repository. Both config loaders read
`process.env` directly:

```ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig
```

Container commands carry no flags either (`CMD ["node", "dist/server.js"]`), and neither do
the npm scripts (`"start": "node dist/server.js"`).

A `.env` file **does** exist at the repository root. It is gitignored and dockerignored, and
**nothing in the API, worker or scripts source reads it**. Running `pnpm start:api` in a
shell that has not exported these values silently uses the schema defaults — which include
`DATABASE_URL=postgresql://kalel:kalel@localhost:5432/kalel` and
`SESSION_SECRET=development-only-secret`.

This is documented, not fixed — see [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

### The four ways values actually arrive today

| # | Mechanism | Applies to |
|---|---|---|
| 1 | Exported in the invoking shell | the only path for `pnpm start:api`, `start:worker`, `backup`, `bootstrap`, `migrate` |
| 2 | Compose `environment:` blocks, interpolated from `docker compose --env-file .env.prod` | production deployment |
| 3 | Docker build `ARG`/`ENV` baked into the image | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_OUTPUT`, `NODE_ENV=production` |
| 4 | Written into `process.env` by a script at runtime | `scripts/dev-api.ts`, `playwright.config.ts` |

On Windows PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://kalel:kalel@localhost:5432/kalel"; pnpm start:api
```

**Exception — the CMS.** `apps/cms` runs on Next.js, and Next loads `.env` / `.env.local`
itself. That behaviour is in the framework, not this repository. Note that
`NEXT_PUBLIC_API_BASE_URL` is **inlined at build time**, so a runtime `.env` cannot change
it in a built image.

---

## 2. API — `apps/api/src/config.ts`

Validated by zod at boot. An invalid value throws
`Invalid environment configuration: {...fieldErrors}` and the process exits.

| Variable | Required | Default | Format | Purpose | Secret |
|---|---|---|---|---|---|
| `NODE_ENV` | no | `development` | enum `development` \| `test` \| `production` | gates every production guard | no |
| `PORT` | no | `3001` | positive int | listen port | no |
| `HOST` | no | `0.0.0.0` | string | listen address | no |
| `DATABASE_URL` | no | `postgresql://kalel:kalel@localhost:5432/kalel` | non-empty string | PostgreSQL connection | **yes** |
| `APP_BASE_URL` | no | `http://localhost:3000` | URL | CMS origin; preview `url`; CORS fallback | no |
| `API_BASE_URL` | no | `http://localhost:3001` | URL | own origin; builds media `url` and preview `dataUrl` | no |
| `SESSION_SECRET` | **in production** | `development-only-secret` | non-empty; **≥32 chars in production** | signs **preview tokens** (HMAC-SHA256). It does **not** sign sessions — see the note below | **yes** |
| `SESSION_TTL_DAYS` | no | `30` | positive int | session ceiling at login | no |
| `SESSION_IDLE_TIMEOUT_MINUTES` | no | `720` (12 h) | positive int | idle expiry | no |
| `SESSION_ABSOLUTE_TIMEOUT_MINUTES` | no | `43200` (30 d) | positive int | absolute expiry; also caps `SESSION_TTL_DAYS` | no |
| `SESSION_ROTATE_MINUTES` | no | `60` | positive int | session-token rotation interval | no |
| `COOKIE_SECURE` | **in production** | `false` | **only the literal `"true"` enables it** — `"1"` does not | `secure` flag on cookies | no |
| `CORS_ORIGINS` | no | `""` | comma-separated list | CORS allow-list; falls back to `[APP_BASE_URL]` | no |
| `TRUST_PROXY` | **in production** | `false` | see below | Fastify `trustProxy`; decides `req.ip`, the rate-limit bucket | no |
| `ENABLE_DOCS` | no | `false` | literal `"true"` | mounts Swagger UI at `/docs`. **Docs are on anyway when `NODE_ENV != production`** | no |
| `BOOTSTRAP_TOKEN` | no (route disabled without it) | unset | any string | compared constant-time against `x-bootstrap-token` | **yes** |
| `MEDIA_STORAGE_PROVIDER` | no | `local` | enum — **`local` is the only accepted value** | storage backend | no |
| `MEDIA_LOCAL_PATH` | no | `./uploads` | non-empty string | local media root | no |
| `MEDIA_MAX_BYTES` | no | `26214400` (25 MiB) | positive int | multipart limit and upload validation | no |
| `LOG_LEVEL` | no | `production→info`, `development→debug`, `test→silent` | enum `silent` \| `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | pino level | no |
| `ALLOW_PRIVATE_WEBHOOKS` | no | `false` | `true` \| `"true"` \| `"1"` | permits webhook targets on private/loopback addresses | no |

Read **outside** the schema, unvalidated:

| Variable | Default | Note |
|---|---|---|
| `RUN_MIGRATIONS` | unset | strict `=== "true"` — `"1"` and `"TRUE"` do **not** work. Applies migrations on boot. |
| `SHUTDOWN_GRACE_MS` | `15000` | `Number(...)` with no validation; a non-numeric value yields `NaN` |

> ### `SESSION_SECRET` does not sign sessions
>
> Its only two runtime uses are `createPreviewToken` and `verifyPreviewToken`. Session and
> CSRF tokens are random opaque values (`generateOpaqueToken`) stored as **unkeyed**
> SHA-256 hashes, and `@fastify/cookie` is registered without a secret — so cookies are not
> signed either. Rotating `SESSION_SECRET` invalidates outstanding **preview tokens only**
> and logs nobody out.

### `TRUST_PROXY` values

| Value | Meaning |
|---|---|
| `false` (the default) | no proxy — use the socket address. **Refused in production.** |
| `""` (set but empty) | behaves identically to `false`, but is **not** refused in production — the guard compares against the literal `"false"` only |
| `direct` | explicitly "no proxy"; the production-safe way to say `false` |
| `1`, `2`, … | trust exactly N nearest proxies (hop count) |
| `10.0.0.0/8,172.16.0.0/12` | CIDR / IP allow-list |
| `loopback`, `linklocal`, `uniquelocal` | named presets |
| `true` | **throws in every environment** — it trusts the client-written left-most `X-Forwarded-For`, which is spoofable per request |

### Production guards — the API refuses to boot when

1. `COOKIE_SECURE` is not `true`;
2. `SESSION_SECRET` is still `development-only-secret`;
3. `SESSION_SECRET` is shorter than 32 characters;
4. `ALLOW_PRIVATE_WEBHOOKS` is enabled;
5. `LOG_LEVEL` is `silent`;
6. `TRUST_PROXY` is `false` — the policy must be stated explicitly, including `direct`.

---

## 3. Worker — `apps/worker/src/config.ts`

| Variable | Required | Default | Format | Purpose | Secret |
|---|---|---|---|---|---|
| `DATABASE_URL` | no | same default as the API | non-empty string | pg pool | **yes** |
| `NODE_ENV` | no | `development` | **plain string, not an enum** (unlike the API) | gates the two production guards | no |
| `POLL_INTERVAL_MS` | no | `1000` | positive int | tick period | no |
| `SCHEDULER_BATCH_SIZE` | no | `100` | positive int, **max 1000** | articles promoted per tick | no |
| `OUTBOX_BATCH_SIZE` | no | `20` | positive int, **max 500** | outbox events claimed per tick | no |
| `SHUTDOWN_GRACE_MS` | no | **`20000`** | positive int, validated | forced-exit timer | no |
| `ALLOW_PRIVATE_WEBHOOKS` | no | unset | **only the literal `"true"`** | disables the delivery-time SSRF re-check | no |
| `LOG_LEVEL` | no | as the API | enum `silent` \| `error` \| `warn` \| `info` \| `debug` — **narrower than the API's** | logger level | no |

### Three real asymmetries between API and worker

1. **`LOG_LEVEL`**: the worker's enum lacks `fatal` and `trace`. A shared environment
   setting `LOG_LEVEL=trace` boots the API and **crashes the worker**.
2. **`SHUTDOWN_GRACE_MS`**: default 20000 and zod-validated in the worker; default 15000 and
   read with a bare `Number()` in the API.
3. **`ALLOW_PRIVATE_WEBHOOKS=1`** is truthy for the API and **falsy for the worker**, which
   compares against the literal `"true"`. Always use `true`.

Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

---

## 4. CMS — `apps/cms`

There is **no config module**; the CMS reads exactly two variables.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | no | `http://localhost:3001` | API origin for browser fetches — **inlined at build time** |
| `NEXT_OUTPUT` | build only | unset | `standalone` enables Next's standalone output; set only in the Dockerfile |

`PORT` and `HOSTNAME` appear in the Dockerfile and compose but are consumed by the Next
server itself, never by application code.

There is no CMS-side session, auth or secret variable — the CMS holds no credential; the
browser's cookie is the credential.

---

## 5. Scripts and tooling

| Variable | Used by | Required | Note |
|---|---|---|---|
| `DATABASE_URL` | `scripts/backup.ts` | **yes — hard fail** | |
| `API_BASE_URL` | `scripts/bootstrap.ts` | no (`http://localhost:3001`) | `--api` overrides |
| `BOOTSTRAP_TOKEN` | `scripts/bootstrap.ts` | **yes — hard fail** | **env wins over `--token`** |
| `KALEL_OWNER_PASSWORD` | `scripts/bootstrap.ts` | **yes — hard fail** | prefer the env var: an argument is visible in the process list |
| `DATABASE_URL` | `scripts/dev-api.ts` | no | when unset, starts an embedded PostgreSQL and writes the URL back into `process.env` |
| `BOOTSTRAP_TOKEN`, `SESSION_SECRET`, `ALLOW_PRIVATE_WEBHOOKS` | `scripts/dev-api.ts` | no | development values are injected when unset |
| `DATABASE_URL` | `drizzle.config.ts`, `packages/testkit` | no | testkit starts an embedded PostgreSQL when unset |
| `MIGRATIONS_FOLDER` | `packages/db/src/migrate.ts` | no | defaults next to the package; set to `/app/drizzle` in production. **Absent from `.env.example`** |
| `KALEL_DEV_DB_PORT` | `packages/testkit/dev-db.mjs` | no (`55432`) | **absent from `.env.example`** |
| `KALEL_DEV_DB_DIR` | `packages/testkit/dev-db.mjs` | no | data dir for the local cluster. **Absent from `.env.example`** |

`scripts/dev-api.ts` hard-codes the local owner (`owner@kalel.dev`) and site (`portal-a`);
those are not configurable.

---

## 6. Container and orchestration variables

| Variable | Where | Note |
|---|---|---|
| `POSTGRES_USER` | both compose files | hard-coded `kalel` |
| `POSTGRES_PASSWORD` | dev: `kalel`; prod: `${POSTGRES_PASSWORD:?set in .env.prod}` | **secret**; compose aborts if unset in production |
| `POSTGRES_DB` | both | hard-coded `kalel` |

Production compose **refuses to start** without: `POSTGRES_PASSWORD`, `DATABASE_URL`,
`SESSION_SECRET`, `APP_BASE_URL`, `API_BASE_URL`, `TRUST_PROXY`.

Compose-level defaults: `BOOTSTRAP_TOKEN` (empty), `CORS_ORIGINS` (empty),
`LOG_LEVEL=info`, `SESSION_IDLE_TIMEOUT_MINUTES=720`,
`SESSION_ABSOLUTE_TIMEOUT_MINUTES=43200`, `SESSION_ROTATE_MINUTES=60`,
`MEDIA_MAX_BYTES=26214400`, `POLL_INTERVAL_MS=1000`, `OUTBOX_BATCH_SIZE=20`,
`SCHEDULER_BATCH_SIZE=100`.

Hard-coded in production compose: `NODE_ENV=production`, `COOKIE_SECURE=true`,
`RUN_MIGRATIONS=true`, `MIGRATIONS_FOLDER=/app/drizzle`, `MEDIA_STORAGE_PROVIDER=local`,
`MEDIA_LOCAL_PATH=/app/uploads`, `PORT=3001`, `HOST=0.0.0.0`.

---

## 7. Test-only variables

| Variable | Default | Purpose |
|---|---|---|
| `CMS_URL` | `http://localhost:3000` | visual sweep target |
| `API_URL` | `http://localhost:3001` | visual sweep API |
| `KALEL_EMAIL` | `owner@kalel.dev` | sweep login |
| `KALEL_PASSWORD` | *(development value)* | sweep login |

Playwright injects a fixed environment per web server rather than inheriting the shell's:
API on port 3101, CMS on 3100, an empty `DATABASE_URL` (so an embedded PostgreSQL starts),
plus its own bootstrap token, session secret and `ENABLE_DOCS=true`.

---

## 8. Minimum sets

### Local development

```
DATABASE_URL
```

Everything else has a working default. Or use `pnpm dev:api`, which needs nothing.

### Production API

```
NODE_ENV=production
DATABASE_URL=<secret>
SESSION_SECRET=<32+ random chars, secret>
COOKIE_SECURE=true
TRUST_PROXY=<hop count, CIDR list, or "direct">
APP_BASE_URL=https://cms.example.com
API_BASE_URL=https://api.example.com
CORS_ORIGINS=https://cms.example.com
MEDIA_LOCAL_PATH=/app/uploads
RUN_MIGRATIONS=true          # or run migrations as a separate step
```

Plus `BOOTSTRAP_TOKEN` **only while provisioning the first owner** — remove it afterwards.

### Production worker

```
NODE_ENV=production
DATABASE_URL=<secret>
LOG_LEVEL=info               # must be within the worker's narrower enum
```

### Production CMS

```
NEXT_PUBLIC_API_BASE_URL=https://api.example.com   # at BUILD time
```

---

## 9. Secret handling

| Variable | Rotation |
|---|---|
| `SESSION_SECRET` | rotating invalidates every outstanding **preview token**. It does **not** log anyone out — sessions are database-backed opaque tokens. To invalidate sessions, delete rows from `sessions` (or call `POST /v1/auth/logout-all` per user) |
| `DATABASE_URL` | standard credential rotation; both API and worker must be updated |
| `BOOTSTRAP_TOKEN` | remove after provisioning; the route refuses once a user exists |
| `POSTGRES_PASSWORD` | must match `DATABASE_URL` |
| Webhook secrets | **not rotatable** — replace the webhook |
| Service tokens | revoke and re-mint; see [../integrations/EXTERNAL_CLIENT_API.md §4](../integrations/EXTERNAL_CLIENT_API.md#4-service-tokens) |

Never log a secret, never place one in a URL, never commit `.env`.

---

## Implementation references

- `apps/api/src/config.ts` — the API schema, `trustProxySetting`, `corsOrigins`, production guards
- `apps/api/src/server.ts` — `RUN_MIGRATIONS`, `SHUTDOWN_GRACE_MS`, graceful shutdown
- `apps/worker/src/config.ts` — the worker schema and its guards
- `apps/cms/lib/api.ts`, `apps/cms/next.config.mjs` — the two CMS variables
- `scripts/bootstrap.ts`, `scripts/backup.ts`, `scripts/dev-api.ts`
- `packages/db/src/migrate.ts` — `MIGRATIONS_FOLDER`
- `packages/testkit/src/index.ts`, `packages/testkit/dev-db.mjs`
- `docker-compose.yml`, `docker-compose.prod.yml`, `apps/*/Dockerfile`
- `.env.example` — the maintained template
