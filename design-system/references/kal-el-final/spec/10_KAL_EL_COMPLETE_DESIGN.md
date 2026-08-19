# KAL EL — COMPLETE EDITORIAL CMS PRODUCT DESIGN

# PEG PRODUCT DESIGN SYSTEM — REGRA COMPARTILHADA

Este produto faz parte da mesma família visual de **Kal El**, **Commerce Wayne** e **ALUGUEI.APP**.

O **PEG Product Design System** já existente no projeto é a fonte visual principal. Não crie outro design system, não duplique foundations e não redesenhe primitives que já existam.

## Source of truth

Use nesta ordem de precedência:

1. screenshots e referências visuais existentes no workspace;
2. PEG Product Design System já construído;
3. este arquivo de especificação do produto;
4. padrões/componentes já aprovados no projeto;
5. somente na ausência de referência, decisão visual nova.

## Linguagem visual obrigatória

Preserve a identidade dos screenshots:

- interface predominantemente clara e neutra;
- tipografia sans-serif limpa e de alta legibilidade;
- alta densidade informacional sem parecer apertada;
- bordas finas;
- sombras discretas;
- radius moderado;
- grids rigorosos;
- tabelas compactas;
- sidebars e inspectors precisos;
- hierarquia baseada em tipografia, spacing e contraste — não em excesso de cor;
- mobile pensado como experiência própria, não desktop comprimido;
- dark mode com surfaces próprias, nunca simples inversão automática.

Evite:

- glassmorphism;
- gradientes decorativos;
- sombras pesadas;
- cards gigantes;
- excesso de pills;
- radius exagerado;
- dashboards genéricos;
- gráficos decorativos;
- saturação excessiva;
- ilustrações sem função;
- visual “template SaaS”.

## Fundação neutra compartilhada

Estas cores são comuns aos três produtos e devem permanecer consistentes:

| Token | HEX | Uso |
|---|---:|---|
| `neutral.canvas` | `#FCFCFC` | canvas/background principal |
| `neutral.surface` | `#F0F0F0` | surface secundária, hover leve, blocos suaves |
| `neutral.mid` | `#C7C7C7` | borders fortes, disabled, divisores |
| `neutral.ink` | `#2F332B` | texto forte, ação principal escura, ícones principais |

A identidade não deve virar uma interface colorida. A cor de produto é **accent**, não substituto dos neutros.

## Regra de componentização

Composição correta:

`PEG primitive → semantic component → domain composition → product screen`

Nunca:

`product screen → CSS arbitrário`

Quando surgir uma necessidade nova:

1. procure primitive PEG existente;
2. procure pattern PEG existente;
3. componha componentes existentes;
4. só então crie extensão nova;
5. se criar extensão, documente-a como candidata a componente compartilhável.

## QA obrigatório

Para cada domínio/tela relevante:

1. desenhar usando PEG UI;
2. comparar com referências;
3. validar spacing, tipografia, grid, borders, radius, density, states e responsive;
4. classificar divergências:
   - `P0`: rompe identidade ou fluxo;
   - `P1`: divergência visual/UX perceptível;
   - `P2`: refinamento;
5. corrigir todos os P0 e P1 antes de considerar concluído.


# PALETA DO KAL EL

Kal El usa a fundação neutra compartilhada e acrescenta dois vermelhos de marca:

| Token | HEX | Papel |
|---|---:|---|
| `kalel.brand.primary` | `#BF5252` | accent editorial principal |
| `kalel.brand.strong` | `#B51B1B` | accent forte, hover/pressed, estados selecionados |

## Regras de uso

- Canvas permanece `#FCFCFC`.
- Surfaces secundárias usam `#F0F0F0`.
- Borders/disabled derivam de `#C7C7C7`.
- Texto e ação primária escura continuam ancorados em `#2F332B`.
- Vermelho identifica Kal El em navegação ativa, focus, seleção, highlights e gráficos.
- **Não transformar todo botão primário em vermelho.** A linguagem PEG continua majoritariamente neutra.
- Vermelho de marca não é automaticamente “erro”. Error/destructive precisa continuar semanticamente distinguível.
- O editor deve permanecer calmo e editorial, sem grandes áreas saturadas.

---

# 1. VISÃO DO PRODUTO

Kal El é um **CMS editorial profissional** e um operating system para produção, revisão, distribuição e governança de conteúdo.

Não trate como:

- clone do WordPress Admin;
- clone do Gutenberg;
- CRUD técnico;
- dashboard genérico;
- editor de HTML.

O modelo principal é:

```text
Navigation
+
Editorial Workspace
+
Contextual Inspector
```

O produto deve ser excelente para:

