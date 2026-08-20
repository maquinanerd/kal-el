# Kal El Documentation

Official reference for the Kal El editorial CMS: what it is, how it is built, and — above
all — **exactly how an external program talks to it**.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

Everything here was derived from the implementation at that commit. Where older
documentation and the code disagreed, **the code won** and the divergence is recorded in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md).

---

## Start here

| You want to | Read |
|---|---|
| Understand what Kal El is | [Product Overview](product/OVERVIEW.md) |
| **Write a client that posts content** | **[External Client API](integrations/EXTERNAL_CLIENT_API.md)** |
| Write that client in Python | [Python Client Example](integrations/PYTHON_CLIENT_EXAMPLE.md) |
| Model your content before sending it | [Content Ingestion Contract](integrations/CONTENT-INGESTION-CONTRACT.md) |
| Work on Kal El itself | [System Architecture](architecture/SYSTEM-ARCHITECTURE.md) |
| Run it locally | [Local Development](operations/LOCAL-DEVELOPMENT.md) |
| Deploy it | [Deployment](operations/DEPLOYMENT.md) |
| Diagnose a failure | [Troubleshooting](operations/TROUBLESHOOTING.md) |

---

## Product

| Document | Covers |
|---|---|
| [Overview](product/OVERVIEW.md) | what Kal El is and is not, who uses it, boundaries of responsibility |

---

## Architecture

| Document | Covers |
|---|---|
| [System Architecture](architecture/SYSTEM-ARCHITECTURE.md) | components, request flow, auth model, the worker, media, preview, technology |
| [Database](architecture/DATABASE.md) | every table, key, constraint and index; where a client can collide |
| [Multisite](architecture/MULTISITE.md) | tenancy, site scoping, cross-site refusals, what is *not* per site |

---

## API

| Document | Covers |
|---|---|
| **[External Client API](integrations/EXTERNAL_CLIENT_API.md)** | **the complete contract — routes, scopes, fields, retries, the full route table** |
| [Authentication](api/AUTHENTICATION.md) | sessions, service tokens, CSRF, the permission model, preset roles, bootstrap |
| [Errors](api/ERRORS.md) | every machine-readable code, when it fires, what to do |
| [Idempotency](api/IDEMPOTENCY.md) | `Idempotency-Key` semantics and the safe retry algorithm |
| [Concurrency](api/CONCURRENCY.md) | `version`, `If-Match`, `VERSION_CONFLICT`, reconciliation |
| [OpenAPI Coverage](api/OPENAPI-COVERAGE.md) | what the OpenAPI document does and does not describe |

---

## Content

| Document | Covers |
|---|---|
| [Article Document](editor/ARTICLE_DOCUMENT.md) | the body JSON schema — every node, mark and constraint, with examples |
| [Workflow](editor/WORKFLOW.md) | the state machine, transitions, side effects, revisions, recovery |
| [SEO](editor/SEO.md) | the SEO object, slugs, redirects, and what a frontend must implement |
| [Media](editor/MEDIA.md) | upload validation, storage, referencing, deduplication, deletion |
| [Taxonomies](editor/TAXONOMIES.md) | categories, tags, authors, entities, sources — and the sources gap |

---

## Integrations

| Document | Covers |
|---|---|
| [External Client API](integrations/EXTERNAL_CLIENT_API.md) | the contract an automation works against |
| [Content Ingestion Contract](integrations/CONTENT-INGESTION-CONTRACT.md) | how to shape content before calling the API, and the exact mapping |
| [Python Client Example](integrations/PYTHON_CLIENT_EXAMPLE.md) | a working client, end to end |
| [SDK](integrations/SDK.md) | what `@kal-el/sdk` implements, and its gaps |
| [Webhooks](integrations/WEBHOOKS.md) | events, payloads, signatures, retries, dead-lettering |
| [Audit](integrations/AUDIT.md) | how a service token appears in the log, and how to read it |

---

## Operations

| Document | Covers |
|---|---|
| [Local Development](operations/LOCAL-DEVELOPMENT.md) | clone → running API, CMS and worker |
| [Environment](operations/ENVIRONMENT.md) | every variable, default and production guard |
| [Deployment](operations/DEPLOYMENT.md) | topology, images, health, shutdown, scaling limits |
| [Backup / Restore](operations/BACKUP-RESTORE.md) | what the utility captures, and what it destroys |
| [Troubleshooting](operations/TROUBLESHOOTING.md) | symptom → cause → fix |

