# SceneShop v0.19 — Rollout & Rollback Runbook R0.1

## Before deployment

1. Freeze the candidate commit and require a clean worktree.
2. Run `npm run rc:contract`, `npm run preflight:rc` and `npm run rc:schema`.
3. Run the live foundation and recovery gates on dedicated infrastructure.
4. Run `npm run rc:schema:live`; it creates an isolated PostgreSQL schema, applies all migrations, verifies every checksum and drops that schema.
5. Produce same-commit Desktop/Android/iOS build evidence, signed mobile evidence and all required QA evidence.
6. Run `npm run rc:verify`. Do not deploy if `eligible` is false.
7. Take a governed recovery checkpoint/backup before changing the serving application version.

## Canary / rollout observation

Every operational endpoint exposes the candidate version and release contract. Verify `/api/live`, `/api/ready`, `/api/health` and moderator `/api/ops/status` all report the expected `0.19.0-rc.1`, release channel `rc`, migration `0027_cache_coordination_recovery.sql` and native bridge version `1`.

During rollout, watch readiness, PostgreSQL migration health, Redis session/cache health, outbox degradation/dead letters, request errors/latency and client reconnect behavior. Stop expansion if any authority is degraded or if the release metadata is mixed across instances unexpectedly.

## Rollback decision

Rollback to `0.18.0-beta.1` is permitted only if:

- `npm run rc:schema` reports rollback compatibility;
- the live schema evidence reports the exact frozen 27-migration set;
- no later schema migration has been applied;
- restored/serving data passes readiness and recovery checks.

Do not attempt a database downgrade. Roll back application instances only. Redis may be restarted empty; PostgreSQL remains the durable authority.

## After rollback

1. Confirm all instances report the expected application version.
2. Re-run readiness/health checks.
3. Verify PostgreSQL remains on the same frozen migration set.
4. Confirm Redis sessions/cache repopulate normally.
5. Inspect outbox ready/dead-letter state and resume workers only when health is green.
6. Preserve the failed RC evidence and incident notes; do not overwrite or relabel them as PASS.
