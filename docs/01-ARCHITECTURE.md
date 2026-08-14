# Kal El Architecture

## Logical architecture

```text
Human editors ───────────────┐
MN26 / MNScr / importers ────┼──> Kal El REST API
Future integrations ─────────┘          │
                                        ├── Auth + RBAC
                                        ├── Editorial domain
                                        ├── SEO domain
                                        ├── Media domain
                                        ├── Entity taxonomy
                                        ├── Workflow / revisions
                                        ├── Publication service
                                        ├── Audit log
                                        └── Event/outbox
                                                │
                           ┌────────────────────┼──────────────────┐
                           │                    │                  │
                       PostgreSQL         Media Storage      Workers/Queue
                           │               local -> R2/S3          │
                           └────────────> Delivery API <───────────┘
                                                │
                              ┌─────────────────┼─────────────────┐
                              │                 │                 │
                         Next portal       Lovable app       other clients
```

## Monorepo target

```text
apps/
  cms/
  api/
  worker/
packages/
  db/
  contracts/
  auth/
  editorial/
  editor/
  media/
  seo/
  design-system/
  observability/
  testkit/
docs/
agents/
prompts/
design-system/
```

PostgreSQL is the system of record. Do not create one database per portal initially; model Site isolation in-domain. Domain databases such as ScreenDB may remain separate and be referenced through stable external identifiers.

REST `/v1/...` is canonical for v1. Require OpenAPI, schema validation, consistent errors, cursor pagination, filtering, service credentials, idempotency, optimistic concurrency and rate limiting where exposed.

Kal El must never require Next.js on the consuming side.

Publishing emits events used for targeted frontend revalidation.

Media uses a `StorageProvider` abstraction: local initially, S3-compatible later. Never store binary media in PostgreSQL.

Future SaaS readiness means explicit ownership/site boundaries, not premature billing or enterprise complexity.
