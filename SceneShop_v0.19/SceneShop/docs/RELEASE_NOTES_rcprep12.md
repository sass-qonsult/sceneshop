# SceneShop v0.19 rcprep.12 — Release Notes

Base: rcprep.11 (`a93879f`), which was never deployed. sceneshop.qonsult.cc still serves the rcprep.10 phone code: on 21/10/2026 its public `/js/mobile.js` still had the 2.5 s time cap and no `observedAgoSeconds`. **This release includes everything in rcprep.11.** Branch `rcprep.12`. Version string unchanged (`0.19.0-rc.1`). No database migration, no new required setting.

## Problems reported and their causes

| Reported | Cause | Fixed in |
| --- | --- | --- |
| Phone synced to the YouTube video stays on the first scene and its product | (1) In COMPANION mode, the phone clock stopped 2.5 s after the sync. (2) With more than one official track, the player and phone picked the first-ranked track; on a tie that is the oldest one (the "original" with one scene), while the edited track was the one published. | (1) rcprep.11, plus rcprep.12: the server position is used instead of the rounded `?t=`. (2) rcprep.11 prefers the track published in the app; rcprep.12 also breaks ties by the most recently edited track. |
| Editing scenes (merge into one, re-cut) breaks what the app shows | (1) The old editor "AI tagging" card applied the AI's own scenes and **replaced the editor cuts** ("Use the suggested scenes" was ticked by default). (2) "Detect cuts" dropped every product. (3) Saving after a re-cut treated the dropped AI products as deleted. | rcprep.12: the AI always analyzes the track's own scenes. Re-cutting carries the products into the new scenes, and the AI re-places approved items by their exact second. Only the × removes an AI product for good. |
| Track editor not integrated with the AI tab (approve there and authorize the sync) | Approvals reached the app only through AI & Publishing. | rcprep.11 (auto-sync on approval) and rcprep.12 (**Find products in the scenes** in the editor, with auto-approval and review inside the editor) |
| Tracks could not be deleted in the editor or the Titles tab | Not implemented in the deployed version | rcprep.11 (editor) and rcprep.12 (Titles tab; editor button always visible) |
| Fictitious stores, keep only the Pilot Marketplace | Demo stores seeded in the data | rcprep.12 |
| Possible race: switching titles quickly in the editor could open and save another title's track | `selectWork` loaded the track asynchronously without checking the title was still selected | rcprep.12 (client guard, plus the server refuses a `workId` that does not match the track) |

## What changed in rcprep.12

| Area | Change |
| --- | --- |
| Editor ↔ AI | The **Products with AI** card in the editor has **Find products in the scenes**. It saves the track first, then sends exactly its scenes to the AI (`sceneSource: TRACK`, `trackId`). Each scene is analyzed separately and in parallel: catalog products with the HYBRID mode, plus open discovery across all categories. "Approve by itself my catalog products recognized with 70% certainty or more" is on by default (`autoApprove`, `autoApproveMin`). Approved items are written into the track and the app by the automatic sync, and the editor reloads. **Review suggestions** lists only the pending items, by the track's scenes. **Approve the ticked ones** approves them, and optionally rejects the rest; flagged items go through the operator-flag resolution. Creating a product from a frame still works. A new analysis joins the app selection even when analyses were ticked by hand. |
| Scene edits keep products | "Detect cuts" moves each product to the new scene that contains the middle of its old scene; the confirm text says so. On save, AI products missing from the edit stay on the track. After every editor save (official track), the AI sync re-places approved items by each item's second in the saved scenes. Only AI products removed with × (`aiRemoved`, per scene) stay out. |
| Which track the app uses | Order: the published track; on a tie between official tracks, the most recently edited one, never the forgotten original. |
| Delete tracks | The Titles tab lists each title's tracks: ● marks the one in the app, and each has a **Delete** button. The editor's **Delete track** button is always visible (disabled on a new, unsaved track). |
| Stores | **Delete store** in Official offers (`DELETE /api/me/sellers/:id`). An own store is marked removed for everyone; a default store is removed for this organization. Their offers are removed. On the first start with existing data, a one-time cleanup removes the five fictitious demo stores (Urbano&Co, Lar Design, Atelier Rosa, MegaLoja, ShopCenter) and their offers; **Marketplace Piloto** stays. "Restore demo" does not bring them back. Product links are entered in each offer (link field). |
| Phone synced by sound | Uses the server's `playbackPosition + observedAgoSeconds` and ignores the rounded `?t=` from the sync redirect. |
| Memory backend | The published timeline now adds the track offset, like PostgreSQL. |
| i18n | 27 new EN/ES entries. |

## What must be done on the server
1. **Deploy this release** (`docker compose build app && docker compose up -d app`). Without it, the phone keeps the old behaviour.
2. After deploying, delete the old "original" tracks you no longer want, in the editor or in Titles → track list → Delete.
3. Optional: `SCENESHOP_AI_AUTOSYNC_MS` (default 800 ms).

The Android APK does not need a new build: it loads the app from the server.

## Tests run (local, this environment, clean clone with fresh `npm ci`)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks
- `test:rc10` (32), `test:rc11` (26) and the new `test:rc12` (25 checks), each on memory and on PostgreSQL 16. The rc12 suite covers:
  - the original track not overriding the edited one, for the player, the phone session and the scene count;
  - editor-run analysis with auto-approval (10 approved, 5 pending);
  - re-cutting to 5 scenes, merging into one scene and going back to 7, with products following;
  - the × removal staying out;
  - store deletion and the one-time demo-store cleanup.
- New `test:rc12:e2e` (15 checks in Chromium). It runs the whole flow from the editor without opening the AI tab, reviews inside the editor, checks the phone opening on scene 2 with `?t=0`, deletes a store, and deletes a track in Titles.
- `ai.e2e.mjs` rewritten for the new flow (22 checks: the AI keeps the editor's 7 cuts instead of replacing them).
- Browser suites e2e, pilot, i18n, audio-id, rcprep10, rcprep11, acr: all passing.

Not done here: a real Gemini account, real phones in a real room, and the YouTube copy of the video. The sync assumes the YouTube video has the same edit and timing as the uploaded file; a different cut needs the track offset or a re-upload.
