# SceneShop v0.17 — Scale & Reliability Release Notes R0.1

## Release boundary

Candidate package: `0.17.0-alpha.2`.

The v0.17 feature scope is code-complete. The official `v0.17.0-alpha.2` tag and `release/v0.17` branch are created only after same-commit live foundation and recovery evidence make the release manifest eligible.

## Delivered scope

### Horizontal delivery workers
- PostgreSQL transactional outbox leasing with `FOR UPDATE SKIP LOCKED`;
- bounded retries, exponential backoff and durable dead-letter state;
- worker heartbeat registry;
- HTTP(S) delivery worker with event-id idempotency key and optional HMAC signature.

### Observability and trace continuity
- W3C `traceparent` continuation;
- AsyncLocalStorage propagation;
- operational counters, gauges and latency summaries;
- protected `/api/ops/status` plus readiness/health integration.

### Distributed cache and coordination
- Redis-backed production cache coordinator;
- namespace-generation invalidation without key scans;
- token-safe distributed leases;
- cache/instance heartbeats;
- production readiness requires PostgreSQL + Redis sessions + Redis cache.

### Disaster recovery
- durable PostgreSQL recovery checkpoints;
- automated checkpoint → `pg_dump` → isolated `pg_restore` → manifest verification;
- restored production smoke with a brand-new empty Redis;
- SHA-256 backup evidence bound to the exact Git commit and package version.

### Release governance
- exact transitive lock verification for critical PostgreSQL/Redis dependencies;
- same-commit foundation and recovery evidence;
- release manifest with fail-closed `eligible` state;
- `npm run release:promote:dry` for audit preview;
- `npm run release:promote` for guarded creation of `release/v0.17` and `v0.17.0-alpha.2`.

## Persistence

Migration chain: 27 contiguous migrations.

Latest migration: `0027_cache_coordination_recovery.sql`.

PostgreSQL remains the durable authority. Redis is operational/reconstructible state and is deliberately not a disaster-recovery authority.

## Promotion sequence

```text
npm run gate:alpha2
        ↓
npm run release:verify
        ↓
eligible=true
        ↓
npm run release:promote:dry
        ↓
npm run release:promote
        ↓
release/v0.17 + v0.17.0-alpha.2
```

Any missing, stale, cross-commit or cross-version evidence blocks promotion.
