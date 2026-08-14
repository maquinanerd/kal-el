# Phase 8–9 — Typed SDK, Delivery/Revalidation Fixture, MN26/MNScr Service Contract

Status: complete (proof)
Date: 2026-08-14
Prompts: prompts/05-INTEGRATIONS.md

## What was built

- **`@kal-el/events`** — shared webhook signature (HMAC-SHA256, timing-safe) and
  header names, used by both the worker (signing) and consumers (verifying).
- **`@kal-el/sdk`** — typed service client (`KalElClient`) for automation:
  - Bearer service-token auth.
  - Automatic, deterministic `Idempotency-Key` per mutating call (sha256 of
    method+path+body) so retries are safe by default; callers can override.
  - Retry with backoff on 408/429/5xx and network errors — reusing the same
    idempotency key — and typed `KalElError` for 4xx.
  - Methods: article create/get/list/update/publish/schedule, category, tag.
- **`apps/fixture`** — reference "frontend" proving cached delivery + targeted
  revalidation: caches published payloads keyed by slug, verifies
  `X-Kal-El-Signature` on `/webhooks/article.published`, rejects bad signatures,
  serves `/articles/:slug` from the fresh cache.

## End-to-end proof (`apps/fixture/tests/e2e.test.ts`)

```text
SDK (service token) -> POST /v1/sites/:id/articles (Idempotency-Key)
                     -> publish (exactly-once, outbox row)
                     -> processDueEvents(worker) -> signed webhook
                     -> fixture verifies signature, revalidates cache
                     -> GET /articles/:slug returns fresh cached article
```

Assertions that hold:
- cache miss before dispatch (404), fresh hit after dispatch (200, `cached: true`);
- delivery carries `X-Kal-El-Idempotency` equal to the outbox event key;
- unsigned deliveries rejected with 401;
- the full path is exercised over real HTTP with real HMAC signatures.

## Evidence

| Package | Tests | Result |
|---|---|---|
| `@kal-el/sdk` | 5 | pass (token header, stable key, same-key retry, no key on GET, typed errors) |
| `@kal-el/fixture` e2e | 2 | pass (revalidation flow, bad signature rejection) |

Global gate after this phase: **64 tests** pass; typecheck/lint/build all green.

## Notes

- The SDK retry contract mirrors the server's exactly-once idempotency
  (ADR-0005): client and server both key on the same `Idempotency-Key`.
- Webhook endpoint coverage is in the OpenAPI registry (`/docs`).
