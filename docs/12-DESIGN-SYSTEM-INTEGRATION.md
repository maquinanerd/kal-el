# Kal El — PEG Product Design System Integration

The bundled PEG Product Design System is a binding visual and interaction contract.

## Source-of-truth hierarchy

1. `design-system/references/*`
2. design-system specification documents
3. baseline implementation tokens
4. generic UI conventions

When generic taste conflicts with screenshot evidence, the screenshot/reference wins.

## Visual identity

Kal El is the editorial member of the PEG product family. It shares foundations/components with other PEG products while retaining its own red product accent and editorial IA.

Do not copy WordPress Admin, Gutenberg, Payload, Notion, Linear, or another product literally. Do not use glassmorphism, gratuitous gradients, excessive shadows/radius/pills, decorative whitespace, or red as a dominant interface fill.

## Mandatory primary shell

```text
Navigation | Editorial workspace | Contextual inspector
```

Baseline before calibration:
- full sidebar: 232–248 px
- compact rail: 60–64 px
- topbar: 48–56 px
- inspector: 300–360 px
- article editor useful width: 720–900 px
- table rows: 48–56 px

## Required visual implementation order

1. Reference audit.
2. Foundations/tokens.
3. Shared primitives.
4. Application shell.
5. Calibration screen.
6. Visual QA desktop light/dark + mobile light/dark.
7. Zero P0 and zero relevant P1.
8. Article Editor first.
9. Articles Index.
10. Media Library.
11. Workflow.
12. SEO.
13. Users/permissions.
14. Remaining screens.

## Navigation

Dashboard; Conteúdo (Artigos, Páginas, Categorias, Tags); Mídia; Fontes; Calendário editorial; Workflow; Automação / IA; SEO; Redirects; Analytics; Usuários; Permissões; Audit log; Settings.

## Article Editor

Header: breadcrumb, save state, Preview, draft action when needed, Schedule, Publish/Update, overflow.

Canvas: title, subtitle/dek, optional summary, rich editor, inline formatting, slash commands, media, gallery, quote, embed, table, source/reference blocks.

Inspector: status/publication, author, categories, tags, featured image, SEO, canonical, robots, social preview, sources/claims, editorial QA, workflow, revisions/history.

Rules: no card around every field; metadata must not compete with prose; inspector collapsible; autosave discreet; preview first-class; confirmations proportional to risk.

## Required screen inventory

Dashboard, Articles index, Article editor, Article preview, Media library, Media detail/crop/focal, Categories, Tags, Authors, Sources, Editorial calendar, Workflow queue, AI/Automations, SEO overview, Redirects, Analytics, Users, Roles & permissions, Audit log, Settings.

## Responsive and dark mode

Mobile changes pattern rather than compressing desktop. Sidebar becomes drawer, inspector becomes sheet/drawer, secondary actions move to overflow, tables prioritize columns.

Dark mode is supported but does not need to be default. Prefer surface/border hierarchy over heavy shadows.

## QA

Classify P0/P1/P2 using `design-system/VISUAL_QA.md`. UI phases do not complete with unresolved P0/P1.
