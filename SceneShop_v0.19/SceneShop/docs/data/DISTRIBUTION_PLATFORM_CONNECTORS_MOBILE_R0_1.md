# SceneShop — Distribution Platform Connectors & Mobile Core R0.1

Status: canonical implementation note for v0.13.0-alpha.2.

## Purpose

SceneShop treats YouTube, Instagram and TikTok as governed playback bindings, not as owners of the canonical SceneShop content identity. A Work keeps its own Content/Sync ID and may have multiple external bindings at the same time.

## Governed platform connections

`sceneshop_platform_connections` belongs to an Organization and stores only a `credentials_ref`, never a raw access token/password. The current runtime resolves `env:VARIABLE`; production secret-manager schemes can be added behind the same adapter contract.

Supported governed metadata adapters in this revision:
- YouTube: video metadata/duration/status via the YouTube Data API.
- Instagram: professional-media metadata via the Instagram API endpoint configured for the deployment.
- TikTok: video metadata via the Display API video-query contract.

Bindings can optionally reference one connection. Repository rules require connection and binding to belong to the same Organization and platform. Connections have `ACTIVE`, `DISABLED`, or `REVOKED` state and support credential-reference rotation.

Metadata refresh updates only metadata on the binding; the token itself never enters the binding payload.

## Companion share/deep-link

The PWA manifest exposes a Web Share Target that opens `/mobile.html?source=...`. The Companion UI can use the shared YouTube/Instagram/TikTok URL as a hint, while the temporal fingerprint remains the independent source for Content/Sync ID + playback-position recognition.

## Reusable mobile state core

`clients/mobile-core/index.js` is browser-independent and models:
- shared Playback Head observation;
- per-viewer Browse Head;
- `LIVE` / `BROWSING` state;
- `Go Live`;
- spoiler policies `PAST_ONLY`, `PAST_AND_CURRENT`, `FULL`;
- commercial scenes missed while a viewer is exploring another product.

This module is intentionally framework-free so the same state semantics can later be used by an iOS/Android client without coupling them to the existing PWA.

## Security invariants

1. Raw provider secrets are rejected by control-plane APIs.
2. Credentials remain secret references, not content metadata.
3. A connection cannot be attached cross-tenant or cross-platform.
4. Refresh uses the Organization-owned connection and fails when it is disabled/revoked.
5. External platform IDs never replace the canonical SceneShop Content/Sync ID.