---

## Reference

| Document | Covers |
|---|---|
| [Known Issues](KNOWN-ISSUES.md) | divergences, gaps and sharp edges found while documenting |

---

## The original design briefs

Written before the implementation; kept for context. Where they disagree with the documents
above, **the documents above are the current truth.**

| Document | Covers |
|---|---|
| [00 — Product Vision](00-PRODUCT-VISION.md) | jobs to be done, explicit non-goals |
| [01 — Architecture](01-ARCHITECTURE.md) | the intended shape |
| [02 — Editor UX](02-EDITOR-UX.md) | the editing experience |
| [03 — SEO](03-SEO.md) | the SEO brief |
| [04 — Content Model](04-CONTENT-MODEL.md) | the intended content model |
| [05 — MN26 / MNSCR Integration](05-MN26-MNSCR-INTEGRATION.md) | external pipeline intent |
| [06 — Migration](06-MIGRATION.md) | migration strategy |
| [07 — Security & Reliability](07-SECURITY-RELIABILITY.md) | the security brief |
| [08 — Deployment](08-DEPLOYMENT.md) | the deployment brief |
| [09 — Roadmap](09-ROADMAP.md) | phasing |
| [10 — Acceptance Criteria](10-ACCEPTANCE-CRITERIA.md) | acceptance gates |
| [11 — Open Decisions](11-OPEN-DECISIONS.md) | decisions outstanding at the time |
| [12 — Design System Integration](12-DESIGN-SYSTEM-INTEGRATION.md) | PEG integration |

Decision records live in [adr/](adr/); phase-by-phase implementation notes in
[progress/](progress/).

---

## The fifteen questions a client author must be able to answer

Every one is answered by the documents above. If you cannot answer one after reading them,
the documentation has a gap worth filing.

| # | Question | Answer lives in |
|---|---|---|
| 1 | What is the base URL? | [External Client API §1](integrations/EXTERNAL_CLIENT_API.md#1-base-url-and-versioning) |
| 2 | How do I authenticate? | [§3](integrations/EXTERNAL_CLIENT_API.md#3-authentication) · [Authentication](api/AUTHENTICATION.md) |
| 3 | How do I identify the site? | [§5](integrations/EXTERNAL_CLIENT_API.md#5-site-context) · [Multisite](architecture/MULTISITE.md) |
| 4 | Which scopes do I need? | [§6](integrations/EXTERNAL_CLIENT_API.md#6-scopes) |
| 5 | How do I create an article? | [§9](integrations/EXTERNAL_CLIENT_API.md#9-create-an-article) |
| 6 | How do I update one? | [§10](integrations/EXTERNAL_CLIENT_API.md#10-update-an-article) |
| 7 | How do I recognise content I already sent? | [§7 `externalKey`](integrations/EXTERNAL_CLIENT_API.md#7-external-identity-externalkey) |
| 8 | How do I upload an image? | [§13](integrations/EXTERNAL_CLIENT_API.md#13-media) · [Media](editor/MEDIA.md) |
| 9 | How do I attach taxonomy? | [§11](integrations/EXTERNAL_CLIENT_API.md#11-taxonomies) · [Taxonomies](editor/TAXONOMIES.md) |
| 10 | How do I move it through review and publication? | [Workflow](editor/WORKFLOW.md) |
| 11 | What errors can I get? | [Errors](api/ERRORS.md) |
| 12 | What may I retry, and how? | [§18 Retry matrix](integrations/EXTERNAL_CLIENT_API.md#18-retry-matrix) |
| 13 | How do I make a retry safe? | [Idempotency](api/IDEMPOTENCY.md) |
| 14 | How do I avoid a lost update? | [Concurrency](api/CONCURRENCY.md) |
| 15 | How do I learn that something was published? | [Webhooks](integrations/WEBHOOKS.md) |

---

## Conventions in these documents

- Every technical document carries a **`Reviewed against`** block naming the branch, commit
  and date it was verified at.
- Every technical document ends with **`Implementation references`** — the source files a
  reader can check the contract against.
- **Exact literals** are used throughout: real route paths, real field names, real error
  codes, real header names.
- Where something is **absent from the code**, it says so explicitly rather than inventing
  a plausible answer.
- **No secret value appears anywhere**, only variable and field names.
