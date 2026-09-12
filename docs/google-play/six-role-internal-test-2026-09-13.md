# Native Android V3 — six-role Internal Testing gate

Date: 2026-09-13

This checkpoint authorizes creation and upload of versionCode 3 only to Google Play Internal Testing. It does not authorize a Production rollout and does not claim device or role-realistic acceptance.

## Product scope

One native Jetpack Compose application, package `com.travkin.flow`, chooses the cabinet from the server-confirmed profile role. The user cannot switch or impersonate a role inside Android.

| Profile role | Native cabinet |
| --- | --- |
| `agronomist` | Harvest overview, crop structure, warehouses, weather; agronomy writes remain explicit user actions |
| `director` | Read-only harvest overview, warehouses and weather |
| `fleet_manager` | PTC fleet manager and driver assignment |
| `mechanic_operator` | PTC harvester transition `empty -> loaded` |
| `weighman` | PTC weighbridge transition `loaded -> unloading` |
| `vegetable_brigadier` | PTC receiving transition `unloading -> empty` |

No WebView, TWA, Custom Tabs, full web Weighbridge, administrator cabinet, role picker, service key, or automatic retry of a business command is included.

## Verified static gate

- Source branch: `codex/google-market-six-cabinets-v1`, descended from the approved native family.
- Server contract baseline: `origin/master@d95b0158f03f5310101b25c26a6eaa1be3c6fecb92` inspected read-only.
- `testDebugUnitTest`: 80 tests, 0 failures, 0 errors.
- `lintDebug`: 0 errors; five pre-existing launcher-resource warnings.
- `assembleDebug`: passed.
- Command transport disables automatic connection retry and re-reads the actor plus canonical PTC vehicle version before a mutation.
- Production web code, database, migrations and business records changed: 0.

## Still required before Production

- Install the Play-delivered Internal Testing artifact as an upgrade over versionCode 2.
- Run real logins for all six roles plus one unsupported role.
- Exercise the three PTC transitions on authorized QA data and verify server audit receipts/no duplicates.
- Run layout, accessibility, offline/refresh, rotation, session-expiry and upgrade checks on representative Android devices.
- Obtain owner acceptance of store text and screenshots.

Until those checks pass, `deviceAcceptance` and `roleRealisticQa` remain false and Production rollout is prohibited.
