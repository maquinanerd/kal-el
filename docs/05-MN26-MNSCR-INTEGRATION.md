# Automation Integration Contract

MN26 and MNScr use the same service-facing REST domain contract as future automation clients.

No automation writes directly to PostgreSQL. Use scoped service credentials, schema validation, idempotency, provenance and server-side revalidation.

```text
source
 -> extraction/generation/QA
 -> Kal El REST API + Idempotency-Key
 -> validation + persistence
 -> workflow/publication
 -> outbox event
 -> frontend revalidation/distribution
```

Suggested endpoints include article create/update/submit/publish/schedule, lookup by external key, taxonomy/entity lookup, media ingestion and webhook/event subscription. Final contract is OpenAPI-first.
