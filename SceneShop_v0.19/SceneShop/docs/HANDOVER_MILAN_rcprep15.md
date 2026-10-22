# SceneShop v0.19 rcprep.15 — Handover for Milan

Hi Milan, the server is still on rcprep.12. **rcprep.15 includes rcprep.13 and rcprep.14**, so install only this one. **No database migration, no new setting, no new APK.**

## 1. Files

| File | When to use it |
| --- | --- |
| `rcprep12_to_rcprep15.patch` | The server is on rcprep.12 (`568734d`): `git am rcprep12_to_rcprep15.patch` |
| `SceneShop_v0.19.0-rc.1_RCPREP15_Repository.bundle` | `git fetch <bundle> rcprep.15` |
| `SceneShop_v0.19.0-rc.1_RCPREP15_Source.zip` | Full source tree |

## 2. Steps

1. Update the code and run `docker compose build app && docker compose up -d app`.
2. Gemini: confirm that the `GEMINI_API_KEY` in `sceneshop.env` is from the same Google AI Studio project where Miguel added credits. If you change the key, restart the app.
3. Miguel, in Team & Security, sets **Operator class of this organization** to Producer. Then, in Titles, he deletes duplicate titles and tracks.

## 3. Verification done

Clean checkout, fresh `npm ci`:

- All unit suites and `test:api` pass.
- `test:rc10` to `test:rc15` pass, with `test:rc12`, `test:rc13` and `test:rc15` also on PostgreSQL 16.
- All browser suites pass.

Details: `SceneShop v0.19 rcprep.15 - Release Notes (EN)`.
