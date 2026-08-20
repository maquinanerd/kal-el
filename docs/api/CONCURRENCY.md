# Kal El — Versioning and Concurrency

How Kal El prevents a lost update when two actors write the same article, and exactly what
a client must send and handle.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The short answer

> **If two processes change the same article, how does Kal El stop a lost update?**
>
> Every article carries an integer `version`. Every write that changes an article is a
> **guarded `UPDATE`** whose `WHERE` clause includes `version = <the value that was read>`.
> If another actor committed in between, the `UPDATE` matches zero rows and the request
> fails with **`409 VERSION_CONFLICT`** instead of overwriting. On top of that, a client
> may send **`If-Match: <version>`** to be refused *before* any work is done when its
> snapshot is already stale.
>
> The guarded `UPDATE` is unconditional and applies to every mutating path. `If-Match` is
> optional and is what turns "the server noticed a race" into "the server refused my
> stale snapshot". Without `If-Match`, a `PATCH` issued against an old snapshot that wins
> the race will still apply — last-write-wins on the fields it carries.

---

## 2. `version`

| Property | Value |
|---|---|
| Field | `version` (on the article body; column `articles.version`) |
| Type | integer, `NOT NULL DEFAULT 0` |
| Initial value | **`0`** on create |
| Increment | **`+1` on every successful mutating write** |
| Scope | per article |
| Exposed on | `articleSchema` and `articleSummarySchema` — every article read |

Operations that increment it:

| Operation | Increments |
|---|---|
| `PATCH /articles/{id}` | yes |
| `POST .../submit`, `/approve`, `/reject`, `/unpublish`, `/archive` | yes |
| `POST .../publish` | yes |
| `POST .../schedule` | yes |
| `POST .../document/replace` | yes |
| Worker promoting a scheduled article | yes |
| Worker blocking an unpublishable article | yes |
| `POST /articles` (create) | n/a — starts at `0` |
| Any `GET` | no |
| Media, taxonomy and redirect writes | n/a — those tables have no version column |

Two notes:

- A transition that is **absorbed as a no-op** (re-`submit` on an already-`in_review`
  article) returns early and does **not** increment. The client sees the same version back.
  This does **not** apply to `/approve` and `/unpublish`, whose target is `draft`: replaying
  either on an article already in `draft` is `409 INVALID_TRANSITION`, not a 200.
- Publishing an already-published article with a `publishedAt` returns early and does not
  increment either.

There is no `ETag` header. The version travels in the response body.

---

## 3. `If-Match`

| Property | Value |
|---|---|
| Header | `If-Match` |
| Value | a **bare integer**, e.g. `If-Match: 4` |
| Quoted ETag (`"4"`) | `400 VALIDATION_ERROR` — "invalid If-Match header" |
| Required? | **No.** Absent means "no precondition". |
| Accepted on | `PATCH /v1/sites/{siteId}/articles/{articleId}` and `POST /v1/sites/{siteId}/articles/{articleId}/document/replace` |
| Ignored on | every other route, including all workflow transitions |
| Mismatch | `409 VERSION_CONFLICT` before any write |

Parsing is `Number(headerValue)` followed by `Number.isInteger`. So `4` works — and so does
anything `Number()` coerces to an integer, such as `4.0` or ` 4 `. `"4"`, `4.5`, `W/"4"`
and `abc` do not. An empty header is treated as absent.

```http
PATCH /v1/sites/{siteId}/articles/{articleId} HTTP/1.1
Authorization: Bearer ke_st.REDACTED
Content-Type: application/json
If-Match: 4

{ "title": "Updated headline" }
```

---

## 4. `VERSION_CONFLICT`

Two producers, distinguishable by their `details`.

### a. Precondition failure — checked before the write

```json
{ "error": { "code": "VERSION_CONFLICT",
  "message": "version mismatch: the article was modified by another actor",
  "details": { "currentVersion": 7, "expectedVersion": 4, "requestId": "..." } } }
```

Your `If-Match` did not match the stored version. Nothing was written.

### b. Lost race — the guarded `UPDATE` matched no row

```json
{ "error": { "code": "VERSION_CONFLICT",
  "message": "article changed concurrently",
  "details": { "expectedVersion": 6, "currentVersion": 7, "currentStatus": "published", "requestId": "..." } } }
```

Raised when someone committed between this request's read and its write. This can happen
**even without `If-Match`** and on **every workflow transition**. Note the extra
`currentStatus` — enough for a client to decide whether its transition still makes sense
without a second round trip.

| `details` field | Present in (a) | Present in (b) |
|---|---|---|
| `expectedVersion` | yes | yes |
| `currentVersion` | yes | yes (may be `null` if the article was deleted) |
| `currentStatus` | no | yes |

> **`POST .../document/replace` is a third shape.** Its lost-race path throws the same
> code and the same message without re-reading, so `details` carries `expectedVersion`
> **only**. A client must not assume `details.currentVersion` exists on every
> `VERSION_CONFLICT` — re-`GET` the article for the current state.

---

## 5. Reconciling a conflict

`409 VERSION_CONFLICT` is **not** a transient failure. Re-sending the same body with the
same `If-Match` will fail identically, forever.

```
409 VERSION_CONFLICT
   |
   v
GET /v1/sites/{siteId}/articles/{articleId}     <- fresh state and fresh version
   |
   v
decide:
   - is my change still meaningful against this new state?
   - did the other writer already make it?
   - do my changes conflict with theirs semantically?
   |
   +-- still wanted --> re-apply MY fields onto the NEW state
   |                    PATCH with If-Match: <new version>
   |
   +-- superseded ----> drop it, log it, move on
   |
   +-- ambiguous -----> escalate to a human; do not guess
```

