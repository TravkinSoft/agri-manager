# Google Play Data Safety — legacy V2 and native V3 evidence matrix

Date: 2026-09-02

Status: code/manifest audit for the Play form draft. This is not a legal approval and has not been submitted to Google Play.

## Evidence boundary

- Legacy V2 source was recovered read-only from `C:\Users\TRAVKIN\Downloads\CodecSaaS\project-google-market\android`. Its `twa-manifest.json` identifies `com.travkin.flow`, versionCode `2`, Bubblewrap TWA start URL `https://travkinflow.com/dashboard`, full web scope and Custom Tabs fallback. That worktree contains uncommitted generated Android files, so V2 findings are source evidence and **not a byte-for-byte audit of the Play-delivered bundle**.
- Native V3 evidence is commit-based in `codex/google-market-native-v1`: `com.travkin.flow`, versionCode `3`, release channel `production`, release writes hard-coded off.
- Server/CDN/Auth retention and the exact Play V2 binary still require owner/vendor evidence. Those unknowns are never converted into a negative declaration.
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
| App activity — app interactions | Route/API calls identify used features and viewed/modified record IDs | Requests reach TravkinFlow/Vercel/Supabase and may be retained in access/security logs | **Collected unless retention audit proves an applicable exception** | App functionality, security, diagnostics |
| App info and performance — crash logs/diagnostics | No Sentry/Firebase/analytics client SDK found | Hosting/API logs can still retain HTTP errors, device/browser headers and timing | **Open pending Vercel/Supabase/backend log retention** | Security and diagnostics if retained |
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
| App activity — app interactions | API paths/queries include viewed screen context, ticket IDs, company ID, KATO and refresh actions | Requests can be present in backend/CDN security/access logs | **Collected unless retention audit proves an applicable exception** | App functionality, security and diagnostics |
| User-generated content / business records | Release code contains guarded Weighbridge bodies but `WEIGHBRIDGE_WRITE_ENABLED=false` and every mutation passes `requireWeighbridgeWrites()` first | Native V3 release does not transmit those write bodies; it downloads authorized business records | **Not collected from native V3 write flows** | Re-evaluate if any production write feature is enabled later |
| Notifications | PostgREST SELECT downloads RLS-scoped notification rows; no read/update/device-token call | Notification content travels server-to-device, not off device; recipient/account filter is already covered by user ID | **No separate content collection by native V3** | App functionality |
| Audio, files/docs, photos/videos, contacts, SMS, call logs, health, financial data | No permission, SDK or API surface found | No direct evidence | **Not collected by native V3** | N/A |
| App info and performance — crash logs/diagnostics | No crash or analytics SDK | HTTP infrastructure may retain error/device headers | **Open pending server/CDN retention** | Security/diagnostics if retained |
| Device or other IDs | No advertising ID, Firebase Installation ID or hardware identifier API | Random local workstation/idempotency IDs are feature-scoped and are not advertising identifiers | **Not found as Play “device or other IDs”** | Confirm backend classification |

## Union declaration while V2 remains active

Current transition note: versionCode 2 remains the active Internal Testing release. A versionCode 3 draft would not change delivery. After an explicitly authorized V3 internal rollout, eligible testers receive the highest compatible version code; verify that V2 is fully shadowed/deactivated across device configurations before removing V2-only practices from any later covered-track declaration. Preserve V2 release history and audit evidence either way.

Conservative form inputs supported by current evidence:

- Data collected: email address, user/account IDs, authentication information, approximate location, app interactions, voice/sound recordings, files/documents and user-generated/business content.
- Precise location: leave unresolved until a V2 runtime network trace proves whether browser geolocation/measurement data leaves the device and whether any receiver retains it.
- Diagnostics/crash data: leave unresolved until Vercel, Supabase and TravkinFlow log schemas/retention are documented.
- Data encrypted in transit: **Yes** for audited first-party flows; cleartext is disabled in V3 and V2 host URLs are HTTPS.
- Data deletion request: the privacy-page source provides a support route, but the actual support contact, identity-verification process and backend deletion/retention procedure must be approved before submission.
- Data sharing: **Not ready**. Confirm the Play service-provider exceptions and contracts for Supabase, Vercel and OpenAI before choosing Yes/No.
- Independent security review: **No claim** without a qualifying completed review.

## Evidence needed before the Play form is submitted

1. Download/export the exact active V2 bundle from Play Console and audit its merged manifest, SDK Index and permissions.
2. Execute a consented V2 runtime network trace for login, map geolocation, KML/document upload and voice transcription.
3. Document Vercel, Supabase, TravkinFlow API and OpenAI retention/deletion settings and processor contracts.
4. Approve the legal owner and support contact on `/privacy`, deploy that single approved page separately, and test its public URL.
5. Reconcile the final form against every artifact still active in each Play track immediately before submission.
