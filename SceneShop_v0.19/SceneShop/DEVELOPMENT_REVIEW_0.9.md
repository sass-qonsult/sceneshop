# RC preparation after Alpha.8 — authoritative content cleanup

After freezing `v0.9.0-alpha.8`, a final multi-node review found two stale content read paths that still bypassed PostgreSQL authority: producer official-offer authorization/listing and the AI Studio work/inventory lookup. Both now use the content repository in PostgreSQL mode, with the local state/catalog retained only as the memory/demo fallback.

The PostgreSQL content repository adds authoritative product-ownership queries covering both products created by the producer and products present in that producer's active official tracks. This prevents a stale Node snapshot from granting or denying offer-management access after another process changes content.

AI work lookup and producer inventory lookup are also repository-backed, preserving the same content authority used by Studio and Commerce Track publication.

Validation after this cleanup: **91/91 Node tests PASS**, syntax PASS, and HTTP smoke PASS for liveness/readiness, producer login, official-offer listing and AI status. This is a develop-only RC-preparation commit; `v0.9.0-RC.1` remains intentionally untagged until the complete npm lockfile and real PostgreSQL + Redis validation gates pass.

Canonical detail: `docs/data/RC_PREPARATION_R0_1.md`.

# Alpha.8 — Release Validation / Viewer-State Authority

**Version:** `v0.9.0-alpha.8`

**Deterministic regression:** 89/89 PASS

## What alpha.8 closes

- Browse Head is no longer modeled as one global property of a playback session; PostgreSQL now has `sceneshop_playback_viewers(session_id, device_id, ...)`.
- Redis and PostgreSQL agree on the per-viewer `LIVE/BROWSING` model.
- `commerce:browse` and `commerce:live` persist low-frequency viewer checkpoints durably without moving the shared Playback Head.
- Migration files are validated as a contiguous SHA-256 manifest.
- PostgreSQL health detects applied/expected migration drift.
- `npm run preflight` and strict `npm run preflight:rc` make release blockers machine-visible.
- `npm run validate:live` provides the PostgreSQL+Redis integration harness needed before RC.

## RC blockers still open

The current sandbox has no PostgreSQL/Redis/Docker and outbound npm/apt installation times out. Therefore the following are **not** marked complete:

1. live PostgreSQL migration/application test;
2. live Redis TTL/restart/PubSub test;
3. complete regenerated npm lock tree for `pg`, `redis`, `@socket.io/redis-adapter`.

The strict RC preflight fails intentionally until those gates are satisfied. No simulated PASS is accepted.

---

# Alpha.7 — Redis / Realtime / PlaybackSession Authority

**Version:** `v0.9.0-alpha.7`
**State schema:** v10 (no compatibility-state migration required)
**Regression:** 84/84 unit/data tests PASS

### Implemented

- Redis-backed operational authority for short-lived playback/pairing sessions.
- Redis sets for admitted audience devices and active phone presence.
- Per-device Commerce browsing state: one viewer's Browse Head no longer changes another viewer or the shared Playback Head.
- `LIVE` / `BROWSING`, `commerce:browse` and `commerce:live` realtime semantics.
- Companion-only `sync:resync` semantics with confidence and durable PostgreSQL observation seam.
- Socket.IO Redis adapter integration for multi-node room broadcasts when `SESSION_BACKEND=redis`.
- Production configuration now requires `SESSION_BACKEND=redis` and `REDIS_URL`.
- `/api/ready` and `/api/health` include Data Plane + Redis session authority + Socket.IO adapter readiness.
- Current mobile second-screen restores per-viewer browsing state and reports Browse/Live transitions without moving the primary video.
- `docs/data/REDIS_REALTIME_AUTHORITY_R0_1.md` freezes the hot-state/durable-state boundary.

### Still open

- Live PostgreSQL + Redis execution/failover remains the alpha.8 external validation gate.
- The npm registry is unavailable in this build environment, so the lock graph for `redis`, `pg`, and `@socket.io/redis-adapter` still requires regeneration/freeze in a registry-enabled environment.
- Browser/device E2E suite remains a release-candidate gate.

---

# SceneShop — Development Review v0.9.0-alpha.4

Status: **DATA PLANE FOUNDATION — IN PROGRESS**  
Parent baseline: `v0.8.0`  
Branch: `feature/v0.9-data-plane`

## Goal of v0.9

Move SceneShop away from direct whole-process dependence on `data/runtime.json` and toward transactional PostgreSQL persistence, Redis-backed realtime state, domain repositories and horizontally scalable deployment while preserving the working v0.8 product flows.

This alpha is not the final `v0.9.0` release.

