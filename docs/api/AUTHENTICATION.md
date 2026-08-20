# Kal El — Authentication and Authorisation

Both credentials, the permission model, and the preset roles.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. Two credentials

The credential is chosen by shape, in `readCredentials()`:

```
cookie ke_session starting with "ke_s."           -> session
Authorization: Bearer  token starting with "ke_st." -> service token
anything else                                      -> no credential
```

A `Bearer` token without the `ke_st.` prefix is treated as **no credential** and produces
`401 UNAUTHENTICATED` — not `403`.

| | Session | Service token |
|---|---|---|
| For | a person in the CMS | an external client |
| Carrier | cookie `ke_session` | `Authorization: Bearer` |
| Prefix | `ke_s.` | `ke_st.` |
| Secret | 32 random bytes, base64url | 32 random bytes, base64url |
| Stored | SHA-256 hex in `sessions.token_hash` | SHA-256 hex in `service_tokens.token_hash` |
| CSRF | **required** on every non-GET/HEAD/OPTIONS | not applicable |
| Site scope | via `user_roles` — a user may belong to several sites | **exactly one site**, in the row |
| Rights | union of role permissions **at the requested site** | the token's literal `scopes` array |
| Expiry | TTL + idle + absolute, with rotation | optional `expires_at` |
| Revocation | delete the session row; `logout-all` revokes every one | set `revoked_at` |
| Rate-limit bucket | client IP | **the token** |

---

## 2. Sessions

### Login

```http
POST /v1/auth/login
Content-Type: application/json

{ "email": "owner@example.com", "password": "..." }
```

Rate limited to **10/minute**, separately from the global limit.

On success two cookies are set:

| Cookie | Flags | Purpose |
|---|---|---|
| `ke_session` | `httpOnly`, `sameSite=lax`, `secure` iff `COOKIE_SECURE`, path `/` | the credential |
| `ke_csrf` | **not** `httpOnly` — JavaScript must read it | the double-submit CSRF token |

Response:

```json
{ "data": { "user": { "id": "…", "email": "…", "name": "…", "status": "active" },
            "session": { "id": "…", "userId": "…", "expiresAt": "…", "createdAt": "…" } } }
```

A disabled account is refused with `401 UNAUTHENTICATED` ("account is disabled"). Email is
stored and compared lower-case, so capitalisation at signup cannot lock an account out.

### CSRF

The session cookie is `sameSite=lax`, which does not stop a same-site cross-origin request.
Every state-changing request with a session credential must therefore carry:

```
x-kal-el-csrf: <the value of the ke_csrf cookie>
```

The server compares `sha256(header)` against `sessions.csrf_token_hash`. Missing or wrong
is `403 FORBIDDEN` ("CSRF validation failed"). `GET`, `HEAD` and `OPTIONS` are exempt.

This applies to `/v1/sites/*` **and** `/v1/admin/*` alike.

### Lifetime

| Bound | Variable | Default |
|---|---|---|
| Ceiling at login | `SESSION_TTL_DAYS` | 30 days |
| Idle timeout | `SESSION_IDLE_TIMEOUT_MINUTES` | 720 min (12 h) |
| Absolute timeout | `SESSION_ABSOLUTE_TIMEOUT_MINUTES` | 43200 min (30 d) — also caps the TTL |
| Rotation interval | `SESSION_ROTATE_MINUTES` | 60 min |

The idle clock reads `last_seen_at`, refreshed on authenticated requests but **throttled to
at most one write per minute** (`TOUCH_INTERVAL_MS`), since the timeout is measured in
hours. The absolute clock reads `created_at`, which rotation does not move.

### Rotation

Past `SESSION_ROTATE_MINUTES` the token is replaced and the new value set as a cookie. The
old token keeps working until `previous_token_expires_at` — a short grace window, because
the CMS issues parallel requests and without it any two crossing the rotation threshold
together would leave one working and the rest `401`ing.

Rotation is guarded so concurrent requests cannot rotate twice.

### Logout

| Endpoint | Effect |
|---|---|
| `POST /v1/auth/logout` | deletes **this** session row and clears both cookies |
| `POST /v1/auth/logout-all` | deletes **every** session for the user (requires CSRF) |

The row is deleted, not just the cookie: a cookie the browser forgot is still a valid
credential to anyone who copied it.

### Resolution and cookie clearing

The auth plugin resolves the session **once per request** — expiry, idle timeout, absolute
timeout and the disabled-account check all in one place. It does not throw: public routes
(health, preview, bootstrap) must still answer with a stale cookie present. Each
authenticated reader consults the resolution and refuses on its own terms. A session that
resolves to `401` has its cookies cleared, so the browser stops sending a credential that
cannot work.

---

## 3. Service tokens

