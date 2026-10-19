# SceneShop v0.19 rcprep.9 — Handover for Milan

Hi Milan, this is everything that changed since rcprep.8 and what you need to do on the server. The Studio is now meant to run for real (no demo), the commission no longer depends on the store reporting sales, and audio sync now uses our own recognition engine (**SceneShop ID**) instead of ACRCloud.

## 1. Which files to use

Use **one** of these three; they contain the same code (branch `rcprep.9`, based on rcprep.8 `eb2bd42`; last commit is the SceneShop ID engine plus updated docs):

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP9_Repository.bundle` | Recommended: `git clone -b rcprep.9 <bundle> SceneShop` or `git fetch <bundle> rcprep.9` into your repo. Keeps the full history. |
| `SceneShop_v0.19.0-rc.1_RCPREP9_Source.zip` | Full source tree, if you deploy by copying files. |
| `rcprep8_to_rcprep9.patch` | Only if your server is exactly on rcprep.8: `git am rcprep8_to_rcprep9.patch` (all commits of the branch). |

**Do not apply the earlier hotfix (`SceneShop_hotfix_ai-workspace.zip`) separately.** That fix ("Failed to load the AI workspace" on PostgreSQL) is already the first commit of rcprep.9 (`68e7891`).

Also in the package: `SceneShop Studio - User Manual (EN).pdf` and `SceneShop Studio - Manual (PT).pdf` (how to use every tab, including store connection and Awin), `SceneShop v0.19 rcprep.9 - Release Notes (EN).pdf` (technical list), `SceneShop rcprep.9 - Colocar em producao (PT).md` (server steps), `SHA256SUMS.txt`, and the badge files.

## 2. What was done

| Area | Change |
| --- | --- |
| AI & Publishing | PostgreSQL bug fixed (listPlacements/reviewCandidate used a non-existent `sceneshop_placements.organization_id`). API errors now return JSON. Products from the Products tab become the AI inventory automatically. |
| Real mode | `tools/criar-admin.js` creates the administrator (producer, OWNER of the organization, plus Moderation). Re-running it resets the password. With `DEMO=0` the demo accounts, demo stores and simulated Amazon/ML/Magalu prices are not used. |
| Prices | Brazilian format 1.250.000,00, no 999.999 ceiling (limit is the DB `NUMERIC(14,2)`). |
| Official offers | The producer registers its own stores, and per product: store, product link, in-scene price, commission. Products tab mirrors it. Manual sale/return entry is still available. |
| Coupon per click | For connected VTEX/Shopify/Nuvemshop stores, each buy click creates a unique `SS-XXXXXX` coupon in the store (discount % per store, may be 0) and shows it on `/cupom/<offer>` before redirecting (Shopify auto-applies it). |
| Store order sync | Every 10 min (`SCENESHOP_STORE_SYNC_MINUTES`) SceneShop reads the store's orders and matches the coupon or the `of_…` reference in UTMs/landing URL: paid = sale, cancelled/refunded = reversal. New: `server/store-connectors.js`, `server/store-sync.js`. |
| Awin | For brands like JBL (Salesforce Commerce Cloud) and Oakley (SAP Commerce) that pay affiliates via Awin: the click link is an Awin deep link with `clickref=<ref>`; the Publisher API transactions are read every 10 min (pending/approved = sale, declined/deleted = reversal). |
| Marketplaces | Mercado Livre / Amazon / Magalu: affiliate link per product + CSV import of the program report. |
| Performance tab | Former "Pilot": per-store table (clicks, coupons, sales, conversion, revenue, commission, how each sale was confirmed) and per-project overview. |
| SceneShop ID | Own audio recognition (`server/audio-id.js`), replacing ACRCloud as the primary. Each uploaded title is fingerprinted automatically (ffmpeg) into `data/uploads/audioid/<work>.ssid`; existing titles are indexed at startup. The phone records 10 s, sends a WAV, and retries with 20 s if needed; SceneShop answers with title + position. No external account or key. `SCENESHOP_AUDIO_ID=sceneshop` (default) or `acrcloud`; ACRCloud keys, if present, are used only as fallback. |
| Badge | "SceneShop compatible" badge shown by the player in the first seconds; the Studio can export an MP4 copy with the badge (corner or centered opening). AAC audio is copied unchanged, so audio recognition still matches. |
| Other | Cut detection uses color; editor lists only the organization's titles; audit hash chain v2 (independent of jsonb key order); Dockerfile installs `ffmpeg`; 228 new EN/ES UI strings. |

## 3. What you need to do

1. **Back up** the database: `docker compose exec postgres pg_dump -U sceneshop sceneshop > backup-before-rcprep9.sql`
2. **Clean start** (decided by Miguel): the current test data can be discarded → `docker compose down -v`.
3. Update the code (section 1), then edit `sceneshop.env` next to `compose.yaml`:
   ```
   PUBLIC_URL=https://sceneshop.qonsult.cc
   SESSION_SECRET=<openssl rand -hex 32>
   TRUST_PROXY=1
   GEMINI_API_KEY=<Google AI Studio key>
   ```
   No `DEMO=1`. ACRCloud is no longer required; add the five `ACRCLOUD_*` values only if Miguel wants it as a fallback. Make sure `data/uploads` (videos **and** the `audioid` indexes) is on a persistent volume included in backups. Change the PostgreSQL password in `compose.yaml` if the DB is reachable from outside.
4. Build and start:
   ```
   docker compose up -d postgres redis
   docker compose build app
   docker compose run --rm app node tools/criar-admin.js --usuario miguel --nome "Miguel" --empresa "SceneShop"
   docker compose up -d app
   ```
   Miguel types his own password at the prompt (min. 10 characters).
5. **nginx** in front of the app: `client_max_body_size 4g; proxy_request_buffering off; proxy_read_timeout 3600s;` (videos up to 4 GB).
6. **Check**: `https://sceneshop.qonsult.cc/api/health` → `"demo": false`, `"backend": "postgres"`. Sign in as the administrator and open every tab. In Titles, each title should show "Sound recognition (SceneShop ID): ready"; then sync a phone by sound against a playing title.
7. **Store keys** (when Miguel gets them): add to `sceneshop.env` and restart the app. The store card in Official offers shows the exact variable names. Pattern `SCENESHOP_LOJA_<STORE ID>_...`:

