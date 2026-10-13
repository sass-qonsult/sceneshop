# SceneShop — Cache, Horizontal Coordination & Recovery R0.1

Version line: **v0.17.0-alpha.2-dev.2**

## Purpose

This increment extends the Scale & Reliability line without changing SceneShop business authority. PostgreSQL remains the durable system of record. Redis is explicitly **ephemeral** and may be discarded/rebuilt after an outage or restore.

The increment addresses three operational hazards that appear when the web tier has more than one process/host:

1. process-local caches diverging across instances;
2. multiple instances running the same singleton/rebuild operation concurrently;
3. backup/restore claims being accepted without a reproducible verification checkpoint.

## Distributed cache policy

Production uses `CACHE_BACKEND=redis`; development may use the in-memory coordinator.

Cache keys are generation-scoped:

`namespace → epoch → SHA-256(logical key)`

Invalidation increments the namespace epoch and publishes a Redis invalidation event. Old generations are never scanned synchronously; they expire through TTL. This makes invalidation O(1) with respect to the number of cached objects and prevents one instance from continuing to serve a process-local generation after another instance changes governed data.

The first integrated cache is the legacy external-offer lookup. Product creation/update invalidates the `offers` namespace. `OFFER_CACHE_TTL_MS` controls the TTL and defaults to the previous one-hour behavior.

Redis cache loss is not data loss. The next read is a miss and SceneShop rebuilds the cached value from the underlying provider/domain path.

## Horizontal coordination

`RedisCacheCoordinator.acquireLease()` uses Redis `SET NX PX` with a random ownership token. Release is compare-and-delete through a Lua script, so an expired lease cannot be deleted by the previous owner after a new owner acquires it.

The coordinator also publishes instance heartbeats in a Redis sorted set. `/api/ready`, `/api/health` and moderator `/api/ops/status` expose sanitized cache/coordination state, including active instance count.

Outbox delivery remains coordinated independently through PostgreSQL `FOR UPDATE SKIP LOCKED`; Redis leases are not used to weaken that database authority.

## Recovery checkpoints

Migration `0027_cache_coordination_recovery.sql` adds `sceneshop_recovery_checkpoints`.

A checkpoint records:

- current SceneShop snapshot revision;
- SHA-256 of the compatibility snapshot payload;
- latest applied migration;
- PostgreSQL WAL LSN at capture time;
- counts of critical durable tables;
- operator metadata and later verification evidence.

Create a checkpoint immediately before the external backup operation:

`npm run recovery:checkpoint`

The resulting checkpoint ID must be present in the restored database. After restoring the backup into an isolated PostgreSQL target, verify it with:

`RECOVERY_DATABASE_URL=... npm run recovery:verify -- --verify=<checkpointId>`

Verification compares the restored revision, snapshot SHA-256, migration head and critical-table counts against the checkpoint manifest. Drift marks the checkpoint `FAILED`; exact agreement marks it `VERIFIED`.

This tool **does not create the PostgreSQL backup** and must not be presented as one. It is the SceneShop verification seam around the infrastructure backup/restore process.

## Redis disaster-recovery doctrine

Redis is deliberately excluded from the durable backup contract. After a disaster/restore:

- playback/session state may be lost and clients reconnect/re-pair;
- cache generations are rebuilt on demand;
- instance presence and distributed leases naturally expire;
- Socket.IO nodes reconnect to the restored/new Redis service.

Durable publication, commerce, financial, audit, identity, privacy and AI evidence remain PostgreSQL responsibilities.

## Acceptance boundary

Deterministic tests may prove cache-generation logic, token-safe lease semantics and recovery-manifest comparison. They cannot prove Redis networking, PostgreSQL restore behavior, multi-host timing or backup infrastructure.

Promotion to `v0.17.0-alpha.2` therefore still requires the connected foundation/live runner plus a real restore verification using an isolated PostgreSQL restore target.


## Automated recovery gate

`npm run gate:recovery` provisions an isolated recovery topology, seeds the primary database if needed, creates a durable checkpoint, captures a custom-format PostgreSQL backup, restores it into a separate PostgreSQL service, verifies the checkpoint manifest, and finally boots SceneShop against the restored database with a brand-new empty Redis.

`npm run gate:alpha2` composes the foundation gate and this recovery gate. It is the only accepted one-command path for promoting the alpha.2 candidate. Successful execution emits SHA-256-bound JSON evidence under `artifacts/recovery-gate/`.
