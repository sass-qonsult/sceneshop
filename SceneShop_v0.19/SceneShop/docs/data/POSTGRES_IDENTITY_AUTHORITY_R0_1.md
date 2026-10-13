# SceneShop PostgreSQL Identity Authority R0.1

Baseline: `v0.9.0-alpha.5`

## Purpose

Alpha.5 moves authentication authority away from the compatibility snapshot. PostgreSQL becomes the source of truth for account credentials, role, `tokenVersion`, and newly issued login sessions. The legacy snapshot remains available while the rest of the v0.8 domains are migrated.

## Authority boundary

PostgreSQL-authoritative now:

- `sceneshop_accounts.username`
- password hash
- role / author binding
- demo flag
- `token_version`
- `sceneshop_auth_sessions`
- session revocation

`sceneshop_authors` exists relationally and is read by the authentication/public-principal path, but KYC/profile mutations are still mirrored from the compatibility state until the compliance/identity sub-domain is migrated. The generic projector is explicitly forbidden from updating existing account credentials or token versions.

## Session token

New tokens carry:

- `sub`: normalized username
- `v`: account token version
- `sid`: cryptographically random login-session identifier
- `exp`: expiration time

The database stores only the session identifier and metadata, never the bearer token itself.

## Verification

For a new token, a request is accepted only when all are true:

1. HMAC signature is valid;
2. token is not expired;
3. PostgreSQL account exists;
4. token `v` equals `sceneshop_accounts.token_version`;
5. `sid` belongs to the same username;
6. the session is not revoked;
7. session is not expired;
8. session token version equals the current account version.

Legacy tokens issued before alpha.5 have no `sid`. They continue to use the authoritative PostgreSQL account/token-version check during the transition and naturally expire under the existing token TTL. New logins always receive a `sid`.

## Logout all

`logout-all` is a PostgreSQL domain transaction:

- increments `sceneshop_accounts.token_version`;
- revokes every active row in `sceneshop_auth_sessions` for the account;
- updates the compatibility snapshot;
- emits `identity.tokens.revoked` to the transactional outbox.

This allows one node to invalidate tokens used against another node without relying on in-process memory.

## Signup

PostgreSQL signup writes the author, account, optional initial login session, compatibility snapshot and `identity.created` outbox event through the domain-commit path. Unique constraints remain the final cross-process duplicate-username barrier.

## Projector safety rule

From alpha.5 onward, whole-state relational projection:

- may insert a missing account during bootstrap;
- **must not update an existing PostgreSQL account**;
- **must not delete accounts** during routine projection.

This prevents a stale Node snapshot from rolling back a password or `tokenVersion` written by another SceneShop instance.

An explicit runtime replacement/import is administrative and may replace identity data intentionally.

## Session privacy

The session table may store an HMAC of the observed IP for security correlation. Raw IP is not required for identity session storage. Session metadata is intentionally independent from the bearer credential.

## Remaining work

- live PostgreSQL migration/integration validation;
- dedicated password change/recovery workflow;
- MFA and enterprise identity in v0.10;
- migrate KYC/profile mutation authority from the compatibility state;
- Redis-backed short-lived auth/session cache if required after measurement;
- session-management UI and single-session logout.