| Platform | Variables | Store/network side |
| --- | --- | --- |
| VTEX | `_KEY`, `_TOKEN` | AppKey/AppToken with OMS read + coupons write; promotion "SceneShop" with utm_source = sceneshop |
| Shopify | `_TOKEN` | Custom app: `read_orders`, `write_price_rules`, `write_discounts` |
| Nuvemshop | `_TOKEN` | App with orders read + coupons write |
| Awin | `_TOKEN` | SceneShop publisher API token (ui.awin.com → API Credentials) |

   Then in the Studio: **Test connection** and **Read orders now** on the store card.

Keys stay only in `sceneshop.env` / secret manager — never in the database or in chat.

## 4. What Miguel handles

- (Optional) ACRCloud as fallback; the Awin publisher account; apply to the Oakley and JBL programs for Brazil.
- Ask each sponsor for the store API key (VTEX/Shopify/Nuvemshop) or confirm their Awin program.

## 5. Verification done

Clean checkout from the bundle, fresh `npm ci`:

- `npm test` 286/286 · `test:rc19` 46/46 (incl. store sync against a VTEX/Shopify/Nuvemshop/Awin simulator) · `test:data` 51/51 · `test:apps` 17/17 · `test:release` 6/6 · `test:api` 125 checks · PostgreSQL regression for the AI workspace.
- Browser suites: e2e 43, pilot 37, i18n 29, AI (Gemini simulator) 20, ACR (ACRCloud simulator, `SCENESHOP_AUDIO_ID=acrcloud`) 8, SceneShop ID (real browser microphone path, room echo + noise) — all passing.
- SceneShop ID accuracy on a synthetic 73-title / 3 h catalog: TV room 90% at 10 s, 97% with the 20 s retry; hard room 52% / 87%; 0 false matches on audio outside the catalog. Details in the release notes.
- Full walkthrough in production mode (NODE_ENV=production, DEMO=0, PostgreSQL + Redis, fresh DB): admin created by the tool, upload, products at R$ 1.250.000,00, VTEX store with coupon page and order read automatically, Awin store with clickref link and transaction read automatically, Earnings, Performance by store, AI inventory, badge video, Team, Moderation, audit chain intact.

Note: the browser test suites need Playwright installed separately (`npm i --no-save playwright`); it is not a runtime dependency.

## 6. Not tested here

SceneShop ID with real phones in real rooms (only simulated recordings so far — please try it with a TV and a couple of phones), real ACRCloud, Gemini, VTEX/Shopify/Nuvemshop stores and Awin account (the connectors follow the public API docs and were tested only against simulators), Docker image build on the server, and native app rebuilds (not needed: the apps load the site).
