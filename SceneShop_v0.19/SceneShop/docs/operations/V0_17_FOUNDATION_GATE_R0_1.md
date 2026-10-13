# SceneShop v0.17 Foundation Gate R0.1

## Purpose
Stop inherited infrastructure uncertainty before Scale & Reliability feature work continues. This gate is a prerequisite to `v0.17.0-alpha.2`, not a final-release cleanup task.

## 1. Reproducible dependency authority
The committed npm lock must contain the complete production closure for:

- `pg` = `8.23.1`
- `redis` = `6.3.0`
- `@socket.io/redis-adapter` = `8.3.0`

The strict preflight requires exact versions, SHA-512 integrity metadata and a fully resolvable transitive closure. Optional peer dependencies are not treated as mandatory nodes. The Socket.IO Redis adapter keeps its own compatible `debug`/`ms` tree where required instead of rewriting older packages used by Express.

Node runtime requirement is >=20 because the pinned Redis client requires it. SceneShop's operational baseline remains Node 22.

### Local evidence
`npm ci --dry-run --offline --ignore-scripts --no-audit --no-fund` accepts the lock graph. This proves npm can consume the committed dependency solution without performing a fresh dependency resolution. It does not replace a connected `npm ci` that downloads and verifies the actual tarballs.

## 2. Live PostgreSQL authority gate
The live harness creates an isolated random schema and must prove:

- the full migration chain applies through `0026_scale_reliability_foundation.sql`;
- repository health reports migration consistency;
- state round-trip is durable;
- stale optimistic-concurrency writers are rejected;
- state survives repository restart;
- two outbox workers obtain non-overlapping leased batches through the PostgreSQL authority;
- ACK and terminal failure/dead-letter transitions persist;
- worker heartbeats are observable.

The isolated schema is dropped after the run.

## 3. Live Redis/realtime gate
The live harness uses an isolated key prefix and must prove:

- session TTL is present;
- per-viewer Browse Head remains independent from Playback Head;
- Companion re-sync does not force a browsing viewer back to LIVE;
- Socket.IO Redis adapter propagates a server-side event between independent Socket.IO instances.

Test keys are removed after the run.

## 4. Production application smoke
A child SceneShop process starts with:

- `NODE_ENV=production`
- `DATA_BACKEND=postgres`
- `SESSION_BACKEND=redis`
- real isolated PostgreSQL/Redis endpoints from the live gate
- `SCENESHOP_MEMORY` explicitly removed

`/api/ready` must report PostgreSQL and Redis authority before the smoke is accepted.

## 5. Connected CI execution
`.github/workflows/v0.17-foundation-gate.yml` provisions PostgreSQL 16 and Redis 7.4 and executes, in order:

1. `npm ci`
2. `npm run preflight:rc`
3. `npm test`
4. `npm run test:api`
5. `npm run validate:live`

Only a successful connected run closes the live-service gate. A local mock or memory backend must never be reported as equivalent.

## Advancement policy
`v0.17.0-alpha.2` remains blocked until this gate is green. Once green, the lock/tree and live PostgreSQL/Redis foundation become the new trusted baseline for all later SceneShop revisions.
