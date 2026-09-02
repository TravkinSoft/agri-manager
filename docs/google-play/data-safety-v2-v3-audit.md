# Google Play Data Safety — legacy V2 and native V3 evidence matrix

Date: 2026-09-02

Status: code/manifest audit for the Play form draft. This is not a legal approval and has not been submitted to Google Play.

## Evidence boundary

- Legacy V2 source was recovered read-only from `C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market\android`. Its `twa-manifest.json` identifies `com.travkin.flow`, versionCode `2`, Bubblewrap TWA start URL `https://travkinflow.com/dashboard`, full web scope and Custom Tabs fallback. That worktree contains uncommitted generated Android files, so V2 findings are source evidence and **not a byte-for-byte audit of the Play-delivered bundle**.
- Native V3 evidence is commit-based in `codex/google-market-native-v1`: `com.travkin.flow`, versionCode `3`, release channel `production`, release writes hard-coded off.
- The Production Supabase project is live-verified read-only as `bhsemlvmkikpntabctml` (`TravkinFlow`, `ap-northeast-1`, healthy). `travkinflow.com` returned `Server: Vercel` and HTTPS 200 on 2026-09-02. The exact Supabase/Vercel account plans and any purchased observability/PITR add-ons are not exposed by repository evidence and remain owner-account facts.
- The exact Play V2 binary still requires owner/Play evidence. Unknown contract terms, legal bases and mandatory retention periods are never converted into a negative declaration.
- Play Console live verification on 2026-09-02 found this app active only on the internal-testing track. Google exempts internal-only apps from the Data Safety section. Before any closed, open or Production release, the declaration must be reconciled against every artifact still active or servable on a covered track or device configuration. V2 remains in the conservative union until Console proves it is no longer active or servable there.

## Legacy V2 — TWA/web app

Artifact facts:

- Bubblewrap/Android Browser Helper `2.6.2`, TWA host `travkinflow.com`, versionCode `2`, target API `36`, minimum API `21`.
- The whole website is in scope, not only the opening dashboard: authenticated users can reach role-authorized web routes and network APIs.
- Notification delegation is disabled. No advertising, Firebase, crash-reporting or analytics SDK dependency was found in the Android wrapper or web package manifest.
- The wrapper opens web content in a Trusted Web Activity and specifies Custom Tabs fallback. Its generated source manifest also contains the Android Browser Helper fallback activity.
- A fresh `processReleaseMainManifest` against the recovered V2 source passed. The merged source declares no runtime/sensitive permission; AndroidX contributes only `com.travkin.flow.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` with package-local signature protection. Browser-origin permissions such as microphone/geolocation are still requested by Chrome/web APIs at runtime and are not represented as permissions of the wrapper package.

| Play data type | Direct code evidence | Transmission finding | Draft Play disposition | Purpose / required state |
| --- | --- | --- | --- | --- |
| Personal info — email address | Supabase email/password sign-in and account/profile UI | Email is sent to Supabase Auth | **Collected** | Account management, app functionality, security; required for login |
| Personal info — user/account ID | Auth UID, actor ID, role and company context accompany authenticated work | IDs/tokens are transmitted to Supabase and TravkinFlow APIs | **Collected** | App functionality, account management, security; required |
| Authentication information | Password sign-in and refresh/session tokens | Password is sent to Supabase Auth; tokens are sent on authenticated requests | **Collected** | Account authentication and security; required, password is not an analytics field |
| Precise location | Web Fields Map calls `navigator.geolocation.watchPosition({ enableHighAccuracy: true })` after user action | Coordinates are used for the local marker/follow-me measurement. Direct server persistence was not proven; map/resource requests need runtime trace | **Open — do not answer “not collected” yet** | Optional map functionality; explicit browser permission |
| Approximate location | Map viewport/resource requests and locality/weather features can reveal a selected area | Network trace and tile/weather provider logging are not yet audited | **Open** | Optional app functionality |
| Audio — voice or sound recordings | Assistant UI records microphone audio and POSTs it to `/api/assistant/transcribe`; server forwards the file to OpenAI transcription | Definite off-device transmission to TravkinFlow and OpenAI | **Collected** | Optional app functionality; user-initiated |
| Files and documents | KML and knowledge/import screens expose file inputs and `FormData` uploads | User-selected files are transmitted to TravkinFlow endpoints | **Collected** | Optional app functionality; user-initiated |
| User-generated content / business records | Web forms create and update fields, operations, tickets, weights, warehouse movements, tasks, assistant messages and other tenant records | Definite authenticated transmission and server persistence | **Collected** | Core app functionality; required or optional by role/workflow |
| App activity — app interactions | Route/API calls identify used features and viewed/modified record IDs | Supabase/Vercel retain request/invocation metadata | **Collected** | App functionality, security, diagnostics |
| App info and performance — diagnostics | No Sentry/Firebase/analytics client SDK found | Hosting/API logs retain HTTP status/errors, request path/query, device/browser headers and timing | **Collected** | Security and diagnostics |
| App info and performance — crash logs | No Sentry/Firebase/crash client SDK found | No browser/TWA crash payload upload path found | **Not found in audited client code** | Recheck exact V2 binary/browser runtime |
| Device or other IDs | No advertising ID SDK or Android identifier API found | Session cookies/tokens exist but are account credentials, not evidence of advertising-ID collection | **Not found in audited client code** | Recheck the exact Play V2 dependency/merged manifest |
| Photos/videos, contacts, SMS, call logs, health, financial data | No corresponding wrapper permission or client SDK found in the scoped audit | No direct evidence | **Not found**, subject to exact V2 bundle and role-route review | N/A |

