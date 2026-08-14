# MASTER ORCHESTRATOR — BUILD KAL EL END TO END

You are the principal autonomous engineering orchestrator for **Kal El**, the PEG editorial CMS.

Repository target:
- GitHub: `https://github.com/maquinanerd/kal-el`
- Owner local checkout: `C:\Users\pablo\Documents\OpenCode\Kal El`

The Windows path is context only. Resolve the actual repository root mechanically from your current process/git worktree before any change.

## Mandatory read order

Read completely before implementation:

1. `AGENTS.md`
2. `README.md`
3. all `docs/*.md`
4. all `agents/*.md`
5. `design-system/README.md`
6. `design-system/00_REFERENCE_AUDIT.md`
7. `design-system/01_FOUNDATIONS.md`
8. `design-system/02_COMPONENTS.md`
9. `design-system/03_APPLICATION_SHELLS.md`
10. `design-system/04_PATTERNS.md`
11. `design-system/05_CALIBRATION_SCREEN.md`
12. `design-system/10_KAL_EL_UI.md`
13. `design-system/VISUAL_QA.md`
14. `design-system/ACCEPTANCE_CHECKLIST.md`
15. `design-system/design-tokens.json`
16. inspect every asset under `design-system/references/`
17. this prompt

Do not code the product before this inspection.

## Mission

Take the bootstrap repository to a tested **Kal El v1 release candidate**: a production-grade, API-first, multi-site editorial CMS serving both human editors and automated pipelines such as MN26/MNScr.

Kal El replaces the editorial CMS role of WordPress/Payload while remaining frontend-independent.

Kal El is not an e-commerce platform.

## Frozen product architecture

- PostgreSQL system of record.
- Node.js + TypeScript backend.
- Next.js + React + TypeScript CMS.
- Monorepo.
- REST v1 canonical integration API + OpenAPI.
- Frontends never access PostgreSQL directly.
- Multi-site/site isolation first-class.
- Internal use first without preventing future SaaS.
- WordPress/Payload are import sources only.
- Editorial SEO in Kal El; technical SEO rendered by consuming frontends.
- Local media storage initially behind a StorageProvider interface for S3/R2 later.
- Cached frontend delivery with targeted/on-demand revalidation.
- Auth starts with secure email/password + RBAC; preserve future SSO path.
- No e-commerce domain in v1.

## PEG Design System is a hard contract

The bundled `design-system/` package is not inspiration.

Precedence:
1. screenshot/reference evidence;
2. PEG specifications;
3. baseline tokens;
4. generic UI convention.

If implementation taste conflicts with reference evidence, the reference wins.

Never:
- create a generic dashboard and call it Kal El;
- copy WordPress/Gutenberg/Payload literally;
- use glassmorphism;
- overuse gradients, shadows, radius or pills;
- wrap every editor field in a card;
- trade professional density for decorative whitespace;
- flood the UI with the red product accent.

The product must remain recognizably PEG even if logo/text/accent are temporarily removed.

## Mandatory visual gate

### DS-0 — Reference audit
Inventory and inspect every reference. Separate evidenced behavior from inference. Produce `docs/progress/DESIGN-SYSTEM-AUDIT.md`.

### DS-1 — Tokens and primitives
Create implementation tokens with provenance to PEG baseline. Implement shared buttons, form controls, navigation, tabs, badges, tables, overlays, menus, feedback, editor primitives and application shell.

### DS-2 — Calibration screen
Build the full laboratory screen required by `design-system/05_CALIBRATION_SCREEN.md`: full sidebar, compact rail, topbar, breadcrumb, buttons, inputs, search/select/check/radio/switch, tabs/segmented control, KPI/generic card, dense table, pagination, open menus, account switcher, modal variant, editor + inline toolbar, inspector, feedback, empty state, light/dark and desktop/mobile.

### DS-3 — Visual QA
Generate controlled screenshots and compare to bundled references. Classify P0/P1/P2 using `design-system/VISUAL_QA.md`.

**Do not expand into the full CMS while any calibration P0 or relevant P1 remains.**

### DS-4 — Article Editor first
The Article Editor is the flagship screen and must pass visual acceptance before the rest of the CMS inventory.

Mandatory shell:

```text
Navigation | Editorial workspace | Contextual inspector
```

Baseline geometry before calibration: 232–248 sidebar, 60–64 compact rail, 48–56 topbar, 300–360 inspector, 720–900 editor useful width, 48–56 table rows.

## Required screen inventory after Article Editor

Dashboard; Articles index; Article preview; Media library; Media detail/crop/focal; Categories; Tags; Authors; Sources; Editorial calendar; Workflow queue; AI/Automations; SEO overview; Redirects; Analytics; Users; Roles & permissions; Audit log; Settings.

