# 10 — Kal El UI Specification

## Produto

Kal El é um CMS editorial profissional. A UI deve privilegiar velocidade editorial, leitura, edição longa, governança, SEO, media e workflow.

## Regra

Não reproduzir WordPress Admin nem Gutenberg. A referência dominante é o padrão editor + contextual rail presente no corpus.

## Primary shell

```text
┌────────────┬──────────────────────────────────┬────────────────┐
│ Navigation │ Editorial workspace              │ Inspector      │
└────────────┴──────────────────────────────────┴────────────────┘
```

## Navigation proposal

- Dashboard
- Conteúdo
  - Artigos
  - Páginas
  - Categorias
  - Tags
- Mídia
- Fontes
- Calendário editorial
- Workflow
- Automação / IA
- SEO
- Redirects
- Analytics
- Usuários
- Permissões
- Audit log
- Settings

## Required screens

1. Dashboard
2. Articles index
3. Article editor
4. Article preview
5. Media library
6. Media detail/crop/focal
7. Categories
8. Tags
9. Authors
10. Sources
11. Editorial calendar
12. Workflow queue
13. AI/Automations
14. SEO overview
15. Redirects
16. Analytics
17. Users
18. Roles & permissions
19. Audit log
20. Settings

## Article Editor — core screen

### Header
- Breadcrumb.
- Save state: `Salvo`, `Salvando…`, `Erro ao salvar`.
- Preview.
- Save draft quando necessário.
- Schedule.
- Publish / Update.
- Overflow para ações secundárias.

### Main canvas
- Title.
- Subtitle/dek.
- Optional summary.
- Rich editor 720–900 px útil.
- Inline formatting.
- Slash commands.
- Media blocks.
- Gallery.
- Quote.
- Embed.
- Table.
- Source/reference blocks.

### Inspector sections
- Status e publicação.
- Autor.
- Categoria.
- Tags.
- Featured image.
- SEO.
- Canonical.
- Robots.
- Social preview.
- Sources/claims.
- Editorial QA.
- Workflow.
- Revisions/history.

### UX rules
- Não embrulhar cada campo do documento em card.
- Metadata não pode competir com o texto.
- Inspector deve poder recolher.
- Autosave visível porém discreto.
- Ações editoriais sensíveis com confirmação proporcional ao risco.
- Preview deve ser acesso de primeira classe.

## Articles index

- Views: Todos / Draft / Review / Scheduled / Published / Blocked.
- Search.
- Filters: author, category, source, status, date.
- Table: title, status, author, category, updated, scheduled/published, quality flags.
- Bulk actions governadas por permissão.

## Media Library

Base visual: file explorer do corpus.

- Grid/list toggle.
- Search.
- File type filters.
- Upload action.
- Metadata.
- Focal/crop.
- Usage references.
- Pagination/infinite strategy definida pelo volume real.

## Workflow

- Queue operacional.
- Status e assignee claros.
- QA flags.
- Comment/activity rail.
- Aprovar, devolver, agendar, bloquear.

## Dark mode

Pode existir no Kal El, mas não deve ser padrão obrigatório. Editor de texto deve manter contraste e legibilidade consistentes.
