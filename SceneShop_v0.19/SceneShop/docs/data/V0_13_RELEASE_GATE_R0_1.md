# SceneShop v0.13 — Release Gate R0.1

Branch: `release/v0.13`
Baseline: `v0.13.0-alpha.2`

## Functional scope frozen for v0.13

1. Canonical Distribution Core for `PARTNER_NATIVE`, `COMPANION`, `EMBEDDED`.
2. Organization-owned Playback Bindings over a SceneShop Content/Sync ID.
3. Temporal fingerprint index/recognition protocol and Companion session bootstrap.
4. Headless Partner SDK with long-lived server key -> short-lived scoped browser token.
5. Governed YouTube / Instagram / TikTok platform connections via external secret references.
6. Provider metadata adapters and binding metadata refresh.
7. Companion PWA share-target foundation and framework-independent mobile state core.

## Local validation completed

- 148/148 unit + contract tests PASS.
- 86/86 real HTTP integration checks PASS.
- JavaScript/MJS syntax checks PASS.
- 20 contiguous migrations; latest `0020_platform_connectors_mobile.sql`.
- Non-strict local preflight PASS.

## RC blockers in this execution environment

`npm run preflight:rc` intentionally fails because the current container cannot regenerate the exact npm dependency tree. The lockfile lacks package entries for:

- `pg`
- `redis`
- `@socket.io/redis-adapter`

The environment also cannot run a live PostgreSQL/Redis validation because those daemons/container runtimes are not available here. `.github/workflows/v0.13-release-gate.yml` is prepared to execute these gates in CI.

## Provider field-validation status

The YouTube, Instagram and TikTok adapter contracts have deterministic mocked tests. They have **not** been promoted as live production-credential validation in this container. Provider authorization, scopes, quotas and live metadata calls must pass in the deployment/CI environment with approved credentials before RC promotion.

## Promotion rule

Do not create `v0.13.0-RC.1` until all of the following pass from the exact release commit:

1. `npm ci`
2. `npm test`
3. `npm run test:api`
4. `npm run preflight:rc`
5. `npm run validate:live`
6. governed provider smoke tests using approved non-production/test credentials where available.
