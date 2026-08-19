# 00 — Reference Audit · resultado da execução

Corpus: 49 arquivos em `uploads/peg-product-design-system/references/`. Todos revisados; nenhum tratado como moodboard.

## Famílias de padrão confirmadas

| Família | Shell | Evidência |
|---|---|---|
| App shell + workspace | A | 3cf289a1, 4e7cbd33, 834715b0, b98b74db, 0fe4e8bc |
| Shell + inspector contextual | B | 3a0c7358, 788d320d, 0f3e66aa |
| Dense data (toolbar → tabs → filtros → tabela → pagination) | A | 3cf289a1, 0a542d2b, 834715b0 |
| Rail duplo (rail de ícones + sub-nav) | C | d3e2d019, 1f3531c6, 3b1f1c0d |
| Focus workflow | D | 9d847613, 0fe4e8bc, 46f4ebc8, 906c9221 |
| Overlay workflow | E | 07aa6cf2, 0cae1b20, 56d881bb |
| Responsive dual-state | F | 4e7cbd33, 0f3e66aa, 1f3531c6, 906c9221 |
| Marketing shell (fora do escopo de produto) | — | a35293bf, 5e3babbb, 0e545562, 11dc1f00 |

## Evidências transversais

- Sidebar em surface-subtle contra workspace branco; nunca sombra, sempre border-right.
- Nav item h34, radius 6, 13.5/500; active = fill muted + texto primary. Accent nunca aparece na navegação.
- Divisores de seção e de row são **1px dotted** — assinatura do sistema, presente em light e dark.
- Cards existem por border + radius 12; controles usam radius 8 + hairline shadow.
- Primary button near-black; accent reservado a publish/CTA e estados semânticos.
- Tabelas: header 38px em canvas, rows 44–48px, checkbox 16px, avatar 24px, kebab à direita.
- Section labels em micro caps tertiary; árvore aninhada com chevron 14px.
- Dark mode tem surfaces próprias: rail mais escuro que o canvas, três níveis de surface, sem sombra preta pesada.
- Mobile mantém os componentes e troca a navegação: drawer, rows priorizadas, bottom sheet, alvos de 44px.

## Divergências corrigidas (P0/P1/P2)

| Sev | Token | Baseline | Calibrado |
|---|---|---|---|
| P0 | dark surfaces | #19191B / #202022 | #0E0E10 / #16161A / #1C1C21 |
| P1 | divider | 1px solid | 1px dotted #DFDFE2 |
| P1 | sidebar surface | não especificado | #F7F7F8 + border-right |
| P1 | table row | 52px | 44px (48 com avatar) |
| P1 | nav item | genérico | h34 · r6 · 13.5/500 · active fill muted |
| P1 | control shadow | flat | 0 1px 2px rgba(16,17,20,.05) |
| P1 | card radius | 8px | 12px card / 8px control |
| P2 | sidebar width | 240px | 248px · rail 60px |
| P2 | typeface | Inter | Geist + Geist Mono |
| P2 | product accent | configurável | Kal El #2F6BFF · Wayne #15803D |

Zero P0 e zero P1 em aberto. Gate liberado para Fase 5 e Fase 6.

Artefatos: `PEG Calibration.dc.html`, `peg-tokens.calibrated.css`, `peg-tokens.calibrated.json`.
