# Phase 10 — Importers (WordPress full + Payload framework)

Status: complete (WordPress), framework (Payload)
Date: 2026-08-14
Prompt: prompts/06-MIGRATION-HARDENING.md (import half)
ADR: ADR-0006

## What was built

`packages/importer` — a neutral pipeline shared by every adapter:

```text
SourceSnapshot -> normalize (ImportBatch) -> dry-run -> import via REST SDK -> reconcile
```

- **`html.ts`** — safe, allow-listed WordPress classic HTML → versioned document
  nodes (headings h2–h4, paragraph, quote, list, table, image, gallery, embed
  w/ YouTube). Scripts/styles/`on*`/unsafe URLs dropped; images kept as
  `sourceUrl` until import resolves media.
- **`wordpress.ts`** — `readWordPressSnapshot` + `normalizeWordPress`
  (deterministic): authors, categories (parents), tags, media, posts; status
  map (publish→published, future→scheduled, draft→draft); Yoast SEO meta →
  editorial SEO; deterministic transform.
- **`dryrun.ts`** — pure validation + counts + preview (no side effects).
- **`import.ts`** — `importBatch` through the public REST API via `@kal-el/sdk`
  (never PostgreSQL directly): ensure taxonomy/authors idempotently by slug,
  create articles with `externalKey = imp:{externalId}` (re-import → existing),
  preserve `status`/`publishedAt`/`scheduledAt`, emit `article.published`
  revalidation for imported published articles, report media as pending.
- **`reconcile.ts`** — source vs imported counts, missing/extra externalKeys,
  deterministic hash comparison.
- **`payload.ts`** — `PayloadAdapter` framework: same `ImportBatch` contract
  with a documented field-map for project-specific exports.

## API contract extension

`createArticleBodySchema` now accepts optional `status`/`publishedAt`/`scheduledAt`
(import + automation path); article summaries expose `externalKey`; article
list supports `externalKey` lookup (also useful for MN26). A published create
emits the exactly-once `article.published` outbox event.

## Evidence

| Suite | Tests | Result |
|---|---|---|
| `html` transform | 3 | safe deterministic conversion; unsafe HTML/URLs never emitted |
| `wordpress` + dry-run | 3 | deterministic normalize; dry-run counts/issues |
| `import` integration (live API) | 2 | import preserves status/date + revalidation; re-import idempotent; reconcile deterministic |

End-to-end: WP snapshot (1 published + 1 draft, Yoast meta, image) → import →
`status=published`, `publishedAt=2024-11-15T10:00:00Z`, SEO filled,
`provenance.sources[0].externalId=wp:post:42`, image node deferred
(`mediaPending=1`), exactly one `article.published` event; second import
imports 0 / existing 2; `reconcile` missing=[], deterministic=true.

## Known limitations

- Media binaries are deferred to the StorageProvider (Phase 5); metadata is
  counted and reported as pending, image nodes are dropped with warnings.
- Inline markup (links/bold within paragraphs) is flattened to text — the
  document schema has no inline formatting nodes yet (editor Phase 4).
- Payload adapter maps a documented export shape; real Payload projects may
  need a small field-map (interface provided).
