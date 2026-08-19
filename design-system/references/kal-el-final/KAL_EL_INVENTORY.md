# KAL EL — Inventário de UI

Extraído de `source/Kal El.dc.html`. Todos os valores são os literais realmente usados nas telas.

---

## 1. Telas entregues

| # | Tela | Shell | Frame | Descrição |
|---|---|---|---|---|
| 1 | **Article Editor** | B — sidebar + workspace + inspector | 1440 × 900 | Coluna de escrita de 820 px, autosave no topbar, toolbar flutuante de seleção, blocos (mídia, citação, fonte vinculada), inspector com abas Publicação / SEO / QA |
| 2 | **Articles Index** | A — rail + workspace | 1440 × 760 | Rail de 60 px, tabs por status com contagem, filtros como chips removíveis, tabela densa, barra de bulk actions flutuante |
| 3 | **Media Library** | B — sidebar + workspace + inspector | 1440 × 780 | Árvore de coleções, medidor de armazenamento, filtros por tipo, grid 5 colunas, inspector com ponto focal, alt text e usos |

---

## 2. Navegação

### Sidebar completa (248 px)
Fundo `#F7F7F6`, `border-right: 1px solid #E2E2E0`, sem sombra.

- **Header** 52 px: marca 22 × 22 px radius 6 em `#2F332B` + wordmark 14 px/600, ícone de colapso à direita.
- **Item** altura 34 px, radius 6, padding lateral 10 px, texto 13.5 px/500, ícone 18 px stroke 1.6.
  - Repouso: texto `#4E5249`, ícone `#8B8D86`.
  - Ativo: fundo `#E8E8E6` + `box-shadow: inset 2px 0 0 #B51B1B`, texto e ícone `#2F332B`.
  - Contador à direita: 11 px/500, fundo `#FFF`, borda `#E2E2E0`, radius 5, padding 1 px 6 px.
  - Badge de atenção: fundo `#B51B1B`, texto `#FFF`, 10 px/600, min-width 18 px.
- **Section label**: 11 px/600, uppercase, tracking 0.06em, cor `#97998F`, padding 8 px 10 px 4 px.
- **Divisor**: `1px dotted #D9D9D6` com margem lateral de 8–16 px.
- **User card** (rodapé): borda `#E2E2E0`, radius 10, avatar 28 px, nome 13 px/600, papel 12 px `#8B8D86`, kebab 15 px.

Grupos: Dashboard · **Conteúdo** (Artigos, Páginas, Categorias, Tags) · Mídia, Fontes, Calendário, Workflow, SEO, Automação/IA · **rodapé** Analytics, Configurações.

### Rail (60 px)
Marca 24 px no topo; ícones em alvo de 36 × 36 px radius 8; ativo = `#E8E8E6` + inset accent; avatar no rodapé.

### Topbar (52 px)
`border-bottom: 1px solid #E2E2E0`.
- **Breadcrumb**: 13 px, cor `#8B8D86`, chevrons 14 px `#C7C7C7`, folha em `#2F332B`/500 — quando é a página atual recebe fundo `#F0F0F0` radius 5 padding 2 px 7 px.
- **Busca**: 32 px, largura 220–260 px, borda `#C7C7C7`, radius 8, sombra 1, ícone 15 px, atalho `⌘K` em mono 11 px `#B3B5AF`.
- **Autosave**: 12 px `#5E6159` + check 14 px `#15803D` — “Salvo há 1 min”.

---

## 3. Botões

| Variante | Altura | Fundo | Borda | Texto | Sombra |
|---|---|---|---|---|---|
| Primary | 36 | `#2F332B` | `#2F332B` | `#FFF` 13/500 | — |
| Secondary | 36 | `#FFF` | `#C7C7C7` | `#4E5249` 13/500 | elev-1 |
| Tertiary | 36 | — | — | `#5E6159` 13/500 | — |
| Destructive | 36 | `#B91C1C` | `#B91C1C` | `#FFF` | — |
| Disabled | 36 | `#F7F7F6` | `#E2E2E0` | `#B3B5AF` | — |
| Icon button | 32 × 32 | `#FFF` | `#C7C7C7` | ícone 16 px | elev-1 |
| Split action | 32 | `#FFF` | `#C7C7C7` | divisor interno `#E2E2E0`, caret 26 px | elev-1 |

