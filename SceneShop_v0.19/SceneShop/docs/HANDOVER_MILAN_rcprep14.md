# SceneShop v0.19 rcprep.14 — Handover for Milan

Hi Milan, the server is still on rcprep.12. **rcprep.14 includes rcprep.13**, so install only this one.

It fixes two things Miguel saw in the app:

- **Amazon, Mercado Livre and Magalu appear next to the real offer.** They are demo-mode simulated prices (the server runs with `DEMO=1`). They now show only for the demo catalog.
- **Every AI approval creates a new track** (rcprep.13). Miguel's organization is not of a "producer" kind, so its tracks were saved as community.

**No database migration, no new setting, no new APK.**

## 1. Files

| File | When to use it |
| --- | --- |
| `rcprep12_to_rcprep14.patch` | The server is on rcprep.12 (`568734d`): `git am rcprep12_to_rcprep14.patch` |
| `SceneShop_v0.19.0-rc.1_RCPREP14_Repository.bundle` | `git fetch <bundle> rcprep.14` |
| `SceneShop_v0.19.0-rc.1_RCPREP14_Source.zip` | Full source tree |

## 2. Steps

1. Update the code and run `docker compose build app && docker compose up -d app`.
2. Check: `https://sceneshop.qonsult.cc/api/works/ytdown-com-shorts-media` should list only `loja-piloto` in each product's `offers`.
3. Miguel deletes the duplicate tracks in Studio → Titles and saves the kept track in the editor.

## 3. Verification done

Clean checkout, fresh `npm ci`:

- All unit suites and `test:api` pass.
- `test:rc10` to `test:rc13` pass, with `test:rc13` also on PostgreSQL 16.
- All browser suites pass.
