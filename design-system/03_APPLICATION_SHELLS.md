# 03 — Application Shells

## Shell A — Full Sidebar

```text
┌──────────────┬─────────────────────────────────────────────┐
│ Sidebar      │ Main workspace                              │
│ 232–248 px   │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

Uso: dashboards, listagens, settings e módulos operacionais.

## Shell B — Sidebar + Inspector

```text
┌──────────────┬──────────────────────────────┬──────────────┐
│ Sidebar      │ Primary workspace            │ Inspector    │
│              │                              │ 300–360 px   │
└──────────────┴──────────────────────────────┴──────────────┘
```

Uso: editores, detalhe de lead, perfil, record detail.

Inspector deve ser contextual e recolhível quando possível.

## Shell C — Compact Rail

```text
┌──────┬─────────────────────────────────────────────────────┐
│ Rail │ Workspace                                           │
└──────┴─────────────────────────────────────────────────────┘
```

Uso: contextos com necessidade máxima de largura útil.

## Shell D — Focus Mode

Onboarding, assinatura, login, checkout, configuração inicial.

Características:
- navegação reduzida;
- uma tarefa dominante;
- progressive disclosure;
- sidebar de passos opcional;
- CTA principal fixo/óbvio.

## Shell E — Overlay Workflow

```text
contexto preservado e desfocado
             +
         modal central
```

Uso: pagamento, confirmação, alteração sensível, quick edit.

## Shell F — Mobile

Não comprimir o desktop.

Regras:
- topbar enxuta;
- hamburger/drawer;
- actions secundárias em overflow;
- inspector vira bottom/side sheet;
- cards empilham;
- page padding reduzido;
- tabelas adotam estratégia de prioridade de colunas.

## Breakpoints de trabalho

- Mobile: 360–479
- Large mobile: 480–767
- Tablet: 768–1023
- Desktop: 1024–1439
- Desktop XL: 1440+

Valores de implementação podem variar; comportamento não.
