# Native Android V1 — Weather checkpoint

Date: 2026-09-02

## Scope delivered

- Native Compose weather screen with explicit KATO locality search.
- Read-only chain: `GET /api/weather-lab/kato` → `GET /api/weather-lab/location` → `GET /api/weather-lab/forecast`.
- Current temperature, wind, gusts, precipitation, humidity, visibility, sunrise/sunset, and the next 24 hourly points.
- Encrypted forecast cache scoped to the authenticated actor and current company context.
- Loading, empty, error, provider-stale, and offline-cache states.
- Manual refresh uses the existing server `refresh=1` contract; a failed refresh preserves and marks cached data as stale.

## Role boundary

The confirmed backend authorization in `app/api/weather-lab/_auth.ts` permits only `global_admin` and `agronomist`. Native access matches that contract exactly.

`company_admin`, `weighman`, and `specialist` are fail-closed. In particular, native does not advertise Weather to `company_admin` while the server would return 403.

## Excluded

- No Weather Lab profile create/update/delete/default actions.
- No operation-window write actions.
- No browser geolocation permission in this slice.
- No changes to crop structure, database schema, or web Weather Lab logic.
- No WebView/TWA/browser shell.

## Verification

- `testDebugUnitTest`: 11 tests, 0 failures, 0 errors.
- `lintDebug`: 0 fatal, 0 errors, 12 warnings.
- `assembleDebug`: passed.
- `compileReleaseKotlin`: passed.
- WebView/TWA source hits: 0.
- Debug APK: 64,703,299 bytes.
- Debug APK SHA-256: `24B325BBB075D6602EDE6A0A6BD01AA538BADF6D1DEA9108DB57025BDC609EAC`.
- Unauthenticated Production probes for KATO, location, and forecast each returned `401` with no redirect.

## Not live verified

- Authenticated forecast content was not fetched because no secure QA build credentials or Android device/emulator were available in this checkpoint.
- QA is protected by Vercel SSO; no bypass was created.
- No Play Console upload or track mutation is included.

Production deploys: 0. Production DB writes: 0. Main TravkinFlow merge: 0.
