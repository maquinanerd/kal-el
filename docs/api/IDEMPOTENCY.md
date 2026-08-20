# Kal El — Idempotency

How `Idempotency-Key` behaves, exactly, and the retry algorithm a client must follow.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The header

| Property | Value |
|---|---|
| Header name | `Idempotency-Key` (read case-insensitively as `idempotency-key`, per HTTP) |
| Required? | **Optional everywhere.** Omitting it runs the handler directly, with no record. |
| Format | 8–128 characters matching `^[A-Za-z0-9._-]+$` |
| Invalid format | `400 VALIDATION_ERROR` — "invalid Idempotency-Key header" |
| Empty string | treated as absent |
| Allowed by CORS | yes (`idempotency-key` is in `allowedHeaders`) |

Anything outside the charset — a UUID with braces, a `:`-separated key, a raw hash with
`+` or `/` — is rejected. `uuid4().hex` and prefixed variants like `pipe.<hex>` are safe.

---

## 2. Which routes honour it

A key is honoured only where the route wires it in. **Everywhere else it is silently
ignored** — no error, no protection.

### Honoured

| Route (under `/v1/sites/{siteId}`) |
|---|
| `POST /articles` |
| `POST /articles/{id}/submit` |
| `POST /articles/{id}/approve` |
| `POST /articles/{id}/reject` |
| `POST /articles/{id}/schedule` |
| `POST /articles/{id}/publish` |
| `POST /articles/{id}/unpublish` |
| `POST /articles/{id}/archive` |
| `POST /articles/{id}/document/replace` |
| `POST /categories` |
| `POST /tags` |
| `POST /authors` |
| `POST /entities` |
| `POST /sources` |
| `POST /media` |

### Ignored

`PATCH /articles/{id}` · `POST /articles/{id}/preview` · every taxonomy `PATCH`/`DELETE` ·
`POST` and `DELETE /redirects` · `PATCH`/`DELETE /media/{id}` · every `GET` ·
**every `/v1/admin/*` route** · every `/v1/auth/*` route.

For `PATCH /articles/{id}` the safety mechanism is `If-Match`, not the key. See
[CONCURRENCY.md](CONCURRENCY.md).

---

## 3. Identity of a record

A stored idempotency record is keyed by **two** columns, unique together:

```
(idempotency_keys.key, idempotency_keys.actor_key)
```

and `actor_key` is composed at request time:

```
actorKey = "<credential identity>@site:<siteId>"     when the route has a :siteId
actorKey = "<credential identity>"                   otherwise
```

where the credential identity is `service:<service_tokens.id>` for a service token and
`user:<users.id>` for a session.

**Consequences:**

- Two different tokens may use the same key value without colliding.
- The same **user session** may use the same key value against two different sites — they
  are two independent records. (Before the site was part of the scope, the stored request
  hash embedded the URL, so the second site got a spurious `IDEMPOTENCY_REPLAY`.) A service
  token cannot reach a second site at all — it gets `403 SITE_SCOPE_MISMATCH` first.
- Rotating a service token changes `actor_key` and therefore invalidates in-flight keys.
  Do not rotate mid-run.

---

## 4. The request hash

```
sha256( METHOD + "\n" + URL + "\n" + canonicalJSON(body) + "\n" + extra )
```

| Component | Detail |
|---|---|
| `METHOD` | e.g. `POST` |
| `URL` | the request URL **including the query string** |
| `canonicalJSON(body)` | JSON with **object keys sorted recursively**; `{}` when there is no body |
| `extra` | empty, except on media upload |

Key ordering therefore does **not** matter: a client that re-serialises the same payload
with a different key order is recognised as the same request. **Array order does matter** —
`["a","b"]` and `["b","a"]` are different requests.

On `POST /media` the multipart body is not in `req.body`, so the route passes the
**SHA-256 of the uploaded bytes** as `extra`. Two different files under one key are
therefore correctly detected as different requests rather than the second silently
replaying the first's response.

