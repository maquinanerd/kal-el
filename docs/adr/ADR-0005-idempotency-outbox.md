# ADR-0005 — Idempotency, transactional outbox and worker strategy

Status: Accepted
Date: 2026-08-14
Related: docs/05-MN26-MNSCR-INTEGRATION.md, docs/07-SECURITY-RELIABILITY.md

## Context

Automation writes (MN26/MNScr) retry on ambiguous timeouts. Publish must be
exactly-once from the caller's perspective with retriable side effects, and
publication must trigger frontend revalidation through an outbox. No Redis or
message broker is justified in v1.

## Decision

- **Exactly-once idempotency** (`withIdempotency`):
  - Callers send `Idempotency-Key` (safe string, >= 8 chars).
  - A Postgres advisory transaction lock (`pg_advisory_xact_lock` on
    `sha256(actor:key)`) serializes concurrent same-key requests; the winner
    runs the side effects and stores the response in `idempotency_keys`;
    followers replay the stored response.
  - Reusing a key with a different request returns 409 `IDEMPOTENCY_REPLAY`.
  - Keys are scoped per actor, so humans and services never collide.
- **Natural-id idempotency**: `articles.externalKey` is unique per site and
  create-with-external-key returns the existing article (belt and suspenders).
- **Transactional outbox**: writes that produce domain events insert a row in
  `outbox_events` in the same transaction as the domain change. Publish emits
  `article.published` with a deterministic idempotency key
  (`article:<id>:publish:<publishedAt>`).
- **Worker**: `apps/worker` will poll `outbox_events` (state `pending`,
  `available_at`, `locked_until`) in a later phase; because events are retriable
  and deduped by key, at-least-once delivery with idempotent handlers is safe.

## Consequences

- No broker/Redis in v1 (docs/08-DEPLOYMENT.md allows Redis "only when
  justified"); the outbox doubles as the retry queue.
- Callers may retry without duplicates; duplicate publish attempts converge on
  the same published timestamp.
- The worker and revalidation webhooks remain retriable/idempotent.
