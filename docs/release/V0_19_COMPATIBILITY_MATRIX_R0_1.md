# SceneShop v0.19 — Compatibility Matrix R0.1

| Layer | RC contract | Validation authority |
| --- | --- | --- |
| Node.js | `>=20` (Node 22 operational baseline) | `package.json`, strict preflight |
| PostgreSQL | validated on `16.15` | `compose.yaml`, foundation/recovery/schema gates |
| Redis | validated on `7.4.11` | `compose.yaml`, foundation/cache/session gates |
| PostgreSQL schema | 27 migrations, latest `0027_cache_coordination_recovery.sql` | migration checksums + isolated live schema gate |
| Native bridge | protocol `1`, payload <= 16 KiB | shared Node/browser contract + RC contract |
| Web | current Chromium, Firefox, Safari/WebKit matrix | real runtime QA evidence |
| Desktop | Linux + Chromium, Windows + Chromium/Edge, macOS + Chromium | real runtime QA + package evidence |
| Android | API 26 minimum; API 33 permission boundary; API 35 target | Gradle build + real runtime QA + signing evidence |
| iOS | iOS 15 minimum; current simulator and signed physical device | Xcode build + real runtime QA + Apple signing/APNS evidence |

The matrix is an RC validation boundary, not a promise that untested older/newer infrastructure is incompatible. Production promotion is based only on evidence for the declared contract.