## Data Plane work completed through alpha.4

### 1. Node/PostgreSQL/Redis reproducible topology

Added:

- `.nvmrc` with Node major 22;
- `Dockerfile` using Node 22;
- `compose.yaml` with SceneShop + PostgreSQL 16 + Redis 7.4;
- development-only persistent volumes and health checks;
- `REDIS_URL` / `SESSION_BACKEND` configuration seam.

Redis is now authoritative for realtime playback/second-screen sessions when `SESSION_BACKEND=redis` (alpha.7).

### 2. PostgreSQL driver/runtime manifest

The project manifest now declares `pg` and `redis`. The current execution sandbox cannot access the npm registry, so their full transitive lock graph could not be regenerated or installed here. Final v0.9.0 keeps dependency locking as a release gate.

### 3. Auditable runtime importer

Added `tools/import-runtime.js` and `server/data/runtime-import.js`.

The importer:

- validates compatible state schema/version;
- computes SHA-256 over source bytes;
- reports domain counts before migration;
- supports dry-run;
- refuses implicit replacement of a populated destination;
- verifies destination state after import;
- records a PostgreSQL import manifest when the PostgreSQL adapter is used.

Dry-run against the current repository runtime: PASS.

### 4. Snapshot optimistic concurrency

Migration `0002_snapshot_revision_and_imports.sql` adds a monotonic `revision` to the transitional PostgreSQL snapshot.

Writes use compare-and-swap semantics. A stale writer receives `SCENESHOP_CONCURRENT_WRITE` instead of silently overwriting a newer snapshot.

This is a transitional guard. The first transaction-critical domain (official order confirmation/refund) now has a native PostgreSQL transaction path; additional domains still need migration before final v0.9.0.

### 5. First domain repository seam — Identity

Authentication no longer reaches directly into `state.accounts/state.authors` for its principal account operations.

Added `StateIdentityRepository`, covering:

- normalized username lookup;
- account lookup;
- author lookup;
- duplicate identity check;
- account+author creation boundary;
- token-version invalidation.

The backing store remains the compatibility state object in this alpha. The purpose is to establish the domain seam that can later be replaced by a PostgreSQL identity repository without rewriting auth behavior.

### 6. Separate liveness and readiness

Added:

- `GET /api/live` — process liveness;
- `GET /api/ready` — Data Plane readiness;
- existing `GET /api/health` remains combined status.

### 7. Data Plane runbook

Added `docs/data/DATA_PLANE_RUNBOOK_R0_1.md` covering local operation, container topology, runtime migration and remaining v0.9 gates.

## Validation performed

- Full current unit/data suite: **89/89 PASS**.
- Existing v0.8 functional unit coverage remains green.
- File persistence round-trip and atomic replacement: PASS.
- Runtime importer round-trip/overwrite guard: PASS.
- Identity repository tests: PASS.
- PostgreSQL optimistic-revision behavior with deterministic adapter fakes: PASS.
- `runtime.json` dry-run: PASS.
- `/api/live`: HTTP 200 in file-backend smoke test.
- `/api/ready`: HTTP 200 with initialized file Data Plane.
- Syntax check across server/tools/tests: PASS.

### Current runtime dry-run

Source SHA-256: `4c8d6b8480e3a75af79cb01e80843da2a4221b82927e67b6849e31572585c4d7`

Detected state summary:

- accounts: 5
- authors: 4
- tracks: 3
- partners: 2
- sellers: 6
- official offers: 6
- clicks: 9
- sales: 9
- orders: 0
- audit entries: 3

## Explicitly not claimed as validated

A real PostgreSQL server and Redis server are not installed in the execution environment used for this alpha, and Docker is unavailable here. Therefore:

- migrations have not yet been executed against a live PostgreSQL server;
- the `pg` runtime path is not declared live-validated;
- the compose stack is source-reviewed but not executed here;
- the npm transitive lock graph for the newly declared drivers remains to be regenerated in a registry-enabled environment.

## Canonical product architecture preserved

`docs/architecture/SCENESHOP_COMMERCE_TRACK_R0_1.md` remains authoritative for:

- Commerce Track;
- PARTNER_NATIVE / COMPANION / EMBEDDED distribution;
- TARGETED / DISCOVERY / HYBRID analysis;
- inventory-first detection;
- optional full-video discovery;
- `DETECTED -> REVIEWED -> APPROVED -> PUBLISHED` lifecycle;
- isolated redundant visual verification;
- operator flags on conflict/no-match/inconclusive;
- separate cinematic, commercial and campaign windows.

## Remaining v0.9 gates before final v0.9.0