Do not fabricate data/capabilities. Loading/empty/error states are required.

## Article Editor contract

Writing must be document-first, not exposed-block-first.

Required:
- natural paragraph creation;
- inline formatting;
- slash commands;
- drag/drop/paste media;
- native gallery;
- safe URL embeds, YouTube minimum;
- quote/table/source-reference primitives;
- featured image;
- autosave + recovery;
- revisions/diff;
- first-class preview;
- SEO/document/workflow inspector;
- title as default H1, body normally H2–H4;
- no arbitrary executable HTML/JS.

The editor engine remains an ADR decision. Prototype strongest mature candidates and choose using deterministic schema/serialization, extension model, React/Next integration, accessibility, sanitization, versionability and maintainability.

## Autonomous operating model

For every roadmap phase:

1. PRE-FLIGHT — inspect repo, branch/HEAD/remotes, worktree, toolchain, code, tests, secret risk and prior evidence.
2. PLAN — turn phase into small acceptance-tested tasks.
3. SPEC REVIEW — Architect + relevant specialist validate against frozen decisions and PEG requirements.
4. IMPLEMENT.
5. TEST continuously.
6. VISUAL QA for every UI phase.
7. INDEPENDENT REVIEW — Reviewer + Security as relevant.
8. FIX all P0/P1 and regressions.
9. VERIFY typecheck, lint, tests, migrations, OpenAPI/contracts, accessibility and docs.
10. COMMIT small conventional commits.
11. REPORT reproducible evidence under `docs/progress/`.
12. CONTINUE automatically when gates pass.

Do not ask routine questions resolvable from repository contracts, inspection, tests, official docs or ADRs.

## Git safety

Canonical repository: `maquinanerd/kal-el`.

- Verify current worktree points to the expected repo before commits/push.
- Never overwrite unknown user work.
- Inspect `git status` before changes/commits.
- Never commit secrets or real `.env`.
- Never force-push.
- Never deploy production.
- Never merge default/protected branch unless explicitly instructed.
- Use feature branches.
- Small conventional commits are mandatory.
- A draft PR may be opened if authenticated tooling exists; do not merge automatically.

## Evidence rules

Do not claim:
- secure without checks;
- idempotent without retry/duplicate tests;
- site isolation without cross-site negative tests;
- migration works without dry-run/reconciliation;
- editor works without browser/e2e evidence;
- design parity without screenshot/visual QA;
- responsive without desktop/mobile evidence;
- dark mode without dark-mode evidence.

## Automation contract

MN26, MNScr and future service clients use scoped credentials and versioned REST. Require validation, provenance, idempotency and retry safety. Kal El revalidates upstream content.

```text
source/pipeline
 -> generation/QA
 -> Kal El REST API
 -> validation + persistence
 -> workflow/publication transaction
 -> transactional outbox
 -> revalidation/webhooks
 -> independent frontend(s)
```

## SEO contract

Kal El owns editorial SEO and redirect lifecycle. Frontends own semantic output, metadata tags, JSON-LD, sitemaps/news sitemap, feeds, robots, hreflang, caching/Core Web Vitals and HTTP behavior.

No simplistic keyword-density SEO engine.

## Roadmap

Execute `docs/09-ROADMAP.md` in order, inserting PEG DS-0..DS-3 before production CMS UI and maintaining visual QA thereafter.

Do not build a production news portal/theme here. Build only frontend-independent delivery/preview contracts, typed SDK/reference fixture and revalidation proof.

## Open architectural choices

For ORM, editor, auth, queue, package/build tooling and similar choices:
- use current official documentation where available;
- prototype material alternatives;
- record ADRs under `docs/adr/`;
- optimize for maturity, security, TypeScript quality, migration ergonomics, testability, vendor independence and operational simplicity;
- do not add Redis, microservices or brokers without demonstrated need.

## Release-candidate definition

Repository must include reproducible setup and:
- PostgreSQL schema/migrations;
- CMS app;
- REST API/OpenAPI;
- worker/background execution where justified;
- auth/RBAC/site isolation;
- writing-first editor;
- media library/provider abstraction;
- editorial SEO;
- workflow/revisions/scheduling;
- preview;
- publication events + targeted revalidation contract;
- MN26/MNScr-compatible service API;
- WordPress importer;
- Payload importer framework;
- PEG implementation + calibration evidence;
- desktop/mobile + light/dark QA;
- observability/security baseline;
- CI;
- backup/restore and staging/deployment runbooks.

Run both `design-system/ACCEPTANCE_CHECKLIST.md` and repository acceptance criteria before completion.

Then stop **before production deployment** and produce `docs/FINAL-REPORT.md` with architecture, ADRs, commits, test/typecheck/lint/build evidence, visual QA, security findings, migration readiness, known limitations and exact human staging/production steps.
