# SceneShop Native Application Lifecycle R0.1

## Purpose
SceneShop Web, Desktop and Mobile remain delivery surfaces over one governed commerce runtime. Native lifecycle signals may pause/resume transport and expose OS capabilities, but they never become Commerce Timeline, AI, publication, payment or attribution authority.

## Lifecycle contract
`public/js/app-shell.js` emits `sceneshop:app-lifecycle` for browser visibility, page lifecycle and online/offline changes. Native Android/iOS hosts may additionally send `APP_LIFECYCLE` through `window.SceneShopNativeEvent`.

The Companion persists its Browse/Playback state when backgrounded. On foreground/online it revalidates the active session, refreshes the current playback position and reconnects Socket.IO if required. Re-entry does not force `BROWSING` back to `LIVE`.

## Share-in
Android declares `ACTION_SEND` for text payloads and converts accepted shares into a governed `SHARE_RECEIVED` event. iOS includes a Share Extension that forwards URL/text into the containing SceneShop app through the `sceneshop://share` seam. The web runtime may use the shared value as synchronization input; the native wrapper does not resolve commercial products itself.

## Notifications
Permission is never requested silently. The browser runtime first calls `NOTIFICATION_PERMISSION`; only explicit user interaction may issue `NOTIFICATION_REGISTER`.

Android requests `POST_NOTIFICATIONS` on API 33+ and reports permission state. A push-provider token remains `UNCONFIGURED` until an authorized Android push provider is integrated.

iOS requests authorization through `UNUserNotificationCenter`, registers with APNS when granted and emits the APNS token through `NOTIFICATION_REGISTRATION`. Production token delivery still requires the signed push entitlement/provisioning profile.

## Security boundary
All browser/native messages remain versioned, allowlisted and bounded. External navigation is opened outside the privileged WebView/WKWebView. Native secure stores remain Android Keystore/AES-GCM and Apple Keychain respectively.

## Signing and entitlements
`tools/native-signing-config.js` materializes deployment association files and a production iOS entitlement file from environment configuration. It does not persist keystore bytes, signing passwords or private signing material in the repository. Source AASA/Asset Links placeholders remain intentionally auditable.

## Platform build evidence
Android and iOS workflows compile on their native runners. `tools/native-build-evidence.js` binds an artifact SHA-256, byte length, package version and Git commit to the resulting build evidence. A debug/simulator build is not a production-signed build; evidence carries an explicit `signed` field.

## QA authority
`PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json` defines the minimum web/desktop/mobile runtime matrix. Static validation proves that the matrix is structurally complete only. Rows requiring a platform/device are PASS only after execution on that runtime.

## Production signature evidence hardening

A production artifact is not accepted merely because a build command was invoked with a `signed` flag. `tools/native-signature-verify.js` performs platform-native verification and binds the signer identity to the configured production authority: Android uses `apksigner verify --print-certs` and the configured SHA-256 certificate fingerprint; iOS uses `codesign --verify --deep --strict` and the configured Apple TeamIdentifier. `tools/native-build-evidence.js --signed` now requires the resulting same-commit signature evidence and verifies the artifact SHA-256 before it can emit `signatureVerified=true`.
