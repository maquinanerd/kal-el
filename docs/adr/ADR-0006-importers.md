# ADR-0006 — Import architecture (WordPress / Payload)

Status: Accepted
Date: 2026-08-14
Related: docs/06-MIGRATION.md, ADR-0001

## Context

WordPress and Payload are migration/import sources, never architectural
dependencies (AGENTS.md rule 3, docs/06-MIGRATION.md). Import must be safe
under retries, deterministic, reversible via dry-run, and reconcileable. No
binary media pipeline exists yet (Phase 5 is gated by the DS-3 visual gate).

## Decision

- **Neutral normalized model**: a `SourceSnapshot` → `ImportBatch` pipeline
  (`packages/importer`) that any adapter (WordPress, Payload, future CMS)
  produces. Kal El never parses WordPress-specific structures at import time
  beyond the adapter boundary.
- **Adapters**:
  - `WordPressAdapter`: reads a deterministic JSON export (modeled on WXR:
    authors, categories, tags, media, posts with Yoast meta), normalizes to the
    batch, transforms classic HTML bodies into the versioned document schema
    via a safe, allow-listed HTML walker (`node-html-parser`).
  - `PayloadAdapter`: framework — same normalized batch contract, with a
    documented field-map option; completes against real exports.
- **Import execution**: through the public REST API via `@kal-el/sdk` (never
  writing to PostgreSQL directly), using article `externalKey = wp:{id}` and
  natural unique slugs for taxonomy/authors for idempotent re-import.
- **Dry-run & reconcile**: import runs in dry-run mode by default; reconcile
  compares source counts/hashes against imported state.
- **Media**: imported as metadata rows (provider=source, storageKey=source URL)
  with provenance; binary ingestion is deferred until the StorageProvider
  (Phase 5) exists and is reported as pending in the reconcile report.

## Consequences

- Deterministic, idempotent, reversible (dry-run) import; safe for retries.
- No runtime coupling to WordPress/Payload after migration.
- Media binaries are not copied in v1 (documented limitation).
