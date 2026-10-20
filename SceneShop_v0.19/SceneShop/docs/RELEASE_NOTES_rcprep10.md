# SceneShop v0.19 rcprep.10 — Release Notes

Base: rcprep.9 (`3502a84`). Branch `rcprep.10`. Version string unchanged (`0.19.0-rc.1`). No database migration, no new required setting.

## Why this release
Registering products scene by scene was slow, AI discovery results reached the app as if the whole track were one scene, and several things could not be deleted (analyses, review items, products) or switched off (default stores).

## What changed

| Area | Change |
| --- | --- |
| Track editor | New **Products by scene** panel: every scene of the cuts on one screen (frame thumbnail, name, time, products). Search and add a product inside each scene, tick scenes to add or remove one product in bulk, remove with ×, open a scene in the video, publish from the panel. |
| AI discovery by scene | New **Scenes** option in AI & Publishing: **Track editor cuts** (default when cuts exist), *let the AI split*, or *single scene*. With editor cuts, the video is uploaded to Gemini once and each ticked scene is analyzed in its own request (`video_metadata` start/end offsets), several at the same time (`GEMINI_SCENE_CONCURRENCY`, default 4, max 12). Each scene is retried once; a failed scene does not fail the job. Items land in their scene (`primaryPayload.sourceSceneId`), times are clamped to the scene (relative times are converted). The job stores the cuts used (`config.sceneSource`, `config.scenes`). |
| Recent jobs | Each analysis can be deleted (`DELETE /api/ai/jobs/:id`, refused while RUNNING) together with its candidates, verifications, flags and placements. An **App** checkbox per analysis selects what goes to the app (`PUT /api/ai/works/:id/sync`); with nothing ticked, the latest COMPLETED analysis is used. |
| Publish to the app | `POST /api/ai/works/:id/publish`: the APPROVED items of the selected analyses are written into the title's latest official track, each in the scene that contains it (by scene id, then by time), and the track is republished (Commerce Timeline). Products placed by hand are kept; AI-placed products carry `source: "ai:<jobId>"` and are replaced on each publish. Without a track, the scenes come from the analysis cuts. |
| Review queue | Grouped by scene, with checkboxes (item, scene, select all), filters by status and analysis, **Approve selected** (uses the chosen product, the target asset or the catalog product suggested by the AI) and **Delete selected** (`POST /api/ai/candidates/delete`). Approved placements of deleted items are deleted, or retired if a publication references them. |
| Products | **Delete product** (`DELETE /api/products/:id`): the product is archived (`archivedAt`), removed from the organization's tracks (republished), loses its official offer and disappears from product lists, editor search, AI inventory and the app. Old sales and publications still resolve the id. Tracks refuse archived products. |
| Official offers | Default stores (not owned by the organization) can be disabled/enabled per organization (`PUT /api/me/sellers/:id/enabled`); own stores keep active/inactive. A disabled store is not offered in the product forms, refuses new offers, and existing offers with it stop resolving (no guaranteed purchase in the app). `offerFor` now also honours own stores that were deactivated. |
| i18n | 92 new EN/ES entries. |

## What must be done on the server
Deploy the code as usual (`docker compose build app && docker compose up -d app`). Nothing else is required. Optional: `GEMINI_SCENE_CONCURRENCY` in `sceneshop.env` to change how many scenes are analyzed at the same time (default 4).

## Tests run (local, this environment)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks
- New `npm run test:rc10` (32 checks, real HTTP server + Gemini simulator), passing on memory **and on PostgreSQL 16** (`RC10_BACKEND=postgres`)
- New `npm run test:rc10:e2e` (25 checks in Chromium): products-by-scene panel, discovery on 3 editor scenes in parallel, bulk approve/delete, publish to the app by scene, delete analysis, delete product, disable/enable a default store
- Browser suites e2e, pilot, i18n, audio-id, ai, acr — all passing
- `test/store-sync.test.js`: the affiliate CSV test used fixed October dates that became older than the click it creates; it now uses today's date (test fix only).

Not done here: real Gemini account (the per-scene requests follow the public `videoMetadata` clipping API and were tested against the simulator).