Radius sempre 8 (6 em tamanho xs de 28 px). **O CTA de publicar é ink, não accent.**

---

## 4. Campos

- Altura 36 px, radius 8, borda `#C7C7C7`, fundo `#FFF`, sombra `0 1px 2px rgba(47,51,43,.05)`, texto 13 px.
- **Label** 13 px/600; obrigatório recebe asterisco em `#B91C1C`.
- **Foco**: borda `#2F332B` + `box-shadow: 0 0 0 3px rgba(47,51,43,.12)`.
- **Erro**: borda `#B91C1C` + ring `rgba(185,28,28,.10)`, mensagem 12 px `#B91C1C`.
- **Helper** 12 px `#5E6159`.
- **Select**: mesmo box + chevron 14 px `#8B8D86`.
- **Textarea**: padding 10 px 12 px, linha 19–20 px.
- **Disabled**: fundo `#F7F7F6`, borda `#E2E2E0`, texto `#B3B5AF`.

---

## 5. Seleção e alternância

- **Checkbox** 16 px radius 4; marcado `#2F332B` com check branco stroke 3; indeterminado com traço horizontal.
- **Radio** 16 px; selecionado `border: 5px solid #2F332B`.
- **Toggle** 34 × 20 px radius 999; ligado `#15803D`, desligado `#E2E2E0`, knob 16 px branco.
- **Segmented**: trilha `#F0F0F0` radius 8 padding 3 px; item ativo `#FFF` + borda `#E2E2E0` + elev-1, altura 26–28 px.
- **Tabs**: 13 px, ativo 600 `#2F332B` com `box-shadow: inset 0 -2px 0 #B51B1B`, inativo 500 `#5E6159`; contagem em `#B3B5AF`; trilho `border-bottom: 1px solid #E2E2E0`.

---

## 6. Status e metadados

- **Badge de status**: altura 22 px, radius 6, padding 0 8 px, 12 px/500, ponto de 6 px na cor do texto. Cinco estados em `status` do JSON de tokens.
- **Tag/chip**: altura 22 px, radius 6, fundo `#F0F0F0`, borda `#E2E2E0`, texto 12 px `#4E5249`; removível ganha × de 11 px; “adicionar” usa `border: 1px dashed #C7C7C7`.
- **Avatar**: 24 px (tabela), 28 px (topbar/card), 32 px (menu), 48 px; iniciais 9–11 px/600; paleta em `color.avatar`.
- **Filtro ativo**: chip de 28 px, fundo `#FFF`, borda `#C7C7C7`, elev-1, com × de 11 px.

---

## 7. Tabela

- **Header**: 38 px, fundo `#FCFCFC`, `border-bottom: 1px solid #E2E2E0`, texto 12 px/500 `#5E6159`; ícone de ordenação 12 px.
- **Row**: 44 px (48 com avatar), `border-bottom: 1px dotted #D9D9D6`, hover `#FCFCFC`.
- **Célula primária**: título 13.5 px/500 + meta 12 px `#8B8D86`, com `text-overflow: ellipsis`.
- **Numérico**: mono 13 px alinhado à direita.
- **Kebab** 16 px `#B3B5AF` na última coluna de 30–36 px.
- **Paginação**: 46 px; botões 28 px radius 6; página atual em `#F0F0F0`/500; elipse em `#8B8D86`.
- **Bulk bar**: flutuante centralizada, radius 12, elev-3, contagem 13 px/500, divisor vertical `#E2E2E0`, ações de 30 px radius 7. Ação de risco fica desabilitada quando o papel não permite.

---

## 8. Editor de artigo

