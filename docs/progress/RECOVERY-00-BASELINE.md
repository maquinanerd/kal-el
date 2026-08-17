# RECOVERY-00 — BASELINE

**Date:** 2026-08-17
**Branch:** `feat/foundation-phase-1-3`
**HEAD:** `3a96a3a9aca4d4f6d0b08bdb26583e1f96af9ab4`

## Worktree discovery (mechanical)

```text
worktree produto:   C:\Users\pablo\Documents\OpenCode\Kal El   (branch feat/foundation-phase-1-3)
remote:             origin https://github.com/maquinanerd/kal-el.git
tracked_files:      261
node:               v24.19.0
package_manager:    pnpm 11.15.1
apps/:              api  fixture  worker   (NO apps/cms)
packages/:          auth contracts db design-system editor events importer sdk testkit
```

Fonte de verdade: `docs/audits/KALEL_360_AUDIT.md`. Seus achados P0/P1 são o ponto de partida.

## Baseline gates (executados nesta recuperação)

| comando | resultado |
|---|---|
| `pnpm -r typecheck` | PASS (12/13 projetos) |
| `pnpm -r lint` | PASS |
| `pnpm -r test` | PASS — 87 tests, 0 fail, 0 skip |
| `pnpm -r build` | PASS (api 73.33 KB, worker 9.44 KB, fixture 1.71 KB) |

Testes por pacote (87 total): contracts 9, design-system 5, editor 6, sdk 5, db 8, auth 5, worker 8, api 31, fixture 2, importer 8.

Observações: "close timed out after 10000ms" em pacotes com PostgreSQL embutido é cosmético no Windows (exit 0). `DeprecationWarning` do `pg` é ruído.

## Pontos de partida R0 (da auditoria)

- P0-1: bypass de publicação via `POST /articles {"status":"published"}`.
- P1-3: `deleteRedirect` apaga linha antes de validar `site_id`.
- P1-2 (parte R0.3): PATCH descarta `status` em silêncio (zod strip).