- escrever;
- editar;
- revisar;
- organizar;
- enriquecer;
- validar;
- programar;
- publicar;
- auditar;
- analisar conteúdo.

---

# 2. PRINCÍPIOS DO CMS

A experiência deve transmitir:

- foco editorial;
- velocidade;
- clareza;
- confiabilidade;
- governança;
- alta densidade;
- contexto;
- previsibilidade.

O artigo é a entidade central.

O editor não deve ser cercado por cards decorativos. O conteúdo longo precisa respirar.

Ações críticas precisam ser explícitas:

- Save draft;
- Preview;
- Schedule;
- Publish;
- Unpublish quando permitido;
- Review request;
- Approve/reject quando aplicável.

Sempre mostrar estado de salvamento.

---

# 3. NAVEGAÇÃO PRINCIPAL

Estrutura-base:

```text
KAL EL

Visão Geral

Conteúdo
├── Artigos
├── Rascunhos
├── Em revisão
├── Agendados
├── Publicados
└── Arquivados

Editorial
├── Calendário
├── Workflow
├── Assignments
├── Revisões
└── Aprovações

Mídia
├── Biblioteca
├── Imagens
├── Vídeos
├── Galerias
└── Uploads

Organização
├── Categorias
├── Tags
├── Autores
├── Séries/coleções quando aplicável
└── Fontes

SEO
├── Overview
├── Metadata
├── Canonicals
├── Redirects
├── Sitemap
└── Social Preview

AI & Automation
├── Assistentes
├── Workflows
├── Jobs
├── Execuções
└── Falhas

Distribuição
├── Canais
├── Publicações
├── Social/Marketing
└── Integrações

Analytics
Relatórios

Administração
├── Usuários
├── Equipes
├── Roles & Permissions
├── Audit Log
├── Integrações
└── Configurações
```

Nomes podem ser refinados sem inventar funcionalidade.

---

# 4. DASHBOARD EDITORIAL

Não criar dashboard de vanity metrics.

Priorizar:

- drafts recentes;
- aguardando revisão;
- agendados hoje;
- publicações com erro;
- conteúdo que exige ação;
- assignments;
- pendências SEO;
- falhas de automação;
- fila editorial;
- calendário próximo;
- atividade da equipe.

Analytics pode aparecer de forma compacta:

- publicados;
- visualizações;
- performance;
- fontes/origens;
- tendências editoriais.

---

# 5. ARTICLE INDEX

Tabela de artigos com alta densidade.

Campos possíveis:

- título;
- status;
- autor;
- categoria;
- tags;
- idioma quando aplicável;
- updated at;
- publish date;
- reviewer;
- workflow;
- SEO status;
- source/automation indicator;
- views/performance quando aplicável.

Ferramentas:

- search;
- filters;
- saved views;
- sort;
- bulk selection/actions;
- custom columns;
- pagination;
- context actions.

Views importantes:

- all;
- draft;
- review;
- scheduled;
- published;
- failed/needs attention;
- archived.

---

# 6. ARTICLE EDITOR — TELA MAIS IMPORTANTE

Shell:

```text
Sidebar
+
Editorial Workspace
+
Contextual Inspector
```

Header:

- breadcrumbs;
- title/status;
- save state;
- preview;
- review action;
- schedule;
- publish.

Workspace:

- título;
- subtítulo;
- resumo/excerpt;
- corpo editorial;
- mídia;
- embeds;
- fontes;
- metadados editoriais.

Inspector:

```text
Documento
├── Status
├── Publicação
├── Autor
├── Categoria
├── Tags
├── Imagem destacada
├── SEO
├── Social
├── Workflow
├── Fontes/Claims
├── QA
├── Revisões
└── Histórico
```

Inspector pode recolher e virar sheet/drawer em breakpoints menores.

---

# 7. EDITOR / RICH TEXT

O editor deve parecer ferramenta editorial própria, não Gutenberg.

Suportar visualmente:

- paragraph;
- H2/H3;
- listas;
- quote;
- pull quote quando permitido;
- links;
- inline formatting;
- media;
- gallery;
- embed;
- source/reference;
- divider;
- structured blocks aprovados pelo contrato.

Toolbar contextual e discreta.

Criar:

- slash menu;
- floating/inline toolbar;
- drag/reorder quando aplicável;
- block selection;
- keyboard-first interactions.

Não permitir visualmente um bloco “HTML livre” arbitrário.

Sem JavaScript/markup arbitrário inserido por editor.

---

# 8. CONTRATO EDITORIAL / BLOCOS

A interface deve reforçar conteúdo estruturado.

Quando o corpo usa blocos discriminados/contrato editorial, representar:

