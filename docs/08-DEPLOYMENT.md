# Deployment Model — Initial Contabo VPS

Kal El must deploy on a Contabo VPS through a container-oriented panel such as Easypanel or an equivalent. Do not hard-code a panel into app architecture.

Conceptual services: `kal-el-cms`, `kal-el-api`, `kal-el-worker`, `kal-el-db`, optional Redis only when justified, reverse proxy/TLS from platform, local persistent media volume initially.

Require container builds, persistent volumes, automated DB backup strategy, staging/prod separation, controlled migrations, no secrets baked into images, health checks and rollback runbook. No autonomous production deployment.
