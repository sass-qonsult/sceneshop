# SceneShop v0.19 rcprep.16 — Release Notes

Base: rcprep.15 (`adc3484`). **Cumulative: it includes rcprep.13, rcprep.14 and rcprep.15.** Patches are provided from rcprep.15 (`adc3484`) and from rcprep.12 (`568734d`). Version string unchanged (`0.19.0-rc.1`). **No database migration.** New optional settings only for wallets. **New APK** (versionCode 7).

## What changed

| Request | Change |
| --- | --- |
| SceneShop logo in black; a big Shazam-like sync button; code and QR code below | The phone app (web and APK) now uses a light theme with the **black SceneShop logo**. The home screen has a **large round sync button** with the SceneShop mark and pulsing rings, and three options under it: **Code** (type the TV code), **QR code** (camera) and **Link** (paste a YouTube / Instagram / TikTok link). The QR reader uses the browser's `BarcodeDetector` and falls back to the bundled jsQR 1.4.0 (`public/vendor`, Apache-2.0). App icons (PWA and Android launcher) now show the SceneShop mark. |
| Unexplained buttons at the top | They were: links to the **Web / Desktop / Mobile** versions of the viewer app, **Install app** (browser only), **Share** (share the session link), **Enable notifications**, the **language** selector and a "Mobile" label showing which version is open. They are now in a **menu (⋯)** together with **Home & history** and **Stop syncing**. The language selector also stays on the home screen. |
| Watch history (do not lose the previous video's track) | Every synced title goes to **Recently watched** on the phone (up to 30, with a saved copy of the last 12 tracks). Tapping one reopens its scenes and products **without syncing again**, also after the session has expired and offline. Buy links keep the original session for attribution. |
| Sync keeps running in the background until Stop | The sync stays on while the viewer uses other apps. When they come back, the position is recomputed from the server and the scenes with products that passed meanwhile appear under **While you were away**. If Android closes the app in the background, opening it again returns straight to the same sync. It ends only with **Stop** (next to the title or in the menu), or when the viewer closes the app (back-exit or swipe from recents). **Android:** a foreground service shows a fixed notification "Synced: <title>" with a **Stop** button. |
| Client accounts: Sony, Netflix… each with its titles, clicks, sales and contract terms | Each client is an organization. New **contract per client** (versioned): contract no., status, validity, currency, monthly fee and terms at three levels: **client default → per title/program → per product** (commission %, client share %, fee per click, fee per order). The commission and split of the contract are **frozen in each sale**; a new contract version never changes past sales or fees. New Studio tab **Clients** (SceneShop staff only): all clients with their numbers, per-title and per-product breakdown, contract editor and CSV. Clients see their own **Account report** under Performance. Clicks now also store the title (`workId`). |
| Use the phone wallets (Google, Samsung, Apple) safely | **Store purchases:** the app opens the store in the phone's browser, where the wallet and saved cards already work in the store's own checkout. **SceneShop checkout** (pilot marketplace today): **Pay with Google Pay / Apple Pay** through the browser's Payment Request API. The wallet gives an encrypted token that goes, signed, to the payment gateway; SceneShop keeps only card brand and last 4 digits. **APK:** Payment Request is enabled inside the WebView (`androidx.webkit` 1.14). In demo mode Google Pay runs in Google's TEST environment. Real charging needs the merchant accounts and a gateway (see the handover). |

## New endpoints
- `GET /api/admin/clients`, `GET /api/admin/clients/:orgId`, `PUT /api/admin/clients/:orgId/contract`, `GET /api/admin/clients/:orgId/report.csv` (platform admin or moderator).
- `GET /api/me/account-report`, `GET /api/me/account-report.csv` (organization `ANALYTICS_READ`).
- `GET /api/wallets/config`, `POST /api/wallets/apple/session`, `GET /.well-known/apple-developer-merchantid-domain-association`, `POST /mkt/api/order/:id/pay-wallet`.

## New optional settings (wallets only)
`GOOGLE_PAY_ENV`, `GOOGLE_PAY_MERCHANT_ID`, `GOOGLE_PAY_MERCHANT_NAME`, `GOOGLE_PAY_GATEWAY`, `GOOGLE_PAY_GATEWAY_MERCHANT_ID`, `GOOGLE_PAY_NETWORKS`, `APPLE_PAY_MERCHANT_ID`, `APPLE_PAY_DISPLAY_NAME`, `APPLE_PAY_CERT_FILE`, `APPLE_PAY_KEY_FILE`, `APPLE_PAY_DOMAIN_ASSOCIATION_FILE`, `WALLET_PSP_URL`, `WALLET_PSP_SECRET`. Without them nothing changes in production (wallet buttons stay hidden).

## Android (APK)
- versionCode 7. New: camera permission (QR code), foreground service `SyncForegroundService` (`dataSync`) with notification permission, Payment Request in the WebView, launcher icons, `singleTask` launch mode, `gradle.properties` with `android.useAndroidX=true`, dependency `androidx.webkit:webkit:1.14.0`.
- Not compiled in our environment (no Android SDK access); it is built by the existing GitHub Actions workflow `v0.18-android-build.yml`.

## Tests run (clean clone with fresh `npm ci`)
- `npm test` 286/286 (with `SCENESHOP_BROWSER` pointing to Chromium; without a Chrome on the machine, the desktop-launcher test cannot find a browser).
- `test:api` passing. `test:rc10`–`test:rc13`, `test:rc15` and the new `test:rc16` (30 checks: access control, contract validation and versions, frozen split on new sales, per-title / per-product reports, CSV, client isolation, click `workId`, wallet config, Google Pay test payment, token never stored) pass on memory and on **PostgreSQL 16**.
- Browser suites all passing: e2e 43, pilot 37, i18n 29, audio-id 6, ai 22, rcprep10 25, rcprep11 14, rcprep12 15, rcprep15 12, acr 8. The new **rcprep16** suite has 29 checks: home screen, QR read by a fake camera, menu, background and missed scenes, resume, Stop, history, expired session, Clients console, Account report and wallet checkout.
