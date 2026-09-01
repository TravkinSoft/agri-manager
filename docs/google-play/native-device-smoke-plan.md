# Native Android V3 — emulator/device smoke plan

Date: 2026-09-02

Run this plan only on QA accounts/data until a separate Production acceptance is authorized.

## Test matrix

Minimum devices:

- Android 10 / API 29, 360 × 800 dp-equivalent phone;
- Android 16 / API 36, 412 × 915 dp-equivalent phone;
- one physical Android device with Play-installed versionCode 2 for upgrade testing;
- portrait and landscape; light and dark mode; font scales 100% and 200%; display scale default and large.

Required role accounts: Global Admin, Company Admin, Агроном, Весовщик and Специалист. Include one unsupported role to verify fail-closed login. Passwords stay in the QA credential store/Play Console, never in this file.

## Install and upgrade

1. Record package/version/signature of the currently installed Play versionCode 2.
2. Install the signed V3 test artifact as an update, not after uninstalling V2.
3. Confirm package remains `com.travkin.flow`, versionCode becomes 3 and user data migration does not crash.
4. Launch from the icon and from `https://travkinflow.com/dashboard`.
5. Confirm another URL such as `https://travkinflow.com/privacy` stays outside the app.
6. Verify cold start, warm start and `/dashboard` received through `onNewIntent` return to the native overview.

## Authentication and session

1. Wrong email/password shows an authentication error without exposing server payloads.
2. Correct login loads server-confirmed actor, role and company context.
3. Unsupported role returns to login and never shows cached data from a previous actor.
4. Background/foreground and rotation do not persist the password field.
5. Expired access token refreshes once; an invalid refresh token clears all actor-scoped state and returns login.
6. Safe logout returns login immediately while offline and after a slow network; reopening shows no previous actor data.

## Role and screen acceptance

For each supported role, compare the visible buttons with the matrix in `native-rc-preflight.md`. Verify direct UI actions cannot open a disallowed screen.

For every allowed screen:

- loading indicator appears;
- empty state is understandable;
- server error is safe and retryable;
- offline encrypted cache is marked stale;
- pull/manual refresh does not duplicate rows;
- long Russian values, email addresses and UUIDs wrap without clipping;
- Back returns to the expected parent and system Back does not exit unexpectedly.

## Accessibility and layout

1. Enable TalkBack: traverse login, app bar actions, primary buttons, cards and dialogs in logical order.
2. Confirm all actionable icons announce `Назад`, `Обновить` or `Выйти`; decorative icons are skipped.
3. Set font scale to 200% and display size large: login remains scrollable and every action remains reachable above the keyboard.
4. Rotate every screen; no state-changing action repeats and no dialog loses entered data unexpectedly.
5. Test 320dp-wide layout for clipping, horizontal overflow and overlapping metric cards.
6. Test dark/light themes and system high-contrast text where available.
7. Confirm focus and keyboard actions for email, password, KATO search, PIN and weights.

## Data and write boundaries

1. Use a release build: all Weighbridge mutation controls must be disabled and commands must fail before network execution.
2. Confirm no notification read/update request is sent; the centre performs SELECT only.
3. In a separately authorized QA build only, enable the Weighbridge flag and verify operator/session/idempotency against the confirmed station backend contract.
4. Repeat offline/online transitions and prove queued commands retain one idempotency key with no duplicate ticket.
5. Capture backend audit evidence. Production DB writes must remain 0 during this plan.

## Store capture

After all checks pass, reset to synthetic QA data and capture at least four real 1080 × 1920 portrait screenshots from the exact RC artifact. Remove notifications/status-bar distractions and do not expose personal or Production data.

## Exit criteria

- All supported roles pass their allowed matrix; unsupported role fails closed.
- No crash, ANR, clipping, inaccessible action or cross-actor cache is observed.
- Signed V3 updates Play-installed V2 without uninstall/data loss.
- App Links and non-claimed site URLs behave as documented.
- Release writes and Production DB writes remain 0.
- Screenshot set and Play reviewer steps are approved for submission.
