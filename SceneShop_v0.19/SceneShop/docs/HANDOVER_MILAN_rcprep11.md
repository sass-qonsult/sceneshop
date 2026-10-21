# SceneShop v0.19 rcprep.11 — Handover for Milan

Hi Milan, this release builds on rcprep.10. It fixes the link between AI & Publishing and the track editor, adds track deletion, and fixes the phone synced by sound not moving to the next scenes. **No database migration and no new required setting. The Android APK does not need a new build** (it loads the app from the server).

## 1. Which files to use

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP11_Repository.bundle` | Recommended: `git fetch <bundle> rcprep.11` into your repo (full history, includes rcprep.9 and rcprep.10). |
| `SceneShop_v0.19.0-rc.1_RCPREP11_Source.zip` | Full source tree, if you deploy by copying files. |
| `rcprep10_to_rcprep11.patch` | Only if your server is exactly on rcprep.10 (`139dfec`): `git am rcprep10_to_rcprep11.patch`. |

If your server is still on rcprep.9 or older, use the bundle or the zip.

## 2. What changed (short)

- **AI → editor → app, automatically:** each item approved in the review queue goes into the track that is in the app, in its scene, within about a second. Rejecting or deleting an item removes it. The editor opens that same track (● "in the app") with the AI products tagged **IA**. **Save changes** no longer drops them.
- **Delete track** in the editor. If it was the app's track, the previous official track goes back to the app.
- **Phone synced by sound** keeps following the film: the next scenes and their thumbnails appear by themselves.

Details and endpoints: `SceneShop v0.19 rcprep.11 - Release Notes (EN)`.

## 3. What you need to do

1. Update the code (section 1).
2. `docker compose build app && docker compose up -d app`
3. Optional, in `sceneshop.env`: `SCENESHOP_AI_AUTOSYNC_MS=800` (delay before the automatic sync after a review action; default 800 ms).
4. Check:
   - Studio → AI & Publishing: approving an item shows "Editor track and app in sync" under Recent jobs.
   - Track editor: the track list shows "● … in the app", with the **Delete track** button.

## 4. Verification done

Clean checkout, fresh `npm ci`:

- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks.
- `test:rc10` and the new `test:rc11` (26 checks) on memory and on PostgreSQL 16.
- Browser suites e2e, pilot, i18n, audio-id, ai, acr, rcprep10 and the new rcprep11 (14 checks): all passing.

## 5. Not tested here

- A real Gemini account (tested against the simulator).
- Real phones in a real room.