```python
def patch_with_reconcile(client, site, article_id, mutate, attempts=3):
    """mutate(current_article) -> dict of fields to PATCH"""
    for _ in range(attempts):
        current = client.get_article(site, article_id)
        body = mutate(current)
        if not body:
            return current                       # nothing left to do
        try:
            return client.patch_article(site, article_id, body,
                                        if_match=str(current["version"]))
        except KalElError as e:
            if e.code != "VERSION_CONFLICT":
                raise
            continue                             # re-read and re-apply
    raise RuntimeError("could not converge; escalating")
```

**Bound the loop.** An article under continuous editing can starve an automated writer
indefinitely; after a few attempts, surface it rather than spinning.

---

## 6. Why the guard applies even without `If-Match`

Every mutating statement **issued by the API** carries the version in its `WHERE`:

```sql
UPDATE articles
   SET status = 'published', version = <read version> + 1, ...
 WHERE id = $1 AND site_id = $2 AND version = <read version>
```

If it returns no row, the code re-reads the article **on the same transaction** and raises
`VERSION_CONFLICT` with the current values. (That re-read is in `concurrentChange`, used by
`updateArticle` and every transition. `replaceDocument` raises the same code and message
without it, so its `details` has `expectedVersion` alone.) Reading on the caller's own transaction is
deliberate: taking a second pooled connection under contention — the exact condition this
code exists to report — would exhaust the pool and turn an immediate 409 into a 500 after
the connection timeout.

The worker's two statements are the exception: promotion guards on
`id AND status = 'scheduled' AND scheduled_at <= now()` and blocking on
`id AND status = 'scheduled'`. Both still bump the version (`version = version + 1`), so a
client holding a pre-promotion version loses its own guarded write and gets the 409.

Nothing sets an isolation level, so transactions run at PostgreSQL's default
**READ COMMITTED**. The version guard, not the isolation level, is what provides the
mutual exclusion.

So: a workflow transition can return `409 VERSION_CONFLICT` even though those endpoints do
not accept `If-Match`. Clients must handle it on every mutating call.

---

## 7. What `If-Match` does *not* protect

| Not protected | Why | What to do |
|---|---|---|
| `POST /articles` | there is no prior version to match | use `externalKey` |
| Media metadata (`PATCH /media/{id}`) | no version column | last-write-wins |
| Taxonomy `PATCH`/`DELETE` | no version column | last-write-wins |
| Redirects | no version column | unique on `(siteId, sourcePath)` |
| Sites, users, roles, tokens, webhooks | no version column | last-write-wins |
| Two clients racing to create the same `externalKey` | not a version problem | the unique index resolves it; the loser sees `409 CONFLICT` with `details.constraint = "articles_site_external_key_unique"` |

Only articles are version-guarded. For everything else, a write from an old snapshot
silently wins.

---

## 8. Interaction with the other mechanisms

| Combination | Effect |
|---|---|
| `If-Match` on `PATCH` | honoured — the only concurrency control that route has |
| `Idempotency-Key` on `PATCH` | **ignored** — the route never reads it |
| `Idempotency-Key` on a transition | honoured; a replay returns the stored response and never re-enters the guarded `UPDATE` |
| `If-Match` on a transition | **ignored** — but the internal guard still applies |
| Both on `document/replace` | both honoured: the key wraps the whole operation, `If-Match` is checked inside it |

A replayed idempotent request returns the **original** response, including the version as
it was at first execution — which may now be behind the current version. Re-read before
your next conditional write.

---

## 9. Recommended client policy

1. **Always send `If-Match` on `PATCH`** when you have a version from a prior read. Cheap,
   and it converts a silent overwrite into a visible conflict.
2. **Treat `409 VERSION_CONFLICT` as "re-read and reconcile"**, never as "retry".
3. **Never cache a version across runs.** Read it in the same operation you write from.
4. **Never construct a version.** It is server-assigned; only echo what you were given.
5. **Bound reconciliation attempts** (3 is a reasonable default), then escalate.
6. **For a create-or-update sync**, prefer: look up by `externalKey`, take `version` from
   that response, `PATCH` with `If-Match`. It makes every lost update visible.

---

## 10. Worked example

```
t0  Client A: GET  /articles/X                  -> version 4, title "Old"
t1  Client B: GET  /articles/X                  -> version 4, title "Old"
t2  Client B: PATCH /articles/X  If-Match: 4    -> 200, version 5, title "B's title"
t3  Client A: PATCH /articles/X  If-Match: 4    -> 409 VERSION_CONFLICT
                                                   details: {expectedVersion: 4, currentVersion: 5}
t4  Client A: GET  /articles/X                  -> version 5, title "B's title"
t5  Client A: decides its change still applies
t6  Client A: PATCH /articles/X  If-Match: 5    -> 200, version 6
```

Without `If-Match` at t3, Client A's `PATCH` would have succeeded, silently discarding
whichever of B's fields A also carried — and A would have been told it worked.

---

## Implementation references

- `apps/api/src/routes/site.ts` — `If-Match` parsing on `PATCH /articles/{id}` and `document/replace`
- `apps/api/src/services/articles.ts` — `updateArticle` precondition, `concurrentChange()`,
  the guarded `UPDATE` in `updateArticle`, `publishArticle`, `scheduleArticle`, `applyStatusTransition`
- `apps/api/src/services/recovery.ts` — `replaceDocument` version handling
- `apps/worker/src/scheduler.ts` — the worker's guarded promotion and the version bump on block
- `packages/db/src/schema/editorial.ts` — `articles.version`
- `packages/contracts/src/errors.ts` — `VERSION_CONFLICT`
- `packages/sdk/src/client.ts` — how the SDK passes `ifMatch`
