# SceneShop v0.19 rcprep.13 — Release Notes

Base: rcprep.12 (`568734d`), which is installed on sceneshop.qonsult.cc. Checked on 21/10/2026:

- `/sw.js` has cache `r8`.
- `/js/mobile.js?v=…` has `companionNow` and `observedAgoSeconds`.
- `/js/studio.js` has the rcprep.12 code.
- `/api/sellers` lists only Marketplace Piloto, so the one-time demo-store cleanup ran.

Version string unchanged (`0.19.0-rc.1`). No database migration, no new required setting.

## Problem found on the live server
The title "YTDown.com Shorts Media … Medina 001" had **four active tracks, all of type `community`**. Three were named "Trilha oficial" with the same 5 AI products, and its Commerce Timeline returned 404.

The cause: the organization that owns the title is not of a "producer" kind (CONTENT_OWNER, PRODUCER, CHANNEL, PLATFORM). Its tracks were therefore saved as `community`, which led to two problems:

- Community tracks are never published to the app as a Commerce Timeline.
- The AI sync only looked for **official** tracks to update. Finding none, every sync created a new "Trilha oficial" track, again as `community`.

The editor only opens the "in the app" track by default, and with no publication it opened a blank track. Each attempt therefore added one more track.

## What changed

| Area | Change |
| --- | --- |
| Track type | A track made by the organization that owns the title is **official**, whatever the organization kind (brand, agency, other). An existing `community` track of the owner becomes official the next time it is saved. Tracks on other organizations' titles stay community. The editor's "Will be published as" label follows the same rule. |
| AI sync | It updates the organization's active track on the title (official first; then the live one; then the most recent). It never creates a new track when one already exists. |
| Which track is "in the app" | Without a Commerce Timeline, it is the first-ranked track, the same one the player and phone open. The editor opens it by default and the Titles tab marks it with ●. |

## What must be done on the server
1. Deploy (`docker compose build app && docker compose up -d app`).
2. In Studio → Titles, on the Medina title, keep the track you want and delete the duplicates ("Trilha oficial" ×3 and "Minha trilha").
3. Open the kept track in the editor and click **Save changes**. It becomes official and is published to the app.

## Tests run (local, clean clone with fresh `npm ci`)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks.
- `test:rc10`, `test:rc11`, `test:rc12` and the new `test:rc13` (11 checks: an OTHER-kind organization owning a title; three AI runs keep one single official track; the app gets the scenes; an old community track is upgraded on save), on memory and on PostgreSQL 16. The rc13 test fails on the rcprep.12 code.
- Browser suites e2e, pilot, i18n, audio-id, ai, rcprep10, rcprep11, rcprep12, acr: all passing.
