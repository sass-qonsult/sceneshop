# SceneShop — Recovery Runbook R0.1

Version line: **v0.17.0-alpha.2-dev.2**

## Authority model

PostgreSQL is the durable recovery authority. Redis is operational infrastructure only and must be disposable. A successful disaster-recovery drill must therefore prove both sides independently:

1. the PostgreSQL backup restores exactly to the pre-backup checkpoint;
2. SceneShop becomes ready when paired with a completely new Redis that contains no prior session, cache, lease or Pub/Sub state.

## One-command acceptance path

Run from a connected host with Docker, Node 22+ and npm:

`npm run gate:alpha2`

The composite gate runs the foundation gate and, only if it passes, the recovery gate.

## Recovery topology

The recovery gate provisions four isolated services under its own Docker Compose project:

- `postgres` — primary SceneShop database;
- `redis` — primary runtime Redis;
- `postgres_restore` — empty PostgreSQL restore target;
- `redis_fresh` — empty Redis with persistence disabled for the drill.

No production credentials or data are required.

## Drill sequence

1. initialize the primary schema and seed a deterministic SceneShop snapshot if the database is empty;
2. create a durable `sceneshop_recovery_checkpoints` record;
3. capture PostgreSQL using `pg_dump -Fc`;
4. reject an empty backup artifact;
5. restore the backup to `postgres_restore` using `pg_restore --clean --if-exists --no-owner --no-privileges`;
6. run `recovery:verify` against the restored database;
7. require `DBSIZE=0` on `redis_fresh` before application startup;
8. boot SceneShop in production configuration against `postgres_restore` + `redis_fresh`;
9. require `/api/ready` to report PostgreSQL data authority, Redis session authority and Redis cache authority;
10. write recovery evidence containing the checkpoint ID, current Git commit, backup SHA-256, backup bytes, manifest verification and fresh-Redis application smoke result.

## Evidence

Evidence is written to `artifacts/recovery-gate/` and the CI workflow uploads the directory as an artifact even on failure when files exist.

The evidence JSON does not replace the backup itself. It proves which backup artifact was exercised and what restored state was observed.

## Failure semantics

Any failed foundation test, non-zero `pg_dump`/`pg_restore`, missing checkpoint, manifest mismatch, non-empty fresh Redis, unhealthy restored PostgreSQL, failed `/api/ready`, or evidence-generation error fails the gate.

The scripts always tear down their isolated Docker project and volumes at exit. A failed drill must not be reported as a partial PASS.

## Promotion rule

`v0.17.0-alpha.2-dev.2` remains a candidate. Only a recorded successful `npm run gate:alpha2` execution may support promotion to `v0.17.0-alpha.2` and subsequent `release/v0.17` preparation.
