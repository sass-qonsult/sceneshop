# SceneShop v0.19 rcprep.14 — Release Notes

Base: rcprep.13 (`e9bb0b3`). **Cumulative: it includes rcprep.13.** The server is still on rcprep.12; checked on 22/10/2026, its studio code is still rcprep.12. Version string unchanged (`0.19.0-rc.1`). No database migration, no new setting.

## Problem
In the app, the Medina title showed **Amazon, Mercado Livre and Magalu** next to the Marketplace Piloto, even though those stores do not exist in Official offers.

These are not stores registered in the studio. They are **simulated prices from demo mode**. The server runs with `DEMO=1`: `/api/health` reports `"demo": true`. The offer engine added them to every product, including the products of an organization.

Checked on the live server (`/api/works/ytdown-com-shorts-media`): every product, for example "oakley-straight-jacket" and "neoforma", listed Marketplace Piloto (official) plus `mercadolivre`, `amazon` and `magalu` marked `simulated: true`.

## Fix
Simulated prices are shown only for the demo catalog: products with no organization and no creator, such as "Cidade em Cenas (demo)". A product registered by an organization shows only the official offer that organization chose. The rule also applies to offers already in the cache, so they disappear right after deploying.

## Also included (rcprep.13)
- A track made by the organization that owns the title is official, whatever the organization kind. Before, it was saved as "community", never reached the app as a Commerce Timeline, and every AI approval created a new "Trilha oficial" track. The live server has 5 tracks on "No Time to Die (4)", all community.
- The AI updates the same track and never creates another one.

## What must be done on the server
1. Deploy: `git am rcprep12_to_rcprep14.patch` (server on rcprep.12), or the bundle/zip. Then `docker compose build app && docker compose up -d app`.
2. Clean up the duplicate tracks in Studio → Titles, then save the kept track in the editor.

## Tests run (local, clean clone with fresh `npm ci`)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks.
- `test:rc10` to `test:rc13` pass. `test:rc13` now has 13 checks, adding two: products of the organization show no simulated stores in the app (this check fails on the previous code), and the demo catalog keeps them. The suite runs on memory and on PostgreSQL 16.
- Browser suites e2e, pilot, i18n, audio-id, ai, rcprep10, rcprep11, rcprep12, acr: all passing.
