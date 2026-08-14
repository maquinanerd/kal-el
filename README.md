# Kal El — Editorial CMS Platform

Kal El is an API-first editorial CMS designed to power multiple independent portals and applications without coupling content to a specific frontend framework.

## Product thesis

Kal El replaces the editorial role currently handled by systems such as WordPress or Payload while preserving frontend independence. A Next.js portal, a Lovable application, or another HTTP-capable client should consume the same stable Editorial API.

Kal El is **not** an e-commerce platform. Commerce integrations may be added later through adapters.

## Frozen architecture decisions

- Primary database: PostgreSQL.
- Backend/runtime: Node.js + TypeScript.
- CMS UI: Next.js + React + TypeScript.
- Architecture: monorepo.
- Public/integration interface: REST first.
- Frontends never access the database directly.
- Rich editor: writing-first, document-like experience rather than exposing block mechanics.
- Media: local storage initially, behind a storage-provider interface suitable for R2/S3 later.
- Authentication: email/password initially; architecture must permit SSO later.
- Authorization: RBAC from day one.
- Delivery: cached frontend rendering with targeted/on-demand revalidation.
- SEO editorial data belongs to Kal El; technical SEO rendering belongs to each frontend.
- Multi-site support is a first-class concern.
- Internal use first, without preventing future SaaS/multi-tenant evolution.
- WordPress and Payload are migration/import sources, never architectural dependencies.

## PEG Product Design System

The repository bundles the PEG Product Design System under `design-system/`. For CMS UI work this package is binding. Complete the calibration gate before expanding the product UI.

Canonical GitHub repository: `https://github.com/maquinanerd/kal-el`.

Owner local checkout context: `C:\Users\pablo\Documents\OpenCode\Kal El`. This is context for the owner's Windows machine; agents must mechanically resolve their actual current worktree rather than assume this path exists.

Start autonomous execution from `prompts/00-MASTER-ORCHESTRATOR.md`.
