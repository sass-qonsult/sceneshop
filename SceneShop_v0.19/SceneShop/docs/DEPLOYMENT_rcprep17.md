# SceneShop v0.19 rcprep.17 — Deployment Notes

How to bring a server to rcprep.17. It includes rcprep.13–16, so a server on rcprep.15 or rcprep.16 updates in one step. After the update, `/api/health` shows `"build": "rcprep.17"`. The full description of the platform is in `SceneShop - Complete System Guide (EN).pdf`. **No database migration.** There is a **new APK** to build.

## 1. Files

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP17_Repository.bundle` | `git fetch <bundle> rcprep.17` |
| `SceneShop_v0.19.0-rc.1_RCPREP17_Source.zip` | Full source tree |
| `rcprep15_to_rcprep17.patch` | Server on rcprep.15 (`adc3484`): `git am rcprep15_to_rcprep17.patch` |
| `rcprep16_to_rcprep17.patch` | Server on rcprep.16 (`1645e6c`): `git am rcprep16_to_rcprep17.patch` |

## 2. Server
1. Update the code (patch or bundle) and run `docker compose build app && docker compose up -d app`.
2. Check: `/api/health` is OK. Opening `/mobile` on a phone shows the new home screen (black background, white logo). Studio → Performance shows **Account report**.
3. To use the **Clients** tab, sign in with a platform admin (`node tools/criar-admin.js --usuario <login>`) or the moderator account.

## 3. Android APK (versionCode 8)
1. Run the GitHub Actions workflow **v0.18-android-build** (or `gradle -p apps/mobile/android :app:assembleDebug`) with `SCENESHOP_APP_URL` set to the production URL.
2. New in rcprep.17: the app fits inside the free area of the screen (status bar, navigation bar, camera cutout, keyboard) and has no title bar. New in rcprep.16 manifest: CAMERA, FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC, and payment `<queries>`. New dependency: `androidx.webkit:webkit:1.14.0`. New file: `gradle.properties` (`android.useAndroidX=true`).
3. We could not compile it here (no access to Google's Maven), so check the CI build log on the first run.

## 4. Wallets (only when the accounts exist)
Leave the variables empty until then; the wallet buttons stay hidden. To turn them on:
- **Google Pay:** in the Google Pay & Wallet Console get the merchant id. Then set `GOOGLE_PAY_ENV=PRODUCTION`, `GOOGLE_PAY_MERCHANT_ID`, `GOOGLE_PAY_GATEWAY` and `GOOGLE_PAY_GATEWAY_MERCHANT_ID` (both given by the payment gateway).
- **Apple Pay:** get the Merchant ID and the Merchant Identity certificate. Set `APPLE_PAY_MERCHANT_ID`, `APPLE_PAY_CERT_FILE` and `APPLE_PAY_KEY_FILE` (PEM paths mounted into the container). Put Apple's domain file in `APPLE_PAY_DOMAIN_ASSOCIATION_FILE`.
- **Gateway:** `WALLET_PSP_URL` and `WALLET_PSP_SECRET` point to a small adapter for the chosen gateway (Pagar.me, Mercado Pago, Stripe, Adyen…).
  - **Request:** a JSON POST `{orderId, amount (cents), currency, method, token}`, with the headers `x-sceneshop-timestamp` and `x-sceneshop-signature` (HMAC-SHA256 of `timestamp.body`).
  - **Response:** `{status: "APPROVED"|"DECLINED", network, last4, reference}`.

Details: `SceneShop v0.19 rcprep.17 - Release Notes (EN)` and `rcprep.16 - Release Notes (EN)`.