V2 sharing decision is still open. OpenAI transcription, Supabase and Vercel are service providers in the observed flow, but the Play “sharing” exception can be used only after confirming the applicable contracts, processing instructions and retention.

## Native V3 — Kotlin/Compose client

Artifact facts:

- Source permissions: `INTERNET`, `ACCESS_NETWORK_STATE`; no runtime/sensitive permission. AndroidX adds only a package-local signature permission in the merged artifact.
- No WebView, TWA, browser content shell, Firebase, FCM, analytics, crash SDK, advertising ID, camera, file picker, microphone or device-geolocation API.
- HTTPS-only Supabase/TravkinFlow base URLs; cleartext disabled. Authentication/session and actor-scoped caches use Android Keystore storage.
- Release Weighbridge mutation flag is compile-time `false`; mutation calls fail before network execution. Notification centre performs SELECT only.

| Play data type | Direct code evidence | Transmission finding | Draft Play disposition | Purpose / required state |
| --- | --- | --- | --- | --- |
| Personal info — email address | `PasswordGrantBody(email, password)` and actor profile | Email is sent to Supabase Auth | **Collected** | Account management, app functionality, security; required |
| Personal info — user/account ID | Auth token, actor ID, role, company ID and notification recipient filter | Authenticated requests send account/tenant identifiers to Supabase and TravkinFlow | **Collected** | App functionality and security; required |
| Authentication information | Password grant, refresh token and logout endpoints | Credentials/tokens are transmitted only to configured HTTPS endpoints | **Collected** | Authentication and security; required |
| Approximate location | User searches locality/KATO; selected KATO and server-resolved locality coordinates are sent to weather endpoints | Selected locality data is transmitted even though device GPS is never read | **Collected** | Weather functionality; optional and user-initiated |
| Precise device location | No location permission and no Android location API | No device coordinate transmission found | **Not collected by native V3** | N/A |
| App activity — app interactions | API paths/queries include viewed screen context, ticket IDs, company ID, KATO and refresh actions | Supabase API/Auth logs and Vercel Runtime Logs retain request/invocation metadata | **Collected** | App functionality, security and diagnostics |
| User-generated content / business records | Release code contains guarded Weighbridge bodies but `WEIGHBRIDGE_WRITE_ENABLED=false` and every mutation passes `requireWeighbridgeWrites()` first | Native V3 release does not transmit those write bodies; it downloads authorized business records | **Not collected from native V3 write flows** | Re-evaluate if any production write feature is enabled later |
| Notifications | PostgREST SELECT downloads RLS-scoped notification rows; no read/update/device-token call | Notification content travels server-to-device, not off device; recipient/account filter is already covered by user ID | **No separate content collection by native V3** | App functionality |
| Audio, files/docs, photos/videos, contacts, SMS, call logs, health, financial data | No permission, SDK or API surface found | No direct evidence | **Not collected by native V3** | N/A |
| App info and performance — diagnostics | No crash or analytics SDK | Supabase/Vercel infrastructure records request status, errors and request metadata; this is diagnostics, not native crash reporting | **Collected** | Security and diagnostics |
| App info and performance — crash logs | No crash-reporting SDK or native crash upload path | No native crash payload transmission found | **Not collected by native V3** | N/A |
| Device or other IDs | No advertising ID, Firebase Installation ID or hardware identifier API | The random workstation UUID stays in encrypted local storage and is not sent by the release read path; idempotency UUIDs exist only behind the disabled write gate | **Not collected by native V3** | Re-evaluate if release writes are enabled later |

