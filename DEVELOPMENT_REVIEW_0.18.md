# SceneShop Development Review — v0.18

## v0.18.0-alpha.1-dev.1 — Application Surfaces Foundation

Status: implemented and deterministically validated. Development candidate because the parent v0.17 live promotion gate is still externally pending.

### Scope
- official Web/HTML application at `/app`;
- official installable Desktop application surface at `/desktop`;
- official installable Mobile/Companion application surface at `/mobile`;
- legacy `/s/:code` preserved for QR/session compatibility;
- shared surface/session/deep-link core under `clients/application-core` / `public/js/app-core.js`;
- shared install/native-bridge shell under `public/js/app-shell.js`;
- all three surfaces reuse the canonical `mobile-core.js` Playback Head/Browse Head state machine and the same Commerce Timeline/runtime commerce client;
- per-surface standalone web manifests with 192px/512px app icons;
- v0.18 service worker precaches all three application shells, purges stale SceneShop caches and has an explicit offline shell;
- surface switching preserves session code and shared content URL;
- session parsing no longer mistakes `mobile.html`/`desktop.html` paths for session IDs;
- controlled native wrapper seam supports a browser fallback, `SceneShopNative.postMessage`, and iOS `webkit.messageHandlers.sceneshop` without duplicating commerce authority.

### Application boundary
The HTML/web application is usable directly in a browser. Desktop and Mobile are installable standalone PWA applications in alpha.1. They are not being presented as the final OS-native packages: the next v0.18 increment will add packaged desktop and iOS/Android wrapper projects over this exact shared core/bridge.

### Validation
- application surfaces + mobile core: **16/16 PASS**;
- dependency-constrained executable regression: **165/165 PASS**;
- full `npm test`: **165 PASS / 2 process failures**, both the unchanged sandbox `MODULE_NOT_FOUND` package-install limitation (`privacy-security.test.js` and `unit.test.js`);
- strict release preflight: PASS;
- exact npm offline clean-install dry run: **143 packages**, PASS;
- migration chain remains **27/27**, latest `0027_cache_coordination_recovery.sql`;
- JS syntax and `git diff --check`: PASS.

### Next v0.18 increment
- packaged desktop wrapper using the shared application bridge rather than a forked commerce implementation;
- iOS and Android wrapper projects around `/mobile` / shared application core;
- native deep-link/share handoff;
- native secure-storage/notification seams where platform capability is genuinely required;
- packaging/build/runbook and device QA gates.

## v0.18.0-alpha.2-dev.1 — Native Application Packaging & Bridge

Status: implemented and deterministically validated as a development candidate. Production-signed mobile binaries remain platform-toolchain gates.

### Scope
- versioned, allowlisted browser/native bridge with bounded payloads and request/response semantics;
- packaged desktop host for the canonical `/desktop` application, with Linux/macOS/Windows install helpers and dedicated app-mode profile;
- Android native wrapper project around the canonical `/mobile` surface;
- iOS native wrapper project around the canonical `/mobile` surface;
- Android secure storage backed by Android Keystore + AES-GCM;
- iOS secure storage backed by Keychain;
- native share/open-external/device-context seams without moving Commerce/AI/Payments authority into the wrappers;
- WebView/WKWebView origin isolation so the native bridge is never exposed to arbitrary external navigation;
- SceneShop session deep links (`/s/:code` and `sceneshop://session/...`) normalize to the canonical mobile session query;
- Apple AASA and Android Asset Links endpoints are explicit; production Team ID/signing fingerprint remain audited placeholders until signing authority is available;
- deterministic package builder produces desktop-host, Android-source and iOS-source ZIPs with SHA-256 checksums;
- native app preflight distinguishes development-ready structure from production-signed readiness.

### Application boundary
HTML/Web remains directly deployable. The desktop package is a thin host that launches the canonical `/desktop` surface in a dedicated Chromium app-mode runtime; it is not presented as a self-contained browser engine. Android/iOS are real native wrapper projects but APK/IPA signing/build validation requires the respective Android SDK/Gradle and macOS/Xcode toolchains.

### Validation
- application/mobile/native packaging tests: **28/28 PASS**;
- dependency-constrained executable regression: **177/177 PASS**;
- full `npm test`: **177 PASS / 2 process failures**, both the unchanged sandbox package-byte limitation in `privacy-security.test.js` and `unit.test.js`;
- strict repository release preflight: PASS;
- exact npm offline clean-install dry run: **143 packages**, PASS;
- desktop runtime dry-run: PASS against installed Chromium;
- development native-app preflight: PASS;
- strict production native-app preflight: correctly BLOCKED because Android SDK/Gradle + production signing fingerprint and macOS/Xcode + Apple Team ID are unavailable/unconfigured here;
- generated desktop/Android/iOS package ZIP integrity: PASS;
- migration chain remains **27/27**, latest `0027_cache_coordination_recovery.sql`;
- JS/MJS syntax, shell syntax and `git diff --check`: PASS.

### Next v0.18 increment
- device QA matrix and lifecycle handling (foreground/background/reconnect/offline);
- native notification permission/token seam and share-intent receive path;
- production signing/entitlement injection without committing secrets;
- platform build workflows for Android and iOS runners;
- Production Beta acceptance gate across Web/Desktop/Mobile.

## v0.18.0-alpha.3-dev.1 — Production Beta Lifecycle & Platform Gates

Status: implemented and deterministically validated as a development candidate. Real Android/iOS build/sign/device gates remain external platform authority.

