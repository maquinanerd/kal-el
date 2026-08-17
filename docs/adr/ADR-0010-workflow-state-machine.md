# ADR-0010 — Editorial workflow state machine and preset roles

Status: Accepted
Date: 2026-08-17
Related: docs/02-EDITOR-UX.md, R3 workflow

## Context

The `status` enum declared `in_review`/`blocked` but no code reached them; the
only transitions were draft→published, draft→scheduled (and publish/schedule).
There was no review path, and status changes via PATCH were silently dropped
(fixed separately in R0.3). Editorial operations were not modeled as explicit,
authorizable transitions.

## Decision

- The workflow is an explicit **state machine** with states
  `draft`, `in_review`, `scheduled`, `published`, `blocked`, `archived`
  (`archived` is a plain-text column value — no SQL migration required; the
  column is `text` without a CHECK constraint).
- Every editorial action is a **dedicated endpoint**, never a generic PATCH:

  | action | transition | permission |
  |---|---|---|
  | `submit` | draft/blocked → in_review | `articles.submit` |
  | `approve` | in_review → draft | `articles.approve` |
  | `reject` | in_review → blocked | `articles.approve` |
  | `schedule` | draft/in_review/scheduled → scheduled | `articles.schedule` |
  | `publish` | draft/in_review/scheduled → published | `articles.publish` |
  | `unpublish` | published → draft | `articles.publish` |
  | `archive` | draft/blocked/in_review/scheduled → archived | `articles.publish` |

  The transition matrix is validated on every write (`assertTransition`); illegal
  transitions return 409. `approve` returns to `draft` because the six-state
  model has no dedicated "approved" state — `draft` is the publishable pre-live
  state. This is documented, not accidental.
- **Preset roles** (global keys, assignable per site) are seeded idempotently at
  boot: `owner`, `admin`, `editor-chefe`, `editor`, `autor`. The exact permission
  matrix lives in `PRESET_ROLES` (`apps/api/src/services/roles.ts`). Custom roles
  remain fully supported.

## Consequences

- `in_review` and `blocked` are now reachable; authors can submit, editors can
  approve/reject, head editors publish/schedule.
- RBAC: `articles.create` can only produce drafts; publishing/scheduling/approving
  require their own permissions (R0.1 + this ADR close the bypass surface).
- The SDK and external pipelines (R10) will target these explicit action
  endpoints rather than a status field on PATCH.
