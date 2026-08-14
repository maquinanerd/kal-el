# ADR-0004 — Authentication, sessions and service credentials

Status: Accepted
Date: 2026-08-14
Related: docs/07-SECURITY-RELIABILITY.md, ADR-0001

## Context

v1 requires secure email/password for humans plus scoped credentials for
automation (MN26/MNScr). The architecture must preserve a future SSO path and
never couple Kal El to a third-party auth provider. Candidates: better-auth,
Lucia-style sessions, custom core.

## Decision

- **Custom auth core** on the API:
  - Passwords: Argon2id via `@node-rs/argon2`.
  - Human sessions: opaque 256-bit tokens (`ke_s.*`) stored hashed (SHA-256)
    in `sessions`; HttpOnly, SameSite=Lax cookies; CSRF protection via a
    secondary `ke_csrf` cookie echoed in the `X-Kal-El-CSRF` header on
    state-changing requests.
  - Automation: opaque scoped tokens (`ke_st.*`) stored hashed in
    `service_tokens`, bound to a Site with an explicit scope list, revocable,
    expiring.
  - RBAC: users are assigned roles per site; roles map to permission keys;
    permission keys are seeded and stable (`PERMISSIONS`).

## Rationale

- Keeps auth in-domain, auditable and fully testable against the acceptance
  criteria (session revocation, site isolation, scoped service credentials).
- Avoids a heavy third-party runtime dependency; SSO can later be added as an
  adapter in front of the same session table.
- Argon2id via prebuilt `@node-rs/argon2` avoids a native toolchain on Windows.

## Consequences

- Every write path records the resolved actor (user/service/system) in the
  audit log.
- Service tokens are the only automation credential; they are always site- and
  scope-bound. A future webhook-signing key may reuse the same token model.
