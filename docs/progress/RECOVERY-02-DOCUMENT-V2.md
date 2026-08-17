# RECOVERY-02 — DOCUMENT V2 (R1)

**Date:** 2026-08-17

## Scope

Substituir o modelo de documento de texto-plano (V1) por um **ArticleDocument V2**
com suporte real a rich text inline (marks), preservando compatibilidade com V1.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/contracts/src/editorial.ts` | Marks (`bold/italic/code/underline/strike/link`), nós inline (`text`/`hardBreak`), `inlineContentSchema`, schemas `documentV1Schema`/`documentV2Schema`, `documentSchema` (união discriminada), e funções `textToInline`, `inlineContentToText`, `normalizeInlineContent`, `migrateDocumentToV2`, `migrateDocumentToV1`. |
| `packages/editor/src/tiptap.ts` | Schema ProseMirror com marks; round-trip V2 preservando marcas; canonicalização determinística. |
| `packages/editor/src/lexical.ts` | Bridge Lexical atualizada para V2 (achata marcas — limitação documentada). |
| `packages/importer/src/html.ts` | `extractInline` preserva bold/italic/code/underline/strike/link; `finalizeDocument` produz V2. |
| `apps/api/src/services/articles.ts` | Normaliza documento para V2 em leitura/escrita/revisões; `DEFAULT_DOCUMENT` V2. |
| `apps/worker/src/scheduler.ts` | `DEFAULT_DOCUMENT` V2 (cosmético). |
| `docs/adr/ADR-0008-document-schema-v2.md` | ADR registrando a decisão. |

## Migrations

Nenhuma SQL (documentos são `jsonb`). Migração V1↔V2 é função pura e testada;
API normaliza em leitura/escrita, então linhas V1 legadas são servidas como V2.

## Tests added / updated

- `contracts/tests/schemas.test.ts`: V2 com marks, rejeição de href inseguro, rejeição de versão 3, e migração V1→V2 idempotente + round-trip V1→V2→V1.
- `editor/tests/prototype.test.ts`: round-trip completo + preservação de marks (bold/italic/link, bold+link).
- `importer/tests/html.test.ts`: preservação de links e formatação no V2; nós intermediários com inline content.
- `api/tests/articles.test.ts`: V2 nas operações de criação/edição/leitura.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 74.00 KB)
pnpm --filter @kal-el/contracts test  15 pass
pnpm --filter @kal-el/editor test      7 pass
pnpm --filter @kal-el/importer test    9 pass
pnpm --filter @kal-el/api test        39 pass
pnpm --filter @kal-el/worker test      8 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Lexical (alternativa documentada) ainda achata marks — fora do caminho runtime.
- Table headers continuam como lista de textos (mesma semântica V1); melhorar o modelo de tabela é trabalho futuro não bloqueante.

## Gate R1

```text
round-trip editor↔JSON↔editor:  PASS (marcas/links preservados)
links preservados:              PASS
marcas preservadas:             PASS
documentos V1 legíveis:         PASS (normalizados para V2)
API aceita V2:                  PASS
revisions preservam V2:         PASS
importer produz V2:             PASS
```

## Commit

Vide `git log` (commit R1).
