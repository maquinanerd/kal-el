# Kal El — Taxonomies

Categories, tags, authors, entities and sources: what each one is, how it links to an
article, and where the model has gaps.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

Request/response reference:
[../integrations/EXTERNAL_CLIENT_API.md §11](../integrations/EXTERNAL_CLIENT_API.md#11-taxonomies).

---

## 1. The five, at a glance

| Taxonomy | Purpose | Article field | Ordered | Unique on | Hierarchy |
|---|---|---|---|---|---|
| `categories` | editorial desk / section | `categories: [uuid]` | no | `(siteId, slug)` | `parentId`, one level of intent |
| `tags` | free labels | `tags: [uuid]` | no | `(siteId, slug)` | none |
| `authors` | bylines | `authors: [uuid]` | **yes** | `(siteId, slug)`, `(siteId, userId)` | none |
| `entities` | people, works, organisations mentioned | `entities: [uuid]` | no | **none** | none |
| `sources` | outlets an article draws on | **none — no link exists** | — | **none** | none |

All five are site-scoped, all five share the same route shape, and all five require the
`*.manage` scope **to read as well as write** — there is no read-only taxonomy scope.

---

## 2. Categories

The primary editorial classification.

| Field | Type | Create | Update |
|---|---|---|---|
| `name` | string 1..120 | required | optional |
| `slug` | string 1..140 | required | optional |
| `parentId` | uuid, nullable | optional | optional |
| `description` | string ≤1000, nullable | optional | optional |

Unique on `(siteId, slug)` — a duplicate is `409 CONFLICT` with `details.field = "slug"`.

**`parentId` is not a foreign key.** A self-referential FK would create a TypeScript
inference cycle in the schema, so the service validates instead that the parent exists in
the same site. Consequence: there is no database-level cycle prevention. Deletion is
handled in the service — `deleteCategory` sets `parentId = null` on every child in the same
site before removing the parent, so children survive as roots rather than being cascaded
away.

The table also has a `position` integer column (default 0) that **the API never exposes or
sets** — ordering is not manageable through the API today.

### Primary category

`seo.primaryCategoryId` singles out one category for canonical/section purposes. It is
validated to belong to the site, and **deleting a category that is any article's primary
category is refused** with `409 CONFLICT` and
`details.field = "primaryCategoryId"`.

Note the asymmetry: `primaryCategoryId` lives in the `seo` object, not next to
`categories`, and nothing requires it to be one of the article's `categories`.

---

## 3. Tags

The simplest taxonomy.

| Field | Type | Create | Update |
|---|---|---|---|
| `name` | string 1..80 | required | optional |
| `slug` | string 1..100 | required | optional |

Unique on `(siteId, slug)`. No hierarchy, no description, no colour, no count.

---

## 4. Authors

**An author is an editorial byline, not an account.** Guest contributors and imported
authors have no user.

| Field | Type | Create | Update |
|---|---|---|---|
| `name` | string 1..120 | required | optional |
| `slug` | string 1..140 | required | optional |
| `bio` | string ≤2000, nullable | optional | optional |
| `email` | email, nullable | optional | optional |
| `userId` | uuid, nullable | optional — **also needs `roles.manage`** | optional — same |
| `avatarMediaId` | uuid, nullable | **not writable through the API** | — |

Unique on `(siteId, slug)` **and** on `(siteId, userId)` — at most one byline per account
per site; rows with a null `userId` are exempt.

### `userId` is a permission change

Linking a byline to an account grants that account edit rights over **every article
carrying the byline**. So supplying `userId` on create or update requires `roles.manage` in
addition to `taxonomy.authors.manage`; without it, `403 FORBIDDEN`.

Two further conditions apply to `userId`:

- the target account must **already be a member of this site**, or the write is
  `400 VALIDATION_ERROR` ("user is not a member of this site", `details.userId`);
- because of the `(siteId, userId)` unique index, a second byline for the same account is
  `409 CONFLICT` with `details.field = "userId"`.

Without that guard, `taxonomy.authors.manage` + `articles.update` was a route to editing
other writers' published articles: repoint a byline at yourself, and the ownership check
starts passing.

### Ownership resolution

The ownership check for a non-privileged session user joins
`article_authors.author_id → authors.id → authors.user_id` and compares **that** to the
caller. Comparing `article_authors.author_id` directly to a user id compares two disjoint
UUID spaces and can never match — which used to mean a legitimately credited co-author was
always refused.

### Ordering

`article_authors.position` preserves byline order, assigned from the array index on write.
It is the **only** ordered relation; categories, tags and entities are sets.

---

## 5. Entities

Named things an article is *about* — people, works, companies, products.

| Field | Type | Create | Update |
|---|---|---|---|
| `name` | string 1..200 | required | optional |
| `type` | string 1..64 | required | optional |
| `description` | string ≤2000, nullable | optional | optional |
| `externalRefs` | array (max 20) of `{provider, type, externalId}` | optional — defaults to `[]` | optional |

`type` is **free text** — there is no enum. Whatever vocabulary you adopt (`person`,
`film`, `company`) is a convention in your data, not something the API validates.

`GET /entities?type=<string>` filters on it; the index is `(siteId, type)`.

### Two traps

1. **No unique constraint.** Creating the same entity twice inserts two rows. Resolve
   client-side and always send an `Idempotency-Key` on create.
2. **`externalRefs` is not a lookup key.** It is stored jsonb, not indexed, not unique, and
   no endpoint filters on it. It documents provenance; it does not deduplicate.

---

## 6. Sources — and the gap

| Field | Type | Create | Update |
|---|---|---|---|
| `name` | string 1..200 | required | optional |
| `url` | URL ≤2048, nullable | optional | optional |
| `kind` | string ≤32 | optional — defaults to `"generic"` | optional |

> ### Sources are not attached to articles
>
> There is **no `article_sources` table**, no `sources` field on the article body, and no
> `sources` array in the article response. The taxonomy exists, is CRUD-able, and links to
> nothing.
>
> Attribution inside an article is expressed by the **`source` document node**:
>
> ```json
> { "type": "source", "attrs": { "label": "Reuters", "url": "https://…", "kind": "news" } }
> ```
>
> which is free text carrying no reference to a `sources` row. The two share a name and
> nothing else. Creating a `sources` row does not make it referenceable from a document,
> and a `source` node does not create or reference a row.
>
> Recorded in [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

If you need queryable source attribution today, the options are the `source` node (free
text, in the body) or the article's `provenance` object (structured, top level, and
returned with every read).

---

## 7. Linking to an article

All four linkable taxonomies are expressed as **arrays of Kal El uuids** in the article
body, on create and on update:

```json
{
  "authors":    ["uuid", "uuid"],
  "categories": ["uuid"],
  "tags":       ["uuid", "uuid", "uuid"],
  "entities":   ["uuid"]
}
```

| Behaviour | Rule |
|---|---|
| Slugs or names instead of ids | **not accepted** — resolve them yourself first |
| Present in a `PATCH` | the array **replaces** the entire relation set |
| Absent from a `PATCH` | the relation is left untouched |
| `[]` in a `PATCH` | clears the relation |
| Duplicate ids in the array | de-duplicated **for the site-membership check only** — the write inserts the array as given, so a repeated id violates the relation table's composite primary key and returns `409 CONFLICT` with `details.constraint`. De-duplicate client-side. |
| An id from another site | `400 VALIDATION_ERROR` with `details.{authorId\|categoryId\|tagId\|entityId}` |
| A non-existent id | **the same message** — deliberately not an existence oracle |
| Order | preserved for `authors` only |

The relation tables have composite primary keys and cascade on delete, so removing a
category detaches it from every article rather than orphaning a row.

`GET /articles` (the list) returns `authors` and `categories` batch-loaded, but **`tags`
and `entities` are always `[]`** in a list response. Fetch the article to see them.

---

## 8. Resolution strategy

There is **no find-or-create endpoint** and **no lookup-by-slug endpoint**. The working
pattern:

```
1. GET /v1/sites/{siteId}/{type}          once per run — returns the complete array
2. build { slug -> id } in memory
3. POST only what is missing, each with an Idempotency-Key
4. reference ids in the article body
```

| Taxonomy | Race behaviour |
|---|---|
| categories, tags, authors | `(siteId, slug)` unique → the loser gets `409 CONFLICT`; re-read and continue |
| entities, sources | **no constraint** → the loser silently inserts a duplicate unless it carried an `Idempotency-Key` |

`GET` returns a plain array with no pagination and no query parameters (except `?type=` on
entities), so a site with thousands of tags returns all of them in one response. Cache the
map for the run.

---

## 9. Update and delete

```
PATCH  /v1/sites/{siteId}/{type}/{id}     at least one field, .strict()
DELETE /v1/sites/{siteId}/{type}/{id}
```

| Property | Value |
|---|---|
| Idempotency-Key | **ignored** on both |
| `If-Match` | not supported — no version column, so last-write-wins |
| Audit | **written** — `categories.update` / `categories.delete` and the tag, entity, author and source equivalents, with `details.changedFields` on updates |
| Delete guard | only for a category that is an article's `primaryCategoryId` |
| Delete effect | cascades through the relation table, detaching it from every article |

A non-UUID `{id}` is `404`, not `400`.

Deleting a tag or category **removes it from every article that used it** — there is no
confirmation and no usage-count endpoint. An audit entry (`tags.delete` /
`categories.delete`) is written, but nothing records *which* articles were detached. Check
usage yourself (`GET /articles?categoryId=…` / `?tagId=…`) before deleting.

---

## 10. Scope summary

| Operation | Scope |
|---|---|
| Read or write categories | `taxonomy.categories.manage` |
| Read or write tags | `taxonomy.tags.manage` |
| Read or write authors | `taxonomy.authors.manage` |
| Read or write entities | `taxonomy.entities.manage` |
| Read or write sources | `taxonomy.sources.manage` |
| Set `authors.userId` | **additionally** `roles.manage` |

There is no `taxonomy.*.read`. A client that only resolves category ids must hold the write
scope — the most common surprise for a new integration.

The preset roles `editor`, `editor-chefe` and `admin` all carry the full taxonomy bundle;
`autor` carries none of it, so a writer cannot create a tag.

---

## Implementation references

- `apps/api/src/services/taxonomy.ts` — all five, with their conflict mapping
- `apps/api/src/routes/site.ts` — the twenty taxonomy routes and the `userId` guard
- `apps/api/src/services/articles.ts` — `assertRelationsInSite`, `replaceRelations`, `relationIds`
- `packages/contracts/src/editorial.ts` — every taxonomy schema
- `packages/db/src/schema/editorial.ts` — the tables, their indexes and the relation tables
- `apps/api/src/services/roles.ts` — the `TAXONOMY` permission bundle
