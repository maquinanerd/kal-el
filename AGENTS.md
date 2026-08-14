# AGENTS.md — Kal El Repository Constitution

This file is binding for every coding agent and subagent.

## Mission

Build Kal El as a production-grade, API-first editorial CMS for a portfolio of news/media portals. The initial user is the owner's own media operation; architecture must avoid preventing a later SaaS product.

## Non-negotiable engineering rules

1. Never silently change frozen architecture decisions in `docs/01-ARCHITECTURE.md`.
2. Never couple a frontend directly to PostgreSQL.
3. Never make WordPress, Payload, TMDB, or any third-party product a core dependency.
4. Use adapters at external boundaries.
5. REST contracts are versioned and documented.
6. Database migrations must be reversible when reasonably possible and tested.
7. Every write endpoint requires authentication, authorization, validation, auditability, and idempotency where external automation can retry.
8. MN26/MNScr integrations must be safe under retries and ambiguous timeouts.
9. Published content must support deterministic preview and targeted cache revalidation.
10. Never expose secrets in source control, logs, fixtures, commits, or generated artifacts.
11. Never deploy production or modify live data without an explicit deployment instruction.
12. Work in small, reviewable commits.
13. Use tests as acceptance evidence; do not declare completion from code inspection alone.
14. Prefer simple solutions over speculative infrastructure.
15. Do not build e-commerce into Kal El.
16. The bundled `design-system/` directory is binding for CMS visual/interaction work.
17. Build and pass the PEG calibration screen before implementing the full CMS screen inventory.
18. Visual P0/P1 findings block UI phase completion.
19. Do not substitute generic dashboard/component-library defaults for calibrated PEG components.

## Autonomous execution

The orchestrator may diagnose, implement, test, refactor, create local commits, and open a draft PR if repository credentials and workflow permit it. It must not deploy production.

For uncertainty:
- Resolve technical uncertainty by inspection, tests, official documentation, and prototypes.
- Choose the safest reversible option when multiple implementations satisfy frozen architecture.
- Stop only for missing credentials, irreversible product decisions not covered by documentation, destructive production actions, or external service access that cannot be mocked.

## Definition of done

A phase is complete only when:
- acceptance criteria are met;
- relevant tests pass;
- lint/typecheck pass;
- security checks relevant to the phase pass;
- visual QA gates pass where UI is involved;
- documentation and API/schema contracts are current;
- migration implications are documented;
- no unresolved P0/P1 finding remains.
