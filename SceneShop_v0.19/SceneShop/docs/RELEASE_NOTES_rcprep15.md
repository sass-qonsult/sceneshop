# SceneShop v0.19 rcprep.15 — Release Notes

Base: rcprep.14 (`8ca0dbb`). **Cumulative: it includes rcprep.13 and rcprep.14.** The server is still on rcprep.12. Version string unchanged (`0.19.0-rc.1`). No database migration, no new setting.

## What changed

| Request | Change |
| --- | --- |
| Delete the titles I uploaded (Titles tab) | **Delete title** button on each title (`DELETE /api/works/:id`, org `CONTENT_WRITE`). The title is archived (`archivedAt`) and disappears from the studio lists, the public list, the player and the app. Its tracks are deleted and its Commerce Timeline is retired; old sales and audit records keep the id. Products are kept in the Products tab. (Track deletion per title is already in rcprep.12.) |
| Products belong to their project, not one basket | Products have projects (`workIds`). A new product goes into the chosen project: from the Products tab, the editor's "Add new product", or `workId` on `POST /api/products`. The **Products** tab has a **Project** selector (or *No project*, *All projects*), **Pull from another project** and **Remove from this project**. Removing is refused while the product is used in one of the project's tracks; the error names the track. Products used in a track automatically join that track's project, so existing data gets its projects from the tracks. The editor search and *Products by scene* show the project's products first; products from other projects are marked and joining them pulls them into the project. The AI only looks for products of the project (plus those with no project yet). |
| Choose the operator class on the login screen, Producer by default | The login screen has an **Operator class** selector (Producer by default; content owner, channel, platform, brand, agency, retailer, other) used by **Create account**. Producer-type classes create a producer account and a PRODUCER organization. Team & Security has **Operator class of this organization** (`PATCH /api/organizations/:id/kind`, owner/admin). Before, every new account got an `OTHER` organization, which made tracks "community". |
| Gemini says the credits ran out after adding more | The studio passes on Google's 402/429 message and explains what to check: credits added in Google AI Studio to the **same project** as the server key (`GEMINI_API_KEY`), the spend cap, and the propagation delay. SceneShop does not cache this error; every analysis calls Google again. The editor's AI card is now shown to organization members, not only to "producer" accounts. |
| Fix found while testing | An affiliate report with only today's date, imported before noon, was refused as "order in the future". |

## Gemini credits: what to check
1. The key on the server (`GEMINI_API_KEY` in `sceneshop.env`) must belong to the **same Google AI Studio project** where the credits were bought. Check it at aistudio.google.com → API keys → project.
2. In AI Studio → Billing, check the prepaid balance and any spend cap.
3. If the balance is positive and Google still returns "Your prepayment credits are depleted", it is a known Google billing sync issue. Several reports on the Google AI developer forum since July 2026 have no official fix, and Google support has to be contacted. A paid scheduled payment brought access back for one user.

## Tests run (local, clean clone with fresh `npm ci`)
- `npm test` 286/286 · `test:rc19` 46/46 · `test:data` 51/51 · `test:release` 6/6 · `test:apps` 17/17 · `test:api` 125 checks.
- `test:rc10`–`test:rc13` and the new `test:rc15` (25 checks: operator class at signup and organization; products per project, pull and remove; AI limited to the project; title deletion; Gemini credit error message). `test:rc12`, `test:rc13` and `test:rc15` also run on PostgreSQL 16.
- Browser suites e2e, pilot, i18n, audio-id, ai, rcprep10, rcprep11, rcprep12, acr and the new rcprep15 (12 checks): all passing. `test/unit.test.js` and `test/e2e.mjs` now pass the operator class explicitly for the community-author scenario.
