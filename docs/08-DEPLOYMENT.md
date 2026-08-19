# Deployment Model — Initial Contabo VPS

Kal El must deploy on a Contabo VPS through a container-oriented panel such as Easypanel or an equivalent. Do not hard-code a panel into app architecture.

Conceptual services: `kal-el-cms`, `kal-el-api`, `kal-el-worker`, `kal-el-db`, optional Redis only when justified, reverse proxy/TLS from platform, local persistent media volume initially.

Require container builds, persistent volumes, automated DB backup strategy, staging/prod separation, controlled migrations, no secrets baked into images, health checks and rollback runbook. No autonomous production deployment.

---

## Commands

Everything below runs from the repository root.

```bash
pnpm install            # workspace install
pnpm build              # all apps and packages
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e           # Playwright, against the CMS

pnpm migrate            # apply pending migrations to DATABASE_URL
pnpm bootstrap ...      # create the first site + owner (see below)
pnpm backup backup out.json
pnpm backup restore out.json

pnpm start:api          # node apps/api/dist/server.js
pnpm start:worker       # node apps/worker/dist/worker.js
pnpm start:cms          # next start
```

`pnpm build` must precede any `start:*`; the start scripts run compiled output.

## Container images

| service | Dockerfile | port |
|---|---|---|
| api | `apps/api/Dockerfile` | 3001 |
| worker | `apps/worker/Dockerfile` | — |
| cms | `apps/cms/Dockerfile` | 3000 |

`docker-compose.prod.yml` wires all three plus PostgreSQL 17 and is the reference
topology. It is a template: TLS and the public hostnames belong to the reverse proxy.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Two build-time facts that are easy to get wrong:

- **`NEXT_PUBLIC_API_BASE_URL` is inlined into the browser bundle at build time.** It is
  the origin the user's browser calls, so it must be the public API URL — not the internal
  compose service name. The compose file passes `API_BASE_URL` through as a build arg.
- **The CMS image uses Next.js standalone output**, enabled by `NEXT_OUTPUT=standalone` in
  its Dockerfile. It is not on by default because the trace step creates symlinks, which
  Windows refuses without Developer Mode — leaving it on would break `pnpm build` on a
  developer machine for a reason unrelated to the code.

## Environment

`.env.example` is the complete list, with the reasoning for each value. The ones that
production actively refuses to boot without:

| variable | why it is required |
|---|---|
| `NODE_ENV=production` | every other production guard keys off it, and it defaults to `development` |
| `COOKIE_SECURE=true` | session cookie over plaintext otherwise |
| `SESSION_SECRET` (32+ chars) | also signs preview tokens, which go to external reviewers by design |
| `TRUST_PROXY` | the rate limiter buckets on client IP; see below |
| `LOG_LEVEL` ≠ `silent` | a mute instance makes every other failure invisible |
| `ALLOW_PRIVATE_WEBHOOKS` unset | opt-in SSRF escape hatch, refused in production by API *and* worker |

### `TRUST_PROXY`

The rate limiter is the brute-force control and it keys on the client address. Behind a
reverse proxy with no policy, that address is the proxy for every request: the whole
platform shares one bucket, and ten failed logins from one host answer 429 to everyone.

Accepted forms:

| value | meaning |
|---|---|
| `direct` | no proxy — the socket address is the client address |
| `1` | trust exactly one proxy hop (the usual answer behind Easypanel/Traefik/nginx) |
| `10.0.0.0/8,172.16.0.0/12` | trust these networks |
| `loopback`, `linklocal`, `uniquelocal` | named presets |

`true` is rejected outright. It makes proxy-addr take the left-most `X-Forwarded-For`
entry, which the client writes — so any caller gets a private bucket per request by
spoofing it, which is strictly worse than no proxy at all.

## Health checks

| path | meaning | use for |
|---|---|---|
| `/health`, `/v1/health` | the process is up and the event loop turns | liveness |
| `/ready`, `/v1/ready` | the database is reachable | readiness / load-balancer membership |

Both are registered with and without the `/v1` prefix, because probes are configured with
a bare path far more often than a versioned one. Neither is rate limited. Liveness
deliberately does *not* touch the database: a check that fails during a brief database
blip gets the container killed and restarted into the same blip.

The worker has no HTTP surface. It writes a heartbeat row every tick instead, which the
CMS operational panel reads — see below.

## Provisioning the first owner

```bash
API_BASE_URL=https://api.example.com \
BOOTSTRAP_TOKEN=... \
KALEL_OWNER_PASSWORD=... \
pnpm bootstrap --site-slug portal --site-name "Portal" --email owner@example.com --name "Owner"
```

Prefer the environment variable for the password: an argument is visible in the process
list and in shell history.

Afterwards, **remove `BOOTSTRAP_TOKEN` from the environment.** The route refuses once any
user exists, but there is no reason to keep a credential that mints full-permission
accounts. The endpoint is rate limited to 5 attempts a minute and answers identically for
a wrong token and an already-provisioned system, so it cannot be used to confirm a guess;
the reason goes to the server log instead.

## Shutdown

Both the API and the worker handle `SIGTERM`/`SIGINT` by stopping new work, draining what
is in flight, closing the database pool and then exiting. Give the containers time for it:
`stop_grace_period` is set in the compose file (30s API, 40s worker).

A tick killed mid-flight leaves its claimed outbox rows locked for the full lock window,
so a deploy that `SIGKILL`s the worker delays those deliveries by a minute or more. A
second signal is treated as an operator override and exits immediately.

## Operating it

`Dashboard → Estado operacional` (requires `audit.read`) shows outbox backlog and
failures, scheduled backlog and how much of it is overdue, webhook health, blocked
articles, and whether the worker is alive. Every figure is read from the table the product
actually acts on.

`Administração → Webhooks` lists each subscriber with the outcome of its last delivery,
and can pause one without destroying its signing secret.

An article whose stored document cannot be parsed shows a repair banner in the editor
(requires `articles.recover`): read the raw stored bytes, restore a readable revision, or
replace the body. The previous bytes are preserved as a revision first, and the operation
is audited.

## Backup and restore

```bash
DATABASE_URL=... pnpm backup backup /var/backups/kal-el-$(date +%F).json
DATABASE_URL=... pnpm backup restore /var/backups/kal-el-2026-08-19.json
```

Export reads every table inside one `REPEATABLE READ` transaction, in keyset chunks, so a
large history does not have to be materialised at once and no delete landing mid-export
can produce a dump whose foreign keys do not resolve.

Restore is a single transaction and truncates **every** table first, not only the ones the
snapshot names — restoring a clean snapshot over a compromised database is exactly the
case where a leftover session or service token matters. Tables the snapshot names but this
schema no longer has are skipped and reported.

Rehearse a restore on staging before relying on it.

## Rollback

Restore the previous image and the latest backup. Re-apply migrations only if the database
being rolled back to is newer than the code. There is no down-migration runner; a
destructive schema change needs its reverse written and tested before it ships.

## Stop

**Do not run any of the above against live data without an explicit human instruction.**
