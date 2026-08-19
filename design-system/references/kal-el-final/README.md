# KAL EL — Pacote de extração completo

CMS editorial construído sobre o **PEG Product Design System**.
Gerado em 19 de agosto de 2026.

---

## Conteúdo

```
kal-el-export/
├── README.md                        este arquivo
├── KAL_EL_INVENTORY.md              inventário de UI: telas, componentes,
│                                    valores literais e regras invioláveis
├── source/
│   ├── Kal El.dc.html               design executável (abre no navegador)
│   └── support.js                   runtime necessário para o HTML acima
├── standalone/
│   └── kal-el.html                  arquivo único, offline, sem dependências
├── tokens/
│   ├── kal-el-tokens.css            tokens do produto, prontos para uso
│   ├── kal-el-tokens.json           os mesmos tokens em dados
│   ├── peg-tokens.calibrated.css    fundação compartilhada (3 produtos)
│   └── peg-tokens.calibrated.json
└── spec/
    ├── 10_KAL_EL_COMPLETE_DESIGN.md especificação de produto (fonte)
    └── 00_AUDIT_RESULT.md           auditoria das 49 referências visuais
```

---

## Como abrir

**Só quero ver o design:** abra `standalone/kal-el.html`. Funciona offline, sem servidor.

**Quero editar:** mantenha `source/Kal El.dc.html` e `source/support.js` na mesma pasta e abra o HTML. Se separar os dois arquivos, a página não renderiza.

---

## Identidade

| | |
|---|---|
| Accent | `#BF5252` primary · `#B51B1B` strong |
| Highlight | `#F6E2E2` |
| Neutros | `#FCFCFC` canvas · `#F0F0F0` surface · `#C7C7C7` mid · `#2F332B` ink |
| Tipografia | Geist / Geist Mono |
| Semantic | `#15803D` · `#B45309` · `#B91C1C` · `#2563EB` |

**A regra que mantém o produto coerente:** o accent identifica o Kal El — marca, indicador de nav ativa, sublinhado de aba, foco, seleção e highlight de texto. Ele não pinta superfícies grandes, não substitui os semantic colors e não assume o botão primário, que permanece ink. É o que impede o CMS de virar “tudo vermelho”.

---

## Telas incluídas

1. **Article Editor** — coluna de escrita de 820 px, autosave, toolbar flutuante de seleção, blocos estruturados (mídia com crédito, citação, fonte vinculada), inspector com Publicação / SEO / QA e checklist editorial de 5 itens.
2. **Articles Index** — rail de 60 px, tabs por status com contagem, filtros como chips removíveis, tabela de 8 colunas e barra de bulk actions com exclusão em massa desabilitada por permissão.
3. **Media Library** — árvore de coleções, medidor de armazenamento, filtros por tipo, grid de 5 colunas e inspector com ponto focal, alt text obrigatório, crédito e lista de usos.

---

## Pendências conhecidas

- **Imagens são placeholders.** Não gero imagens; envie os arquivos reais e eles entram no lugar.
- As demais telas da especificação (revisões/diff, calendário editorial, workflow, SEO, preview, IA/automações, distribuição, Ads, WhatsApp, permissões, auditoria) não estão neste pacote — foram deixadas para a propagação depois da validação destas três.
