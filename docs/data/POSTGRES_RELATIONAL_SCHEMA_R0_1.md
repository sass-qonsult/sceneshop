# SceneShop PostgreSQL Relational Schema R0.1

Status: `v0.9.0-alpha.4`

## Purpose

The v0.9 Data Plane no longer treats PostgreSQL as a future placeholder. PostgreSQL now has a concrete relational model for the current SceneShop product plus a separate foundation for the SceneShop Commerce Track doctrine.

The legacy JSON snapshot remains temporarily as a compatibility read model because several v0.8 modules still mutate synchronous in-memory state. When `DATA_BACKEND=postgres`, a durable flush and its relational projection are committed in the same PostgreSQL transaction. As domain repositories are migrated, the snapshot projection will be removed domain by domain.

## Current relational domains

### Identity

- `sceneshop_authors`
- `sceneshop_accounts`

### Partner/content catalog

- `sceneshop_partners`
- `sceneshop_works`
- `sceneshop_work_partners`
- `sceneshop_products`
- `sceneshop_tracks`
- `sceneshop_track_scenes`
- `sceneshop_scene_products`

### Commerce

- `sceneshop_sellers`
- `sceneshop_official_offers`
- `sceneshop_issued_offers`
- `sceneshop_code_pool`
- `sceneshop_clicks`
- `sceneshop_sales`
- `sceneshop_orders`
- `sceneshop_commissions`

### Trust, compliance and operations

- `sceneshop_reports`
- `sceneshop_alerts`
- `sceneshop_audit_log`
- `sceneshop_events`
- `sceneshop_outbox`

## Commerce Track foundation

The Commerce Track schema is intentionally separate from the old scene-product mapping.

- `sceneshop_commercial_assets`
- `sceneshop_asset_references`
- `sceneshop_analysis_jobs`
- `sceneshop_detection_candidates`
- `sceneshop_redundant_verifications`
- `sceneshop_operator_flags`
- `sceneshop_placements`
- `sceneshop_campaigns`
- `sceneshop_placement_campaigns`
- `sceneshop_commerce_track_publications`
- `sceneshop_commerce_track_entries`

The schema enforces the agreed doctrine:

1. Analysis mode is `TARGETED`, `DISCOVERY`, or `HYBRID`.
2. Primary detection is stored separately from redundant verification.
3. Redundant verification has only corroboration states: `CONFIRMED`, `CONFLICT`, `NO_MATCH`, `INCONCLUSIVE`, `SOURCE_UNAVAILABLE`.
4. Operator flags are first-class records.
5. A detection candidate is not a published placement.
6. A placement is not part of a consumer Commerce Track until a publication revision includes it.

This preserves the sequence:

`DETECTED -> REVIEWED -> APPROVED -> PUBLISHED`

## Transitional projection

`server/data/postgres-projection.js` converts the current state/catalog into relational rows. It is executed inside the same transaction that updates the compatibility snapshot. The projection is currently rebuilt child-first on each durable flush. This is deliberately conservative for correctness during migration and is not the final high-volume write path.

The end-state for v0.9 is to replace this full projection with domain-specific PostgreSQL repositories and atomic write transactions. Alpha.4 has begun that transition: official order confirmation/refund uses a native financial transaction writer while the compatibility snapshot is updated in the same SQL transaction.

## Concurrency and migrations

- Schema migrations are checksummed with SHA-256.
- An advisory lock serializes schema migration execution.
- An advisory transaction lock serializes transitional relational projection.
- The compatibility snapshot retains optimistic `revision` checks, preventing silent last-write-wins.
- Every successful projection emits a `state.projected` outbox event.

## Validation status

The relational mapper, financial writer and compatibility behavior are covered by the Node test suite (54/54 PASS in alpha.4). A live PostgreSQL service was not available in the execution environment used to build alpha.4, so applying migrations to an actual PostgreSQL server remains an explicit validation gate. The repository includes `compose.yaml` with PostgreSQL 16 and Node 22 to make that validation reproducible in an environment with Docker/Podman.


## Commercial policy (alpha.4.1)

Migration `0006_commercial_policies.sql` adds `sceneshop_commercial_policies`, a versioned record of future-facing commercial terms. `sceneshop_commissions` now stores `commercial_policy_id` and `commercial_policy_version` alongside the already frozen numeric rates and amounts.

Commercial policy is mutable only by creating a new version; historical commission rows are immutable.

## Alpha.5 identity authority addendum

Migration `0007_identity_authority.sql` adds `sceneshop_auth_sessions` and makes existing rows in `sceneshop_accounts` authoritative for authentication credentials and `token_version`. The generic snapshot projector no longer deletes or updates existing account rows; it may only bootstrap missing accounts. Explicit runtime replacement remains the only generic operation allowed to replace identity data.

New login tokens include an opaque `sid`. PostgreSQL verifies account version plus active session state, allowing revocation across multiple SceneShop nodes. `sceneshop_authors` remains compatibility-updated for KYC/profile fields until that sub-domain receives its own authority migration.
