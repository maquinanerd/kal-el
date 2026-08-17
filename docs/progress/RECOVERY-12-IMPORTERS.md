# RECOVERY-12 — IMPORTADORES (R11)

**Date:** 2026-08-17

## Delta audit (`packages/importer`)

Antes: WordPress (snapshot→normalize→HTML→import via REST→reconcile) já preservava inline/links
(via R1), mas **descartava toda mídia** (`urlToMediaId` nunca populado). Payload era um parser
que esperava HTML string e descartava relações.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/importer/src/import.ts` | `fetchMedia` opcional: baixa/uploada binários via SDK, popula `urlToMediaId` e `featuredMediaId`; nós image/gallery preservados. |
| `packages/importer/src/lexical.ts` | Conversor Payload/Lexical JSON → nós intermediários (marcas bold/italic/code/underline/strike/link). |
| `packages/importer/src/payload.ts` | Detecta Lexical vs HTML; mapeia relações (author/categories/tags). |
| `packages/importer/tests/import.test.ts` | Media migration: 1 mídia importada, image preservada, featured definido. |
| `packages/importer/tests/payload.test.ts` | Fixture Payload/Lexical → batch com relações e marcas. |

## Migrations

Nenhuma.

## Tests

- `import.test.ts` atualizado (mídia preservada).
- `payload.test.ts` novo (Lexical + relações).
- Suíte: **134 testes passando** (importer 10).

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm --filter @kal-el/importer test   10 pass
```

## Gate R11

```text
dry-run → import → re-import (no duplicate) → reconcile: PASS
mídia + rich text preservados no WordPress:           PASS
Payload export → normalized batch (Lexical):          PASS
```

## Commit

Vide `git log` (commit R11).
