# SceneShop — PostgreSQL Content & Commerce Track Authority R0.1

**Baseline:** `v0.9.0-alpha.6`  
**Status:** canonical implementation note

## 1. Purpose

From alpha.6 onward PostgreSQL is the authoritative store for SceneShop content metadata: works, products, tracks, scenes and scene-product links. The legacy snapshot remains a compatibility read model for modules that have not yet migrated, but it is no longer allowed to delete or overwrite authoritative content rows.

SceneShop does **not** become a video host. A source video may be uploaded or otherwise made available temporarily for processing, scene analysis, fingerprint generation and thumbnail extraction. Playback remains on a content-owner page, an external platform, or an embedded partner application.

## 2. Content identity

A work has a SceneShop-owned `sync_id`, independent of YouTube, Instagram, TikTok or any partner player identifier. External playback bindings map those platform identifiers to the same SceneShop work.

This lets the same audiovisual content share one governed Commerce Track across multiple playback environments.

## 3. Authoritative tables

The authoritative content write model uses:

- `sceneshop_works`
- `sceneshop_products`
- `sceneshop_tracks`
- `sceneshop_track_scenes`
- `sceneshop_scene_products`
- `sceneshop_work_partners`

The compatibility projector may bootstrap rows that do not exist, using `ON CONFLICT ... DO NOTHING`, but it does not truncate or rewrite these tables.

## 4. Official track → Commerce Track publication

An active official track can be materialized as a versioned Commerce Track publication:

`Official Track → CommercialAsset → Placement → CommerceTrackPublication → CommerceTrackEntry`

Each publication receives a monotonically increasing revision per work. The previous published revision is retired; its rows remain available for audit. Placements are revision-specific so temporal history is not rewritten when a later track revision changes.

Legacy catalog products are bridged into `sceneshop_commercial_assets` through the new `product_id` relation. This is a migration seam, not a requirement that future AI-discovered commercial assets always have a catalog product.

## 5. Commerce Timeline API model

The published timeline exposes commercial scenes rather than every cinematic cut. A scene entry includes:

- commercial start/end time;
- scene thumbnail when permitted;
- source scene identifier;
- one or more commercial assets/products;
- placement priority and policy;
- publication revision and timeline policy.

Prices and marketplace destinations are deliberately **not frozen into the temporal track**. They are resolved by the Commerce layer from the offer/provider configuration so price, stock or routing may change without reprocessing the video.

## 6. Synchronization contract

`sync_id` identifies the audiovisual content for Companion synchronization. Fingerprints generated later by the Sync pipeline map an observed sample to:

- `work_id`;
- `sync_id`;
- playback position;
- confidence.

The Commerce Timeline is then resolved from the same `work_id` independently of the external playback platform.

## 7. Compatibility rules

During v0.9:

1. the snapshot is still updated after authoritative domain commits so unmigrated modules continue to function;
2. PostgreSQL content rows are never overwritten by a stale projector snapshot;
3. public and Studio content reads use the authoritative repository when PostgreSQL is active;
4. file/memory mode keeps the legacy synchronous path for development and regression tests.

## 8. Open gates after alpha.6

- execute the full migration chain against a live PostgreSQL daemon;
- make community voting/report/moderation PostgreSQL-authoritative;
- migrate partner/work access control away from snapshot state;
- resolve external offers dynamically into Commerce Timeline responses;
- implement the Sync Engine and Redis-backed realtime session authority.
