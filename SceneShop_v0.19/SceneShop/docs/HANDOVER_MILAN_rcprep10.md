# SceneShop v0.19 rcprep.10 — Handover for Milan

Hi Milan, this release builds on rcprep.9 (same deployment as before). It changes the Studio's track editor, AI & Publishing, Products and Official offers tabs. **No database migration and no new required setting.**

## 1. Which files to use

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP10_Repository.bundle` | Recommended: `git fetch <bundle> rcprep.10` into your repo (full history, includes rcprep.9). |
| `SceneShop_v0.19.0-rc.1_RCPREP10_Source.zip` | Full source tree, if you deploy by copying files. |
| `rcprep9_to_rcprep10.patch` | Only if your server is exactly on rcprep.9 (`3502a84`): `git am rcprep9_to_rcprep10.patch`. |

If your server is still on rcprep.8, use the bundle or the zip (they include rcprep.9), and follow the rcprep.9 handover first.

## 2. What changed (short)

- **Track editor → Products by scene:** all scenes on one screen; search/add products per scene, bulk add/remove across ticked scenes.
- **AI & Publishing:** discovery can use the editor's scene cuts; each scene is a separate Gemini request (video clip offsets), run in parallel. Analyses can be deleted; an **App** checkbox picks which analyses go to the app; **Publish to the app** writes the approved items into the official track, each in its own scene. The review queue has selection, filters, bulk approve and bulk delete.
- **Products:** delete (archived; removed from tracks, offer, AI list and app).
- **Official offers:** default stores can be disabled/enabled per organization.

Details and endpoints: `SceneShop v0.19 rcprep.10 - Release Notes (EN)`.

## 3. What you need to do

1. Update the code (section 1).
2. `docker compose build app && docker compose up -d app`
3. Optional, in `sceneshop.env`: `GEMINI_SCENE_CONCURRENCY=4` (how many scenes are analyzed at the same time; 1–12). Higher is faster but uses more of the Gemini quota at once.
4. Check: Studio → Track editor shows the **Products by scene** button; AI & Publishing shows the **Scenes** option and **Publish to the app**.

## 4. Verification done

Clean checkout, fresh `npm ci`: `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks · new `test:rc10` (32 checks) on memory and on PostgreSQL 16 · browser suites e2e, pilot, i18n, audio-id, ai, acr and the new `test:rc10:e2e` (25 checks) — all passing.

## 5. Not tested here

Real Gemini account with per-scene clipping (tested against the simulator, following the public `videoMetadata` API).
