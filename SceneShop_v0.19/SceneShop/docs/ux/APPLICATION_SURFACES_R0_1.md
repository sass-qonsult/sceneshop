# SceneShop Application Surfaces R0.1

## Purpose
v0.18 Production Beta makes SceneShop an explicit multi-surface application product. The web/HTML, desktop and mobile applications are different presentation surfaces over the same governed backend, Commerce Timeline and Companion state machine.

## Official surfaces

- **Web / HTML (`/app`)** — zero-install browser application for consumers and partner handoff.
- **Desktop (`/desktop`)** — installable standalone desktop PWA with wider Commerce Timeline/product layout and keyboard-capable interaction.
- **Mobile (`/mobile`)** — installable Companion-first PWA optimized for touch, QR/session join, shared URLs and external playback synchronization.

The legacy `/s/:code` route continues to open the mobile surface for QR/session compatibility.

## Shared core

All three surfaces load the same:

- `mobile-core.js` — Playback Head / Browse Head state machine;
- `app-core.js` — surface selection, session/deep-link parsing and cross-surface URL continuity;
- `mobile.js` — governed Commerce Timeline, dynamic commerce resolution, saved products, missed scenes and synchronization behavior;
- `app-shell.js` — installability, surface navigation, service worker and native-wrapper bridge seam.

No surface may fork pricing, attribution, publication, placement or session authority.

## Installation model

Each surface has its own web manifest. The v0.18 alpha.1 desktop application is an installable standalone PWA, not yet a packaged OS-native binary. The mobile application is likewise installable and preserves a native bridge seam for the later iOS/Android wrapper. This prevents a native wrapper from becoming a second commerce implementation.

## Native bridge seam

`window.SceneShopAppBridge.notify(type, payload)` provides a controlled seam for future desktop/iOS/Android wrappers. The browser fallback dispatches `sceneshop:native`; platform wrappers may expose `SceneShopNative.postMessage` or the iOS `webkit.messageHandlers.sceneshop` handler.

## Offline boundary

The service worker caches application shells and static assets only. PostgreSQL/Redis authority, current offers, attribution decisions and live synchronization remain network-authoritative. Offline mode never fabricates a price or commercial placement.
