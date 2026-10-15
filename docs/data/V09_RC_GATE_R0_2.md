# SceneShop v0.9 — RC Gate R0.2

## Purpose
The v0.9 release candidate is allowed only after four independent gates pass:

1. unit/contract regression (`npm test`);
2. real HTTP integration (`npm run test:api`);
3. deterministic dependency/migration preflight (`npm run preflight:rc`);
4. live PostgreSQL + Redis validation (`npm run validate:live`).

## Local command
`npm run test:rc-local` validates everything that does not require external PostgreSQL/Redis and intentionally uses the non-strict preflight.

## Full RC command
`npm run test:rc` is the canonical full gate. It must run with `LIVE_DATABASE_URL` and `LIVE_REDIS_URL` and with an exact lockfile that supports `npm ci`.

## CI
`.github/workflows/v0.9-release-gate.yml` provisions PostgreSQL 16.15 and Redis 7.4.11 service containers and runs the full gate. It is deliberately expected to fail while the repository lockfile is incomplete; the RC must not bypass that failure.

## Release doctrine
No `v0.9.0-RC.1` tag may be created solely from unit-test success. The strict lockfile gate and live data-plane gate are mandatory release evidence.