- tipo de bloco;
- conteúdo;
- validação;
- erro;
- fallback;
- preview.

O CMS, automação editorial e frontend precisam convergir para o mesmo formato.

Se um bloco não é válido:

- mostrar erro local;
- explicar o problema;
- permitir correção;
- impedir publicação quando necessário.

---

# 9. EMBEDS

Criar experiência nativa para:

- YouTube;
- Instagram;
- X/Twitter;
- outros providers permitidos.

Fluxo:

```text
colar URL
→ detectar provider
→ preview
→ metadata
→ confirmar
```

Sem exigir HTML embed manual.

Estados:

- loading;
- unavailable;
- invalid URL;
- provider blocked;
- retry.

---

# 10. MÍDIA

Biblioteca de mídia robusta:

- search;
- filters;
- grid/list;
- upload;
- drag & drop;
- metadata;
- alt text;
- caption;
- credit;
- focal point;
- crop;
- dimensions;
- file type;
- usage/references.

Criar picker contextual dentro do editor.

Nunca deixar mídia sem contexto editorial.

---

# 11. GALERIAS

Criar:

- create gallery;
- reorder;
- caption;
- alt;
- cover/preview;
- insert into article;
- responsive preview.

---

# 12. AUTORES

Criar:

- author list;
- author detail;
- avatar;
- bio;
- social/links;
- role;
- content count;
- recent articles.

No editor, author picker rápido e pesquisável.

---

# 13. CATEGORIAS E TAGS

Interfaces simples e densas.

Evitar telas de taxonomia com excesso de chrome.

Suportar:

- search;
- create/edit;
- slug;
- description;
- hierarchy quando permitido;
- usage count;
- merge/deprecate quando a regra do produto permitir.

---

# 14. FONTES / CLAIMS / QA

Criar experiência para conteúdo com fontes e verificações.

Fontes podem ter:

- URL;
- publisher;
- title;
- timestamp;
- status;
- relation to article.

Claims/QA podem mostrar:

- item;
- source;
- confidence/status;
- needs review;
- approved;
- blocked.

A UI deve distinguir:

`FATO/FONTE` × `SUGESTÃO DE IA` × `DECISÃO EDITORIAL`

Nunca esconder problemas críticos em tooltip.

---

# 15. WORKFLOW EDITORIAL

Criar estados/padrões:

```text
Draft
→ In Review
→ Changes Requested
→ Approved
→ Scheduled
→ Published
```

Quando o workflow real divergir, preservar a arquitetura sem inventar regra.

Criar:

- queue;
- assignments;
- reviewer;
- due date;
- comments;
- approval history;
- status transitions.

Mudanças críticas precisam de feedback claro.

---

# 16. REVISÕES / VERSIONAMENTO / DIFF

Criar:

- revision history;
- autosave history;
- named versions quando aplicável;
- compare revisions;
- side-by-side or inline diff;
- restore;
- author/timestamp.

Diff precisa ser legível para texto longo.

---

# 17. AUTOSAVE / SAVE STATE

Estados explícitos:

- Saving…;
- Saved;
- Offline;
- Unsaved changes;
- Save failed;
- Retry.

Nunca deixar usuário sem saber se o conteúdo foi persistido.

---

# 18. PREVIEW

Criar preview realista:

- frontend;
- desktop;
- tablet;
- mobile;
- social preview;
- search snippet.

Preview deve ser acessível sem abandonar o editor quando possível.

---

# 19. SEO

Área tipo “SEO workspace”, não plugin copiado.

Representar:

- SEO title;
- meta description;
- slug;
- canonical;
- robots;
- structured data status;
- sitemap status;
- social title/description/image;
- search preview;
- validation.

Mostrar feedback objetivo, sem gamificação excessiva.

---

# 20. REDIRECTS / CANONICAL / SITEMAP

Criar interfaces operacionais para:

- redirects;
- source URL;
- target;
- type/status;
- conflicts;
- last modified;
- search;
- filters.

Sitemap:

- collections/status;
- generated at;
- errors;
- exclusions.

---

# 21. CALENDÁRIO EDITORIAL

Views:

- month;
- week;
- agenda/list.

Itens:

- artigo;
- status;
- owner;
- schedule;
- channel;
- warnings.

Permitir rapidamente abrir editor ou detalhes.

---

# 22. AI & AUTOMATION

IA pode auxiliar:

- writing support;
- rewrite;
- summarize;
- metadata;
- tagging;
- source organization;
- QA assistance;
- translation/localization quando aplicável;
- image metadata.

Estados:

- processing;
- suggestion;
- confidence;
- accepted;
- rejected;
- needs review;
- failed.

IA nunca deve parecer publicar silenciosamente sem controle editorial quando a política exige revisão.

