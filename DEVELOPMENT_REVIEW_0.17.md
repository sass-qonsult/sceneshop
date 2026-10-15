# SceneShop Development Review — v0.17

## v0.17.0-alpha.1 — Scale & Reliability Foundation

Status: implemented and deterministically validated within the dependency-constrained build environment.

### Scope
- PostgreSQL transactional outbox upgraded to a leased multi-worker queue.
- `FOR UPDATE SKIP LOCKED` concurrent claiming.
- bounded exponential retry and durable dead-letter state.
- worker heartbeat authority and queue-health reporting.
- standalone outbox delivery worker with HTTP(S) publisher and optional HMAC body signature.
- W3C Trace Context continuation with per-request local spans.
- AsyncLocalStorage trace propagation for structured operational logs.
- in-process counters/gauges/latency summaries.
- moderator-protected `/api/ops/status` surface.
- public readiness/health now include a sanitized operations component.

### Persistence
Migration `0026_scale_reliability_foundation.sql` extends the existing transactional outbox and adds `sceneshop_worker_heartbeats`.

### Delivery doctrine
Outbox delivery is at-least-once. Event ID is the downstream idempotency key. No event is marked published before a successful downstream 2xx response; exhausted retries become dead letters.

### Validation
- all repository JS/MJS syntax checks PASS;
- Scale/Reliability + release-preflight focused suite: 9/9 PASS;
- broad dependency-light regression: 133/133 PASS;
- migration manifest: 26 contiguous migrations, latest `0026_scale_reliability_foundation.sql`;
- local non-strict release preflight: PASS;
- `git diff --check`: PASS.

At the alpha.1 freeze, the full package suite was not reported as PASS because `npm ci` could not complete in the sandbox and the inherited lock still lacked the PostgreSQL/Redis production closure. Alpha.1.1 below corrects the repository-side dependency defect; live PostgreSQL/Redis execution remains separately required.

### Next alpha
`v0.17.0-alpha.2` will address cache policy/invalidation, horizontal-scale coordination and disaster-recovery/runbook verification. No RC promotion occurs until the inherited exact npm/PostgreSQL/Redis live gates are satisfied.

## v0.17.0-alpha.1.1 — Foundation Gate Closure / Dependency Reproducibility

Status: dependency gate corrected and deterministically validated; live-service execution remains mandatory before alpha.2.

### Why this patch exists
The alpha.1 implementation exposed an inherited release risk: `package.json` declared PostgreSQL/Redis runtime dependencies while the lockfile did not contain their complete install graph. Advancing feature work with that mismatch could make a later clean install fail or resolve a different dependency tree.

### Corrections
- exact lock graph added for `pg@8.23.1`, `redis@6.3.0` and `@socket.io/redis-adapter@8.3.0`, including required transitive packages and SHA-512 integrity metadata;
- conflicting historical `debug`/`ms` versions are preserved correctly through nested adapter dependencies rather than overwritten;
- runtime engine aligned to Node >=20; operational baseline remains Node 22 (`.nvmrc` / Dockerfile);
- strict release preflight now validates exact critical versions, package integrity presence and the entire transitive dependency closure;
- `npm ci --dry-run --offline` accepts the committed tree without requiring new resolution;
- v0.17 foundation CI gate provisions PostgreSQL 16 and Redis 7.4 and runs exact install, regression, HTTP integration and the live harness;
- live harness now validates PostgreSQL migrations/restart/optimistic concurrency, Redis TTL/viewer isolation/PubSub, concurrent outbox leasing/dead-letter and a production-configured application smoke test;
- the production smoke child explicitly removes `SCENESHOP_MEMORY`, preventing a CI test override from masquerading as a PostgreSQL/Redis live pass.

### Local validation
- strict RC preflight: PASS;
- critical lock closure: complete, no unresolved dependencies;
- npm offline clean-install dry run: PASS;
- release-preflight + Scale/Reliability focused tests: 12/12 PASS;
- broad dependency-light regression: 136/136 PASS;
- JS/MJS syntax, foundation-gate shell syntax and `git diff --check`: PASS;
- real offline `npm ci` reaches `ENOTCACHED` only because this sandbox lacks package tarballs; no dependency-resolution error is reported by the lock dry-run.

### Advancement rule
No `v0.17.0-alpha.2` feature work is accepted until the connected foundation runner executes `npm ci`, the full regression/HTTP suites and `npm run validate:live` successfully against real PostgreSQL and Redis. This sandbox cannot honestly claim the live-service portion because PostgreSQL/Redis daemons and registry network access are unavailable here.

## v0.17.0-alpha.2-dev.1 — Distributed Cache / Coordination / Recovery Candidate

Status: implemented on an isolated development branch and deterministically validated. **Not promoted to `v0.17.0-alpha.2`** because the connected foundation/live runner remains unavailable in this execution environment.

### Scope
- Redis-backed cache coordinator for production with memory-only development fallback;
- namespace-generation cache keys and O(1) distributed invalidation;
- external-offer cache moved away from process-local-only authority;
- product create/update invalidates the offer namespace;
- token-safe Redis distributed leases (`SET NX PX` + compare-and-delete release);
- Redis instance heartbeats and cache status in readiness/health/ops surfaces;
- migration `0027_cache_coordination_recovery.sql` with durable PostgreSQL recovery checkpoints;
- recovery checkpoint/restore verification tooling comparing revision, SHA-256, migration head and critical durable-table counts;
- live harness extended to prove two-instance cache sharing, invalidation and lease exclusivity when real Redis is available.

