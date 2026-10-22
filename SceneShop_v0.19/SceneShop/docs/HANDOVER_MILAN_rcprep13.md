# SceneShop v0.19 rcprep.13 — Handover for Milan

Hi Milan, thanks for installing rcprep.12. It is live: the phone code, the studio, and the cleanup that left only Marketplace Piloto are all in place.

rcprep.13 fixes what the live data showed. Miguel's organization is not of a "producer" kind, so its tracks were saved as community. Because of that they never reached the app, and every AI sync created another "Trilha oficial" track. The Medina title has 4 tracks today. **No database migration, no new setting, no new APK.**

## 1. Files

| File | When to use it |
| --- | --- |
| `SceneShop_v0.19.0-rc.1_RCPREP13_Repository.bundle` | `git fetch <bundle> rcprep.13` |
| `SceneShop_v0.19.0-rc.1_RCPREP13_Source.zip` | Full source tree |
| `rcprep12_to_rcprep13.patch` | The server is on rcprep.12 (`568734d`): `git am rcprep12_to_rcprep13.patch` |

## 2. Steps
1. Update the code and run `docker compose build app && docker compose up -d app`.
2. Miguel, in Studio → Titles, on the Medina title: keep one track and delete the duplicates.
3. Open the kept track in the editor and click **Save changes**. It becomes official, and `/api/works/ytdown-com-shorts-media/commerce-timeline` stops returning 404.

## 3. Verification done

Clean checkout, fresh `npm ci`:

- All unit suites and `test:api` pass.
- `test:rc10` to `test:rc13` pass on memory and on PostgreSQL 16.
- All browser suites pass.

Details: `SceneShop v0.19 rcprep.13 - Release Notes (EN)`.