---

## 5. Behaviour

### First request with a key

1. Open a transaction.
2. Take a Postgres advisory transaction lock on `hashtextextended("<actorKey>:<key>")`.
3. Look for a non-expired record for `(key, actorKey)`.
4. None found → run the handler **inside the same transaction**.
5. Insert the record with the produced status and body.
6. Commit. Side effects and the record commit atomically.

### Identical retry — replay

The stored `requestHash` matches, so nothing re-runs:

| What the client gets | Value |
|---|---|
| HTTP status | **the original status, replayed verbatim** (e.g. `201` for a create) |
| Body | the original body, byte-for-byte from JSONB |
| Marker header | **none** |
| Marker field | **none** |

There is no way for a client to tell a replay from a first execution. That is by design:
the replay is meant to be indistinguishable. If you need to know, compare against your own
records — or use `externalKey`, which tells you whether the *article* already existed.

### Same key, different request — refusal

`409 IDEMPOTENCY_REPLAY`, message `idempotency key reused with a different request`.
Nothing is executed and nothing is stored. This is a client bug: a key identifies **one
attempt at one operation**, not "the operation".

### Concurrent identical requests

The advisory lock serialises them on `(actorKey, key)`. The first transaction executes and
commits; the second acquires the lock afterwards, finds the stored record, and replays it.
**Side effects run exactly once.** The second caller waits for the first to finish rather
than failing.

### TTL and expiry

| Property | Value |
|---|---|
| TTL | **24 hours** (`IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000`) |
| Stored in | `idempotency_keys.expires_at` |
| Lookup filter | `expires_at > now()` — an expired record is invisible |
| Cleanup | two ways — lazily, the row for that identity is deleted just before a new one is inserted; **and the worker purges every expired row on each tick** |

An expired key therefore behaves exactly as if it had never been used: the handler runs
again and its side effects happen again. **Do not rely on a key older than 24 hours to
suppress a duplicate.**

Collection is automatic: `purgeExpiredIdempotencyKeys` runs on **every worker tick**
(`POLL_INTERVAL_MS`, default 1 s) and deletes every row past `expires_at`. No operator cron
is required. If the worker is stopped, expired rows accumulate until it runs again — they
are already invisible to the lookup, so that costs disk, not correctness.

### What is stored

| Column | Content |
|---|---|
| `key` | the header value |
| `actor_key` | `<credential>@site:<siteId>` |
| `request_hash` | the SHA-256 above |
| `response_status` | the HTTP status to replay — with one exception, below |
| `response_body` | the response body, as JSONB |
| `created_at` | insert time |
| `expires_at` | `created_at + 24 h` |

The **request body is never stored — only its hash**. The `Idempotency-Key` header value
and the credential *identity* (`service:<id>` / `user:<id>`) are stored, as the table above
shows; no secret, token value or other request header is.

> **`POST /categories`, `POST /tags` and `POST /authors` are a special case.** They go
> through the `respondIdempotentValue` helper, which hard-codes `status: 200` into the
> stored record — while the route itself always answers `201`, on the first call and on the
> replay alike. The stored status is never used for those three.

> Because the body is persisted as JSONB and replayed verbatim, the handler must produce a
> **finished response value**, not a database row. This is an internal invariant, but it
> explains why a replayed response is always the exact JSON the first caller saw.

---

## 6. Safe retry algorithm

The situation this exists for: the request was sent, the server executed it, and the
response was lost. The client cannot tell that apart from "the request never arrived".

```
generate ONE key for this logical operation
    |
    v
send request with that key  ------------------> 2xx  -> done
    |                                            |
    | network error / timeout / 408 / 429 / 5xx  |
    v                                            |
wait (backoff with jitter)                       |
    |                                            |
    +--> resend the IDENTICAL request            |
         with the SAME key --------------------> 2xx -> done (may be a replay; same result)
                                                 |
                                                 +--> 409 IDEMPOTENCY_REPLAY
                                                       -> your payload changed between
                                                          attempts. This is a bug in the
                                                          client, not a transient failure.
```

