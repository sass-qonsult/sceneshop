# SceneShop Commerce Track — Architecture Doctrine R0.1

Status: CANONICAL DESIGN INPUT  
Applies to: future Content/AI/SDK layers  
Does not change the v0.8 player contract by itself.

## 1. Product definition

SceneShop is a platform-independent commerce metadata layer synchronized with audiovisual content. The underlying media asset does not need to be modified. The commerce layer behaves conceptually like a hidden subtitle track: it is time-aligned, can remain invisible, and is rendered only when the distribution experience chooses to expose it.

The canonical name for that time-aligned layer is **SceneShop Commerce Track (SCT)**.

## 2. Distribution modes

The same SCT must support three delivery modes without creating separate business models:

1. **Native** — content plays in a SceneShop-controlled experience. Playback time is directly available to SceneShop.
2. **Embedded / Partner SDK** — a broadcaster, streamer, channel or content owner keeps its own player and UI, while a SceneShop SDK/API receives playback position and returns active commercial placements.
3. **Companion / Second Screen** — content plays in a third-party player or device while SceneShop runs independently on the phone and synchronizes the viewer to the same timeline.

The commerce model is shared. Only the synchronization/renderer adapter changes.

## 3. Commercial governance

Recognition is not publication.

The system must maintain an explicit lifecycle:

DETECTED -> REVIEWED -> APPROVED -> PUBLISHED

A detected object never becomes an active placement solely because an AI model recognized it. The content owner, producer or authorized operator controls publication.

Sponsors, campaigns, rights, territory, validity period, exclusivity and display policy are first-class commercial concepts.

## 4. Analysis modes

SceneShop shall support three analysis modes.

### TARGETED

Inventory-first detection. The content owner uploads the products/commercial assets it wants SceneShop to find, ideally including brand, model, SKU/reference, description, multiple reference images and optional reference video. AI searches specifically for those authorized assets.

This is the preferred workflow for planned productions and sponsored placements.

### DISCOVERY

The operator may scan the complete video without a prior inventory. Discovery can be restricted by commercial categories (fashion, vehicles, jewelry, watches, furniture, décor, electronics, food/beverage, etc.) or run across all enabled categories.

Discovery creates candidate commercial assets. It does not publish them.

### HYBRID

Targeted inventory search and selected-category discovery run in parallel. This is expected to be the most useful mode for enterprise content owners: contractual sponsor items receive guaranteed targeted search while SceneShop may also surface additional monetization opportunities.

## 5. Primary identification and redundant verification

External visual search must be isolated from primary SceneShop identification.

Required order:

1. SceneShop primary identification runs independently.
2. Its hypothesis and evidence are frozen for that candidate.
3. A separate redundant verification process may query Google visual services, manufacturer catalogs, retailer catalogs or future providers.
4. Redundant evidence is prohibited from feeding back into the primary identification model/run.
5. The verification layer may only corroborate, conflict with, or fail to confirm the primary result.

Canonical redundant states:

- `CONFIRMED`
- `CONFLICT`
- `NO_MATCH`
- `INCONCLUSIVE`
- `SOURCE_UNAVAILABLE`

For a commercial publication candidate, `CONFLICT`, `NO_MATCH` and `INCONCLUSIVE` must raise an operator flag unless an explicit enterprise policy says otherwise.

Primary and redundant evidence must remain separately auditable.

## 6. Commercial asset model

The domain must distinguish at least:

- `CommercialAsset` — product/service/location/experience the partner may commercialize.
- `DetectionCandidate` — machine hypothesis that the asset appears at a time/range.
- `VerifiedAppearance` — accepted audiovisual occurrence.
- `Placement` — commercial decision to expose an asset for a defined display window.
- `Campaign` / `Sponsor` — why and under what contract the placement is active.
- `Offer` — territory/time/merchant-specific commercial action.
- `CommerceTrackEvent` — time-aligned SCT event delivered to a renderer/SDK.

A product and an offer are different objects. The same product appearance can resolve to different merchants, currencies, calls-to-action and availability by territory and time.

## 7. Timing model

Three timing concepts must not be conflated:

- **Cinematic appearance** — when the asset is physically visible.
- **Commercial display window** — how long SceneShop may expose the asset to the viewer.
- **Campaign validity** — calendar/territory period in which that placement/offer is commercially active.

This allows a sponsor item to remain discoverable after a rapid scene cut without modifying the original video.

## 8. Synchronization doctrine

All playback sources should eventually normalize to a common observation contract similar to:

```
PlaybackObservation {
  contentId
  position
  playbackState
  playbackRate
  confidence
  observedAt
  source
}
```

The SCT resolver should not need to know whether position came from a native player, partner SDK, Cast integration, acoustic synchronization or another authorized source.

## 9. Enterprise principle

The content owner controls what becomes commerce. AI reduces editorial work; it does not replace commercial authorization.

Canonical rule:

> Recognition discovers possibilities. The content owner decides what becomes commerce.
