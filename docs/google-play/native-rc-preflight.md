# TravkinFlow Native Android V3 — Release Candidate preflight

Date: 2026-09-02

Branch: `codex/google-market-native-v1`

Status: preflight checkpoint only. No Play upload, Production deployment or database write is authorized by this document.

## Release identity and upgrade path

| Field | Release value | Result |
| --- | --- | --- |
| Package / application ID | `com.travkin.flow` | Matches the existing Play application |
| Namespace | `com.travkin.flow` | Pass |
| Previous Play versionCode | `2` | Known current Play artifact |
| Native RC versionCode | `3` | Monotonic update path: pass |
| Version name | `3.0.0` | Pass |
| minSdk | 29 | Android 10+ |
| targetSdk / compileSdk | 36 / 36 | Meets the 2026 Play target requirement |
| Release base URL | `https://travkinflow.com` | HTTPS only |
| Release app channel | `production` | Pass |
| Release Weighbridge write flag | hard-coded `false` | Production writes fail closed |

Upgrade acceptance still requires Play to accept an AAB signed by the registered upload key. The primary and backup keystore files exist and match by SHA-256, but no password or key material was read during this preflight.

## Native screen and role matrix

`company` means the server-confirmed company context is additionally required.

| Native screen | Global Admin | Company Admin | Агроном | Весовщик | Специалист | Contract / boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Login | Yes | Yes | Yes | Yes | Yes | Supabase email/password Auth; password not persisted |
| Operational overview | Yes | Yes | Yes | Yes | Yes | `GET /api/weighbridge/bootstrap?summary=true` |
| Tickets | Yes | Yes | Yes | Yes | Yes | `GET /api/weighbridge/tickets` |
| Ticket detail | Yes | Yes | Yes | Yes | Yes | `GET /api/weighbridge/tickets/{id}` |
| Harvest summary | Yes + company | Yes + company | Yes + company | No | No | `GET /api/dashboard/harvest-summary` |
| Warehouses/objects | Yes + company | Yes + company | Yes + company | Yes + company | No | `GET /api/warehouses/summaries` |
| Native Weighbridge | Yes + company | Yes + company | No | Yes + company | No | Reads available; all release mutations fail closed |
| Weather | Yes | No | Yes | No | No | KATO/location/forecast GET contracts only |
| Notifications | Yes | Yes | Yes | Yes | Yes | Supabase `user_notifications` SELECT with RLS |
| Profile/session | Yes | Yes | Yes | Yes | Yes | Local/server-confirmed identity; no token display |

Unsupported roles, including Warehouse worker, are rejected before the signed-in UI. The web Weighbridge page is not embedded or mobile-adapted; the Android screen is independent Compose UI.

## API contract inventory

Read/auth contracts:

- Supabase Auth: token/password, refresh token and best-effort logout.
- TravkinFlow actor: `GET /api/auth/actor`.
- Operational overview, tickets, ticket details, harvest summary and warehouse summaries.
- Weighbridge operator/session state.
- Weather KATO search, location resolution and forecast.
- Supabase PostgREST notification SELECT.

Mutation contracts present in source:

- operator unlock/lock;
- create harvest ticket;
- save gross weight;
- finalize tare/net/lot processing;
- idempotent encrypted retry queue.

Every mutation enters through `requireWeighbridgeWrites()`. The policy requires all four conditions: explicit build flag, `qa` channel, exact `https://qa.travkinflow.com` base URL, and an allowed role. `release` hard-codes the flag to `false`; setting the QA environment variable cannot enable release writes.

The main backend stream reports the QA station/backend contract deployed; this GM worktree has not independently live-verified it. Positive E2E still waits for a safely provisioned QA auth session/PIN. This is a QA/device acceptance gap, not a route to Production writes.

## Manifest and platform surface

- Source permissions: `INTERNET` and `ACCESS_NETWORK_STATE`; both are normal permissions. The merged artifact also declares/uses AndroidX's package-local `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` with `signature` protection. No runtime/sensitive permission is declared.
- Exported components: only `MainActivity`, required for launcher/App Links.
- Cleartext traffic: disabled in the application and network security config.
- Trust anchors: system certificates only; no user CA or debug override.
- Backup/device transfer: disabled at application level and excluded for shared preferences, databases and files.
- No service, receiver, content provider, camera, file provider, location, Bluetooth, contacts, SMS or notification permission.
- App Links are restricted to the exact HTTPS path `/dashboard` on `travkinflow.com` and `qa.travkinflow.com`; Production uses `autoVerify=true`, QA uses `false`.
- `onNewIntent` routes a trusted `/dashboard` link back to the native overview. Other site paths, including a future `/privacy`, are not claimed.

## Security and privacy implementation

- Supabase base URL must parse as a root HTTPS URL without credentials, query or fragment; invalid/cleartext values fail closed.
- Session, actor-scoped caches, notification cache, operator cookie and pending Weighbridge commands use Android Keystore AES-GCM storage.
- Password uses non-saveable Compose memory and is not written to saved-instance state.
- Logout clears the local actor/session state first and returns login immediately, then performs a bounded best-effort remote revoke.
- A repeated authenticated `401` clears local state and returns to login. Invalid login and invalid operator PIN remain distinct.
- Notification rows are filtered by server RLS and rechecked for actor/company scope in Android.
- WebView, TWA, `androidx.webkit`, browser fallback, Firebase/FCM and analytics/crash SDKs are absent.

## Accessibility and layout static preflight

- All primary screens use `LazyColumn`; the login form now has vertical scrolling for small screens, keyboard resize and larger font scales.
- Material buttons/icon buttons provide platform touch-target sizing.
- Action icons have Russian content descriptions; decorative icons use null descriptions next to visible text.
- Login fields expose email/password keyboard types and IME actions; password is visually masked.
- No hard-coded screen width/height was found; fixed sizes are limited to icons/progress indicators.
- Android lint accessibility/layout errors: 0 in debug and release.

