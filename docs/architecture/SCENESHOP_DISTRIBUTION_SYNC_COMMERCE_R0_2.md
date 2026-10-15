# SceneShop Distribution, Sync & Commerce Architecture R0.2

Status: **CANONICAL / FROZEN FOR IMPLEMENTATION**

## 1. SceneShop is not a video host

SceneShop stores and serves commerce metadata, synchronization metadata, products, placements, campaigns, routing policies, attribution and analytics. It does not aim to become the permanent host/distributor of master movies, episodes, reels or creator libraries.

A producer may upload/source audiovisual material temporarily for analysis and fingerprint generation according to retention policy. Playback remains on the content owner's property or a third-party platform.

## 2. Three official delivery modes

### PARTNER_NATIVE

The video plays on the producer/content owner's own page/player. SceneShop is integrated as the commerce layer and receives playback state directly when supported.

### COMPANION

The video plays on a third-party environment such as YouTube, Instagram, TikTok, TV or OTT. The SceneShop consumer app runs as a synchronized second screen.

Priority external platforms: **YouTube and Instagram**. TikTok is part of the same neutral connector contract and is expected to follow without changing SceneShop Core.

### EMBEDDED

The SceneShop SDK is integrated inside the partner's application/player. The partner retains UX, identity and playback control; SceneShop supplies governed Commerce Track state and commerce metadata.

Companion and Embedded are expected to be the predominant deployment modes. Partner-Native remains first-class.

## 3. Content identity is platform-independent

A SceneShop `Content/Work` owns a canonical SceneShop identity and Commerce Track. One content item may have multiple playback bindings, for example official site + YouTube + Instagram + TikTok + partner OTT.

External platform IDs are bindings, not the primary identity.

## 4. Companion ingest and Sync ID

The producer uploads/references the video for processing, configures inventory/campaigns/offers and runs TARGETED, DISCOVERY or HYBRID analysis. SceneShop generates:

- canonical Content ID;
- Sync ID;
- temporal fingerprints;
- scenes / commercial placements;
- thumbnails for commerce-relevant scenes;
- a versioned Commerce Track.

The analysis media can then be removed according to retention policy; the synchronization metadata remains.

## 5. Playback Head and Browse Head are universal

All three delivery modes use the same commerce state model:

- **Playback Head** — where the actual audiovisual content is now;
- **Browse Head** — which commerce-relevant scene the user is exploring.

When a consumer opens a product, the video may continue. The Browse Head can remain on the earlier scene while the Playback Head advances.

`GO LIVE` moves the Browse Head back to the current Playback Head without changing the video.

## 6. Commerce Timeline

The timeline is a SceneShop Core capability, not a Companion-only UI. It contains only scenes with published commercial placements, rather than every cinematic cut.

Each eligible scene can expose a representative thumbnail, timestamp, product count, campaign/brand metadata and active placements.

Default interaction: selecting a timeline scene moves the **Browse Head**, not the video.

Partner-Native/Embedded may optionally expose a separate `SEEK_TO_SCENE` capability if the partner player permits it. Companion must not assume it can seek a third-party player.

## 7. LIVE, BROWSING and Re-sync

`LIVE` and `BROWSING` exist in every delivery mode.

`RE-SYNC` is primarily a Companion operation: it performs a new synchronization observation/fingerprint match and corrects the Playback Head/drift. Partner-Native and Embedded normally receive direct player telemetry and therefore do not need acoustic re-sync.

## 8. Missed commerce and spoilers

While the consumer explores a product, SceneShop can retain commerce events that passed on the Playback Head and show an **"while you were exploring"** history.

Timeline visibility is governed per content:

- `PAST_ONLY`
- `PAST_AND_CURRENT` (recommended default for narrative content)
- `FULL`

Future-scene thumbnails must respect the same spoiler policy.

## 9. Marketplace / commerce destination independence

A Commerce Track never hardcodes a marketplace price into the temporal event. A placement references products/offers; the Commerce Service resolves the current destination, price, inventory and CTA.

Commerce destinations are selected/governed by the producer/content owner and campaign. Supported provider classes include:

- brand/direct store;
- marketplace (e.g. Amazon, Mercado Livre, Shopee when connected/authorized);
- affiliate destination;
- custom/private marketplace;
- lead generation;
- dealer locator;
- reservation;
- SceneShop checkout where/if commercially adopted.

A simple generic/deep URL must remain a valid Level-0 integration so a merchant does not need an API to participate.

## 10. Offer routing

A product/asset may have multiple authorized offers. Routing may depend on territory, campaign, partner, contract and availability. SceneShop must not replace an authorized seller merely because another price is cheaper.

## 11. Consumer surfaces

SceneShop has two product surfaces in addition to partner SDKs:

- **Web/PWA/Desktop browser surface** for Studio/operations and supported consumer experiences;
- **native mobile consumer app** (iOS/Android) for Companion synchronization, Commerce Timeline exploration, deep links/share handoff, QR and future device capabilities.

The mobile app is not only a mirror of playback. It is an independently navigable commerce surface synchronized to the content.

## 12. Database foundation

Migration `0009_distribution_commerce_sync_foundation.sql` introduces the relational seams for:

- playback bindings;
- Commerce Timeline policy;
- temporal fingerprints/Sync ID;
- playback sessions with separate Playback/Browse heads;
- sync observations;
- commerce providers and merchant connections;
- external offers;
- offer routing policies.

These are foundations only; provider connectors and the full mobile app are later roadmap increments.
