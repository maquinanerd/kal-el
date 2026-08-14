# Phase 6 — Editorial SEO (slug/canonical/redirect lifecycle)

Status: complete (core)
Date: 2026-08-14
Prompt: prompts/04-SEO-WORKFLOW.md (SEO half)

## What was built

- **Redirect lifecycle** (`/v1/sites/:siteId/redirects`): list, create (409 on
  duplicate source), delete — all behind the `seo.manage` permission.
- **Automatic 301 on slug change**: `updateArticle` inserts/updates a permanent
  redirect from the previous slug to the new one (`upsertSlugRedirect`,
  idempotent via `onConflictDoUpdate`). Old URLs stay alive.
- **Editorial SEO metadata** (already in the article model, now exercised):
  `seoTitle`, `metaDescription`, `canonicalUrl` (http(s) only), `robotsIndex`,
  `robotsFollow`, social title/description — editable through article update.

## Evidence

`apps/api/tests/seo.test.ts` (3 tests):

| Test | Result |
|---|---|
| slug change creates a 301 redirect old→new | pass |
| manual redirect CRUD + duplicate conflict (409) | pass |
| editorial SEO metadata editing via article update | pass |

Per docs/03-SEO.md, Kal El owns editorial SEO; technical SEO rendering remains
the responsibility of consuming frontends (the fixture proves revalidation).

## Notes

- Scheduled-publish promotion (worker) and redirect table are available for
  the SEO overview UI phase (gated by the DS-3 visual gate).
