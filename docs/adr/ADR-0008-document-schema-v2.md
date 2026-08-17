# ADR-0008 — Canonical editorial document schema V2 (inline marks)

Status: Accepted
Date: 2026-08-17
Related: ADR-0007, docs/02-EDITOR-UX.md, docs/03-SEO.md

## Context

The v1 document model stored paragraph/heading/quote content as plain strings
and list/table cells as plain strings. Rich inline formatting — bold, italic,
links (internal and external), code — was structurally impossible to store,
which blocks editorial use, internal linking (SEO) and lossless imports.

## Decision

- The canonical document schema is **V2**, where every text-bearing block
  (paragraph, heading, quote, list item, table cell) carries **inline content**:
  an ordered array of text nodes with optional **marks**.
- Marks: `bold`, `italic`, `code`, `underline`, `strike`, `link` (link carries
  `href`, `title`, `internal`). `href` accepts `http(s)` URLs or internal paths
  (`/slug`), matching the internal/external link requirement.
- The versioned schema remains a discriminated union `version: 1 | 2`:
  - `version: 1` (legacy) is still accepted at the API boundary (old
    SDK/importer clients and legacy stored rows);
  - `version: 2` (canonical) is what the API serves and what the editor/importer
    produce.
- Pure, tested migration functions (`migrateDocumentToV2`, `migrateDocumentToV1`)
  normalize between versions. V1→V2 is lossless; V2→V1 flattens marks (documented
  as lossy). The API normalizes to V2 on read and write, so legacy V1 rows are
  served as V2 and new writes always store V2. No SQL migration is required
  (documents are `jsonb`; the transform is structural and reversible for plain
  text).
- ProseMirror (TipTap, per ADR-0007) is extended with mark specs mirroring the
  contract; `documentToProseMirror` / `proseMirrorToDocument` round-trip V2,
  preserving marks. Inline content is canonicalized (`normalizeInlineContent`:
  stable mark order + merge adjacent identical text nodes) for deterministic
  serialization.

## Consequences

- Bold/italic/link survive editor → JSON → editor and storage round-trips.
- The WordPress importer now preserves inline marks and links via an
  `extractInline` walker (still allow-list based; unsafe hrefs/scripts dropped).
- Renderers on consuming frontends must only trust known node types and marks;
  unknown node types are rejected at the ProseMirror schema boundary and by the
  zod contract.
- Lexical remains the documented alternative prototype (ADDR-0007); its headless
  bridge flattens marks, which is an explicit known limitation requiring custom
  node/mark registration.
