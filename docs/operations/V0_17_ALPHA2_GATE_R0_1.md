# SceneShop v0.17 Alpha.2 Gate R0.1

Candidate source: `v0.17.0-alpha.2-dev.2`; promotion package version staged as `0.17.0-alpha.2` with the official tag withheld.

## Deterministic gates

- exact npm lock/preflight remains PASS;
- migration chain is contiguous through `0027_cache_coordination_recovery.sql`;
- cache generation invalidation is deterministic;
- concurrent lease acquisition is exclusive and release is ownership-token safe;
- product create/update invalidates the offer-cache namespace;
- recovery manifest comparison detects revision, snapshot, migration and row-count drift;
- production configuration requires Redis cache coordination;
- readiness/health expose cache backend without exposing secrets.

## Composite executable gate

Run on a connected Docker runner:

`npm run gate:alpha2`

This command executes the foundation gate first and then the isolated PostgreSQL backup→restore + fresh-Redis recovery drill. Recovery evidence is written under `artifacts/recovery-gate/`.

## Live gates required before tag `v0.17.0-alpha.2`

1. run exact `npm ci` on a connected runner;
2. run the full unit/contract/regression and HTTP integration suites;
3. run `npm run validate:live` against real PostgreSQL + Redis;
4. prove cache read across two Redis-backed coordinator instances;
5. prove namespace invalidation is visible across instances;
6. prove Redis lease excludes a second owner and becomes acquirable after safe release/expiry;
7. create a real recovery checkpoint, execute custom-format `pg_dump`, restore it to an isolated PostgreSQL target and run `recovery:verify` successfully;
8. require a brand-new Redis with `DBSIZE=0` before restore smoke, then prove the application becomes ready using the restored PostgreSQL + fresh Redis;
9. preserve the generated recovery evidence JSON, including checkpoint ID, Git commit, backup SHA-256/bytes and verification result.

No final alpha.2 tag or `release/v0.17` freeze is valid until these live gates are recorded as PASS **for the exact promotion commit** and `npm run release:verify` returns `eligible=true`.
