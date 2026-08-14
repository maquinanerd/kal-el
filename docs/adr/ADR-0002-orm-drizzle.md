# ADR-0002 — ORM and query layer

Status: Accepted
Date: 2026-08-14
Related: docs/11-OPEN-DECISIONS.md, ADR-0001

## Context

The backend needs a TypeScript persistence layer over PostgreSQL with first-class
migration ergonomics, testability, vendor independence and operational
simplicity. Candidates considered: Prisma, Drizzle ORM, Kysely, raw `pg` + SQL.

## Decision

- **Drizzle ORM** (node-postgres driver) for schema, queries and relational
  query API; **drizzle-kit** for migrations.
- `pg` Pool directly for transactional/raw needs (advisory locks, schema
  maintenance in tests).

## Rationale

- SQL-first, TypeScript-native schema with no codegen step or engine server.
- Deterministic, reviewable SQL migrations; `strict` diffing.
- Small dependency footprint, no lock-in: generated SQL is portable and can be
  replaced by Kysely/raw SQL at boundaries without a rewrite.
- Adapter-friendly: node-postgres driver; alternative drivers are swappable.

## Consequences

- No Prisma engine binary or introspection service in production.
- Self-referencing FKs (categories.parentId) are enforced at the service layer
  instead of a DB FK to avoid a TS inference cycle (documented in schema).
- Relational `.query` API is used for reads; writes go through explicit
  transaction code paths to keep audit + idempotency atomic.
