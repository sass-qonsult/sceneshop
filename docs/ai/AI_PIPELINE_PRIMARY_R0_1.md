# SceneShop AI Pipeline — Primary Identification R0.1

## Canonical modes

- **TARGETED** — searches only Commercial Assets explicitly authorized by the organization.
- **DISCOVERY** — scans selected commercial categories without requiring pre-uploaded inventory.
- **HYBRID** — searches required target assets and open categories in the same job.

## Inventory-first object model

`CommercialAsset` is the governed item the content owner may want to commercialize. It can reference a SceneShop Product but is not required to. Each asset may have images, video references, catalog pages or datasheets.

## Primary identification doctrine

The SceneShop primary engine runs independently. Every candidate is stored with:

- source analysis job;
- target `assetId` when applicable;
- category, proposed brand/model and description;
- physical time window, best timestamp and 2D box;
- primary confidence and raw primary payload;
- `primary_frozen_at`;
- SHA-256 `primary_fingerprint`.

The frozen primary result is evidence. External verification is not allowed to rewrite it.

## Publication boundary

AI output is not a Commerce Track. A candidate begins as `DETECTED` and requires the separate review/governance pipeline before it can become an approved Placement.
