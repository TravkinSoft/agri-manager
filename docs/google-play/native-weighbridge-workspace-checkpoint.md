# Native Android V1 — Weighbridge workspace checkpoint

Date: 2026-09-02

## Scope delivered

- Native Compose workspace for `global_admin`, `company_admin`, and `weighman` only.
- Read-only operator/shift state and harvest incoming queue.
- Native flows for create/continue ticket, manual gross, tare, server-calculated net, source → destination, and read-only processing/lot identifiers.
- Explicit confirmation before create, gross save, and finalize; a second confirmation is required when the backend reports tare variance.
- Encrypted operator cookie and encrypted pending-command queue.
- Create/finalize commands preserve one UUID idempotency key across retries. Gross retry replays the same absolute value, not an additive mutation.

## Fail-closed write boundary

Android writes require all of the following:

1. debug QA build (`APP_CHANNEL=qa`);
2. exact base URL `https://qa.travkinflow.com`;
3. build-time `TRAVKINFLOW_QA_WEIGHBRIDGE_WRITES=true`;
4. approved write role;
5. server-confirmed weighbridge station contract;
6. unlocked operator session and open shift.

The current backend has no server station catalog/selection/confirmation contract. The existing web workstation identifier is client-local only. Therefore `stationContractAvailable=false`, the UI reports this backend gap, and all native mutation entry points are blocked. The local workstation UUID is informational and never grants write authority.

Release builds hard-code `WEIGHBRIDGE_WRITE_ENABLED=false` and `BASE_URL=https://travkinflow.com`.

## Contract audit

- `GET/POST /api/weighbridge/operator-session`: server-owned shift and PIN operator session through the `travkin_wb_operator` HttpOnly cookie. A POST `401` is not automatically retried because it can mean an invalid PIN.
- `POST /api/weighbridge/tickets`: UUID `Idempotency-Key` and payload fingerprint/replay handling.
- `PATCH /api/weighbridge/tickets/{id}`: absolute gross update through the atomic harvest RPC; no additive client mutation.
- `POST /api/weighbridge/tickets/{id}/finalize`: idempotency key plus tare-variance confirmation contract.
- Existing crop allocation data is consumed read-only. Crop structure, database schema, and web business logic were not changed.

## Verification

- `testDebugUnitTest`: 10 tests, 0 failures, 0 errors, including cross-origin operator-cookie rejection.
- `lintDebug`: 0 fatal, 0 errors, 12 existing warnings.
- `assembleDebug`: passed.
- `compileReleaseKotlin`: passed.
- WebView/TWA source hits: 0.
- Debug APK: 64,631,803 bytes.
- Debug APK SHA-256: `9B98C9E006E30B30C8CAF626D4819AF29BB4B0CCE8FBBBC3834F6F9FC48EAB80`.

## Not live verified

- QA authenticated E2E writes were not run: the station contract is missing, the write flag was unset, Supabase build secrets were absent, and QA is protected by Vercel SSO.
- No Android device/emulator acceptance run is claimed.
- No Play Console upload or track change is included in this checkpoint.

Production deploys: 0. Production DB writes: 0. Main TravkinFlow merge: 0.
