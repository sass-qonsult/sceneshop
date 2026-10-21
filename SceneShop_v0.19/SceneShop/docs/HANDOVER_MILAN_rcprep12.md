# SceneShop v0.19 rcprep.12 — Handover for Milan

Hi Milan, **sceneshop.qonsult.cc is still on rcprep.10.** On 21/10/2026 its public phone code (`/js/mobile.js`) did not have the rcprep.11 fix. rcprep.12 includes rcprep.11 and fixes what Miguel reported: the phone stuck on the first scene, the original track overriding the edited one, and the editor not integrated with the AI. It also adds track and store deletion. **No database migration and no new required setting. The Android APK does not need a new build.**

## 1. Which files to use

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP12_Repository.bundle` | Recommended: `git fetch <bundle> rcprep.12` (full history). |
| `SceneShop_v0.19.0-rc.1_RCPREP12_Source.zip` | Full source tree, if you deploy by copying files. |
| `rcprep10_to_rcprep12.patch` | If the server is exactly on rcprep.10 (`139dfec`): `git am rcprep10_to_rcprep12.patch` (rcprep.11 and rcprep.12 together). |

## 2. What you need to do

1. Update the code (section 1).
2. `docker compose build app && docker compose up -d app`
3. Check that the new version is live: open `https://sceneshop.qonsult.cc/js/mobile.js` and search for `companionNow`. It must be there.
4. On the first start, the five fictitious demo stores and their offers are removed from the data, automatically and once. Marketplace Piloto stays.
5. Ask Miguel to delete the old tracks he no longer wants: Studio → Titles → the title's track list → Delete.

## 3. What changed (short)

- **Editor → AI:** **Find products in the scenes** analyzes exactly the track's scenes, approves catalog products by itself (≥ 70%), and sends them to the app. **Review suggestions** handles the rest without leaving the editor.
- **Scene edits keep products:** re-cut, merge into one scene and back. Approved AI products follow each item's exact second.
- **The app uses the edited track,** never the forgotten original.
- **Delete track** in the editor and in Titles. **Delete store** in Official offers.
- **Phone synced by sound** keeps following the film and uses the server's position.

Details: `SceneShop v0.19 rcprep.12 - Release Notes (EN)`.

## 4. Verification done

Clean checkout, fresh `npm ci`:

- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks.
- `test:rc10`, `test:rc11` and `test:rc12` on memory and on PostgreSQL 16.
- Browser suites e2e, pilot, i18n, audio-id, ai, acr, rcprep10, rcprep11 and rcprep12: all passing.

## 5. Not tested here

- A real Gemini account (tested against the simulator).
- Real phones in a real room.
- The YouTube copy of the video. It must have the same edit as the uploaded file.
