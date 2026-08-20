# Kal El — Backup and Restore

The bundled logical backup utility: what it captures, what it does not, and how restore
behaves.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. Commands

```bash
DATABASE_URL=... pnpm backup backup /var/backups/kal-el-$(date +%F).json
```

```bash
DATABASE_URL=... pnpm backup restore /var/backups/kal-el-2026-08-19.json
```

`pnpm backup` is `tsx scripts/backup.ts`. Usage string, verbatim:

```
usage: pnpm backup <backup|restore> <file.json>
```

`DATABASE_URL` is **required** — the script exits 1 with `DATABASE_URL is required`.

Output lines:

| Operation | Line |
|---|---|
| backup | `backup written to <file> (<N> tables)` |
| restore | `restored <rows> rows across <tables> tables` |
| restore, partial | `skipped <n> table(s) absent from this schema: <names>` |

---

## 2. What a backup contains

```json
{
  "exportedAt": "2026-08-19T18:00:00.000Z",
  "data": {
    "sites": [ { "...": "..." } ],
    "articles": [ { "...": "..." } ]
  }
}
```

| Property | Value |
|---|---|
| Format | JSON, pretty-printed, 2-space indent |
| Table selection | **every** table in schema `public`, except names starting with `__drizzle` |
| Consistency | one transaction at `REPEATABLE READ` — a point-in-time snapshot |
| Paging | keyset on `ctid`, 5000 rows per chunk (constant, not configurable from the CLI) |
| Internal column | the `__ctid` helper is stripped from every row before it is written |

> ### Logical data only — **the schema is not in the backup**
>
> A restore assumes the target database already has the schema, recreated from migrations.
> The dump captures content, not structure. A full recovery is therefore:
> **create database → `pnpm migrate` → `pnpm backup restore`.**

### Table order

Restore uses a fixed foreign-key-parents-first order:

```
sites, users, media, roles, permissions, role_permissions, user_roles,
sessions, service_tokens, categories, tags, entities, authors, sources,
articles, article_revisions, article_authors, article_categories,
article_tags, article_entities, audit_log, outbox_events,
idempotency_keys, redirects, webhooks, webhook_deliveries, worker_heartbeats
```

A table not on this list sorts last. Adding a table with foreign keys to something later in
the list requires updating `TABLE_ORDER` in `packages/db/src/backup.ts`.

### Not included

**Uploaded media files.** The `media` **table** is captured; the bytes under
`MEDIA_LOCAL_PATH` (`/app/uploads`, volume `kalel_media`) are **not**. Back that volume up
separately, or a restore yields a database full of media rows whose files are gone.

---

## 3. How restore behaves

Read this before running it against anything you care about.

1. Tables named in the backup but **absent from the live schema are skipped** and reported —
   never created.
2. Present tables are restored in `TABLE_ORDER`.
3. **Live tables the backup does not mention are TRUNCATEd first**, in reverse dependency
   order.
4. The entire restore is **one transaction** — it either lands completely or not at all.
5. Every named table is `TRUNCATE ... CASCADE`d **even when the snapshot has zero rows for
   it**.
6. The column set is the **union of keys across all rows** in that table; a row missing a
   key is bound as explicit `NULL`.
7. jsonb values are re-serialised and cast with `::jsonb`.
8. Inserts are chunked to stay under PostgreSQL's 65535 bind-parameter cap.

> ### Restore is destructive to the whole database, not just to the tables in the file
>
> Steps 3 and 5 mean a restore **empties every table**, including ones the snapshot never
> mentioned. This is deliberate: a restore after a compromise must not leave the attacker's
> sessions and service tokens behind. It also means a restore is never a partial merge.

**Always restore into a fresh database**, not over a live one, unless you intend to discard
everything currently there.

---

## 4. Recovery procedure

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop api worker cms
```

```bash
createdb kalel_restore
```

```bash
DATABASE_URL=postgresql://kalel:...@host/kalel_restore pnpm migrate
```

```bash
DATABASE_URL=postgresql://kalel:...@host/kalel_restore pnpm backup restore /var/backups/kal-el-2026-08-19.json
```

Then restore the media volume from its own backup, point `DATABASE_URL` at the restored
database, and start the services again.

Verify:

- `GET /ready` returns `{"status":"ready"}`
- `GET /v1/sites/{siteId}/stats` shows the expected counts
- `GET /v1/sites/{siteId}/ops-status` shows the worker `up` and no unexpected backlog
- a spot-checked article renders its images (proving the media volume matched)

---

## 5. Limitations

| Limitation | Consequence |
|---|---|
| Logical only, no schema | run migrations first |
| No `pg_dump` | not compatible with standard PostgreSQL tooling |
| No incremental, no PITR | you lose everything since the last snapshot |
| No compression | JSON of a large archive is large |
| No encryption | the file contains **password hashes, session token hashes and service-token hashes** — protect it as a secret |
| No media files | back up the `kalel_media` volume separately |
| Restore truncates everything | never a partial merge |
| **Nothing schedules a backup** | no cron, no container, no worker task — an operator must schedule it |
| Old snapshots | tables that no longer exist are skipped, not restored |

A snapshot is a credential store. Store it with the same care as `SESSION_SECRET`.

---

## 6. Suggested schedule

Not implemented — this is guidance, not something the repository does for you.

| Frequency | Retention |
|---|---|
| Daily database snapshot | 7 days |
| Weekly | 4 weeks |
| Monthly | 12 months |
| Media volume | with the database, same cadence |

Restore into a scratch database periodically and check the counts. A backup that has never
been restored is a hypothesis.

For a larger installation, `pg_dump` plus WAL archiving is a better primary strategy;
`pnpm backup` remains useful as a portable, human-readable logical export.

---

## Implementation references

- `scripts/backup.ts` — the CLI, argument handling, output lines
- `packages/db/src/backup.ts` — `exportBackup`, `restoreBackup`, `TABLE_ORDER`,
  `EXPORT_CHUNK_ROWS`, the truncate strategy and jsonb handling
- `packages/db/src/migrate.ts` — schema recreation
- `docker-compose.prod.yml` — the `kalel_pgdata` and `kalel_media` volumes
