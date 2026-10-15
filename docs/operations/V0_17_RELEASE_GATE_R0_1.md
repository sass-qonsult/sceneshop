# SceneShop v0.17 Release Gate R0.1

## Purpose

The v0.17 release boundary is evidence-driven. The package may carry version `0.17.0-alpha.2` as the promotion candidate, but no `v0.17.0-alpha.2` tag and no `release/v0.17` freeze are valid until the live gate evidence is produced for the exact same Git commit.

## Required evidence

1. Foundation evidence from `tools/run-foundation-gate.sh` proving exact `npm ci`, strict lock preflight, full regression/HTTP checks and live PostgreSQL/Redis validation.
2. Recovery evidence from `tools/run-recovery-gate.sh` proving checkpoint → `pg_dump` → isolated `pg_restore` → manifest verification → restored production smoke on brand-new empty Redis.
3. Both evidence files must report `ok=true`, the candidate package version and the exact current Git commit.
4. The Git worktree must be clean and the strict dependency/migration preflight must remain PASS.

## Promotion verifier

`npm run release:verify`

The verifier emits `artifacts/release-gate/v0.17-release-manifest.json`. `eligible=true` is the only state that authorizes creation of the `v0.17.0-alpha.2` tag and freezing `release/v0.17` at that same commit.

Stale evidence from an earlier commit is rejected even when the earlier gate was PASS.

## CI

`.github/workflows/v0.17-release-gate.yml` runs the complete alpha.2 gate first and only then executes the same-commit release verifier. Foundation, recovery and release evidence are uploaded together as the release audit artifact.

## Non-negotiable boundary

No manual assertion, local mock or prior-version PASS may substitute for same-commit live evidence.

## Guarded promotion command

After `npm run gate:alpha2` and `npm run release:verify` succeed on the same commit:

1. `npm run release:promote:dry` must report `eligible=true`, `branchState=CREATE|ALREADY_AT_HEAD` and `tagState=CREATE|ALREADY_AT_HEAD`.
2. `npm run release:promote` creates only `release/v0.17` and annotated tag `v0.17.0-alpha.2` at the eligible commit.
3. Existing refs at another commit are conflicts and are never overwritten.
4. Post-promotion verification resolves both refs back to the eligible commit.

Until that happens, use the RC-preparation/freeze-candidate refs only; they are not a substitute for the official release branch/tag.
