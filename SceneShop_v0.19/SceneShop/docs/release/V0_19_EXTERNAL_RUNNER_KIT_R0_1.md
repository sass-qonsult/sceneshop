# SceneShop v0.19 — External Runner Kit R0.1

## Purpose

The canonical SceneShop repository may be transported as a full Git bundle. The RC gate therefore must not depend on one central CI provider. Every external runner MUST execute the exact candidate commit and emit same-commit evidence. The canonical RC candidate is promoted only after the evidence set is imported and `npm run rc:verify` returns PASS.

## Candidate identity

Before running any gate:

```bash
git rev-parse HEAD
node -p "require('./package.json').version"
npm run rc:contract
npm run rc:schema
```

All evidence for one promotion must contain the same `gitCommit` and `packageVersion`.

## Linux / infrastructure runner

Required: Node >=20, npm, Docker with Compose, network access for the exact npm lock, PostgreSQL/Redis images.

```bash
npm run gate:foundation
npm run gate:recovery
npm run build:app-packages
DESKTOP=$(find artifacts/app-packages -name 'SceneShop_Desktop_Host_*.zip' -type f | head -1)
node tools/native-build-evidence.js \
  --platform=desktop \
  --artifact="$DESKTOP" \
  --out=artifacts/native-build/desktop.json
```

`gate:foundation` also runs the isolated v0.19 live schema compatibility gate and writes `artifacts/rc-gate/schema-compatibility.json`.

## Android runner

Required: JDK 17+, Android SDK 35, Gradle 8.9 or compatible wrapper/tooling, production signing material supplied only through environment/secret storage.

Engineering build:

```bash
gradle -p apps/mobile/android :app:assembleDebug --no-daemon
APK=$(find apps/mobile/android/app/build/outputs/apk/debug -name '*.apk' -type f | head -1)
node tools/native-build-evidence.js --platform=android --artifact="$APK" --out=artifacts/native-build/android.json
```

Production-signed build, after signing environment has been configured and verified:

```bash
npm run native:signing:verify
gradle -p apps/mobile/android :app:assembleRelease --no-daemon
APK=$(find apps/mobile/android/app/build/outputs/apk/release -name '*.apk' -type f | head -1)
# Verify the APK signature with Android build-tools before recording evidence.
node tools/native-signature-verify.js --platform=android --artifact="$APK" --out=artifacts/native-build/android-signature.json
node tools/native-build-evidence.js --platform=android --artifact="$APK" --signed --signature-evidence=artifacts/native-build/android-signature.json --out=artifacts/native-build/android-signed.json
```

Execute the Android QA rows on their declared API/runtime targets and record each PASS with `npm run qa:apps:record -- ...`. Static checks do not substitute for runtime/device execution.

## macOS / iOS runner

Required: macOS, Xcode, XcodeGen, Apple signing identity/provisioning for signed device distribution.

Simulator build:

```bash
cd apps/mobile/ios
xcodegen generate
xcodebuild -project SceneShopMobile.xcodeproj -scheme SceneShopMobile \
  -sdk iphonesimulator -configuration Debug \
  -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
APP=$(find build/DerivedData/Build/Products/Debug-iphonesimulator -name 'SceneShopMobile.app' -type d | head -1)
ditto -c -k --sequesterRsrc --keepParent "$APP" ../../../artifacts/native-build/SceneShopMobile-simulator.zip
cd ../../..
node tools/native-build-evidence.js --platform=ios \
  --artifact=artifacts/native-build/SceneShopMobile-simulator.zip \
  --out=artifacts/native-build/ios.json
```

For the signed device artifact, first run `npm run native:signing:verify`, archive/export using the authorized Apple identity and provisioning profile, run `node tools/native-signature-verify.js --platform=ios --artifact=<signed-package> --out=artifacts/native-build/ios-signature.json`, then record the build with `--signed --signature-evidence=artifacts/native-build/ios-signature.json` into `artifacts/native-build/ios-signed.json`. The signature verifier executes `codesign --verify --deep --strict` and checks the Apple TeamIdentifier.

Execute the iOS QA rows on the declared iOS 15 target, current simulator and a physical signed device. `ios-current-device` PASS requires the recorder's `--physical-device` attestation.

## Web/Desktop QA

Each matrix row must be executed on the runtime named in `docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json`. Record only observed checks:

```bash
npm run qa:apps:record -- \
  --id=web-chromium \
  --result=PASS \
  --runtime="Chromium current" \
  --checks=session-deeplink,commerce-timeline,offline-shell,share-out \
  --out=artifacts/app-qa/executions/web-chromium-<stamp>.json
```

A FAIL is evidence too and should be retained for audit, but it cannot satisfy promotion.

## Evidence transport and import

Copy evidence from all runners into one transport directory using this layout:

```text
external-evidence/
  foundation-gate/foundation-evidence-*.json
  recovery-gate/recovery-evidence-*.json
  rc-gate/schema-compatibility.json
  native-build/desktop.json
  native-build/android.json
  native-build/ios.json
  native-build/android-signed.json
  native-build/ios-signed.json
  native-signing/report.json
  app-qa/executions/*.json
```

Place that directory at `artifacts/external-evidence/` or pass another path directly to the importer.

Dry-run validation:

```bash
npm run rc:evidence:import:dry
```

Complete fail-closed import:

```bash
npm run rc:evidence:import
```

The importer refuses missing, stale, cross-version or cross-commit evidence and copies only validated evidence into the canonical ignored `artifacts/` locations.

## Final verification and promotion

```bash
npm run rc:manifest
npm run rc:verify
npm run rc:promote:dry
npm run rc:promote
```

`rc:promote` may create `release/v0.19` and `v0.19.0-rc.1` only when the manifest is eligible. No evidence file is a substitute for the final verifier.

## Evidence export from each runner

After a runner has produced its available canonical evidence, export a transport directory without touching Git-tracked source files:

```bash
npm run rc:evidence:export
```

The exporter writes `artifacts/runner-export/` with the canonical external-evidence layout plus `evidence-index.json` containing the candidate commit, package version, file sizes and SHA-256 hashes. Runner exports may be merged into the aggregator's `artifacts/external-evidence/`; the importer remains the authority and rejects stale or cross-commit material.

## One-command finalization

After all runner exports have been merged into `artifacts/external-evidence/`, the final promotion no longer requires a manual command sequence.

Dry-run:

```bash
npm run rc:finalize:dry
```

Finalization:

```bash
npm run rc:finalize
```

`rc:finalize` performs the fail-closed sequence in one process: validate the complete external evidence set, import only valid same-commit evidence, rebuild the RC manifest, verify eligibility, create `release/v0.19` and `v0.19.0-rc.1`, verify both refs point to the candidate commit, and write `artifacts/rc-gate/v0.19-finalization.json`. No Git ref is created before evidence import and manifest verification succeed.