Covered in full in
[../integrations/EXTERNAL_CLIENT_API.md §4](../integrations/EXTERNAL_CLIENT_API.md#4-service-tokens).
The essentials:

| Property | Value |
|---|---|
| Header | `Authorization: Bearer ke_st.<secret>` |
| Minted at | `POST /v1/admin/sites/{siteId}/service-tokens`, permission `tokens.manage` at that site |
| Plaintext | returned **once**, in the creation response only |
| Site | one, fixed at creation; a mismatch is `403 SITE_SCOPE_MISMATCH` on `/v1/sites/{siteId}/…` and `403 FORBIDDEN` on `/v1/admin/sites/{siteId}/…` |
| Scopes | an array of permission keys, validated against the known set at creation |
| Revoked | `403 FORBIDDEN` |
| Expired | `401 UNAUTHENTICATED` |
| Usage | `last_used_at` stamped on every successful resolution |

No CSRF, no cookie, no refresh flow, no OAuth. The token is the whole credential.

---

## 4. The permission model

Deliberately flat:

- a route names **one** permission string;
- for a session, the check is `actor.permissions.has(key)` — the union of the permissions of
  every role the user holds **at that site**;
- for a service token, it is `actor.scopes.has(key)` — the literal array;
- **no wildcards, no hierarchy, no implication.** `articles.publish` does not grant
  `articles.read`.

Failure is `403 FORBIDDEN` with `missing permission: <key>` — except on `/v1/admin/*` with
a **service token**, where the message is `missing scope: <key>`.

### The complete permission set

| Key | Grants |
|---|---|
| `system.manage` | reserved; **checked by no route** |
| `sites.create` | create a site; also required to `PATCH` one |
| `sites.read` | list sites |
| `users.create` | create a user |
| `users.read` | list users |
| `roles.manage` | create roles, assign roles, link an author byline to an account |
| `tokens.manage` | service tokens **and** webhooks |
| `articles.create` | create |
| `articles.read` | read/list, revisions, stats, preview |
| `articles.update` | `PATCH` |
| `articles.publish` | publish, unpublish, archive; create as `published` |
| `articles.schedule` | schedule; create as `scheduled` |
| `articles.submit` | submit for review |
| `articles.approve` | approve **and** reject |
| `articles.delete` | **checked by no route** — removal is via `archive` |
| `articles.recover` | read raw document bytes and replace an unreadable document |
| `taxonomy.categories.manage` | categories, read **and** write |
| `taxonomy.tags.manage` | tags |
| `taxonomy.entities.manage` | entities |
| `taxonomy.authors.manage` | authors |
| `taxonomy.sources.manage` | sources |
| `media.manage` | upload, update, delete |
| `media.read` | list, read, download |
| `seo.manage` | redirects |
| `audit.read` | audit log and `/ops-status` |

`GET /v1/admin/permissions` (permission `roles.manage`) returns the live list.

### Escalation guards

Three checks exist beyond the plain permission test:

1. **Create-with-status.** `POST /articles` additionally requires `articles.publish` when
   the body sets `status: "published"` or a `publishedAt`, and `articles.schedule` for
   `scheduled` / `scheduledAt`.
2. **Author ↔ account linking.** Setting `authors.userId` grants that account edit rights
   over every article carrying the byline, so it additionally requires `roles.manage`.
   Without it, `taxonomy.authors.manage` + `articles.update` was a route to editing other
   writers' published articles.
3. **Role assignment.** You cannot grant a role containing permissions you do not hold **at
   that site**: `403 FORBIDDEN` with `details.missing`. This applies to service tokens too —
   a token holding `roles.manage` alone cannot grant the owner role.

### Ownership

A session user **without** `articles.publish`, `articles.approve` or `articles.schedule`
may only `PATCH` an article they created, or one where they are a listed author (resolved
through `authors.userId`). Otherwise `403 FORBIDDEN` ("you can only edit your own
articles").

**Service tokens are always treated as privileged** and skip this check entirely.

### Admin routes: two modes

| Mode | Routes | Rule |
|---|---|---|
| Global | `/v1/admin/sites`, `/users`, `/roles`, `/permissions` | the permission may come from **any** site the actor belongs to |
| Site-scoped | `/v1/admin/sites/{siteId}/…` | the permission must be held **at that site**, and membership is mandatory |

Without the second mode, one site's owner could act on every other site, because the union
carries their permission everywhere.

---

## 5. Preset roles

Created idempotently on every API boot by `ensurePresetRoles()`. All five are **global**
roles (`site_id = NULL`) assignable to any site via `POST /v1/admin/users/{userId}/roles`.

Two bundles compose them:

```
EDITORIAL_BASE = articles.create, articles.read, articles.update
TAXONOMY       = taxonomy.{categories,tags,entities,authors,sources}.manage
```

| Role key | Name | Permissions |
|---|---|---|
| `owner` | Owner | **every** permission |
| `admin` | Admin | `EDITORIAL_BASE` + publish, schedule, submit, approve, delete, recover + `TAXONOMY` + `seo.manage`, `media.manage`, `media.read`, `audit.read`, `sites.read` |
| `editor-chefe` | Editor chefe | `EDITORIAL_BASE` + publish, schedule, submit, approve, **recover** + `TAXONOMY` + `seo.manage`, `media.manage`, `media.read`, `audit.read` |
| `editor` | Editor | `EDITORIAL_BASE` + submit, approve + `TAXONOMY` + `media.manage`, `media.read` |
| `autor` | Autor | `EDITORIAL_BASE` + submit + `media.read` |

Notes worth reading:

- **`admin` has no `users.*`, `roles.manage`, `tokens.manage` or `system.manage`** — it is
  full *site* control, not platform control.
- **`editor` cannot publish or schedule.** It can approve and reject, which is why
  `approve` is restricted to `in_review`/`blocked`: otherwise an editor could withdraw a
  live article through `/approve`.
- **`autor` deliberately lacks `articles.recover`.** Repairing a corrupt body means seeing
  unvalidated bytes and overwriting the only copy — an operator action, not an editing one.
- **`autor` has `media.read` but not `media.manage`** — writers reference existing assets
  rather than uploading.

Custom roles can still be created with `POST /v1/admin/roles` (permission `roles.manage`).
Like the presets they are **global**: `createRoleBodySchema` carries no `siteId` and
`createRole` never sets one, so **no code path creates a site-scoped role**. A role becomes
site-specific only through the assignment in `user_roles`.

---

## 6. Bootstrap

The one-shot route that creates the first site and its owner.

```http
POST /v1/bootstrap/init
x-bootstrap-token: <BOOTSTRAP_TOKEN>
Content-Type: application/json

{ "site": { "slug": "portal", "name": "Portal" },
  "user": { "email": "owner@example.com", "name": "Owner", "password": "<12..128 chars>" } }
```

| Property | Value |
|---|---|
| Rate limit | **5/minute**, separate from the global limit |
| Token comparison | constant-time |
| Concurrency | an advisory lock plus the already-initialised check, **inside one transaction** |
| Success | `201` with the created site and user |
| Refusal | `403 FORBIDDEN`, `bootstrap is not available` |

The refusal is **identical** for a missing token, a wrong token, and an already-provisioned
system. Answering differently would turn the endpoint into an oracle: a caller would learn
their guess was right from a system that then refuses to act on it. The distinction is
logged server-side for whoever is provisioning.

The owner role is created if absent and granted every permission that exists at that
moment. Remove `BOOTSTRAP_TOKEN` from the environment afterwards.

---

## 7. Checking a credential

```
GET /v1/auth/me
```

| Credential | Response |
|---|---|
| Service token | `{ "data": { "kind": "service", "id", "name", "siteId", "scopes": [...] } }` |
| Session | `{ "data": { "kind": "user", "user": {...}, "sessionId": "..." } }` |

Revocation and expiry are enforced here too — without that, a revoked token would still get
a `200` disclosing its id, name, site and full scope list.

`GET /v1/me/sites` (**session only**) lists the sites the user belongs to.

An external client should call `GET /v1/auth/me` at startup and assert both the `siteId` and
the scopes it needs. Failing at startup beats a `403` halfway through a run.

---

## 8. Transport protections

| Control | Value |
|---|---|
| Global rate limit | 600 req/min, bucketed **by service token** when one is present, else by IP |
| Login | 10/min |
| Bootstrap | 5/min |
| Health / ready | exempt |
| CORS | allow-list from `CORS_ORIGINS`, falling back to `[APP_BASE_URL]`; `credentials: true`; allowed headers `content-type`, `authorization`, `x-kal-el-csrf`, `if-match`, `idempotency-key` |
| Helmet | on, with CSP disabled |
| Body limit | 5 MiB |
| Upload limit | `MEDIA_MAX_BYTES`, one file per request |
| `req.ip` | governed by `TRUST_PROXY` — misconfigure it and every caller shares one bucket |

---

## Implementation references

- `apps/api/src/plugins/auth.ts` — `readCredentials`, `csrfFailed`, `resolveUserActor`, `resolveServiceActor`, `requireSiteScope`, rotation
- `apps/api/src/auth-context.ts` — `PERMISSIONS`, `ALL_PERMISSIONS`, `permissionDenied`
- `apps/api/src/services/sessions.ts` — creation, resolution, idle/absolute timeouts, rotation, revocation
- `apps/api/src/services/tokens.ts` — minting, listing, revocation
- `apps/api/src/services/roles.ts` — `PRESET_ROLES`, `EDITORIAL_BASE`, `TAXONOMY`, `ensurePresetRoles`
- `apps/api/src/services/seed.ts` — permission seeding
- `apps/api/src/routes/auth.ts` — login, logout, `me`, bootstrap
- `apps/api/src/routes/admin.ts` — `requireAdminPermission`, the two guard modes, escalation checks
- `packages/auth/src/rbac.ts` — `getEffectivePermissions`
- `packages/auth/src/keys.ts` — token generation and hashing
- `packages/contracts/src/identity.ts` — login, user, role and token schemas
