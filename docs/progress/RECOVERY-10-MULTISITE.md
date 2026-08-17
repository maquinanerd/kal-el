# RECOVERY-10 — MULTI-SITE (R9)

**Date:** 2026-08-17

## Scope

Gerenciamento de sites (criar/listar/editar) + prova de isolamento multi-site ponta a ponta.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/app/(app)/sites/page.tsx` | Tela de sites (listar/criar/editar nome+status, "usar" no switcher). |
| `apps/cms/components/AppShell.tsx` | Item "Sites" no nav. |
| `apps/api/tests/multisite.test.ts` | Matriz de isolamento R9 (ler/editar/listar artigos, deletar taxonomia, mídia, service token cross-site). |

## Migrations

Nenhuma (backend já modelava Site e isolamento por `site_id`).

## Tests

`multisite.test.ts` (4): editor do site A não lê/edita/lista artigos do B (403); não deleta taxonomia do B (404 + linha persiste); artigo do A não referencia mídia que não possui (400); service token do A não opera B (SITE_SCOPE_MISMATCH).

Suíte: **130 testes passando** (api 66).

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm -r test         130 pass, 0 fail, 0 skip
pnpm --filter @kal-el/cms build   PASS (rota /sites)
```

## Known gaps

- `maxParamLength` emitiu deprecation warning no Fastify 5 (funcional; mover para `routerOptions` em limpeza futura).
- Ao criar um site via admin, o owner não ganha membership automaticamente (precisa atribuir papel por site) — comportamento existente, documentado.

## Gate R9

```text
Site A não lê/edita/deleta Site B:   PASS
Site A não usa mídia do B:           PASS
service token A não opera B:         PASS
```

## Commit

Vide `git log` (commit R9).
