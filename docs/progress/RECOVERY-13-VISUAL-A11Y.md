# RECOVERY-13 — VISUAL QA + ACCESSIBILITY (R12)

**Date:** 2026-08-17

## Scope

Auditoria de acessibilidade em nível de código + preparação para visual QA automatizado.

## Accessibility (code-level)

Revisão feita nos componentes/telas do CMS e correções aplicadas:

| área | estado |
|---|---|
| Labels de formulário | Input/Select/Textarea usam `<label>` que envolve o controle (associação implícita) — OK |
| Semântica | `role="menu"/"menuitem"`, `role="dialog"/"aria-modal"`, `<main>/<aside>/<header>` no shell PEG — OK |
| Toolbar do editor | botões com `aria-label` + `title` — OK |
| Site switcher | `<select>` com `aria-label` — OK |
| Media grid / MediaPicker | adicionados `aria-label` e `aria-pressed` nos botões de seleção (corrigido nesta fase) |
| Contraste/teclado/focus | herdados dos tokens PEG (`--peg-*`); focus-visible depende do CSS do design system |

## Visual QA (classificação P0/P1/P2)

Estado honesto: a classificação visual item a item contra os screenshots de referência
(`design-system/` + `docs/progress/calibration-shots/`) requer uma revisão com capacidade de
imagem (browser/screenshot). Este ambiente CLI não executa navegador com captura. A evidência
automatizada (screenshots + axe) será produzida no R13 via Playwright, que é o ponto natural
do gate visual + acessibilidade + E2E.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/app/(app)/media/page.tsx` | `aria-label` nos botões de abrir mídia. |
| `apps/cms/components/MediaPicker.tsx` | `aria-label` + `aria-pressed` nos botões de seleção. |

## Migrations

Nenhuma.

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm --filter @kal-el/cms build   PASS
```

## Gate R12

```text
a11y code audit:      parcial (feito; screenshot/axe no R13)
visual QA P0/P1/P2:   pendente de revisão com imagem (R13 Playwright)
```

## Commit

Vide `git log` (commit R12).
