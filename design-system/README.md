# PEG Product Design System

Base visual compartilhada para:

- **Kal El** — CMS editorial.
- **Commerce Wayne** — CRM / Commerce OS.

---

## ⚠️ Referência visual final do Kal El

**`references/kal-el-final/` é a referência visual final do Kal El** e tem precedência
sobre os documentos genéricos deste pacote para tudo que diga respeito ao CMS.

```
references/kal-el-final/
├── standalone/kal-el.html        design executável — abra no navegador, funciona offline
├── source/Kal El.dc.html         mesma coisa, editável (precisa de support.js ao lado)
├── KAL_EL_INVENTORY.md           valores literais de cada componente + regras invioláveis
├── spec/10_KAL_EL_COMPLETE_DESIGN.md
├── spec/00_AUDIT_RESULT.md       auditoria das 49 referências
└── tokens/                       kal-el-tokens.* e peg-tokens.calibrated.*
```

**Nada disso é dependência de runtime.** Nenhum arquivo daqui é importado pelo produto;
`packages/design-system/src/tokens.css` é a implementação, derivada de
`tokens/kal-el-tokens.css`. O pacote existe para consulta e para regressão visual.

Três telas têm design executável e devem ser comparadas lado a lado com o produto antes
de qualquer alteração visual nelas: **Article Editor**, **Articles Index** e **Media
Library**.

### Ordem de precedência quando houver conflito

1. `standalone/kal-el.html`
2. `KAL_EL_INVENTORY.md`
3. `spec/10_KAL_EL_COMPLETE_DESIGN.md`
4. `tokens/kal-el-tokens.*`
5. os documentos genéricos do PEG abaixo

### Erros conhecidos no pacote

- `spec/00_AUDIT_RESULT.md` traz a linha `Kal El #2F6BFF` na tabela de divergências.
  É resíduo cross-product e deve ser **ignorada**. O accent do Kal El é `#BF5252`
  (primary) / `#B51B1B` (strong), como está no README do pacote, no inventário e nos
  tokens.
- Os `#C7C7C7` (borda de controle) e `#8B8D86` (texto terciário) do pacote medem 1.69:1
  e 2.95:1 e reprovam no gate de acessibilidade do CMS. A implementação usa `#8B8E86`
  (3.33:1) e `#6B6E65` (4.56:1) — mesma família neutra quente, contraste aprovado. Ver o
  comentário no topo de `packages/design-system/src/tokens.css`.

O relatório da rodada que implementou este pacote está em `docs/FINAL-VISUAL-REPORT.md`.

---

Este pacote transforma os screenshots de referência em uma especificação operacional para reconstrução no Claude Design e posterior implementação no código.

## Regra principal

Os screenshots em `references/` são o **visual source of truth**. Os documentos deste pacote não autorizam "embelezamento" livre. Quando uma decisão genérica de UI conflitar com uma evidência visual dos screenshots, a referência visual vence.

## Ordem de execução

1. `00_REFERENCE_AUDIT.md`
2. `01_FOUNDATIONS.md`
3. `02_COMPONENTS.md`
4. `03_APPLICATION_SHELLS.md`
5. `04_PATTERNS.md`
6. `05_CALIBRATION_SCREEN.md`
7. `10_KAL_EL_UI.md`
8. `20_COMMERCE_WAYNE_UI.md`
9. `VISUAL_QA.md`
10. `ACCEPTANCE_CHECKLIST.md`

O arquivo `CLAUDE_DESIGN_MASTER_PROMPT.md` é o prompt mestre para o Claude Design.

`design-tokens.json` e `design-tokens.css` são uma baseline de implementação. Os valores devem ser calibrados visualmente antes de serem considerados definitivos.

## Princípio de arquitetura visual

```text
PEG Product Design System
├── Foundations
├── Components
├── Application Shells
├── Patterns
├── Kal El
└── Commerce Wayne
```

Kal El e Commerce Wayne devem parecer produtos diferentes construídos pela mesma empresa, pelo mesmo time e sobre o mesmo sistema de componentes.

## Não fazer

- Não reproduzir WordPress/Gutenberg no Kal El.
- Não transformar o Commerce Wayne em um dashboard genérico de cards.
- Não usar glassmorphism.
- Não exagerar shadows, gradients, radius ou pills.
- Não trocar densidade por espaços vazios decorativos.
- Não usar cor como substituto de hierarquia.
- Não redesenhar componentes antes de auditar a referência correspondente.