- **Canvas** 820 px centralizado sobre `#FFF`, padding-top 40 px.
- **Kicker**: badge de status + meta 12 px `#8B8D86` (categoria · autor · palavras · tempo de leitura).
- **Título** 36/44 600 −0.025em · **dek** 18/28 `#5E6159` · corpo 16/27 `#3C4038`, tudo com `text-wrap: pretty`.
- **Highlight de citação no texto**: fundo `#F6E2E2` (accent wash), radius 2.
- **Toolbar flutuante**: fundo `#2F332B`, radius 8, padding 4 px, elev-3; alvos 28 px radius 6; ativo `#2E322C`; ícones 14 px `#E2E2DE`; divisor `#43483F`.
- **Bloco de mídia**: card radius 12 borda `#E2E2E0`; área de imagem 240 px `#F7F7F6`; legenda 13 px `#5E6159` + ações 26 px.
- **Bloco de citação**: `border-left: 2px solid #2F332B`, padding-left 18 px, texto 20/30 500, atribuição 13 px `#5E6159`.
- **Bloco de fonte vinculada**: card `#FCFCFC`, ícone 26 px, eyebrow 12 px/600 uppercase `#8B8D86`, título 13.5 px/500, verificação 13 px `#5E6159`, ação “Abrir” 26 px com ícone de link externo.
- **Slash prompt**: ícone 26 px `border: 1px dashed #C7C7C7` + texto 14 px `#B3B5AF` com a tecla de barra em mono sobre `#F0F0F0`.

---

## 9. Inspector (336 px)

Fundo `#FAFAF9`, `border-left: 1px solid #E2E2E0`. Header 52 px com segmented de abas + botão de colapso. Corpo com padding 16 px e seções separadas por `1px dotted #D9D9D6` + padding-top 14 px. Footer 52 px com duas ações lado a lado (secundária + ink).

Seções do Article Editor: Status · Publicação (data + fuso) · Autor · Categoria/Editoria · Tags · Imagem destacada · QA editorial.

- **QA editorial**: contador “4 de 5”, barra de 5 segmentos de 4 px (preenchido `#15803D`, vazio `#E2E2E0`), lista de itens 13 px com check `#15803D` ou alerta `#B45309`.
- **Media detail**: preview 168 px com marcador de ponto focal (círculo de 34 px, borda branca 2 px), metadados em mono, alt text obrigatório, crédito, lista de usos.

---

## 10. Overlays e feedback

- **Dropdown/menu**: radius 10, borda `#E2E2E0`, elev-2, padding 4 px; item 30 px radius 6, texto 13 px; ativo `#F0F0F0`; item destrutivo `#B91C1C`; divisor `1px dotted #D9D9D6`.
- **Tooltip**: fundo `#2F332B`, texto `#FFF` 12 px/500, altura 26 px, radius 6.
- **Toast**: radius 10, borda `#E2E2E0`, elev-2/3, ícone 22 px em `#2F332B`, ação secundária 12 px `#8B8D86`.
- **Alert inline**: card `#FCFCFC` radius 10, ícone 16 px semântico, título 13 px/600, corpo 13/19 `#5E6159`, ação 28 px.
- **Empty state**: card `#FCFCFC` radius 10 padding 24 px, ícone 20 px em moldura de 40 px, título 14 px/600, texto 13/19 centralizado (max 260 px), duas ações de 32 px.

---

## 11. Regras invioláveis

1. **Divisor é sempre `1px dotted`** — de seção, de row, de bloco do inspector. É assinatura do sistema.
2. **Card tem border, não sombra.** Sombra pertence a controle (hairline), dropdown e modal.
3. **Dois níveis de radius**: 12 para card/superfície, 8 para controle.
4. **Accent não entra na navegação como preenchimento** — só como indicador de 2 px e na marca.
5. **Botão primário é ink.** Publicar, Aprovar e Salvar nunca são vermelhos.
6. **Dark mode tem surfaces próprias** — o rail é mais escuro que o canvas; nunca inverter cores automaticamente.
7. **Alvos de 44 px em mobile**; a tabela vira lista de rows priorizadas, o inspector vira bottom sheet e a sidebar vira drawer.
8. **Sugestão de IA nunca se disfarça de fato** — recebe rótulo próprio e exige ação humana.
