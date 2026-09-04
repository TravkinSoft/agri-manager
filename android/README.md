# TravkinFlow Native Android — full Agronomist cabinet (in progress)

Jetpack Compose client for the existing Play identity `com.travkin.flow`. Owner expanded the scope on 2026-09-04 from the previous identity-only foundation to the entire working Agronomist cabinet.

**NOT READY FOR INTERNAL TEST.** Do not upload the previous minimal signed V3 bundle. Acceptance is tracked in `../docs/google-play/agronomist-parity-2026-09-04.md` and the machine-readable readiness manifest.

## Architecture and isolation

- Isolated worktree `project-google-market-native-v1`, branch `codex/google-market-native-v1`.
- Native Compose UI, user-scoped HTTPS API calls, server-authoritative role/company.
- Agronomist only; no role impersonation, operator station or administrative cabinet.
- No WebView, TWA, Custom Tabs or embedded-site fallback.
- `debug`: package `com.travkin.flow.qa`, API `https://qa.travkinflow.com`.
- `release`: package `com.travkin.flow`, API `https://travkinflow.com`.
- Historical seasons/operation reads use the same Supabase Data API as the web, with user JWT and publishable/anon key; never a service key.
- No web application changes, database migrations/RLS changes, master merge or Production deployment.
- Development/verification Production business writes: **0**. Implemented commands are invoked only by explicit app-user actions.

## Current implementation (not device-accepted)

Primary navigation follows the actual Agronomist menu: harvest summary, crop structure, warehouses, harvest tickets, vehicle traffic and weather. Shared notification/settings screens are separate.

Implemented source surfaces include period/identity filters and party drilldowns; crop/fallow/mix field dossiers and historical seasons; crop editor; warehouse stock/lot details; harvest ticket status filters; fleet selection and employee access information; forecast/operating windows and personal weather-profile CRUD; notifications/read acknowledgements and notification preferences.

Persistent vehicle-driver assignment was also ported from the new web baseline, including its compare-and-set token and scope-checked receipt. PDF export uses the existing ticket PDF unchanged, and renders the existing field-card HTML response as native paginated PDF text (no script execution/browser engine). Only an explicit Android document-picker action writes to the user's chosen destination. MIME/template/size checks reject login pages and unexpected content. This is not a claim of exact browser print layout or device acceptance.

Still required: operation planning and all detailed operation actions/attachments, printing/export visual fidelity, complete payload/surface parity audit, role-realistic QA and physical Android acceptance. Latest local gates: 67 unit tests, lintDebug and assembleDebug pass. Do not describe six navigation buttons or a passing build as full parity.

## Synchronization

Native screens read the same server data as the site on navigation, foreground, manual refresh and bounded foreground intervals (traffic 5 s, notifications 15 s, most pages 30 s, weather 5 min). Editing dialogs pause their page polling. Business records are not stored as a second independent Android database. Authentication tokens are encrypted using Android Keystore.

Late results are guarded across navigation/logout/account changes. Commands use a separate no-retry/no-redirect client and a single in-flight UI action; an uncertain network outcome requires reading the canonical server state before trying again.

Data and supported actions are shared with the website. Changes to native layouts/features require a new Android build; website UI code does not automatically become a native screen.

## Debug verification

Set process-only `TRAVKINFLOW_SUPABASE_URL` and `TRAVKINFLOW_SUPABASE_ANON_KEY` for the **QA Supabase project** before building a usable QA login APK. Do not use Production authentication configuration with the QA website.

```powershell
./gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

A build without public Auth configuration is suitable for compilation checks only, not a successful login demonstration. Never put account passwords in source, Gradle properties or reports.

Current integration blocker (2026-09-04): unauthenticated native HTTP calls to QA `/api/healthz`, `/api/auth/actor` and `/auth/login` each return **302 to vercel.com**. A browser's Vercel SSO session does not establish native app access. No deployment-protection bypass secret was embedded and no QA/Production protection setting was changed. Arrange an explicitly authorized Android QA access path before account/device testing. No device was connected at this checkpoint.

## Release guard

`preReleaseBuild` and `build-play-bundle.ps1` reject signing/packaging while `readyForInternalTest`, `deviceAcceptance` and `roleRealisticQa` are false. Passing tests alone must not change these fields. The PowerShell guard runs before opening signing files.

After acceptance, existing signing invariants still apply: exact native worktree/branch and approved native ancestry, clean HEAD, package/version/target, external upload key/alias/fingerprint, bundletool validation and signer verification. The legacy TWA checkout is rejected. The script builds but never uploads or publishes.

No signing material is kept in Git. Preserve the existing external keystore, backup and prior signed AAB. Production and database require no rollback because this workstream has not changed them.

## Device acceptance

Check real Agronomist login (not Global Admin with a role switch), company isolation and rejection of other roles; all screen/actions against the pinned web version; Android back/keyboard/rotation/process restart; network loss, token refresh/logout and mutation uncertainty; upgrade from the existing Play build without uninstall. Do not mark Internal Testing live until Play accepts the new AAB.