1. Run migrations/import against real PostgreSQL and validate restart/recovery.
2. Regenerate/freeze the complete npm lock graph.
3. **DONE in alpha.5.1:** author/KYC profile authority migration; account authentication + KYC are PostgreSQL-native write/read paths.
4. Move content/tracks to domain repositories.
5. Extend the new native commerce transaction model to payout/withdrawal and remaining ledger writes; remove whole-state financial projection as an authority path.
6. **DONE in alpha.7:** Redis realtime/playback authority plus multi-node Socket.IO coordination.
7. **DONE in alpha.8 (code/harness):** per-viewer durable Browse Head, migration drift checks and automated release/live validation harness.
8. **RC gate:** execute the harness against real PostgreSQL+Redis and regenerate a complete npm lock tree.
8. Restore/lock complete E2E dependencies and run the browser/device suite.

Only after these gates pass should the branch be promoted and tagged `v0.9.0`.


## Alpha.3 — PostgreSQL Relational Core

The PostgreSQL backend is now a concrete relational data model rather than only a JSON snapshot adapter. Migrations `0003_relational_core.sql` and `0004_commerce_track_foundation.sql` create relational tables for identity, content/tracks, commerce, orders, sales, audit/compliance, and the future SceneShop Commerce Track.

When PostgreSQL is selected, snapshot persistence and relational projection now occur in the same database transaction. The snapshot remains a compatibility layer while v0.8 synchronous modules are migrated to domain repositories. A successful projection also writes a `state.projected` outbox event.

The Commerce Track schema encodes the agreed TARGETED / DISCOVERY / HYBRID analysis modes and keeps primary identification physically separate from redundant verification and operator flags. Detection does not imply publication.

Validation after alpha.3: **50/50 Node tests PASS**. Live execution against a PostgreSQL server remains pending because no PostgreSQL daemon/container runtime is available in the build environment.


## Alpha.4 — PostgreSQL Financial Transactions

Alpha.4 makes PostgreSQL the durability authority for the first critical write path: official seller order confirmation and refund.

### Atomic order confirmation

The PostgreSQL path now writes, in one transaction:

1. seller order;
2. attributed sale;
3. frozen commission split;
4. coupon consumption when applicable;
5. tamper-evident audit entry;
6. compatibility snapshot/revision;
7. `commerce.order.confirmed` outbox event.

The Node in-memory state is replaced only after COMMIT. A failed SQL operation leaves the process state unchanged.

### Financial immutability

Migration `0005_financial_transactions.sql` adds `sceneshop_commissions`. Commission economics are frozen at sale time: gross commission, partner share, owner share, SceneShop share, rates and release time. State schema version advances to **7**, and older sales receive a one-time financial freeze during migration.

This prevents later changes to commercial policy from changing historic sales.

### Cross-process idempotency

`sceneshop_orders` already has primary key `(seller_id, order_id)`; alpha.4 now uses it directly as the SQL idempotency barrier. A duplicate discovered in PostgreSQL does not write a second sale, commission, snapshot revision or outbox event.

### Refund transaction

Refunds now have a PostgreSQL path that locks the order, updates order status, reverses an unpaid sale/commission when applicable, appends audit, updates the snapshot and emits `commerce.order.reversed` atomically.

### Validation

- Complete suite: **54/54 PASS**.
- Frozen-economics regression test: PASS.
- PostgreSQL financial writer contract test: PASS.
- Duplicate-order SQL idempotency test: PASS.
- Domain transaction (write + snapshot + outbox) test: PASS.
- Existing v0.8 behavior: PASS.

Canonical detail: `docs/data/POSTGRES_FINANCIAL_TRANSACTION_R0_1.md`.

Live PostgreSQL execution remains explicitly unclaimed in this environment because a PostgreSQL daemon/container runtime is unavailable.

## Alpha.4.1 — Versioned Commercial Policy

Alpha.4.1 removes the remaining interpretation that example percentages are fixed business rules. All economic percentages are now contractual parameters for future transactions.

A new `commercial-policy` domain service maintains versioned terms. Each sale freezes `policyId`, `policyVersion`, seller commission rate, partner/channel rate, content-owner split and the resulting monetary amounts. Historical sales are never recalculated when a new policy is created.

Offer-specific commission remains the highest-priority term, so different sponsors/sellers can use different rates in the same work. Seller-agreement terms can override selected defaults, followed by the active policy. The Studio offer commission control now accepts 0–100% and uses the active policy as its default rather than a hard-coded 10% UI value.

Migration `0006_commercial_policies.sql` adds PostgreSQL policy history and policy references to `sceneshop_commissions`. State schema advances to **8**. AML now consumes the frozen owner share instead of recomputing historical commissions with current configuration.

