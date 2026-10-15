# SceneShop — Scale & Reliability Foundation R0.1

Version line: **v0.17.0-alpha.1**

## Purpose

The v0.17 line begins the Scale & Reliability roadmap step without changing the canonical product model. PostgreSQL remains the durable authority and Redis remains realtime authority. This increment turns the already-transactional PostgreSQL outbox into a horizontally safe delivery queue and adds process-level observability/tracing.

## Transactional outbox worker

Migration `0026_scale_reliability_foundation.sql` extends `sceneshop_outbox` with:

- delivery attempt counter;
- next-attempt timestamp;
- worker lease owner and lease timestamp;
- last error;
- terminal dead-letter timestamp;
- indexes for ready and dead-letter events.

Workers claim rows through `FOR UPDATE SKIP LOCKED`, so several worker processes may poll the same database without delivering the same available row concurrently. A stale lease becomes claimable again after the configured lease interval.

Delivery semantics are **at least once**. Downstream consumers must therefore treat `X-SceneShop-Event-Id` as the idempotency key. A successful 2xx delivery ACKs the row. Failure uses bounded exponential backoff; terminal failures are retained as dead letters rather than discarded.

## Worker heartbeat

`sceneshop_worker_heartbeats` records worker identity, process host/PID, running SceneShop version, metadata and last-seen timestamp. Queue health reports pending/ready/dead-letter counts plus active worker count.

## Event delivery

`npm run worker:outbox` starts a dedicated process. It requires PostgreSQL and `OUTBOX_WEBHOOK_URL`; production requires HTTPS. Optional `OUTBOX_WEBHOOK_SECRET` signs the exact JSON body using HMAC-SHA256 in `X-SceneShop-Signature`.

The web process does not mark outbox events as delivered. Delivery remains isolated in the worker process.

## Observability

SceneShop now continues W3C `traceparent` traces when supplied and creates a new local span for every HTTP request. Responses expose a new `Traceparent` and `X-SceneShop-Trace-Id`. `AsyncLocalStorage` keeps request/outbox trace context available to structured logs.

The in-process metrics registry currently records:

- request count and latency by method/status;
- outbox delivery success/failure by topic;
- handler and worker-tick latency;
- queue batch size;
- process uptime/memory metadata.

`GET /api/ops/status` is moderator-protected and returns operations health plus the in-process metrics snapshot. Public `/api/health` and `/api/ready` expose only the sanitized operations state.

## Reliability boundaries

- A queue backlog or dead letter is operational degradation, not silent data loss.
- PostgreSQL transaction + outbox creation remains atomic.
- External delivery is not declared successful until the destination returns HTTP 2xx.
- Retry does not mutate the original event payload.
- Multiple workers coordinate through database leases instead of process-local locks.
- No live PostgreSQL/Redis/provider PASS is claimed by deterministic tests.

## Next v0.17 increment

Alpha.2 is reserved for cache policy, horizontal-scale coordination, recovery/runbook automation and disaster-recovery verification seams before the v0.17 release line is frozen.
