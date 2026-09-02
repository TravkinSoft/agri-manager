# TravkinFlow Native Android

Jetpack Compose client for the existing Play identity `com.travkin.flow`.

## Runtime boundary

- The business UI is native Compose.
- The runtime has no WebView, TWA or embedded-site fallback.
- `debug`: package `com.travkin.flow.qa`, API `https://qa.travkinflow.com`.
- `release`: package `com.travkin.flow`, API `https://travkinflow.com`.
- Supabase Auth URL and publishable/anon key are supplied at build time. No service role, signing password or database secret belongs in the app or Git.

## Build configuration

Set these process-only variables before a QA build that needs login:

- `TRAVKINFLOW_SUPABASE_URL`
- `TRAVKINFLOW_SUPABASE_ANON_KEY`

Without them the APK still compiles, but login fails closed with a configuration message.

Release signing continues to use the existing external variables:

- `TRAVKINFLOW_UPLOAD_KEYSTORE`
- `TRAVKINFLOW_UPLOAD_STORE_PASSWORD`
- `TRAVKINFLOW_UPLOAD_KEY_ALIAS`
- `TRAVKINFLOW_UPLOAD_KEY_PASSWORD`

No signing material is stored in this repository.

## Current native foundation

- email/password authentication against Supabase Auth over HTTPS;
- access/refresh token encryption with Android Keystore AES-GCM;
- server-authoritative actor/role lookup through `GET /api/auth/actor`;
- fail-closed scope for Global Admin, Company Admin, Агроном, Весовщик and Специалист;
- a real read-only Compose operational overview from `GET /api/weighbridge/bootstrap?summary=true`;
- read-only ticket list and details, harvest summary, warehouse/object balances, KATO weather and notifications;
- profile/session screen, immediate local logout and explicit expired-session return to login;
- native Weighbridge workspace with operator/shift/queue/weight UI and encrypted idempotent retry queue;
- Weighbridge mutations are disabled in every release build and can run only in a QA build with an explicit process flag;
- encrypted company-scoped read cache with explicit stale/offline UI;
- serialized token refresh and no automatic replay of write requests;
- native logout and App Links intent filters.

FCM/device-token delivery, camera/files, complete native deep-link routing and device E2E acceptance are not implemented. The main backend stream reports the QA Weighbridge contract deployed; positive E2E still waits for a safely provisioned QA auth session/PIN. Release writes remain fail-closed, so this does not block the read-only release materials.

## Verification

```powershell
./gradlew.bat testDebugUnitTest testReleaseUnitTest lintDebug lintRelease assembleDebug assembleRelease bundleRelease
```

For the final signed Play bundle, set only the Supabase URL/publishable key in the current terminal and run `build-play-bundle.ps1`. The script always prompts for both upload-key passwords without echoing them and removes signing variables when it exits. It creates `app/build/outputs/bundle/release/app-release.aab`; it does not upload or publish anything.

Static runtime gate:

```powershell
rg -n "WebView|androidx\.webkit|loadUrl|TrustedWebActivity|bubblewrap" app/src/main
```

The static command must return no matches.
