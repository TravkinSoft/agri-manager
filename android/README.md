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
- encrypted company-scoped read cache with explicit stale/offline UI;
- serialized token refresh and no automatic replay of write requests;
- native logout and App Links intent filters.

Write workflows, operator PIN, camera/files, FCM and offline command queue remain gated until their backend contracts and device E2E tests are complete.

## Verification

```powershell
./gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Static runtime gate:

```powershell
rg -n "WebView|androidx\.webkit|loadUrl|TrustedWebActivity|bubblewrap" app/src/main
```

The static command must return no matches.