Device-backed checks for TalkBack order, 200% font, landscape, 320dp width, keyboard overlap and contrast remain mandatory because static lint cannot prove rendered behaviour.

## Build and static gates

Final values are filled after the clean RC gate:

| Gate | Result |
| --- | --- |
| `testDebugUnitTest` | Pass: 13 tests, 0 failures/errors |
| `testReleaseUnitTest` | Pass: 13 tests, 0 failures/errors |
| `lintDebug` / `lintRelease` | Pass: 0 fatal, 0 errors, 12 warnings each |
| `assembleDebug` / `assembleRelease` | Pass |
| `bundleRelease` | Pass |
| `lintVitalRelease` and R8/resource shrink | Pass |
| WebView/TWA/browser implementation hits | 0 in source/build config and 0 forbidden runtime dependencies |
| Firebase/analytics/crash SDK hits | 0 |
| Release mutation flag proof | Generated `BuildConfig`: `APP_CHANNEL="production"`, `BASE_URL="https://travkinflow.com"`, `WEIGHBRIDGE_WRITE_ENABLED=false` |
| Debug APK | 64,680,443 bytes; SHA-256 `10EF312F58059A0BF208E1E4EF68DAB228FF2046FB04FD6C221C79D0FFEC5775` |
| Unsigned release APK | 3,429,759 bytes; SHA-256 `6EE2EDECE9CC9AE94EC5C4C975900C4B9A7E9C993EC2858E95FFF01F6D3A66AD` |
| Unsigned preflight AAB | 4,378,830 bytes; SHA-256 `3377556D62E4B58967ADBE62755E2298B5CD4CEA3B350CA807692217C9A5B05B` |

`android/build-play-bundle.ps1` is the final signing entry point. It reads Supabase configuration from process-only variables, always prompts without echo for both upload-key passwords, writes no secret into the project, removes signing variables on exit, verifies the AAB upload signature, and creates `android/app/build/outputs/bundle/release/app-release.aab`. It does not upload or publish.

The preflight AAB above is intentionally unsigned and was compiled without Supabase runtime values. `jarsigner` reports `jar is unsigned`; it must never be uploaded. The script parser passes with 0 errors, but the signed path remains pending the user's terminal entry.

The Kotlin metadata warning is fixed without suppression. The project pins R8 `9.1.31`, which is above the official Kotlin 2.4 minimum `9.1.29`; `BUNDLE-METADATA/com.android.tools/r8.json` records version `9.1.31`. A clean rerun of `minifyReleaseWithR8` and the complete suite produced zero Kotlin metadata parsing warnings and a successful AAB. R8 still reports two non-metadata messages that the AGP class-file provider does not support async parsing, and Kotlin reports that Gradle 8.11.1 will be deprecated only for future Kotlin 2.5; neither message is suppressed. Device smoke remains mandatory for the minified artifact.

## Privacy/store-source gates

- `npm run typecheck`: pass.
- Production `next build`: pass using non-secret build-only Supabase placeholders; `/privacy` is emitted as static HTML.
- Local production-server request to `/privacy`: HTTP 200, `text/html; charset=utf-8`, no redirect/`Location`, expected title and both explicit placeholders present.
- Targeted ESLint for `app/privacy/page.tsx` and the home-page footer: 0 errors/warnings. Repository-wide `npm run lint` still fails on five pre-existing errors outside these files and was not altered in this Google scope.
- Privacy source contains exactly two business placeholders: legal operator name and support contact; no deploy was performed.
- Deterministic store assets pass: opaque 1024 × 500 feature PNG and byte-identical 512 × 512 store icon copy.
- Local Android SDK contains no Emulator binary, system image or AVD; `adb devices -l` lists no device, so no emulator smoke is claimed.

## Live App Links evidence

- `https://travkinflow.com/.well-known/assetlinks.json`: HTTP 200, no redirect/`Location`, JSON content type.
- Exact package: `com.travkin.flow`.
- Play App Signing fingerprint present: `72:0D:D0:43:18:F8:A4:DC:38:CB:44:0E:53:E8:27:EE:B3:FA:EF:BF:3A:21:68:9E:D6:C9:A0:DB:A0:5E:3A:34`.
- Google Digital Asset Links API returned a matching `delegate_permission/common.handle_all_urls` statement.
- The native manifest deliberately accepts only `/dashboard`, even though the domain statement delegates URLs at the website level.

## Release blockers / manual acceptance

1. No Emulator binary/system image/AVD and no connected device are available locally: install, login, role, rotation and layout acceptance is pending.
2. The final signed AAB has not been generated with user-entered secrets.
3. Play App Signing/upload-key acceptance and upgrade installation from versionCode 2 are not device/Play verified.
4. Privacy route source is ready, but legal owner/support values, native in-app access, Production deploy and live verification are missing; live `https://travkinflow.com/privacy` returns HTTP 404.
5. Separate V2/V3 Data Safety evidence is drafted; exact V2 Play binary, runtime geolocation trace and backend/CDN/provider retention still require confirmation.
6. Play reviewer credentials/instructions must be entered in Play Console.
7. Feature graphic/store icon files are ready but not owner-approved; real screenshots are not captured.
8. Push/FCM/device-token/backend sender are absent and are not simulated.
9. The QA Weighbridge backend contract is reported deployed by the main stream, but positive E2E waits for its safe QA auth session/PIN; release writes remain disabled.

## Zero-change boundaries

- Production deploys: 0.
- Production DB writes: 0.
- Play Console uploads/track/store mutations: 0.
- Main TravkinFlow merges: 0.
