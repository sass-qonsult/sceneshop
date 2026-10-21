# SceneShop v0.19 rcprep.11 — Release Notes

Base: rcprep.10 (`139dfec`). Branch `rcprep.11`. Version string unchanged (`0.19.0-rc.1`). No database migration, no new required setting.

## Why this release
Three problems reported after rcprep.10:

- Products approved in AI & Publishing did not reach the track editor. Clicking **Save changes** in the editor wrote back the version that was open before the approval, so the AI products disappeared from the app. The only workaround was adding every product by hand, scene by scene.
- Tracks could not be deleted.
- On the phone synced by sound (COMPANION mode), the scene list stopped at the scene where the sync happened. Synced at scene 18, scenes 19 and 20 never appeared. Without a SceneShop player sending the time, the phone's clock only moved 2.5 s past the sync point.

## What changed

| Area | Change |
| --- | --- |
| AI → track, automatically | Approving, rejecting or deleting items in the review queue, deleting an analysis, or changing the **App** selection syncs the track by itself. It runs about 0.8 s later (`SCENESHOP_AI_AUTOSYNC_MS`), and bulk actions become one publication. There is one sync per title at a time. Only the AI products of that track are rebuilt; products placed by hand are kept. If nothing changed, nothing is republished. The workspace returns `sync.last` and `sync.pending`, and the AI tab shows the last sync. **Publish to the app** is now **Sync now**. |
| Which track | The AI writes into the track that is live in the app (the Commerce Timeline's source track). The editor opens that same track by default, marked **●** "in the app" in the list. `/api/works/:id` (player and phone) also prefers it. |
| Editor save keeps AI products | The editor sends `baseUpdatedAt` (the version it opened) and `aiRemoved` (AI products the producer removed). If the track changed after it was opened, the new AI products are merged into the saved version, each in its scene. AI products the producer removed are recorded per scene and track, so the next sync does not re-add them. When the editor tab is shown again, it reloads the track if it has no unsaved edits, or warns that the products will be merged on save. AI products carry an **IA** tag in the editor and in Products by scene. |
| New track while the AI already published | If the editor holds an unsaved new track and an AI-synced track is live, saving offers to save into the live track instead of creating a second one without the AI products. |
| Delete track | **Delete track** button in the editor (`DELETE /api/tracks/:id`, same permissions as editing). The track becomes `removida`: it leaves the editor, the player and the app, while old sales still resolve. If it was the app's track, the most recent remaining official track is republished. With none left, the publication is retired (`retirePublishedTimeline`, PostgreSQL). |
| Phone synced by sound | `GET /api/sessions/:code` returns `observedAgoSeconds`, measured on the server. In COMPANION mode the phone starts at `playbackPosition + observedAgoSeconds` and keeps playing on its own clock with no 2.5 s cap. Re-sync, coming back from background, and the server's re-sync tick keep it playing. Thumbnails and products of the following scenes appear as the film moves on. The service worker cache name is bumped (`r8`). |
| i18n | 28 new EN/ES entries. |

## What must be done on the server
Deploy the code as usual (`docker compose build app && docker compose up -d app`). Nothing else is required. The Android APK does not need a new build: it loads the app from the server.

## Tests run (local, this environment, clean clone with fresh `npm ci`)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks
- `test:rc10` 32 checks, on memory and on PostgreSQL 16
- New `npm run test:rc11` (26 checks, real HTTP server and Gemini simulator), on memory **and on PostgreSQL 16** (`RC11_BACKEND=postgres`). It covers auto-sync on approval, a stale editor save keeping AI products, removed AI products not coming back, deleting items in review, deleting tracks (republish and retire), and `observedAgoSeconds`.
- New `npm run test:rc11:e2e` (14 checks in Chromium): approval → editor track and app without clicking publish, IA tags, Save changes keeps the products, phone in COMPANION mode advancing from scene 1 to 2 by itself, and delete track. The phone check fails with the rcprep.10 `mobile.js` (1 → 1 thumbnails) and passes with this release (1 → 2).
- Browser suites e2e, pilot, i18n, audio-id, ai, rcprep10, acr: all passing.
- `test/rcprep10.api.mjs`: the server keep-alive timeout was raised in the test, because the video encoding step now takes longer than Node's 5 s idle timeout (test-only change).

Not done here: a real Gemini account, and real phones in a real room.
