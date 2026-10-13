# SceneShop v0.15 Release Gate R0.1

The v0.15 implementation is functionally frozen at `v0.15.0-alpha.2`.

## Local gates completed

- 164/164 unit/contract/regression tests PASS.
- 105/105 HTTP integration checks PASS.
- 23 contiguous migrations PASS; latest `0023_campaign_assets_commerce_timeline.sql`.
- local release preflight PASS.
- Studio AI workspace operates on the governed v0.14 domain without rewriting frozen primary evidence.
- consumer surface uses the published Commerce Timeline rather than all cinematic cuts.
- `Playback Head` and per-viewer `Browse Head` remain independent.
- timeline gaps do not falsely present a previous product as live.
- `CommercialAsset`-only placements do not masquerade as `productId` during commerce resolution.
- campaigns, offers and routing policies can govern a `CommercialAsset` directly before a canonical Product exists, with tenant isolation.
- public commerce resolution uses SceneShop activation URLs before merchant redirect.

## v0.15-specific acceptance

- Studio can launch TARGETED / DISCOVERY / HYBRID jobs, review flags and approve/reject placements.
- primary identification fingerprint remains visible and immutable through operator review.
- producer can govern timeline visibility (`PAST_ONLY / PAST_AND_CURRENT / FULL`), thumbnails, missed-items behavior and integrated-player seek policy.
- Companion preserves per-device `LIVE/BROWSING` state.
- `Go Live` moves only the Browse Head; `Re-sync` performs a new Companion recognition.
- “Enquanto você explorava” records commercial scenes crossed while the user is browsing an earlier placement.
- dynamic product/offer resolution occurs at interaction time, not in the time-coded track.
- periods without an active commercial placement display no false live offer.

## Required before `v0.15.0-RC.1`

1. regenerate and verify the exact npm lock tree for `pg`, `redis` and `@socket.io/redis-adapter`;
2. execute the live PostgreSQL + Redis harness;
3. run the v0.15 CI release workflow;
4. run authorized primary-AI-provider smoke tests on approved non-sensitive test content;
5. run approved YouTube / Instagram / TikTok connector smoke tests with test credentials;
6. perform device/browser QA for the consumer surface, including mobile Safari and Android Chrome, before production beta.

No alpha.3 is planned.
