# Phase 4 (decision step) — Editor engine prototype + ADR

Status: engine decision made; editor UI pending (DS-3 gate)
Date: 2026-08-14
ADR: ADR-0007
Prompt: prompts/03-EDITOR-MEDIA.md (engine ADR requirement)

## What was done

- **`packages/editor`** — headless prototype comparing the two strongest
  mature TypeScript rich-text candidates:
  - **TipTap / ProseMirror** (`src/tiptap.ts`): a schema mirroring the Kal El
    versioned document schema; `documentToProseMirror` validates structure
    (`Node.fromJSON` throws on unknown node types), `proseMirrorToDocument`
    round-trips; deterministic serialization.
  - **Lexical headless** (`src/lexical.ts`): core text-block round-trip via the
    official `@lexical/headless` editor (async `editor.update`), demonstrating
    the extension cost (custom Node subclasses for media/embed/source) and the
    heavier serialized JSON.
- **ADR-0007**: engine decision = **TipTap (ProseMirror)** — deterministic
  schema/serialization, full node coverage without extra classes, mature
  React/Next integration, schema-based sanitization, lean versionable JSON.

## Evidence

`packages/editor/tests/prototype.test.ts` (6 tests):

| Test | Result |
|---|---|
| TipTap round-trips the full Kal El node set deterministically | pass |
| TipTap rejects unknown node types (sanitization) | pass |
| heading-level range is the zod contract (structural acceptance documented) | pass |
| Lexical round-trips core text blocks deterministically | pass |
| Lexical JSON includes engine internals (versionability cost) | pass |
| Lexical drops unsupported node types without custom classes | pass |

## Status

The engine decision required by prompts/03 is resolved. **Implementing the
editor UI and the media library (Phases 4–5) remains gated by the DS-3 visual
QA classification** (AGENTS.md 17–18).
