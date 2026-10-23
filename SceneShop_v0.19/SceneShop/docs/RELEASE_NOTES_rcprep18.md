# SceneShop v0.19 rcprep.18 — Release Notes

Base: rcprep.17. **Cumulative: it includes rcprep.13 to rcprep.17.** Patches are provided from rcprep.15, rcprep.16 and rcprep.17. **No database migration.** **New APK** (versionCode 9). `/api/health` shows `"build": "rcprep.18"`.

## What changed

| Request | Change |
| --- | --- |
| In the APK the QR code button did not turn the camera on | APKs built before rcprep.16 refused camera access to the page; only the microphone was allowed. The camera inside an Android WebView also depends on the phone's WebView version and permissions. The Android app now opens **Google's native QR scanner** (Google Play services code scanner) when the button is tapped. It is a full-screen camera that needs no camera permission from the app and does not depend on the WebView. It returns only the text read, and the app connects to that session. Cancelling returns to the home screen. If the native scanner is not available (an older APK, or a phone without Google Play services), the page falls back to its own camera reader. That reader now shows a clear message when the camera is blocked in the phone settings. iOS and browsers keep using the page's camera reader. |

## Android (APK)
- versionCode 9. New dependency `com.google.android.gms:play-services-code-scanner:16.1.0`, plus a manifest entry so Google Play services downloads the scanner together with the app. New bridge message `SCAN_QR`.
- **The fix only reaches phones with the new APK installed.** The web part goes live when the server is updated.

## Tests run (clean clone)
- `npm test` 286/286.
- API suites up to `test:rc17` pass.
- All browser suites pass (13 suites). The new **rcprep18** suite has 4 checks:
  - the button calls the native scanner and connects to the session read;
  - cancelling returns home;
  - an old APK without the scanner falls back to the page camera;
  - no JavaScript errors.
