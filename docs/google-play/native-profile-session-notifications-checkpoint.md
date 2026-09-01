# Native Android V1 — Profile, session, and notifications checkpoint

Date: 2026-09-02

## Scope delivered

- Native Compose profile with server-confirmed actor ID, email, supported role, company context ID, app channel, actor verification time, and access-token expiry time.
- Password, access token, refresh token, and operator token are never rendered or logged.
- Logout clears the local session first, immediately returns to login, then performs a bounded best-effort Supabase logout.
- Local logout clears actor, overview, tickets, harvest, warehouse, weather, notification, pending weighbridge-command caches, and the operator cookie.
- A second authenticated API `401` is classified as `SessionExpiredException`, clears local state, and returns to login with an explicit message. Invalid operator PIN and invalid login remain separate non-session `401` cases.

## Native read-only notification center

- Uses only `GET {SUPABASE_URL}/rest/v1/user_notifications` with the authenticated JWT and anon API key.
- Selects the exact existing columns, filters `recipient_user_id=eq.{actor.id}`, optionally filters the current company, orders newest first, and limits to 30.
- A read-only Production schema audit confirmed that RLS is enabled and the authenticated SELECT policy permits a row only when `auth.uid() = recipient_user_id`.
- The mapper repeats actor/company checks client-side and rejects any mismatched row.
- Notifications are cached encrypted and scoped to actor plus company context.
- UI covers loading, error, empty, offline/stale cache, unread count, and manual refresh.
- No read-marker UPDATE, route navigation, proactive POST, Realtime subscription, or other notification DB write is implemented.

## Push gap

Firebase/FCM SDK dependencies, Google Services configuration, Android messaging service, device-token registration, and a backend push sender are absent. Push is not simulated. The current native center updates only after a manual refresh or reopening the screen.

## Live Production contract audit

- Supabase project `bhsemlvmkikpntabctml` (`TravkinFlow`) reported `user_notifications` with RLS enabled.
- The table exposes the columns consumed by Android: `id`, `company_id`, `recipient_user_id`, `category`, `event_type`, `title`, `body`, `href`, `read_at`, and `created_at` (plus existing web-only columns).
- The authenticated SELECT policy is `auth.uid() = recipient_user_id`.
- `authenticated` has table-level `SELECT` only; `anon` has no reported table grant. Although legacy mutation policies exist, the audited table grants do not authorize Android's authenticated role to mutate this table.
- The table is included in the `supabase_realtime` publication, but Android V1 deliberately does not subscribe to it.
- No public table name matching FCM, push, or device-token storage was found. This supports the stated push-backend gap; it is not a proof that no differently named external push service exists.
- The audit used schema/catalog SELECT queries only. Production DB writes: 0.

## Verification

- `testDebugUnitTest`: 12 tests, 0 failures, 0 errors.
- `lintDebug`: 0 fatal, 0 errors, 12 warnings.
- `assembleDebug`: passed.
- `compileReleaseKotlin`: passed.
- Notification write API hits in Android: 0.
- WebView/TWA source hits: 0.
- Debug APK: 64,754,191 bytes.
- Debug APK SHA-256: `C79ED456D95F06148506A577EA8DC76BC9DCC503AAF450968F308C701295CB5B`.

## Remaining acceptance gap

- An authenticated Production or QA notification fetch was not executed because secure build credentials and an Android device/emulator were unavailable.
- Notification contents and the complete logged-in UI flow therefore remain pending device-backed acceptance.
- No Play Console upload or track mutation is included.

Production deploys: 0. Production DB writes: 0. Main TravkinFlow merge: 0.
