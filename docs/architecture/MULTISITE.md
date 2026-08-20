# Kal El — Multi-site

How tenancy is expressed, enforced, and where it leaks.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The model

A **site** is the tenant boundary. One Kal El installation serves many; a site owns its
articles, taxonomies, media, redirects, service tokens and webhooks. Users and roles are
platform-level; their *reach* is per site.

| Object | Scoped by |
|---|---|
| Articles, revisions, relations | `site_id` on `articles` |
| Categories, tags, authors, entities, sources | `site_id` |
| Media | `site_id` |
| Redirects | `site_id` |
| Service tokens | `site_id`, **NOT NULL** |
| Webhooks, outbox events | `site_id` |
| Webhook deliveries | **no `site_id`** — scoped transitively via `webhook_id` / `outbox_event_id` |
| Audit rows | `site_id`, nullable |
| **Users** | platform-level; reach via `user_roles` |
| **Roles** | `site_id` nullable — `NULL` means a global role |
| **Permissions** | platform-level |
| **Sessions** | belong to a user, not a site |
| **Idempotency keys** | no column — the site is embedded in `actor_key` |

Enforcement is structural: every scoped table has `site_id NOT NULL REFERENCES sites(id) ON
DELETE CASCADE`. **Deleting a site deletes its content.**

---

## 2. Site identity

| Field | Uniqueness | Used for |
|---|---|---|
| `id` (uuid) | primary key | **every API path** |
| `slug` | unique platform-wide, `[a-z0-9][a-z0-9-]*` | human reference |
| `primary_domain` | not unique | building canonical/public URLs |
| `status` | `active` \| `inactive` | operational marker |

`primary_domain` is normalised on input: `https://MaquinaNerd.com.br/` is stored as
`maquinanerd.com.br` — scheme stripped, path stripped, trailing dot stripped, lowercased,
validated as an RFC 1123 hostname with at least one dot (so bare `localhost` is refused).
An empty value clears it to `NULL`.

It is stored bare because everything downstream concatenates it rather than parsing it. It
is **not** used for routing: there is no host-based site resolution anywhere in the API.

> **`status: "inactive"` is a marker, not an enforcement point.** No route consults it. An
> inactive site still accepts writes. Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

---

## 3. Routing

```
/v1/sites/{siteId}/...      every editorial route
/v1/admin/sites/{siteId}/... site-scoped administration
/v1/admin/sites             platform-level site management
```

`{siteId}` is always a **UUID**. There is no slug route, no domain route, no `X-Site-Id`
header. A non-UUID fails the site-scope preHandler with `400 VALIDATION_ERROR`.

All 49 site routes live in one encapsulated Fastify plugin whose `preHandler` runs before
every handler:

1. validate `{siteId}` is a UUID — else `400`;
2. validate `{articleId}` is a UUID when present — else **`404`** (not `400`, so a
   malformed id is indistinguishable from a missing one);
3. `requireSiteScope(siteId)` — resolve the credential **against that site**.

No site route can forget the check, because no site route performs it.

---

## 4. Enforcement per credential

### Service token — pinned to one site

`service_tokens.site_id` is `NOT NULL`. Every request compares it to the path:

```
row.siteId !== siteId  ->  403 SITE_SCOPE_MISMATCH
                           "token is not scoped to this site"
```

**One token cannot address two sites.** A multi-site client needs one token per site, and
should read `data.siteId` from `GET /v1/auth/me` at startup to confirm which one it holds.

### Session — membership plus permission, at that site

```
no user_roles row for (user, site)  ->  403 SITE_SCOPE_MISMATCH ("no access to this site")
member, but lacks the permission    ->  403 FORBIDDEN ("missing permission: …")
```

Effective permissions are the union of the permissions of every role the user holds **at
that site** — never permissions carried from another site.

### Admin routes — two modes

| Mode | Routes | Rule |
|---|---|---|
| Global | `/v1/admin/sites`, `/users`, `/roles`, `/permissions` | the permission may come from any site the actor belongs to |
| Site-scoped | `/v1/admin/sites/{siteId}/…` | membership **and** the permission at that site |

Without the second mode, one site's owner could act on every other site, because the union
carries their permission everywhere. `POST /v1/admin/users/{userId}/roles` takes its target
site from the **body**, so it performs the check inside the handler rather than in a
preHandler.

---

## 5. Cross-site references

Every id an article points at is verified to belong to the same site — on create **and** on
update:

| Referenced | Checked by |
|---|---|
| `authors`, `categories`, `tags`, `entities` | `assertRelationsInSite` |
| `featuredMediaId`, `seo.socialImageMediaId`, every `image`/`gallery` `mediaId` | `assertMediaInSite` |
| `seo.primaryCategoryId` | `assertPrimaryCategoryInSite` |

Failure is `400 VALIDATION_ERROR` with a field marker (`details.authorId`,
`details.mediaId`, …).

