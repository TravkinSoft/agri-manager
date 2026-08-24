# TravkinFlow Android V1

This is the native Android shell for the existing TravkinFlow application. It replaces the previous TWA-only delivery while keeping the established Play identity `com.travkin.flow`.

## Runtime channels

- `debug`: `com.travkin.flow.qa`, opens `https://qa.travkinflow.com`.
- `release`: `com.travkin.flow`, opens `https://travkinflow.com`.

The shell contains no Supabase service role, Vercel token, database password, API secret, or signing password. Authentication remains in the protected web application and persists in the first-party WebView storage. The weighbridge PIN remains an independent server-side business gate.

## Local verification

```powershell
$env:JAVA_HOME = "$HOME\.bubblewrap\jdk\jdk-17.0.11+9"
$env:ANDROID_HOME = "$HOME\.bubblewrap\android_sdk"
./gradlew.bat testDebugUnitTest assembleDebug
```

The debug APK is generated at `app/build/outputs/apk/debug/app-debug.apk` and is intentionally ignored by Git.

## Release AAB

`./gradlew.bat bundleRelease` builds an unsigned release AAB unless all approved upload-signing environment variables are present:

- `TRAVKINFLOW_UPLOAD_KEYSTORE`
- `TRAVKINFLOW_UPLOAD_STORE_PASSWORD`
- `TRAVKINFLOW_UPLOAD_KEY_ALIAS`
- `TRAVKINFLOW_UPLOAD_KEY_PASSWORD`

No signing material is stored in this repository. Google Play publication remains an owner-controlled action.

## Native capabilities

- no browser toolbar or URL bar;
- safe-area/status/navigation bar integration;
- Android Back closes a dismissible dialog first, then navigates application history;
- first-party session persistence across process restarts;
- trusted deep links for tickets, fields, warehouses and notifications;
- network loss/recovery state;
- authenticated PDF/file download using current first-party cookies;
- native file picker and camera handoff without broad storage/camera permission;
- native share bridge (`window.TravkinAndroid.share(...)`);
- notification channels for important and agronomic events.

Remote push delivery still requires the owner-controlled Firebase configuration. The app does not request notification permission automatically.