## Native V3 processor and destination closure

No Firebase, FCM, advertising, analytics, crash-reporting, Play Billing, maps, WebView, TWA or OpenAI SDK is present in the native module. AndroidX/Compose, OkHttp, Retrofit, Gson and Kotlin Coroutines are local libraries and do not establish an independent telemetry destination in the audited code.

| Destination | Layer and purpose | Confirmed transmitted categories | Not transmitted by this path |
| --- | --- | --- | --- |
| `https://bhsemlvmkikpntabctml.supabase.co` | Supabase Auth password/refresh/logout and PostgREST notification SELECT | Email, password, access/refresh tokens, user ID, company ID, notification query/response metadata | No native business-record writes; no advertising or hardware ID |
| `https://travkinflow.com` | First-party TravkinFlow API hosted on Vercel | Bearer token, user/company context, requested ticket/section identifiers, KATO/locality names and locality coordinates, request/device headers | No password; no native microphone/file/camera/device-GPS payload |
| `https://nominatim.openstreetmap.org` | Server-side KATO geocoding and reverse-geocoding fallback | Selected locality/region/district text or locality coordinates, Kazakhstan country restriction and first-party weather User-Agent | No TravkinFlow bearer token, email, user ID or company ID |
| `https://geocoding-api.open-meteo.com` | Server-side locality geocoding candidate lookup | Selected locality name, language and country code | No TravkinFlow bearer token, email, user ID or company ID |
| `https://www.uavforecast.com/api/v1/forecast` or owner-configured `UAV_FORECAST_API_URL` | Server-side weather forecast provider | Selected locality latitude/longitude and forecast option flags; provider API key remains server-side | No TravkinFlow bearer token, email, user ID or company ID |

The V3 release sends no request directly from Android to the three weather providers. Android sends the selected KATO/locality/coordinates to the first-party API; the first-party server performs the downstream calls. A custom `UAV_FORECAST_API_URL` is supported by code, so the deployed environment value is an owner-only runtime verification before a covered-track declaration.

## Encryption, retention and deletion closure

Confirmed technical facts:

- Android permits only HTTPS API bases, disables cleartext traffic, uses system trust anchors and excludes shared preferences/files/databases from Android cloud backup and device transfer.
- The password is used for the Supabase password grant and is not stored. Access/refresh tokens, the actor, operational caches, notifications, weather cache and first-party operator cookie are stored with AES-256-GCM using a non-exported Android Keystore key.
- Supabase's current shared-responsibility documentation states hosted project data is encrypted at rest and in transit. Vercel documents AES-256 at rest and HTTPS/TLS 1.3 in transit. These are vendor capability facts, not proof of the contracts or legal bases accepted by `LWP LTD, TOO`.
- Safe logout immediately removes the local session, actor, operational/ticket/harvest/warehouse/weather/notification caches, pending write queue and operator cookie, then attempts Supabase logout for up to five seconds. The local workstation UUID is intentionally not cleared, but no release read path transmits it.
- The offline actor fallback is bounded to 12 hours. Other native business caches have no age TTL in `LocalStateStore`; they persist encrypted until refresh/overwrite, logout, application-data clear or uninstall.
- Server-side weather forecast cache is in process memory for 10 minutes. KATO/reverse-geocode results are in process memory with a 30-day TTL. Neither cache is a database retention policy and either may disappear earlier when the function process restarts.
- Vercel documents Runtime Logs on all plans, including request path, status, User-Agent, search parameters and invocation metadata. Current documented retention is plan/add-on dependent (1 hour, 1 day, 3 days or 30 days). The current TravkinFlow Vercel plan/add-on is not live-verified.
- Supabase documents Auth/API/edge/database logging and states retention depends on the project pricing plan. Paid daily-backup availability is documented as 7 days for Pro, 14 days for Team and up to 30 days for Enterprise, with optional PITR. The current TravkinFlow plan, Log Drains and PITR state are not live-verified.
- No application-wide scheduled user/business-data retention or automatic account-deletion job was found in the scoped repository search. Therefore business-record retention duration, mandatory legal retention and deletion/anonymization order remain owner/legal decisions.

