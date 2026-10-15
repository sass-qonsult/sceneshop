# SceneShop Consumer / Companion UX R0.1

## Purpose
v0.15 completes the consumer-side behavior approved for Companion and reuses the same commercial state machine across Companion, Partner-Native and Embedded surfaces.

## Canonical heads
- `Playback Head`: where the audiovisual content is actually playing.
- `Browse Head`: which commercial scene the viewer is exploring.

These heads are independent. Browsing never rewinds the external player unless an integrated partner explicitly enables scene seek.

## Commerce Timeline
The consumer UI is driven by the published Commerce Timeline, not by every cinematic cut. It therefore renders only commercial scenes with governed placements.

The timeline respects the producer policy:
- `PAST_ONLY`
- `PAST_AND_CURRENT`
- `FULL`

Thumbnail visibility, missed-items behavior and integrated-player seek are also governed by the timeline policy.

## While you were exploring
When the viewer enters `BROWSING`, Playback Head keeps moving. Any new commercial scenes crossed by Playback Head are collected independently. The app exposes them in an “Enquanto você explorava” shelf so the viewer can revisit products without rewinding the video.

The missed list can be cleared without changing either head.

## Live vs Re-sync
- `Go Live` moves only Browse Head to the current Playback Head.
- `Re-sync` performs a new physical recognition of external content and may correct Playback Head/confidence. It is Companion-specific.

## Dynamic commerce
The Commerce Timeline stores placements and product/asset identity, not frozen marketplace prices. On interaction, the consumer surface calls the Commerce resolver with work, placement, product/asset, campaign context and territory. The response exposes SceneShop activation URLs only; destination URLs remain server-side for governance and attribution.

## Shared mobile core
`public/js/mobile-core.js` is framework-neutral and UMD-compatible. Node tests import the same source through `clients/mobile-core/index.js`, preventing divergence between browser behavior and the future iOS/Android client state machine.

## Persistence
- Server viewer state preserves `LIVE/BROWSING` and Browse Head per device.
- Local state preserves missed commercial scenes and allows seamless UI continuity on reconnect.
- Playback state remains shared by the session.