A temporary v0.9 management API exposes policy inspection to producers/moderators and version creation to the internal moderator role; v0.10 must replace this transitional permission with a dedicated commercial/finance role.

Validation after alpha.4.1: **57/57 Node tests PASS**.

Canonical detail: `docs/data/COMMERCIAL_POLICY_R0_1.md`.


## Alpha.5 — PostgreSQL Identity Authority

Alpha.5 makes PostgreSQL authoritative for authentication credentials, roles, account-to-author binding, token version and new login sessions. Migration `0007_identity_authority.sql` adds `sceneshop_auth_sessions` and session indexes.

New bearer tokens carry an opaque `sid`. Request authentication checks the HMAC token and then reads PostgreSQL to confirm the current account `tokenVersion`; tokens with `sid` additionally require an active, unrevoked, unexpired matching session. Tokens issued before alpha.5 do not contain `sid` and are accepted only through the authoritative account/token-version check until their normal TTL expires.

`logout-all` now updates `tokenVersion`, revokes all active sessions, updates the compatibility snapshot and emits `identity.tokens.revoked` through the domain transaction path. Signup uses the normalized identity tables with the database uniqueness constraint as the final cross-process duplicate barrier.

The generic relational projector no longer deletes or updates existing `sceneshop_accounts`; it may only bootstrap a missing account. This is a critical multi-node safety property: stale compatibility state cannot roll back credentials or token revocation. Author/KYC fields remain compatibility-projected temporarily and are an explicit remaining gate.

Validation after alpha.5: **62/62 Node tests PASS**, including PostgreSQL identity mapping, authoritative account reads, session persistence contract, logout-all revocation contract and projector non-overwrite protection.

Canonical detail: `docs/data/POSTGRES_IDENTITY_AUTHORITY_R0_1.md`. Live PostgreSQL execution remains explicitly unclaimed in this environment because no PostgreSQL daemon/container runtime is available.


## Alpha.5.1 — PostgreSQL Author/KYC Authority + Distribution/Sync Foundation

Alpha.5.1 completes the planned Author/KYC authority seam and freezes the newly agreed distribution architecture in the relational model before Content/Tracks are migrated.

### Author/KYC authority

Migration `0008_author_kyc_authority.sql` adds `sceneshop_author_kyc`. Raw CPF/CNPJ values are not stored; the authority table stores a keyed document hash, masked document, legal name, PF/PJ type, PEP declaration, workflow status and submission/review metadata. `document_hash` is unique and therefore becomes the cross-process duplicate-identity barrier.

KYC submission and compliance decision are domain transactions that update the authority row, public author status, tamper-evident audit chain, compatibility snapshot and outbox together. The generic projector may only bootstrap missing author/KYC rows and uses `ON CONFLICT DO NOTHING`; stale compatibility state cannot roll back KYC decisions.

`/api/me/ledger`, withdrawal eligibility and `/api/aml/kyc` now resolve KYC through the authoritative repository when PostgreSQL is active. AML alert storage itself remains a later Data Plane migration and is not claimed PostgreSQL-authoritative here.

### Distribution / synchronization / commerce foundation

Migration `0009_distribution_commerce_sync_foundation.sql` materializes the frozen product architecture:

- three official modes: `PARTNER_NATIVE`, `COMPANION`, `EMBEDDED`;
- platform-neutral playback bindings (YouTube/Instagram are Tier-1 external targets; TikTok fits the same adapter contract);
- Sync ID + temporal fingerprint metadata without storing audiovisual blobs;
- universal Playback Head / Browse Head split and `LIVE/BROWSING` state;
- Commerce Timeline visibility policy: `PAST_ONLY`, `PAST_AND_CURRENT`, `FULL`;
- playback/sync observations for Companion re-lock;
- commerce-provider abstraction, merchant connections, external offers and routing policy independent of the playback platform.

SceneShop is explicitly not modeled as a permanent video host. Producer-uploaded/source media may be used transiently for analysis/fingerprint generation, while playback remains on the content owner's site/app or an external platform.

Canonical detail: `docs/architecture/SCENESHOP_DISTRIBUTION_SYNC_COMMERCE_R0_2.md` and `docs/data/POSTGRES_AUTHOR_KYC_AUTHORITY_R0_1.md`.

Validation after alpha.5.1: **72/72 Node tests PASS**. HTTP memory-backend smoke test also passed for `login -> submit KYC -> moderator queue -> approve -> ledger reflects approved`. Live PostgreSQL execution remains unclaimed in this environment because no PostgreSQL daemon/container runtime is available.
