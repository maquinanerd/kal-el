# Claude Design — Master Reconstruction Prompt

## Contexto

Você está reconstruindo uma identidade visual de produto a partir de screenshots reais localizados na pasta `references/`.

Os produtos são:

- **Kal El** — CMS editorial.
- **Commerce Wayne** — CRM / Commerce OS.

Ambos compartilham uma única foundation: **PEG Product Design System**.

## Regra de autoridade

Os screenshots são o **visual source of truth**.

Não trate as referências como moodboard. Não crie apenas "algo parecido". Extraia proporções, tokens, componentes, density e comportamento e recrie-os com fidelidade.

Quando existir conflito entre:
1. sua preferência estética;
2. um padrão SaaS genérico;
3. a referência visual;

**a referência visual vence**.

## Arquivos obrigatórios a ler antes de desenhar

1. `00_REFERENCE_AUDIT.md`
2. `01_FOUNDATIONS.md`
3. `02_COMPONENTS.md`
4. `03_APPLICATION_SHELLS.md`
5. `04_PATTERNS.md`
6. `05_CALIBRATION_SCREEN.md`
7. `VISUAL_QA.md`

Depois, conforme o produto:
- `10_KAL_EL_UI.md`
- `20_COMMERCE_WAYNE_UI.md`

`design-tokens.json` é baseline, não verdade final. Ajuste tokens se a comparação visual provar divergência.

# FASE 0 — AUDIT

Examine todas as imagens da pasta `references/`.

Crie internamente a página `00 — Reference Audit` e registre:
- screenshot;
- tipo de tela;
- shell;
- componentes;
- desktop/mobile;
- light/dark;
- estados;
- métricas visuais relevantes.

Não avance sem revisar todo o corpus.

# FASE 1 — FOUNDATIONS

Crie `01 — Foundations` contendo:
- Color/light;
- Color/dark;
- Semantic colors;
- Typography;
- Spacing;
- Radius;
- Borders;
- Elevation;
- Icon sizes;
- Control heights;
- Layout metrics.

Preserve a estética predominantemente neutra.

# FASE 2 — COMPONENTS

Crie `02 — Components`.

Reconstrua componentes com variants e states:
- buttons;
- inputs;
- textarea;
- search;
- select;
- checkbox;
- radio;
- switch;
- tabs;
- segmented control;
- sidebar full;
- compact rail;
- mobile drawer;
- breadcrumb;
- table;
- cards;
- badges/status;
- avatar/profile;
- pagination;
- dropdown;
- context menu;
- account menu;
- popover;
- modal;
- drawer;
- toast/alert;
- editor surface;
- rich text toolbars;
- inspector groups.

Não duplique visualmente o mesmo componente entre Kal El e Commerce Wayne.

# FASE 3 — APPLICATION SHELLS

Crie:
- Sidebar + workspace;
- Sidebar + workspace + inspector;
- Compact rail + workspace;
- Focus workflow;
- Modal workflow;
- Mobile shell.

# FASE 4 — CALIBRATION SCREEN

Pare a expansão do projeto.

Antes de criar as telas finais, produza uma **Calibration Screen** que reúna os principais tokens e componentes em:
- desktop light;
- desktop dark;
- mobile light;
- mobile dark.

Compare com o corpus.

Classifique divergências:
- P0: identidade errada / uso quebrado;
- P1: divergência perceptível;
- P2: refinamento.

Corrija todos os P0 e P1 antes da próxima fase.

# FASE 5 — KAL EL

Leia `10_KAL_EL_UI.md`.

Primeiro crie e calibre:
1. Article Editor;
2. Articles Index;
3. Media Library.

Somente depois propague o sistema para as demais telas.

O Article Editor deve seguir o padrão:

```text
Navigation + Editorial Workspace + Contextual Inspector
```

Não criar Gutenberg clone. Não transformar o canvas em coleção de cards.

# FASE 6 — COMMERCE WAYNE

Leia `20_COMMERCE_WAYNE_UI.md`.

Primeiro crie e calibre:
1. Leads/CRM Index;
2. Lead Detail;
3. Conversations.

Depois propague para os demais módulos.

O CRM deve privilegiar alta densidade operacional, tabelas/listas, filtros, atividades e contextual details — não grids decorativos.

# FASE 7 — RESPONSIVE

Para os componentes e telas principais, produzir:
- Desktop XL;
- Desktop;
- Tablet;
- Mobile.

Mobile não é desktop reduzido.

Transformações obrigatórias:
- sidebar → drawer;
- inspector → sheet/drawer;
- table → responsive data pattern;
- secondary actions → overflow;
- multi-column → progressive navigation.

# FASE 8 — DARK MODE

Dark mode deve possuir surfaces e borders próprias.

Nunca implementar por inversão automática de cores.

# FASE 9 — FINAL VISUAL QA

Faça QA contra screenshots.

Avalie:
- typography;
- font weight;
- border;
- radius;
- spacing;
- control height;
- sidebar width;
- row height;
- modal size;
- density;
- whitespace;
- icons;
- surface hierarchy;
- responsive behavior.

Zero P0 e zero P1 relevante para concluir.

# HARD CONSTRAINTS

Não usar como linguagem dominante:
- glassmorphism;
- gradients decorativos;
- sombras grandes;
- cards gigantes;
- radius exagerado;
- cores saturadas em grandes superfícies;
- excesso de pills;
- dashboards cheios de gráficos sem função;
- ilustrações genéricas em telas operacionais.

O resultado deve transmitir:
**software profissional, silencioso, preciso, editorial/operacional, denso e sofisticado.**

# DEFINITION OF DONE

Mesmo removendo logo, textos de marca e accent color, uma tela nova deve parecer pertencente à mesma família visual dos screenshots de referência.

Kal El e Commerce Wayne devem parecer dois produtos diferentes da mesma plataforma visual.