**Rules**

1. **One key per logical attempt, generated once, before the first send.** Never generate
   it inside the retry loop.
2. **The retried request must be byte-identical in meaning** — same method, same URL
   *including query string*, same body content, same file bytes. Key order may differ;
   array order may not.
3. **Reuse the key only for transport-level retries of that attempt.** A new logical
   operation gets a new key — including a re-submit after a rejection. (Keying by a hash
   of the payload instead of per attempt is a known trap: submit → reject → fix → submit
   would collide for 24 hours and replay the first response, giving the caller a stale
   article and filing no transition.)
4. **Do not send a key on `PATCH`.** It is ignored; use `If-Match`.
5. **Bound the retries.** Suggested: 5 attempts, full-jitter exponential backoff from
   250 ms, capped at 30 s.
6. **After exhausting retries without a response, reconcile rather than retry** —
   `GET /articles?externalKey=<key>` tells you whether the write landed.

### Reference implementation

```python
import random, time, uuid, requests

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}

def post_idempotent(session, url, json_body, headers, max_attempts=5, timeout=15):
    key = "pipe." + uuid.uuid4().hex          # generated ONCE, outside the loop
    hdrs = {**headers, "Idempotency-Key": key}

    for attempt in range(1, max_attempts + 1):
        try:
            r = session.post(url, json=json_body, headers=hdrs, timeout=timeout)
        except requests.RequestException:
            if attempt == max_attempts:
                raise
            time.sleep(min(30, 0.25 * 2 ** (attempt - 1)) * random.random())
            continue

        if r.status_code in RETRYABLE_STATUS and attempt < max_attempts:
            delay = r.headers.get("retry-after")
            time.sleep(float(delay) if delay else
                       min(30, 0.25 * 2 ** (attempt - 1)) * random.random())
            continue

        return r          # 2xx (possibly a replay), or a terminal error
    return r
```

---

## 7. What idempotency does *not* do

| It does not | Use instead |
|---|---|
| deduplicate articles across runs | `externalKey` — [EXTERNAL_CLIENT_API.md §7](../integrations/EXTERNAL_CLIENT_API.md#7-external-identity-externalkey) |
| protect `PATCH` from a lost update | `If-Match` — [CONCURRENCY.md](CONCURRENCY.md) |
| protect `PATCH`/`DELETE` at all | nothing — those routes ignore the header |
| survive longer than 24 hours | `externalKey`, or your own ledger |
| survive a token rotation | keep the same credential for the run |
| tell you whether a replay happened | compare against your own state |

### The three mechanisms side by side

| | `externalKey` | `Idempotency-Key` | `If-Match` / `version` |
|---|---|---|---|
| Where | request body, create only | HTTP header | HTTP header (integer) |
| Question | is this the same *article*? | is this the same *request attempt*? | has the row changed since I read it? |
| Lifetime | permanent | 24 h | one request |
| Scope | per site | per (key, actor, site) | per article |
| Duplicate outcome | `200` with the existing article | replayed original response | `409 VERSION_CONFLICT` |
| Mismatch outcome | — | `409 IDEMPOTENCY_REPLAY` | `409 VERSION_CONFLICT` |

---

## Implementation references

- `apps/api/src/plugins/idempotency.ts` — `withIdempotency`, `respondIdempotent`,
  `respondIdempotentValue`, `idempotencyRequestHash`, `idempotencyScope`, `IDEMPOTENCY_TTL_MS`
- `apps/api/src/routes/site.ts` — the routes that wire it in (and the media content digest)
- `packages/db/src/schema/system.ts` — the `idempotency_keys` table and its unique index
- `packages/contracts/src/common.ts` — `idempotencyKeySchema`
- `packages/sdk/src/client.ts` — `attemptKey()` and the SDK's retry loop
