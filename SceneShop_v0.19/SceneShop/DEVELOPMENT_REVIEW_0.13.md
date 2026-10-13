# SceneShop Development Review — v0.13

## v0.13.0-alpha.1 — Distribution / Sync / Partner SDK Core

- Os três modos canônicos (`PARTNER_NATIVE`, `COMPANION`, `EMBEDDED`) passam a compartilhar o mesmo Distribution Core.
- `PlaybackBinding` é propriedade da organização e vincula a obra a YouTube, Instagram, TikTok, site/app do parceiro, TV/OTT ou outro ambiente sem tornar SceneShop host de vídeo.
- Sync Index temporal: `tools/build-sync-index.js` usa FFmpeg apenas durante processamento autorizado e persiste descritores perceptuais compactos; a mídia bruta não faz parte do índice.
- `POST /api/sync/recognize` resolve Content/Sync ID + posição + confiança; `POST /api/sync/start` abre sessão `COMPANION` sem expor controller token.
- SDK headless (`public/js/sceneshop-partner-sdk.js`) entrega timeline e playback state sem impor UI ao parceiro.
- Chaves SDK long-lived são armazenadas somente como SHA-256; o browser recebe token HMAC curto, vinculado a organização/obra/binding/scopes.
- Companion consumer shell ganhou PWA foundation, Sync por microfone e Re-sync separado de Go Live.
- Migration `0019_distribution_sdk_sync.sql` materializa ownership, builds de sync, SDK keys e distribution events.

### Validation

- 137/137 unit/contract tests PASS.
- 78/78 real HTTP integration checks PASS.
- FFmpeg sync-index tool executed against the bundled demo media; the demo audio is effectively silent, so the production importer correctly rejects zero-quality windows.
- Live room-acoustic accuracy remains a beta/field-validation item; the protocol and deterministic matcher are implemented, not claimed as calibrated for every acoustic environment yet.

## v0.13.0-alpha.2 — Governed Platform Connectors & Mobile Core

- Added Organization-owned governed platform connections for `YOUTUBE`, `INSTAGRAM`, and `TIKTOK`.
- Platform secrets are represented only as `credentialsRef`; raw tokens/passwords are rejected. The current runtime implements `env:` resolution and leaves secret-manager schemes behind the same adapter seam.
- Binding-to-connection assignment is constrained by Organization, platform and active connection state.
- YouTube/Instagram/TikTok metadata adapters refresh external metadata into the playback binding without changing the canonical SceneShop Content/Sync ID.
- Platform connection lifecycle supports `ACTIVE`, `DISABLED`, `REVOKED` and credential-reference rotation.
- PWA manifest now supports Web Share Target into the Companion source field.
- Added framework-independent `clients/mobile-core` with Playback Head / Browse Head, `LIVE/BROWSING`, Go Live, spoiler policy and missed-commerce state for reuse by the future native app.
- Migration `0020_platform_connectors_mobile.sql` adds governed connections and metadata fields.

### Validation

- 148/148 unit/contract tests PASS.
- 86/86 real HTTP integration checks PASS.
- Migration chain: 20 contiguous migrations, latest `0020_platform_connectors_mobile.sql`.
- Local preflight PASS. Strict RC remains intentionally blocked by the pre-existing environment gate: the exact npm lock tree for `pg`, `redis`, and `@socket.io/redis-adapter` cannot be regenerated in this network-isolated container, and live PostgreSQL/Redis services are unavailable here.

## RC preparation

The `release/v0.13` line is frozen from `v0.13.0-alpha.2`. No alpha.3 is planned. Local regression is green (148/148 tests, 86/86 HTTP checks, 20 migrations). Promotion to `v0.13.0-RC.1` remains gated by an exact npm lock tree plus live PostgreSQL/Redis validation and provider credential smoke tests; these are intentionally not simulated in the network-isolated development container. See `docs/data/V0_13_RELEASE_GATE_R0_1.md`.
