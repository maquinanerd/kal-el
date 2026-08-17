# RECOVERY-03 — MEDIA (R2)

**Date:** 2026-08-17

## Scope

Construir o subsistema de mídia de ponta a ponta: StorageProvider, upload,
listagem, detalhe, metadata, delete seguro, featured image e galeria com
isolamento por site.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/api/src/storage/provider.ts` | Contrato `StorageProvider` (put/get/delete). |
| `apps/api/src/storage/local.ts` | `LocalStorageProvider` (filesystem) com validação de key contra path traversal. |
| `apps/api/src/storage/index.ts` | Fábrica `createStorageProvider(config)`. |
| `apps/api/src/services/media.ts` | upload/list/get/update/delete + `assertMediaInSite` + `collectDocumentMediaIds`. |
| `apps/api/src/routes/site.ts` | Rotas `/media` (GET/POST), `/media/:id` (GET/PATCH/DELETE), `/media/:id/file` (GET). |
| `apps/api/src/app.ts` | Registra `@fastify/multipart` e decora `storage`. |
| `apps/api/src/config.ts` | `MEDIA_STORAGE_PROVIDER`, `MEDIA_LOCAL_PATH`, `MEDIA_MAX_BYTES`. |
| `apps/api/src/auth-context.ts` | Nova permissão `media.read`. |
| `packages/contracts/src/editorial.ts` | `featuredMediaId` em create/update article. |
| `apps/api/src/services/articles.ts` | Valida mídia referenciada (featured + nós image/gallery) no mesmo site. |
| `.env.example` | `MEDIA_MAX_BYTES`. |
| `docs/adr/ADR-0009-media-storage.md` | ADR (StorageProvider + image-size, SVG excluído). |

Dependências adicionadas: `@fastify/multipart`, `image-size`.

## Migrations

Nenhuma (tabela `media` já existia).

## Tests added

`apps/api/tests/media.test.ts` (7 testes): upload com dimensões/mime/tamanho,
list/detail/file (bytes íntegros), update metadata, featured image persistente
após reabrir, nós image/gallery com mídia real, bloqueio cross-site (featured e
nó de documento), delete seguro (409 em uso / 200 não usado).

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 85.84 KB)
pnpm --filter @kal-el/api test   46 pass (incl. 7 media)
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Cursor pagination na listagem de mídia (limite simples por enquanto; cursor chega com a tela Media Library em R6).
- Transformação de imagem (resize/variants) adiada — `sharp` é o candidato, sem mudar o contrato StorageProvider.
- Verificação de "media em uso" em nós de documento usa busca textual no jsonb (heurística segura); rastreamento referencial explícito pode vir depois.

## Gate R2

```text
upload → media record → retrieve → assign featured → reopen → relation intact: PASS
site A article cannot use site B media: PASS
```

## Commit

Vide `git log` (commit R2).
