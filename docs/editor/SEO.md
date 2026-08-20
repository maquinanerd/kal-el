# Kal El — SEO

The SEO metadata Kal El stores, the redirects it owns, and the line between the CMS and a
public frontend.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. The division of responsibility

This is the most important thing in this document.

| Kal El owns | The public frontend owns |
|---|---|
| Storing SEO metadata per article | Rendering `<title>`, `<meta>`, Open Graph, Twitter cards |
| The `robotsIndex` / `robotsFollow` values | Emitting `<meta name="robots">` and `robots.txt` |
| `canonicalUrl` as a stored string | Emitting `<link rel="canonical">`, and defaulting it when null |
| `socialImageMediaId` as a reference | Resolving it to a URL and sizing the image |
| `primaryCategoryId` | Deciding what a section URL looks like |
| The site's `primaryDomain` | Building absolute URLs from it |
| Redirect **records** | **Serving** the 301/302 |
| Slug uniqueness and slug-change redirects | URL structure beyond the slug |
| `x-robots-tag: noindex, nofollow` on preview responses | Everything else about preview pages |

**Kal El derives nothing and falls back to nothing.** If `seoTitle` is `null`, it stays
`null` in the API response — the API does not substitute `title`. Any "use the headline
when no SEO title is set" rule belongs to the renderer.

**Kal El serves no redirect.** The `redirects` table is a record for the frontend or the
reverse proxy to consume; nothing in the API issues a 301 to a reader.

---

## 2. The SEO object

`seo` is a nested object on the article, on both create and update.

| Field | Type | Nullable | Default on create | Max |
|---|---|---|---|---|
| `seoTitle` | string | yes | `null` | 160 |
| `metaDescription` | string | yes | `null` | 320 |
| `canonicalUrl` | URL | yes | `null` | 2048 |
| `robotsIndex` | `"index"` \| `"noindex"` | no | **`"index"`** | — |
| `robotsFollow` | `"follow"` \| `"nofollow"` | no | **`"follow"`** | — |
| `socialTitle` | string | yes | `null` | 160 |
| `socialDescription` | string | yes | `null` | 320 |
| `socialImageMediaId` | uuid | yes | `null` | — |
| `primaryCategoryId` | uuid | yes | `null` | — |

Stored as a single `jsonb` column, `NOT NULL`, with a table default that is the same
all-null object.

### Merge semantics

| Operation | Behaviour |
|---|---|
| Create | your partial object is **spread over the defaults**; anything omitted takes the default |
| Update | your partial object is **shallow-merged over the stored one** |

So `{"seo": {"seoTitle": "x"}}` on a `PATCH` changes only `seoTitle` and leaves the other
eight fields untouched. There is no way to reset the whole object in one call other than
sending all nine fields.

### Validation

| Field | Checked |
|---|---|
| `socialImageMediaId` | must be media **in this site** → else `400`, `details.mediaId` |
| `primaryCategoryId` | must be a category **in this site** → else `400`, `details.categoryId` |
| `canonicalUrl` | valid URL, ≤2048 |
| `robotsIndex` / `robotsFollow` | enum |

Length limits are **not truncated** — exceeding one is a `400`. The 160/320 figures are
conventional search-result limits, enforced as hard maxima.

### What is not modelled

No `keywords`, no structured-data/JSON-LD field, no per-article `hreflang`, no
`ogType`, no `twitterCard`, no `noarchive`/`nosnippet`/`max-snippet`, no
`priority`/`changefreq`. A renderer needing any of those derives them itself.

---

## 3. Slugs and canonical URLs

| Concern | Behaviour |
|---|---|
| Auto-derivation | when `slug` is omitted on create: NFD-normalised, accents stripped, lowercased, non-alphanumerics collapsed to `-`, trimmed, truncated to 120 chars, falling back to `"untitled"` |
| Collision (auto) | `-2`, `-3`, … appended until free |
| Collision (explicit) | **not renamed** — `409 CONFLICT` from `articles_site_slug_unique` |
| Uniqueness | `(site_id, slug)` — two sites may share a slug |
| Nullable | yes, at the database level |
| Path shape | the API stores a slug, **not a path**. `/2026/08/my-article` is the frontend's construction. |

`canonicalUrl` is a free string. Nothing composes it from `primaryDomain` + `slug`; if you
want that, either write it on the client or have the renderer derive it.

The site's `primaryDomain` is stored bare (`maquinanerd.com.br` — no scheme, no trailing
slash) precisely so a renderer can concatenate rather than parse.

---

## 4. Redirects

```
GET    /v1/sites/{siteId}/redirects              -> {"data": [ … ]}, sorted by sourcePath
POST   /v1/sites/{siteId}/redirects              -> 201
DELETE /v1/sites/{siteId}/redirects/{redirectId} -> 200 {"data": {"id", "deleted": true}}
```

