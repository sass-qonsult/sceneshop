# SceneShop Development Review — v0.15

## v0.15.0-alpha.1 — Studio AI & Publication Workspace

Status: implemented and locally validated.

### Scope
- New `IA & Publicação` Studio surface.
- Aggregate tenant-scoped endpoint `GET /api/ai/workspace?workId=...`.
- Governed launcher for TARGETED / DISCOVERY / HYBRID analysis.
- Operational KPI view for assets, detections, flags and placements.
- Persistent review board showing frozen primary fingerprint, redundant verification state and operator flag.
- Human approve/reject actions mapped to the canonical v0.14 review endpoints.
- Approved Placement view and published Commerce Timeline preview.
- Existing track editor preserved for detailed timeline authoring.

### Validation
- 158/158 unit/contract tests PASS.
- HTTP integration expanded with the AI workspace aggregation checks.
- No new database migration required in alpha.1; v0.15 consumes the canonical v0.14 domain.

### Next alpha
v0.15.0-alpha.2 will complete the consumer/Companion experience on top of `mobile-core`: missed commercial scenes, explicit Live/Browsing state, deep-link/share continuity and persistent per-device browsing state.

## v0.15.0-alpha.2 — Consumer / Companion UX

Status: implemented and locally validated.

### Scope
- Commerce Timeline replaces raw cinematic-scene navigation in the consumer surface.
- Shared browser/native `CompanionState` core.
- Per-device persistent `LIVE/BROWSING` continuity.
- Producer spoiler policy (`PAST_ONLY / PAST_AND_CURRENT / FULL`) applied to visible commercial scenes.
- “Enquanto você explorava” shelf records commercial scenes crossed while Browse Head is detached from Playback Head.
- Explicit `Go Live` vs `Re-sync` semantics.
- Dynamic Commerce Core resolution at interaction time; SceneShop activation URL is used before redirect.
- Studio exposes timeline policy controls for thumbnails, missed-items behavior and integrated-player seek.
- Service-worker cache updated for the shared mobile core.

### Validation
- 164/164 unit/contract tests PASS.
- 105 HTTP integration checks PASS.
- RC hardening adds migration `0023_campaign_assets_commerce_timeline.sql` so campaigns and routing policies can target CommercialAsset directly, before a canonical Product exists.

### Release status
No alpha.3 is planned. `release/v0.15` is prepared from `v0.15.0-alpha.2`; post-alpha.2 RC hardening is confined to the release branch and the RC tag remains blocked until inherited external live gates pass.


## release/v0.15 — RC hardening

Status: locally validated; RC tag not created.

### Hardening completed
- `CommercialAsset`-only campaigns are first-class: a campaign may govern `assetIds` without requiring `productIds`.
- external offers and routing policies may target a CommercialAsset directly, with tenant validation.
- PostgreSQL migration `0023_campaign_assets_commerce_timeline.sql` adds `sceneshop_campaign_assets` and asset-scoped routing.
- Companion LIVE state explicitly clears the current commercial scene while the Playback Head crosses a gap with no placement, preventing stale products/offers from being presented as live.

### Validation
- 164/164 unit/contract/regression tests PASS.
- 105/105 HTTP integration checks PASS.
- 23 contiguous migrations PASS.
- local release preflight PASS; strict RC remains intentionally blocked by the inherited exact npm lock/live PostgreSQL+Redis gates.