### Scope
- browser + native lifecycle event model for foreground/background/online/offline;
- Companion persists Browse/Playback state in background and revalidates/reconnects on resume without forcing BROWSING to LIVE;
- Android `ACTION_SEND` share-in path with governed `SHARE_RECEIVED` delivery;
- iOS Share Extension forwarding URL/text into the canonical mobile application;
- explicit user-initiated notification permission/registration flow;
- Android API 33+ `POST_NOTIFICATIONS` permission handling, with push-token provider intentionally `UNCONFIGURED` until an authorized provider is integrated;
- iOS `UNUserNotificationCenter` + APNS registration/token event seam;
- build-time Android release signing support through environment-only keystore variables;
- deployment association/entitlement materialization from Apple Team ID and Android signing fingerprint without persisting secrets;
- Android Ubuntu/Gradle build workflow and iOS macOS/XcodeGen/xcodebuild workflow;
- SHA-256 build evidence binding artifact → package version → Git commit;
- 12-row Web/Desktop/Android/iOS Production Beta QA matrix with explicit platform execution authority.

### Validation
- Production Beta/native/application focused tests: **38/38 PASS**;
- dependency-constrained executable regression: **187/187 PASS**;
- full `npm test`: **187 PASS / 2 process failures**, both the unchanged sandbox `MODULE_NOT_FOUND: express` limitation in `privacy-security.test.js` and `unit.test.js`;
- strict repository release preflight: PASS;
- exact npm offline clean-install dry run: **143 packages**, PASS;
- native development preflight: PASS;
- Production Beta QA matrix structure: **12/12 required rows present**, PASS;
- migration chain remains **27/27**, latest `0027_cache_coordination_recovery.sql`.

### External gates preserved
- Android SDK/Gradle build is defined in CI but not executable in this sandbox;
- Android production signing identity/keystore is not available here;
- macOS/Xcode build is defined in CI but not executable in this Linux sandbox;
- Apple Team ID/code-signing/provisioning identity is not available here;
- parent PostgreSQL/Redis live foundation/recovery evidence remains a same-commit release requirement.

### Next v0.18 increment
- aggregate Production Beta acceptance evidence across live infrastructure + Desktop + Android + iOS;
- signed Android/iOS distribution candidates when signing authority is provided;
- execute device/browser QA matrix and close platform-specific findings;
- prepare `release/v0.18` only after those gates are evidenced.


## v0.18.0-alpha.4-dev.1 — Production Beta Acceptance Orchestrator

Status: implemented and deterministically validated as a development candidate. External live/platform/device/signing evidence remains fail-closed.

### Scope
- single fail-closed v0.18 acceptance manifest;
- same-commit/same-version validation across foundation, recovery, Desktop, Android, iOS and QA evidence;
- explicit separation of `betaCandidateEligible` from `productionDistributionReady`;
- QA evidence recorder that rejects incomplete PASS declarations and requires physical-device attestation for the signed iOS device row;
- production signing report bound to Git commit and package version;
- guarded `release/v0.18` / `v0.18.0-beta.1` promotion path with conflict-safe refs;
- cross-platform CI evidence workflow for repository, live infrastructure, Desktop, Android and iOS build evidence;
- Android wrapper version advanced to `0.18.0-alpha.4` / versionCode 4.

### Validation
- v0.18 application/native/acceptance focused suite: **47/47 PASS**;
- dependency-constrained executable regression: **196/196 PASS**;
- full `npm test`: **196 PASS / 2 process failures**, both the unchanged sandbox `MODULE_NOT_FOUND: express` limitation in `privacy-security.test.js` and `unit.test.js`;
- strict repository release preflight: PASS;
- exact npm offline clean-install dry run: **143 packages**, PASS;
- native development preflight: PASS;
- Production Beta QA matrix structure: **12/12 required rows present**, PASS;
- Desktop/Android/iOS source packages regenerated for `0.18.0-alpha.4` with SHA-256 output;
- migration chain remains **27/27**, latest `0027_cache_coordination_recovery.sql`;
- JS syntax, shell syntax, workflow YAML and `git diff --check`: PASS.

### External gates preserved
The acceptance manifest intentionally remains ineligible until the exact frozen commit receives current foundation/recovery evidence, Desktop/Android/iOS build evidence and PASS evidence for all 12 declared QA runtimes. Production distribution additionally requires current signing evidence plus signed Android/iOS artifacts.

### Doctrine
Alpha.4 closes release orchestration, not external validation. Platform/device/signing rows remain BLOCKED until the declared runtime or signing authority actually produces evidence for the exact current commit. No further v0.18 feature work is planned after this orchestrator; remaining work is gate execution and correction of any findings.


## v0.18.0-beta.1-rcprep.1 — Production Beta Freeze Preparation

Status: version-alignment/freeze step only; no new feature scope.

The package version and Android wrapper are advanced to the exact intended Production Beta version `0.18.0-beta.1`. This ensures every subsequent live infrastructure, platform build, QA and signing evidence is bound to the same commit/version that the guarded promotion command will publish. Promotion remains impossible until `betaCandidateEligible=true`. Production distribution additionally remains gated by `productionDistributionReady=true`.

Validation after version alignment: **47/47 focused PASS**, **196/196 dependency-constrained executable regression PASS**, strict preflight PASS, exact offline npm clean-install dry run **143 packages PASS**, and `git diff --check` PASS.
