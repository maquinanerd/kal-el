# Phase 7 — Workflow / Publication (outbox, webhooks, retry)

Status: complete (core)
Date: 2026-08-14
Prompt: prompts/04-SEO-WORKFLOW.md

## What was built

- **Webhook subscriptions** (`webhooks`, `webhook_deliveries` schema + migration):
  admin CRUD at `/v1/admin/sites/:siteId/webhooks` (create returns the secret
  once; list; delete). Events: `article.published|scheduled|updated`.
- **Outbox dispatcher worker** (`apps/worker`):
  - Claims due `outbox_events` with `SELECT … FOR UPDATE SKIP LOCKED`.
  - Matches site + event type via JSONB `?` operator.
  - Delivers POST with `X-Kal-El-Signature` (HMAC-SHA256), `X-Kal-El-Event`,
    `X-Kal-El-Delivery`, `X-Kal-El-Idempotency` (subscribers dedupe).
  - Exponential backoff (`baseDelayMs * 2^(attempt-1)`), max attempts,
    dead-letter (`status=failed`), and publish on success / no subscribers.
  - Deliveries upsert on `(webhook, event)` — idempotent after crashes.
- **Exactly-once semantics**: publish emits one `article.published` event keyed
  deterministically (`article:<id>:publish:<publishedAt>`); delivery carries the
  same key so side effects stay retriable without duplicates (per ADR-0005).

## Evidence

`apps/worker/tests/dispatcher.test.ts` (5 tests):

| Test | Result |
|---|---|
| signature signs/verifies (timing-safe) | pass |
| delivers signed idempotent request to subscriber | pass |
| retries transient failure and converges on success | pass |
| dead-letters beyond max attempts | pass |
| marks event published with no subscribers | pass |

Also: publish-exactly-once + single outbox row covered in `apps/api` article tests.

## Notes

- Worker is deployable as `kal-el-worker` (docs/08-DEPLOYMENT.md).
- The scheduled-publish tick (promoting `scheduled` articles to `published`
  when `scheduled_at` arrives) is a follow-up within this phase's worker.
- Webhook endpoints are in the OpenAPI registry (`/docs`).
