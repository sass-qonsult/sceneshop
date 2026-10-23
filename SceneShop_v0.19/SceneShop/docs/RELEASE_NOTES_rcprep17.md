# SceneShop v0.19 rcprep.17 — Release Notes

Base: rcprep.16. **Cumulative: it includes rcprep.13 to rcprep.16.** Patches are provided from rcprep.15 (`adc3484`) and from rcprep.16. Version string unchanged (`0.19.0-rc.1`). **No database migration.** **New APK** (versionCode 8).

## What changed

| Request | Change |
| --- | --- |
| On Android the top bar covers part of the app and the page cannot be scrolled up to see it | Android 15 apps (target SDK 35) are drawn from edge to edge, so the status bar sat over the page. The app now places the page inside the free area of the screen. It leaves room for the status bar, the navigation bar, the camera cutout and the keyboard, on Android 11 to 15 and later. The window has no title bar, and the system bars are black with light icons. The page is no longer hidden under the status bar, so nothing needs to be scrolled into view. |
| Show the scenes **without** products too, so the phone follows the video without breaks | The published Commerce Timeline (PostgreSQL) only contains scenes with products, so the phone jumped from one product scene to the next. The phone now merges in the track's other scenes. The scene strip runs continuously (0 products shown in a dimmed thumbnail), and the live scene without products shows "No products in this scene — the phone keeps following the video". The phone only vibrates on scenes that have products. |
| Reconciliation by channel › video › product, in folders or a cascade | **Studio → Clients** is now a cascade. Click the arrow of a client (channel) to see its titles. Click a title to see its products. Click a product to see its **orders** (date, store, order number, value, commission, client share, status: in custody, released, paid, reversed). Every level shows clicks, orders, sales, commission, client share and SceneShop revenue, and each level adds up exactly to the level above. The client's own **Performance → Account report** has the same cascade: title › product › orders. The CSV export follows the same hierarchy and ends with the list of orders for reconciliation. |
| Which version is on the server? | `GET /api/health` and `GET /api/live` now return `"build": "rcprep.17"`. |

## How to tell which version a server runs (before rcprep.17)
- `/api/health` has a `build` field → rcprep.17 or later.
- No `build`, but `GET /api/me/account-report` answers 401 (not 404) → rcprep.16.
- `GET /api/me/products?work=x` answers 401 (not 404) → rcprep.15.

## Tests run (clean clone)
- `npm test` 286/286 (with `SCENESHOP_BROWSER` pointing to Chromium).
- `test:api` passing; `test:rc10`–`test:rc13`, `test:rc15`, `test:rc16` and the new `test:rc17` (7 checks: build id, cascade, each product carries its orders, products add up to the title and titles to the client, hierarchical CSV, client view) pass on memory and on **PostgreSQL 16**.
- All browser suites pass. The new **rcprep17** suite has 12 checks, run against a PostgreSQL server where the bug happened: 3 scenes shown in sequence with "No products in this scene", the product scene still works, browsing an empty earlier scene, and the Clients cascade client › title › product › orders with no broken values. It also covers the client's own cascade.
- The Android window change is native code. It is built and checked by the GitHub Actions Android workflow.
