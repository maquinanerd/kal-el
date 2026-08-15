# ADR-0007 — Rich-text editor engine

Status: Accepted
Date: 2026-08-14
Related: docs/02-EDITOR-UX.md, docs/11-OPEN-DECISIONS.md, prompts/03-EDITOR-MEDIA.md

## Context

The Article Editor must be writing-first, document-first, with a versioned
structured document schema, safe embeds/paste, media, galleries, links,
headings and tables — and no arbitrary executable HTML/JS. The engine choice
was an open decision. This ADR records a headless prototype comparison
(`packages/editor`, tests in `prototype.test.ts`).

## Candidates and prototype evidence

Prototype covered: deterministic serialization round-trip of the Kal El node
set, structural sanitization, and versionability of the serialized form.

| Criterion | TipTap (ProseMirror) | Lexical (headless) |
|---|---|---|
| Deterministic schema/serialization | ✅ full node set round-trips via `Node.fromJSON/toJSON`; lean, stable JSON | ✅ core text blocks round-trip; serialized JSON carries engine internals (heavier) |
| Extension model | schema NodeSpec/attrs — full coverage (paragraph, heading 2–4, quote, list, table, image, gallery, embed, source) without extra classes | custom Node subclasses required for media/embed/gallery/source |
| React/Next integration | mature (`@tiptap/react`); StarterKit | mature (`@lexical/react`), but async update model in headless |
| Accessibility | contenteditable with aria support; schema-safe | comparable |
| Sanitization | schema rejects unknown node types at the boundary | unknown/custom content dropped or requires custom node validation |
| Versionability | document JSON is the storage form; versioned (`version:1`) | editor state JSON is heavier and includes engine fields |

## Decision

- **TipTap (ProseMirror)** is the Kal El editor engine.
- The ProseMirror schema in `packages/editor/src/tiptap.ts` mirrors the
  versioned document schema (`packages/contracts`); the zod contract remains
  the value-range gatekeeper at the API boundary (e.g., heading level 2–4),
  while the ProseMirror schema is the structural sanitizer (unknown node types
  are rejected before storage/rendering).

## Consequences

- Deterministic serialization enables revisions/diff and safe round-trip
  storage of the article document.
- Media/embed/source/table are first-class nodes via schema attrs (no extra
  node-class boilerplate).
- The editor UI (Phase 4) is still gated by the DS-3 visual QA gate; this ADR
  resolves only the engine choice.
- Lexical remains documented as the primary alternative if a future product
  (e.g., a comment thread or collaboration surface) has requirements that
  ProseMirror serves worse.