Account lifecycle facts:

- Native V3 exposes password login, refresh and logout only. It has no self-registration, account-creation or account-deletion UI/API.
- The broader web application exposes self-registration through `/auth/register` and `/api/auth/register-company`; this creates a `company_admin` Auth user and later completes the company/profile flow. This web capability is relevant to legacy V2/full-web scope, not native V3.
- The only account-capable deletion path found is the Global Admin company hard-delete endpoint. It refuses deletion while operational blocker tables contain rows, then deletes company Auth users, leftover profiles and the company. It is not a user self-service account-deletion flow.
- Supabase supports administrator user deletion. Vendor documentation warns that an already-issued JWT remains valid until expiry and that Auth user deletion can be blocked by user-owned Storage objects. The repository does not prove the Production JWT lifetime, Storage ownership state or a complete request-to-erasure runbook.
- The privacy source offers deletion requests by email, but `https://travkinflow.com/privacy` returned HTTP 404 on 2026-09-02. It cannot be submitted as a live deletion URL until a separately authorized deploy and operational verification.

Google's account-deletion rule applies when the app lets users create an account from within the app. Native V3 does not. Whether Google or counsel requires the web account-creation surface to be treated as part of the same app/service is an owner/legal decision; do not claim a compliant deletion path until that decision and the operational workflow are complete.

## Union declaration while V2 remains active

Current transition note: versionCode 2 remains the active Internal Testing release. A versionCode 3 draft would not change delivery. After an explicitly authorized V3 internal rollout, eligible testers receive the highest compatible version code; verify that V2 is fully shadowed/deactivated across device configurations before removing V2-only practices from any later covered-track declaration. Preserve V2 release history and audit evidence either way.

Conservative form inputs supported by current evidence:

- Data collected: email address, user/account IDs, authentication information, approximate location, app interactions, diagnostics, voice/sound recordings, files/documents and user-generated/business content.
- Precise location: leave unresolved until a V2 runtime network trace proves whether browser geolocation/measurement data leaves the device and whether any receiver retains it.
- Diagnostics: **Collected** because Supabase and Vercel document retained request/invocation metadata. Native crash logs remain **not collected** because no crash-reporting upload path was found.
- Data encrypted in transit: **Yes** for audited first-party and weather-provider flows; cleartext is disabled in V3 and every observed destination is HTTPS.
- Data deletion request: the privacy-page source provides a support email, but the public URL is currently 404 and the identity-verification, deletion/anonymization and mandatory-retention procedure requires owner approval before submission.
- Data sharing: **Not ready**. Confirm the Play service-provider exceptions and contracts for Supabase, Vercel and OpenAI before choosing Yes/No.
- Independent security review: **No claim** without a qualifying completed review.

## Evidence needed before the Play form is submitted

1. Download/export the exact active V2 bundle from Play Console and audit its merged manifest, SDK Index and permissions.
2. Execute a consented V2 runtime network trace for login, map geolocation, KML/document upload and voice transcription.
3. Owner verifies the actual Vercel/Supabase plans, add-ons, Log Drains/PITR, custom `UAV_FORECAST_API_URL`, processor contracts and any OpenAI retention setting used by V2.
4. Deploy the locally completed `/privacy` page separately and test its public URL; Console-verified operator/support values are already applied in source.
5. Reconcile the final form against every artifact still active in each Play track immediately before submission.

## Current official capability references

- Supabase Logs: https://supabase.com/docs/guides/monitoring-and-debugging/logs
- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase User Management/deletion: https://supabase.com/docs/guides/auth/managing-user-data
- Supabase Shared Responsibility Model: https://supabase.com/docs/guides/deployment/shared-responsibility-model
- Vercel Runtime Logs: https://vercel.com/docs/logs/runtime
- Vercel security/encryption: https://vercel.com/docs/security/compliance
- Google Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
