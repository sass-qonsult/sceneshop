# SceneShop Native Application Packaging R0.1

## Doctrine
Web/HTML, Desktop and Mobile are delivery surfaces over the same SceneShop commerce runtime. Native hosts may provide OS capabilities, but must not duplicate Commerce Timeline, product resolution, AI, payment, attribution or publication authority.

## Desktop
`apps/desktop/launcher.mjs` launches the canonical `/desktop` surface in a dedicated Chromium app-mode profile. Linux, macOS and Windows installation helpers are included. Non-local HTTP origins are rejected unless explicitly overridden for controlled development.

## Mobile
Android and iOS projects host the canonical `/mobile` surface in WebView/WKWebView. They expose a narrow native bridge for OS-only capabilities such as share/open-external and provide secure storage and governed notification/share-in lifecycle seams while keeping push-provider authority external. Both projects declare the `sceneshop://` deep-link seam; Android additionally declares the production HTTPS session route.

## Build authority
Native packaging is considered build-validated only on the corresponding platform toolchain. Linux can validate the desktop launcher in this repository; Android requires Android SDK/Gradle; iOS requires macOS/Xcode. Static contract tests run everywhere and must pass before platform builds.

## Bidirectional bridge
The browser/native bridge is versioned and allowlisted. Requests are bounded to 16 KiB and may return through `window.SceneShopNativeResolve`. Android uses Android Keystore-backed AES-GCM for secure values; iOS uses Keychain with this-device-only accessibility. Native wrappers are not allowed to evaluate arbitrary commands supplied by web content.

## Production linking and signing
The repository publishes Apple AASA and Android Asset Links endpoints, but production identifiers remain explicit placeholders until signing authority is available. `npm run preflight:native-apps` validates development structure; `npm run preflight:native-apps:strict` deliberately fails until Android signing, Apple Team ID and their platform toolchains are available.


## Lifecycle and Production Beta
Lifecycle, share-in, notification registration, platform build workflows, signing injection and QA authority are defined in `NATIVE_APPLICATION_LIFECYCLE_R0_1.md` and `PRODUCTION_BETA_ACCEPTANCE_R0_1.md`.
