# PEG Product Design System

Base visual compartilhada para:

- **Kal El** — CMS editorial.
- **Commerce Wayne** — CRM / Commerce OS.

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
