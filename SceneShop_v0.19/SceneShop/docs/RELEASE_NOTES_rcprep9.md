# SceneShop v0.19 rcprep.9 — Release Notes

Base: rcprep.8 (`eb2bd42`). Branch `rcprep.9`. Version string unchanged (`0.19.0-rc.1`).

## Why this release
The Studio was still running as a demo. This release makes it usable for real titles: a real
administrator login, stores and product links owned by the producer, no price ceiling, AI that uses the
registered products, a way to confirm sales, the "SceneShop compatible" badge, and **SceneShop ID**, our own
audio recognition, so syncing the phone to a title no longer depends on ACRCloud.

## What changed

| Area | Change |
| --- | --- |
| AI & Publishing | Fixed "Failed to load the AI workspace" on PostgreSQL (queries used a non-existent `sceneshop_placements.organization_id`). Approving AI suggestions was broken by the same bug. API errors now return JSON. |
| AI & Publishing | Products from the Products tab become the AI inventory automatically (`POST /api/ai/assets/sync-products`). Plain-language modes. |
| Admin | `tools/criar-admin.js`: creates the administrator (producer, OWNER of the organization, plus Moderation access via `platformAdmin`). Re-running resets the password and revokes sessions. |
| Prices | Brazilian format 1.250.000,00 everywhere, no 999.999 ceiling (limit is the DB's NUMERIC(14,2)). Shared parser `server/price.js`. |
| Official offers | Producer registers its own stores (`/api/me/sellers`, org-scoped), sets per-product store link, price, commission, validity. New integration `link_produto`: redirect to the product URL with `ss_ref` + UTM. "Clicks sent and sales": list of issued references and manual sale/return registration (`POST /api/me/sellers/:id/orders`). Advanced area (routing + future SceneShop payments) collapsed. |
| Store connection | New `server/store-connectors.js` (VTEX, Shopify, Nuvemshop) and `server/store-sync.js`. Each buy click creates a unique `SS-XXXXXX` coupon in the store (discount % per store, may be 0) and shows it on `/cupom/<offer>` before redirecting (Shopify auto-applies it via `/discount/<code>`). Every 10 min SceneShop reads the store's orders and matches the coupon or the `of_…` reference carried in UTMs/landing URL: paid orders become sales, cancelled/refunded orders reverse the commission. Store credentials only in env (`SCENESHOP_LOJA_<ID>_KEY/_TOKEN`), never in the DB. |
| Affiliate networks | Awin connector for brands whose own stores run on enterprise platforms (JBL Brazil: Salesforce Commerce Cloud; Oakley: SAP Commerce) and pay affiliates through Awin. Each click's link is an Awin deep link with `clickref=<of_ ref>`; the Publisher API transactions (`/publishers/{id}/transactions`, `accessToken`, UTC, ≤31-day windows) are read every 10 min: pending/approved = sale, declined/deleted = reversal. |
| Marketplaces | Store type "affiliate program": affiliate link per product + CSV import of the program report (Mercado Livre, Amazon, Magalu). Rows with a SceneShop reference are attributed to the scene; the rest count in the store's performance. |
| Performance | "By store" table: clicks, coupons, sales, conversion, revenue, commission and how each sale was confirmed (coupon read at store, link read at store, store notification, manual, affiliate report). |
| Products | Product card mirrors the official offer (store, link, price, commission) instead of the demo "Pilot Marketplace". |
| Production | Simulated Amazon/Mercado Livre/Magalu prices are hidden when `DEMO=0`. Editor lists only the active organization's titles. Demo controls hidden. |
| Performance | Former "Pilot" tab: "All projects" overview per title + existing funnel/scene/product detail. |
| SceneShop ID | New `server/audio-id.js`: own audio fingerprinting (spectral-peak landmarks, Shazam-style). Every uploaded title is indexed automatically (ffmpeg → 8 kHz mono → hashes) into `data/uploads/audioid/<work>.ssid`; titles without an index are indexed at startup. The phone records 10 s and posts a WAV to `/api/sync/audio/recognize|start`; if not recognized it records 10 s more and sends 20 s. Answer = title + position (±50 ms). `SCENESHOP_AUDIO_ID=sceneshop` (default) or `acrcloud`; ACRCloud, when configured, is only a fallback. Studio shows "Sound recognition (SceneShop ID): ready" per title with Index now/again. Routes `GET/POST /api/audio-id/works/:id[/index]`. No external key, and the viewer's audio is not stored. |
| Badge | `POST /api/works/:id/branded` creates an MP4 copy with the "SceneShop compatible" badge (top corner or centered opening, 4 s, fade in/out). AAC audio is copied unchanged, so audio recognition still matches. The SceneShop player shows the badge for the first seconds. |
| Editor | Cut detection compares color, not only brightness. Editor opens the newly uploaded title. |
| Audit | Hash chain v2 is independent of jsonb key order (the chain used to look "broken" after a reload on PostgreSQL). Old entries keep the original hash. |
| Docker | Image installs `ffmpeg` (audio indexing and badge video). |
| i18n | 228 new entries (EN/ES). |

## What must be done on the server
1. Back up the database.
2. Pull/extract this version, add `PUBLIC_URL`, `SESSION_SECRET`, `TRUST_PROXY=1`, and `GEMINI_API_KEY` to `sceneshop.env` (no `DEMO=1`). The `ACRCLOUD_*` values are now optional (fallback only). Keep `data/uploads` (videos + `audioid` indexes) on a persistent volume.
3. Clean start (demo data is not migrated): `docker compose down -v` only if the current test data can be discarded.
4. `docker compose up -d postgres redis && docker compose build app`
5. `docker compose run --rm app node tools/criar-admin.js --usuario <login> --nome "<name>" --empresa "<company>"`
6. `docker compose up -d app`
7. nginx: `client_max_body_size 4g; proxy_request_buffering off; proxy_read_timeout 3600s;`
8. Check `/api/health` → `"demo": false`, `"backend": "postgres"`.

9. To connect a store: set `SCENESHOP_LOJA_<ID>_KEY/_TOKEN` in `sceneshop.env` (names shown on the store card), restart, then Test connection.

Details in `docs/PRODUCAO_rcprep9.md`.

## Mobile apps
No change to the Android/iOS shells. They load the site, so the new server features reach them without rebuilding.

## Tests run (local, this environment)
- `npm test` 286/286 · `npm run test:rc19` (incl. `test/rcprep9.test.js`, `test/store-sync.test.js` against a VTEX/Shopify/Nuvemshop/Awin API simulator, and `test/audio-id.test.js`) 46/46 · `npm run test:api` 125 checks · `npm run test:apps` 17/17
- Browser suites: e2e 43, pilot 37, i18n 29, ai (Gemini simulator) 20, acr (ACRCloud simulator, `SCENESHOP_AUDIO_ID=acrcloud`) 8, audio-id (`npm run test:audio-id`: real browser microphone path with room echo + noise) 6 — all passing; audio-id also passed against a production-mode server on PostgreSQL, including re-indexing at startup
- `test/ai-pipeline-postgres.test.js` on a fresh PostgreSQL 16 — fails before the fix, passes after
- Manual walkthrough in production mode (NODE_ENV=production, DEMO=0, PostgreSQL + Redis): admin login, upload, products at R$ 1.250.000,00, store + offer, publish, buy redirect with `ss_ref`, manual sale, earnings, AI inventory, badge video (both styles), performance, audit chain intact.

Not done here: real ACRCloud/Gemini accounts, real VTEX/Shopify/Nuvemshop stores or Awin account (connectors follow the public API docs and were tested only against the simulator in `test/store-mock.mjs`), native app rebuilds, external RC evidence (stays pending; no synthetic evidence was recorded).

## SceneShop ID — measured accuracy (synthetic corpus, this environment)
Room recordings were simulated (volume drop, noise, reverb, small speaker, TV room, hard room). Catalog of 73 titles / 3 h:

| Recording | 10 s | 20 s (automatic retry) |
| --- | --- | --- |
| Clean, quiet, noise down to 0 dB SNR, reverb, small speaker (13 titles) | 100% | — |
| TV room | 90% | 97% |
| Hard room (loud noise + strong echo) | 52% | 87% |
| Audio not in the catalog | 0 false matches | 0 false matches |

Position error ~10–50 ms. Query ~90–240 ms. Indexing ~4 s per 15 min of audio. Index ~9 MB per hour of audio.
Limits: tested on synthetic music, not yet on real phone recordings in real rooms; playback speed changes (e.g. PAL 4% speed-up) are not handled.
