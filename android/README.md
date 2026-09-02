# TravkinFlow Native Android

Jetpack Compose client for the existing Play identity `com.travkin.flow`.

## Product scope

The current Google Play release is an Agronomist-only native foundation:

- Supabase email/password authentication over HTTPS;
- server-authoritative actor lookup through `GET /api/auth/actor`;
- fail-closed admission for the single wire role `agronomist`;
- encrypted access/refresh token and actor cache through Android Keystore AES-GCM;
- one native Agronomist cabinet with server-verified role/company context, refresh and logout.

No other role is accepted by the Android client. Global Admin, Company Admin, Weighman, Specialist, warehouse and any unknown role fail closed and their local session is cleared.

The release intentionally has no field map or secondary working pages. Those features are added later, one independently accepted stage at a time.

The Android runtime contains no weighbridge screen, weighing workflow, ticket flow, operator session, write queue or weighbridge API route. The weighbridge remains a desktop web tool.

Travkin Copilot is not rendered or linked anywhere in the Agronomist Android UI. There is no Copilot button, tab, panel, deep link or API entry point in this mobile artifact. The existing web Copilot engine/API is not deleted or changed and remains outside this Android worktree.

## Runtime boundary

- The business UI is native Compose.
- The runtime has no WebView, TWA, Bubblewrap, Android Browser Helper, Custom Tabs or embedded-site fallback.
- `debug`: package `com.travkin.flow.qa`, API `https://qa.travkinflow.com`.
- `release`: package `com.travkin.flow`, API `https://travkinflow.com`.
- Only a Supabase publishable/anon key may be embedded. Service-role, signing passwords and database secrets never belong in the app or Git.
- No database schema, RLS policy, web application or web Production deployment is changed by this Android scope.

## Build configuration

Set these process-only variables before a build that needs login:

- `TRAVKINFLOW_SUPABASE_URL`
- `TRAVKINFLOW_SUPABASE_ANON_KEY`

Release signing uses only the external variables managed by `build-play-bundle.ps1`:

- `TRAVKINFLOW_UPLOAD_KEYSTORE`
- `TRAVKINFLOW_UPLOAD_STORE_PASSWORD`
- `TRAVKINFLOW_UPLOAD_KEY_ALIAS`
- `TRAVKINFLOW_UPLOAD_KEY_PASSWORD`

No signing material is stored in this repository.

## Verification

```powershell
./gradlew.bat testDebugUnitTest testReleaseUnitTest lintDebug lintRelease assembleDebug assembleRelease bundleRelease
```

Static product-scope gate:

```powershell
rg -n -i "WebView|androidx\.webkit|loadUrl|TrustedWebActivity|bubblewrap|androidbrowserhelper|CustomTabs|weighbridge|weighman|Весов|copilot|assistant" app/src/main
```

The static command must return no matches. The release dependency tree must also contain zero WebView/TWA dependencies.

## Play signing gate

For the final signed Play bundle, set only the Supabase URL/publishable key in the current terminal and run `build-play-bundle.ps1`. The script prompts for both upload-key passwords without echoing them, clears signing variables on exit, creates the AAB, validates it and never uploads or publishes it.

The signing command accepts only:

- worktree `C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market-native-v1`;
- branch `codex/google-market-native-v1`;
- a clean HEAD descending from native baseline `909bd1eed3c367f0fcca68c2d765ef567d09e300`;
- package/version/target `com.travkin.flow` / `3` / `3.0.0` / API 36;
- alias `travkinflow-upload` with the exact Google Play Upload certificate;
- zero forbidden runtime/source/dependency matches.

The legacy `C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market\android` TWA project is explicitly rejected and must never be used for Play V3 signing.

After the build, the script requires `bundletool validate`, a valid `jarsigner` AAB signature and an exact signer-certificate match. `apksigner` is used only for APK artifacts, not AAB files.

## V3-over-V2 device smoke

- Install V2 from the Play Internal track, then update to V3 without uninstalling.
- Confirm package `com.travkin.flow`, version `3.0.0` / code `3` and native Compose rendering with no browser surface.
- Confirm that an Agronomist can sign in and reopen the app with the encrypted native session.
- Confirm that a non-Agronomist account is rejected and leaves no usable local session.
- Confirm that only the main Agronomist cabinet exists and that no field map, weighbridge or Copilot entry point is visible or reachable through `/dashboard`.
