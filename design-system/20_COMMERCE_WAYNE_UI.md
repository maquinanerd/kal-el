# 20 — Commerce Wayne UI Specification

## Produto

Commerce Wayne é um CRM / Commerce OS orientado a leads, contatos, empresas, oportunidades, pipeline, conversas, campanhas, automações e operação comercial.

## Primary shell

Full sidebar + workspace. Detail pages podem usar contextual inspector.

## Navigation baseline

- Home
- CRM
  - Leads
  - Contatos
  - Empresas
  - Oportunidades
  - Pipeline
- Commerce
  - Produtos / Imóveis
  - Negócios / Pedidos
  - Pagamentos
- Conversations
  - Inbox
  - WhatsApp
  - Histórico
- Marketing
  - Campanhas
  - Meta Ads
  - Google Ads
  - TikTok Ads
- Automation
  - Workflows
  - Triggers
  - Executions
- Analytics
- Team
- Settings

A arquitetura final deve respeitar o domínio real do produto. Não inventar backend para preencher navegação.

## Required screens

1. Dashboard
2. Leads
3. Contacts
4. Companies
5. Lead detail
6. Contact detail
7. Company detail
8. Pipeline
9. Opportunities
10. Products/Properties
11. Product/Property detail
12. Conversations inbox
13. WhatsApp conversation
14. Activities
15. Tasks
16. Calendar
17. Automations
18. Campaigns
19. Analytics
20. Users
21. Teams
22. Permissions
23. Audit log
24. Settings

## CRM list pattern

Base visual: customers/file explorer do corpus.

- Page title + primary CTA.
- Saved/custom views somente quando houver valor.
- Search.
- Filters.
- Dense table.
- Select rows.
- Bulk actions.
- Avatar/company.
- Status/stage.
- Owner.
- Last activity.
- Value.
- Next action.
- Pagination.

## Lead detail

Desktop recomendado:

```text
┌────────────┬──────────────────────────────────┬────────────────┐
│ Sidebar    │ Lead workspace                   │ Detail rail    │
└────────────┴──────────────────────────────────┴────────────────┘
```

Workspace:
- identity;
- timeline/activity;
- notes;
- conversations;
- opportunities;
- tasks;
- documents.

Rail:
- stage;
- owner;
- score;
- value;
- contact data;
- source;
- tags;
- next action.

## Pipeline

- Kanban só quando representação por etapa for operacionalmente útil.
- Cards compactos.
- Totais por estágio.
- Drag & drop com feedback claro.
- Alternativa table/list obrigatória para alta densidade.

## Conversations

Três zonas desktop quando necessário:
- inbox/conversation list;
- thread;
- contact/context rail.

Mobile:
- list → thread → detail, sem três colunas comprimidas.

## Automation

Base visual deve seguir shell operacional, não builder futurista.

- Workflow list.
- Status.
- Trigger.
- Last run.
- Success/failure.
- Owner.
- Executions/log.
- Editor visual apenas se o backend realmente suportar.

## Analytics

Evitar dashboards de vaidade. KPIs devem responder perguntas comerciais: volume, conversion, pipeline, response, revenue, campaign efficiency e operational bottlenecks.