> **For `assertRelationsInSite` and `assertPrimaryCategoryInSite` the message is identical
> whether the id is missing or belongs to another site.** That is deliberate: telling them
> apart would turn the endpoint into an existence oracle for another tenant's ids.
>
> **`assertMediaInSite` is the exception** — it answers "referenced media does not exist"
> for an unknown id and "referenced media does not belong to this site" for a foreign one,
> which *does* distinguish the two. Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

Two further reasons the check matters: a cross-tenant foreign key would let site B's
deletion of its own tag cascade into site A's article, and taxonomy deletion is unguarded
otherwise.

---

## 6. Isolation of the shared mechanisms

| Mechanism | Isolation |
|---|---|
| **Idempotency** | the scope key is `<credential>@site:<siteId>`, so the same key against two sites is two independent records. Sessions previously collided here; service tokens were accidentally safe because a token is pinned to one site — the guarantee silently changed shape with the credential type. |
| **Rate limiting** | bucketed **per service token**, so two sites' integrations behind one NAT no longer exhaust each other's budget. Session traffic is still bucketed by IP. |
| **Outbox and webhooks** | events carry `site_id`; the dispatcher matches subscribers by `site_id` **and** event type. A subscriber never receives another site's events. |
| **Audit** | `site_id` on every site-scoped row (it is nullable — platform actions such as user creation carry `NULL`); both read endpoints filter on it. |
| **Slug uniqueness** | `(site_id, slug)` — two sites may use the same slug. |
| **`externalKey`** | `(site_id, external_key)` — the same external id in two sites is two articles. |
| **Media storage** | keys are `sites/{siteId}/{uuid}.{ext}`; serving is site-scoped and permission-gated. |
| **Preview tokens** | the payload carries the site; resolution filters on `(articleId, siteId)`. |

---

## 7. Creating and managing a site

| Operation | Endpoint | Permission |
|---|---|---|
| The **first** site | `POST /v1/bootstrap/init` | the `x-bootstrap-token` header |
| Additional sites | `POST /v1/admin/sites` | `sites.create` |
| List | `GET /v1/admin/sites` | `sites.read` |
| Update (`name`, `primaryDomain`, `status`) | `PATCH /v1/admin/sites/{siteId}` | **`sites.create`** at that site |
| A user's sites | `GET /v1/me/sites` | session only |

There is **no delete-site endpoint.** Removing a site means direct SQL — and the cascades
mean that destroys all of its content, media rows, tokens and webhooks. Audit rows survive
with `site_id = NULL`.

`slug` is **not updatable** after creation.

Onboarding a new site is therefore: create the site → assign roles to the people who work
on it → mint a service token per integration → create taxonomies → configure webhooks.

---

## 8. What is *not* per site

| Not scoped | Consequence |
|---|---|
| Users | one account, many sites; disabling it disables it everywhere |
| Permissions | one global vocabulary |
| Preset roles | global (`site_id = NULL`), assignable to any site |
| Sessions | a logged-in user reaches every site they hold a role at |
| `SESSION_SECRET` | signs **preview tokens for every site** — sessions are opaque random tokens, not signed with it |
| Rate limit ceiling | 600 req/min is per token or IP, not per site |
| Media storage root | one `MEDIA_LOCAL_PATH`, partitioned by key prefix |
| The worker | one process serving every site; batch sizes are global |
| `sites.slug` | unique across the whole platform |

There is **no per-site quota, throttle or storage limit.** One site's backfill can consume
the worker's batch budget and the shared database.

---

## 9. For an external client

1. **One token per site.** Configuration is `(baseUrl, siteId, token)`; a multi-site client
   holds a set of those triples.
2. **Verify at startup.** `GET /v1/auth/me` → assert `data.siteId` matches your configured
   site. A mismatch is a configuration error, not a runtime one.
3. **Never share ids across sites.** Category ids, media ids and article ids are meaningless
   in another site and will be refused.
4. **Namespace `externalKey` by site if your source is shared.** The constraint is
   `(site_id, external_key)`, so the same key in two sites is fine — but your own state
   store needs to keep them apart.
5. **`403 SITE_SCOPE_MISMATCH` is never retryable.** It means the wrong token for the path.

---

## Implementation references

- `packages/db/src/schema/sites.ts` — the `sites` table and domain normalisation
- `packages/contracts/src/sites.ts` — `primaryDomainSchema`, `createSiteBodySchema`, `updateSiteBodySchema`
- `apps/api/src/routes/site.ts` — the encapsulated prefix and its preHandler
- `apps/api/src/plugins/auth.ts` — `requireSiteScope`, `resolveServiceActor`, `resolveUserActor`
- `apps/api/src/routes/admin.ts` — `adminGuard` vs `siteAdminGuard`
- `apps/api/src/services/articles.ts` — `assertRelationsInSite`, `assertPrimaryCategoryInSite`
- `apps/api/src/services/media.ts` — `assertMediaInSite`, the storage key prefix
- `apps/api/src/plugins/idempotency.ts` — `idempotencyScope`
- `apps/worker/src/dispatcher.ts` — site-matched subscriber lookup
- `apps/api/src/services/sites.ts` — site CRUD
