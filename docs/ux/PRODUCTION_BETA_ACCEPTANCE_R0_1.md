# SceneShop v0.18 Production Beta Acceptance R0.1

## Candidate scope
A Production Beta candidate must expose the same governed SceneShop runtime through Web/HTML, Desktop and Mobile without duplicating Commerce/AI/Payments authority in native wrappers.

## Deterministic repository gates
Before platform execution:

- strict dependency-lock preflight PASS;
- migration chain continuous and checksum-valid;
- application/native/lifecycle regression PASS;
- desktop launcher dry-run PASS;
- native development preflight PASS;
- application QA matrix structurally complete;
- app packages reproducibly generated with SHA-256 checksums.

## Live infrastructure gates
The current commit must also pass the PostgreSQL/Redis foundation and recovery gates. v0.18 does not inherit a historical PASS from a different commit.

## Platform build gates
Android requires a real Android SDK/Gradle build. iOS requires a real macOS/Xcode build. Build evidence must identify current Git commit, current package version and artifact SHA-256.

Debug Android and iOS Simulator builds are useful engineering evidence but do not authorize production distribution.

## Production signing gates
Production distribution additionally requires:

- Android production signing certificate fingerprint;
- Android keystore and key credentials supplied only through the CI/secret environment;
- Apple Team ID and valid code-signing identity/provisioning profile;
- Apple push entitlement if APNS token delivery is enabled;
- generated AASA/Asset Links matching the actual signing identities.

No signing secret is committed to Git or included in downloadable source bundles.

## Device QA
The matrix in `docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json` must be executed. Platform-specific rows remain pending until their declared runtime was actually used. Repository tests must never substitute for a device/toolchain result.

## Promotion doctrine
`release/v0.18` is reserved for a Production Beta candidate whose repository, live infrastructure and required platform gates are evidenced. Development tags may be frozen before those external gates, but must be labeled accordingly.


## Acceptance manifest
The canonical acceptance command is:

```bash
npm run beta:manifest
```

It emits `artifacts/production-beta/v0.18-production-beta-manifest.json` and binds every accepted evidence item to the current Git commit and current package version.

Two readiness states are intentionally separate:

- `betaCandidateEligible`: repository, live PostgreSQL/Redis, recovery, Desktop/Android/iOS builds and all QA matrix rows are evidenced for the same candidate;
- `productionDistributionReady`: everything above plus production signing material and signed Android/iOS build evidence.

`npm run beta:verify` requires the first state. `npm run beta:verify:distribution` requires the second.

## QA evidence recording
A matrix row is recorded only after the declared runtime was actually used:

```bash
npm run qa:apps:record -- \
  --id=web-chromium \
  --result=PASS \
  --checks=session-deeplink,commerce-timeline,offline-shell,share-out \
  --out=artifacts/app-qa/executions/web-chromium-<timestamp>.json
```

The recorder rejects incomplete PASS declarations. The `ios-current-device` row additionally requires `--physical-device`.

## Promotion command
`release/v0.18` and `v0.18.0-beta.1` are created only by the guarded promotion command and only when the package itself is already `0.18.0-beta.1` and `betaCandidateEligible=true`:

```bash
npm run beta:promote:dry
npm run beta:promote
```

Existing conflicting refs are never overwritten.