---

# 23. INGESTÃO / AUTOMAÇÃO EDITORIAL

Para conteúdos vindos de automação/pipeline, criar estados visuais:

- ingested;
- processing;
- generated;
- QA pending;
- review required;
- blocked;
- publication pending;
- published;
- technical failure;
- retry.

Mostrar origem e histórico.

---

# 24. DISTRIBUIÇÃO / PUBLICAÇÃO

Representar canais e publication state.

Por canal:

- ready;
- published;
- scheduled;
- failed;
- needs attention;
- paused.

Mostrar:

- timestamp;
- URL;
- target;
- retry;
- audit.

---

# 25. MARKETING / ADS INTEGRATIONS

Quando habilitadas no produto, criar interfaces coerentes para integração com:

- Meta Ads;
- Google Ads;
- TikTok Ads.

Objetivo do CMS não é copiar Ads Manager.

Mostrar:

- campanhas relacionadas a conteúdo;
- distribuição;
- status;
- performance;
- creative/source article;
- ações seguras.

Ações via API/MCP precisam de confirmação, feedback e auditabilidade.

---

# 26. WHATSAPP / COMMERCE ASSISTED FLOWS

Quando o projeto usar WhatsApp para venda/conversão:

- inbox/conversations;
- template messages;
- linked content/product;
- inventory/availability context quando aplicável;
- link de venda;
- history;
- automation status.

Não transformar Kal El inteiro em CRM. Esta superfície deve permanecer integração/distribuição editorial/comercial.

---

# 27. ANALYTICS

Criar analytics focado em decisão editorial:

- content performance;
- publication cadence;
- categories;
- authors;
- traffic sources;
- engagement;
- search/SEO;
- distribution/channel;
- automation quality.

Evitar gráficos decorativos.

---

# 28. USUÁRIOS / ROLES / PERMISSIONS

Criar:

- users;
- invites;
- teams;
- roles;
- granular permissions.

Permissões podem separar:

- read;
- create;
- edit;
- review;
- approve;
- schedule;
- publish;
- delete/archive;
- manage SEO;
- manage integrations;
- admin.

Não condensar tudo em “admin”.

---

# 29. AUDIT LOG

Criar:

- actor;
- action;
- entity/article;
- field/change;
- timestamp;
- source;
- integration;
- result.

Detalhes com diff quando aplicável.

---

# 30. SETTINGS

Organizar por domínio:

```text
Workspace
Editorial
Publishing
SEO
Media
AI & Automation
Integrations
Users
Teams
Permissions
Security
Audit
Appearance
```

Evitar página infinita.

---

# 31. RESPONSIVE

Desktop:

- sidebar;
- workspace;
- inspector.

Tablet:

- sidebar compacta/drawer;
- inspector sheet.

Mobile:

- foco no conteúdo;
- actions compactas;
- inspector em bottom sheet/drawer;
- navegação progressiva;
- toolbar adaptada.

Editor mobile deve permitir revisão e ajustes importantes, sem tentar replicar 100% da densidade desktop.

---

# 32. DARK MODE

Criar dark mode real:

- canvas;
- surface;
- raised surface;
- borders;
- text hierarchy;
- brand red recalibrado;
- semantic statuses.

Não inverter automaticamente.

---

# 33. ESTADOS OBRIGATÓRIOS

Cobrir:

- loading;
- skeleton;
- empty;
- first-use;
- error;
- save failed;
- permission denied;
- offline;
- processing;
- validation error;
- review blocked;
- publication failed;
- retry;
- success;
- warning.

---

# 34. ORDEM DE EXECUÇÃO

1. Architecture/navigation
2. Dashboard
3. Article index
4. Article editor
5. Editor blocks/toolbar
6. Media
7. Taxonomy/authors
8. Sources/claims/QA
9. Workflow/revisions
10. SEO/preview
11. Calendar
12. AI/automation
13. Distribution/integrations
14. Analytics
15. Admin
16. Responsive/dark
17. Visual QA final

---

# 35. CRITÉRIO FINAL

O Kal El está concluído quando o design demonstrar:

```text
IDEIA/FONTE
→ CRIAÇÃO/INGESTÃO
→ EDIÇÃO
→ MÍDIA
→ FONTES/QA
→ REVISÃO
→ APROVAÇÃO
→ SEO
→ PREVIEW
→ AGENDAMENTO
→ PUBLICAÇÃO
→ DISTRIBUIÇÃO
→ ANALYTICS
→ HISTÓRICO/AUDITORIA
```

Tudo deve parecer um CMS editorial profissional próprio, usando PEG UI e a identidade vermelha do Kal El de forma controlada.
