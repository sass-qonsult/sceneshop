# SceneShop Data Plane Runbook R0.1

Applies to: `v0.9.0-alpha.2`

## Purpose

This runbook defines the reproducible local/CI path for the v0.9 Data Plane while the application is being migrated from the v0.8 whole-state runtime into PostgreSQL/Redis domain services.

## Runtime baseline

- Node.js: major 22 (`.nvmrc`, Docker image `node:22-bookworm-slim`).
- PostgreSQL target: PostgreSQL 16 in the local compose profile.
- Redis target: Redis 7.4 in the local compose profile.
- Local compatibility backend: atomic JSON file.

PostgreSQL is authoritative for v0.9 production persistence. Redis is provisioned now but does not become authoritative for realtime sessions until the session adapter migration is completed and tested.

## Local compatibility mode

```bash
npm install
cp .env.example .env
npm test
npm start
```

Default development keeps `DATA_BACKEND=file`.

## Container Data Plane

```bash
docker compose up --build
```

The compose topology contains:

1. `app` — SceneShop running on Node 22;
2. `postgres` — persistent PostgreSQL volume;
3. `redis` — persistent Redis volume.

The compose credentials are development-only and MUST NOT be reused outside local development.

## Readiness

- `GET /api/live` — process liveness only; no dependency checks.
- `GET /api/ready` — Data Plane readiness; returns 503 if persistence is unhealthy.
- `GET /api/health` — combined application/Data Plane status.

## runtime.json migration

Always inspect before writing:

```bash
npm run data:inspect -- --source data/runtime.json
```

Import into PostgreSQL:

```bash
DATABASE_URL='postgres://...' npm run data:import -- --backend postgres --source data/runtime.json
```

The importer:

- validates minimum compatible state version;
- calculates a SHA-256 checksum over source bytes;
- reports domain counts;
- refuses to replace an existing destination unless `--replace` is explicit;
- verifies the destination snapshot after import;
- records an import manifest when the PostgreSQL adapter is used.

`--replace` is destructive and must only be used against an intentional target.

## Snapshot concurrency

The transitional PostgreSQL snapshot has a monotonic `revision`. Updates use optimistic concurrency. A stale writer fails with `SCENESHOP_CONCURRENT_WRITE` instead of silently overwriting a newer state.

This protection is transitional. Final v0.9 removes transaction-critical operations from whole-state snapshot writes and places them in normalized domain repositories/transactions.

## Open v0.9 gates

- execute this stack against a real PostgreSQL/Redis runtime;
- regenerate and freeze the full npm lock graph after registry access is available;
- move identity persistence from state-backed repository to normalized PostgreSQL;
- move content/tracks and commerce/ledger next;
- make order + commission confirmation one database transaction;
- switch realtime session authority to Redis and add the Socket.IO multi-node adapter;
- add PostgreSQL concurrency/idempotency integration tests.