Scope `seo.manage` on all three.

| Field | Type | Required | Constraint |
|---|---|---|---|
| `sourcePath` | string 1..2048 | yes | **must start with `/`** |
| `targetPath` | string 1..2048 | yes | **must start with `/`** |
| `kind` | `"301"` \| `"302"` | no, default `"301"` | |

Unique on `(siteId, sourcePath)` — a duplicate is `409 CONFLICT` with
`details.field = "sourcePath"`.

`POST /redirects` does **not** honour `Idempotency-Key`. Deletion is scoped by
`(id, site_id)` in the `WHERE` clause itself, so a caller from another site can never
destroy a row that is not theirs.

### Automatic redirects on slug change

When a `PATCH` changes an article's `slug` and the value actually moves, the API upserts:

```
sourcePath = "/" + oldSlug
targetPath = "/" + newSlug
kind       = "301"
```

with `ON CONFLICT (site_id, source_path) DO UPDATE`, so a slug that moves twice ends up
pointing at the final destination rather than forming a chain.

Two things to know:

- **The paths are bare `/slug`.** If your public URLs include a date or section segment,
  these rows will not match them — translate on the frontend, or manage your own redirects.
- **Uniqueness excludes the article itself** when re-checking a slug on update. Without
  that, a repeated sync of the same source slug oscillated: the article at `foo-2` asked for
  `foo`, found `foo` taken and `foo-2` taken (by itself), moved to `foo-3`; the next run
  found `foo-2` free and moved back — leaving redirects in both directions, i.e. a permanent
  301 loop on the public site.

Nothing prunes redirects, and nothing detects chains or loops beyond that upsert.

---

## 5. Preview and indexing

`GET /v1/preview/{token}` always sets:

```
x-robots-tag: noindex, nofollow
```

The CMS renderer at `/preview/{token}` fetches that endpoint server-side. If you build your
own preview surface, set the header yourself — the token is unauthenticated and a leaked
preview URL is otherwise indexable for 15 minutes.

See [../integrations/EXTERNAL_CLIENT_API.md §15](../integrations/EXTERNAL_CLIENT_API.md#15-preview).

---

## 6. What a frontend has to implement

Given an article payload, a public frontend is responsible for:

1. `<title>` — `seo.seoTitle` **or** `title`, truncated to taste;
2. `<meta name="description">` — `seo.metaDescription` or a derived summary;
3. `<link rel="canonical">` — `seo.canonicalUrl` or `https://{primaryDomain}/{slug}`;
4. `<meta name="robots">` — `${seo.robotsIndex}, ${seo.robotsFollow}`;
5. Open Graph / Twitter — `seo.socialTitle` or `seoTitle` or `title`;
   `seo.socialDescription` or `metaDescription`; the image from
   `seo.socialImageMediaId` (**resolve the id to a URL yourself — the media file route is
   permission-gated**) or `featuredMediaId`;
6. JSON-LD — nothing is stored; build it from `title`, `dek`, `authors`, `publishedAt`,
   `updatedAt`, `categories`;
7. `sitemap.xml` and `robots.txt` — nothing is generated;
8. Serving the rows in `redirects` as real HTTP redirects;
9. `noindex` on preview, search and pagination surfaces.

---

## 7. Scopes

| Operation | Scope |
|---|---|
| Read or write `seo` on an article | `articles.read` / `articles.update` — it is part of the article body |
| Set `seo` at creation | `articles.create` |
| List, create, delete redirects | `seo.manage` |

There is no separate SEO read scope. The preset roles `admin` and `editor-chefe` carry
`seo.manage`; `editor` and `autor` do not — an editor can set an article's `seo` object but
cannot manage redirects.

---

## Implementation references

- `packages/contracts/src/seo.ts` — `seoMetadataSchema`, `redirectSchema`, `createRedirectBodySchema`
- `apps/api/src/services/articles.ts` — the SEO merge, `assertPrimaryCategoryInSite`, `slugify`, `uniqueSlug`
- `apps/api/src/services/redirects.ts` — CRUD and `upsertSlugRedirect`
- `apps/api/src/services/media.ts` — `assertMediaInSite` for `socialImageMediaId`
- `apps/api/src/services/preview.ts`, `apps/api/src/routes/preview.ts` — the `noindex` header
- `packages/contracts/src/sites.ts` — `primaryDomainSchema`
- `packages/db/src/schema/editorial.ts` — `articles.seo` and its default
- `packages/db/src/schema/system.ts` — the `redirects` table
- [../03-SEO.md](../03-SEO.md) — the original product-level SEO brief
