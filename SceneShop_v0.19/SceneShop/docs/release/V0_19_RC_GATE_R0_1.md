# SceneShop v0.19 — Release Candidate Gate R0.1

## Purpose

v0.19 is a convergence/hardening release. It does not introduce a new commerce domain or a new database migration. The RC may be promoted only when the exact candidate commit is proven against the production topology and all application surfaces.

## Frozen contract

- package: `0.19.0-rc.1`
- Node engine: `>=20`
- PostgreSQL migration count: `27`
- latest migration: `0027_cache_coordination_recovery.sql`
- migration-set SHA-256: `58e73ab31399eb7db9641510baa9fc5a2e5d3dd725c6cefcdcf07eb8ecaccafa`
- native bridge message version: `1`
- maximum native bridge payload: `16384` bytes
- production authorities: PostgreSQL (durable data), Redis (sessions/cache/coordination)

The machine-readable authority is `docs/release/V0_19_RELEASE_CONTRACT_R0_1.json`.

## Required gates

1. strict dependency lock and migration preflight;
2. release-contract verification;
3. production runtime configuration validation;
4. live PostgreSQL + Redis foundation gate;
5. backup -> isolated restore -> fresh Redis recovery gate;
6. isolated live schema compatibility verification;
7. Desktop, Android and iOS build evidence bound to the same commit/version;
8. all 12 Production Beta QA rows executed on their declared runtimes;
9. production signing authority ready for Android and Apple;
10. production-signed Android and iOS artifact evidence;
11. clean Git worktree and same-commit RC manifest.

`npm run rc:verify` is fail-closed. `npm run rc:promote` cannot create release refs until the manifest is eligible.

## Canonical refs

Only guarded promotion may create:

- branch `release/v0.19`
- annotated tag `v0.19.0-rc.1`

No conflicting branch/tag is overwritten.

## Schema/rollback doctrine

v0.19 deliberately retains the exact v0.18 beta.1 migration set. Application rollback to `0.18.0-beta.1` is therefore allowed only while the live database still exactly matches the 27-migration v0.19 contract. If any later migration has been applied, rollback to v0.18 is blocked until a separately reviewed compatibility plan exists.

Redis is not rollback authority: sessions/cache/leases are ephemeral and may be rebuilt.

## Portable multi-runner evidence import

SceneShop does not require a central GitHub repository to combine RC evidence. External Linux, Android and macOS/device runners may place evidence under one transport directory using the canonical layout:

- `foundation-gate/foundation-evidence-*.json`
- `recovery-gate/recovery-evidence-*.json`
- `rc-gate/schema-compatibility.json`
- `native-build/desktop.json`, `android.json`, `ios.json`
- `native-build/android-signed.json`, `ios-signed.json`
- `native-signing/report.json`
- `app-qa/executions/<row>-*.json`

`npm run rc:evidence:import:dry` validates every file against the current Git commit and package version without copying anything. `npm run rc:evidence:import` requires the complete evidence set, imports only validated evidence into the canonical `artifacts/` layout, and refuses stale or cross-commit evidence. Promotion remains a separate `npm run rc:verify` then `npm run rc:promote` step.