### Deterministic validation
- focused alpha.2 + release-preflight suite: **14/14 PASS**;
- executable regression excluding the two files that import missing `express` in this sandbox: **144/144 PASS**;
- full `npm test`: **144 PASS / 2 process failures**, both caused by `MODULE_NOT_FOUND: express`, matching the inherited sandbox package-install limitation rather than a test assertion/regression;
- strict release preflight: **PASS**;
- migration manifest: **27 contiguous migrations**, latest `0027_cache_coordination_recovery.sql`;
- JS/MJS syntax scan: PASS;
- `git diff --check`: PASS.

### Promotion rule
The candidate remains development-only until the live foundation runner completes `npm ci`, full regression/HTTP checks, PostgreSQL/Redis live validation and a real PostgreSQL backup→restore→`recovery:verify` drill. Redis remains explicitly non-durable/rebuildable.

## v0.17.0-alpha.2-dev.2 — Automated Backup / Restore / Fresh-Redis Gate

Status: recovery-runbook automation implemented and deterministically validated. **Still not promoted to `v0.17.0-alpha.2`** until the composite gate runs successfully on a connected Docker runner.

### Scope
- one-command composite gate: `npm run gate:alpha2`;
- isolated recovery topology with primary PostgreSQL/Redis, restore PostgreSQL and brand-new non-persistent Redis;
- deterministic seed helper for an otherwise empty recovery-gate database;
- durable checkpoint creation immediately before infrastructure backup;
- real PostgreSQL custom-format `pg_dump` and isolated `pg_restore` path;
- checkpoint manifest verification against the restored database;
- restored-application smoke that requires Redis `DBSIZE=0` before startup and proves `/api/ready` on restored PostgreSQL + fresh Redis;
- SHA-256 + byte-size evidence for the backup artifact and JSON recovery evidence bound to the Git commit;
- dedicated GitHub Actions definition `v0.17-alpha2-gate.yml` that uploads recovery evidence.

### Deterministic validation
- alpha.2 focused suite: **12/12 PASS**;
- release + Scale/Reliability focused suite: **24/24 PASS**;
- full dependency-constrained `npm test`: **148 PASS / 2 process failures**, both exactly `MODULE_NOT_FOUND: express` from the sandbox package-install restriction (`privacy-security.test.js` and `unit.test.js`);
- strict preflight: **PASS**;
- migration manifest: **27 contiguous migrations**, latest `0027_cache_coordination_recovery.sql`;
- shell syntax for foundation/recovery/composite runners: PASS;
- JS syntax for recovery helpers: PASS.

### Promotion boundary
The repository now contains the complete executable alpha.2 acceptance path, but no live PASS is claimed locally. Promotion requires `npm run gate:alpha2` to finish successfully on a connected runner and preserve its generated recovery evidence artifact.

## v0.17.0-alpha.2 promotion candidate — Same-Commit Release Governance

Status: release-governance path implemented. Package version is staged as `0.17.0-alpha.2`, but **the official tag is intentionally withheld** until same-commit live evidence exists.

### Scope
- foundation gate now emits durable JSON evidence with Git commit, package version, lockfile SHA-256, Node runtime and migration head;
- recovery evidence now records the package version in addition to commit, checkpoint, backup hash/bytes and fresh-Redis restore smoke;
- release verifier `npm run release:verify` requires both PASS evidence files to match the exact current Git commit and candidate package version;
- stale evidence, missing version metadata, dirty worktree or preflight drift blocks promotion;
- release manifest records dependency-lock hash, migration head/checksum and gate evidence under `artifacts/release-gate/`;
- dedicated `.github/workflows/v0.17-release-gate.yml` executes the complete alpha.2 live gate before same-commit promotion verification;
- no `v0.17.0-alpha.2` tag and no `release/v0.17` freeze are created by this preparation step.

### Deterministic validation
- release/scale/governance focused suite: **30/30 PASS**;
- dependency-constrained regression excluding the two `express` import files: **154/154 PASS**;
- full `npm test`: **154 PASS / 2 process failures**, both the known `MODULE_NOT_FOUND: express` sandbox limitation;
- strict preflight: PASS with 27 contiguous migrations;
- workflow YAML and shell/JS syntax checks: PASS;
- local release manifest correctly reports `eligible=false` because this sandbox has no live foundation/recovery evidence.

### Promotion rule
Only `eligible=true` from `npm run release:verify`, generated after `npm run gate:alpha2` on the same commit, authorizes the official alpha.2 tag and `release/v0.17` freeze.

## v0.17.0-alpha.2 RC preparation — Guarded Promotion Automation

Status: feature scope and deterministic release preparation complete. Official promotion remains gated exclusively by same-commit live foundation/recovery evidence.

### Closure
- package remains staged at `0.17.0-alpha.2`;
- README and release notes now describe the promotion-candidate boundary rather than the earlier `dev.2` checkpoint;
- `npm run release:promote:dry` produces the exact promotion plan without mutating Git refs;
- `npm run release:promote` is fail-closed and creates only `release/v0.17` plus annotated tag `v0.17.0-alpha.2` after the release manifest is eligible;
- existing branch/tag refs pointing elsewhere are treated as conflicts rather than overwritten;
- post-promotion verification requires both refs to resolve to the exact eligible commit.

### Final boundary
No additional v0.17 feature work is planned. Once the connected runner produces PASS foundation and recovery evidence for this exact candidate commit, the guarded promotion command is the only remaining action required to freeze `release/v0.17`.

### Deterministic closure validation
- release/scale/governance focused suite: **32/32 PASS**;
- dependency-constrained executable regression: **156/156 PASS**;
- full `npm test`: **156 PASS / 2 process failures**, both unchanged `MODULE_NOT_FOUND: express` due the sandbox package-install restriction;
- strict release preflight: PASS;
- migration chain: **27/27**, latest `0027_cache_coordination_recovery.sql`;
- guarded promotion dry-run correctly refuses the current environment before live evidence;
- JS syntax and `git diff --check`: PASS.
