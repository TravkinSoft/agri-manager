# Оборот машин — independent MVP

## Scope

`/traffic` is the agronomist/company-admin/global-admin observer and configuration page. `/traffic-operator` is a restricted personal operator cabinet with its own server-side session. Existing application roles and operational permissions are not broadened for operators.

One company has one optional field and up to 100 assigned existing fleet vehicles. No vehicle duplication or updates to the shared fleet, staff or field records. Driver attribution is shown only for the same company's active, nonarchived `reference_specialists` driver linked by `primary_responsible_personnel_id`.

The cycle is strictly manual:

1. Комбайнёр: `empty → loaded`, after actual loading and explicit confirmation.
2. Приёмка картофеля: `loaded → unloading`, arrival at unloading and explicit confirmation.
3. Приёмка картофеля: `unloading → empty`, unloading finished and explicit confirmation.

There are no imports, links, writes or automatic transitions involving weighing, gross/tare, tickets, stock, ledger, GPS or AI. Empty means without cargo, not proof of arrival at the field.

## Setup and credentials

The authenticated agronomist/admin opens «Поток и машины», selects existing machines and an optional field, explicitly acknowledges new vehicles are currently empty and enables the flow. Busy machines cannot be unassigned and the field cannot change until they are empty. Existing state, version, cycle and timestamps survive disabling and reassignment.

In «Доступ сотрудников», select an active existing company person and the cabinet, then issue access. Random login/password are returned once, only in a no-store authenticated response. Copy them for that specific employee. Lost credentials are replaced by revoking access and issuing new credentials; passwords cannot be retrieved. Revocation invalidates existing sessions on the next request and is checked inside the atomic transition as well.

Passwords use a random salt and Node scrypt; opaque 256-bit session tokens are only in an HttpOnly, SameSite=Strict cookie, Secure in production, scoped to `/api/traffic`. Database stores SHA-256 token hashes, never tokens. Session lifetime is 12 hours. Persistent database limits allow 50 attempts per source and 10 per login per 10-minute window, shared across application instances. Exhausted source limits are checked before allocating another login-limit row. No hardcoded passwords, PINs, public bearer or client-side role selector.

## Atomicity and data boundaries

Migration: `supabase/migrations/20260904103550_ptc_independent_machine_turnover_v1.sql`, created with Supabase CLI `migration new`.

Six new RLS-enabled tables: `ptc_flows`, `ptc_vehicle_states`, `ptc_access`, `ptc_sessions`, `ptc_login_limits`, `ptc_events`. Anonymous and normal authenticated roles have no direct table or RPC access. Only the server's service role can call the invoker RPCs. Manager APIs verify the main Auth session, role, active profile and company; every selected person, field and vehicle is tenant-checked. Operators are independently verified from their cookie and active employee/access/session.

`ptc_transition_v1` locks flow/session/access/person/state, checks allowed previous state and expected version and appends one event in the same transaction. The same idempotency key and command replay the original event without changing cycle/time/version. A mismatched key, stale version, forbidden role, expired/revoked/inactive actor or disabled flow is rejected. A concurrent cross-vehicle duplicate key rolls the transaction back and maps to HTTP 409. Events capture original field ID and actor name; UPDATE and DELETE are forbidden. No audit cleanup or silent reset is performed.

## Mobile and freshness

All new interfaces are mobile-first, including manager forms/access management/history. Explicit 48px touch minimums, 16px inputs, single-column narrow layouts, wrapped plates, full-card vehicle actions, bounded scrollable dialogs and dynamic viewport/safe-area spacing. Existing shared desktop navigation order is preserved; mobile exposes the module through «Ещё» for allowed roles.

Visible clients poll canonical server snapshots every eight seconds after the previous request finishes. Manager catalog data is paginated and loaded separately from compact repeated snapshots. Operator responses contain only their working vehicle set, without the manager's event history. Focus, online, pageshow and returning from a hidden tab force refresh and mark old data stale. Hidden tabs do not poll. Offline or failed reads disable actions; there is no optimistic mutation or offline replay. An uncertain mutation asks for fresh status and reuses its command key if retried from the same confirmation.

## Local gates

- `node scripts/qa-ptc-independent-mvp.cjs`: actual migration in isolated PGlite, 37 assertions; no hosted connection.
- `node node_modules/tsx/dist/cli.mjs scripts/qa-ptc-model.ts`: 46 pure model/auth/client-contract assertions.
- `node node_modules/tsx/dist/cli.mjs scripts/qa-ptc-mobile-css.ts`: eight actual Tailwind output assertions, not merely class-name matching.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- `next lint --file ...` on the new routes, UI and supporting libraries.

Local builds may use clearly fake build-only keys and the verified QA URL; they are not evidence of a working hosted API. Hosted QA must separately verify SameSite/Secure cookies and the exact origin behind the Vercel proxy, personal logins, all three manual actions across two operator sessions, observer synchronization, expiry/revocation, stale/offline handling, 320/360/390/412 CSS-pixel layouts, actual DOM touch dimensions and no horizontal overflow. Desktop viewport emulation is not physical Android testing.

## Release and rollback

Merge fresh master before release to preserve the independent warehouse stream. Hosted migration, deployment and live acceptance belong to the release owner; this implementation task does not perform them. Keep migrations additive and retain all event/test history. Emergency rollback is tenant flow disable (states/history preserved), followed if necessary by rolling back the UI release. Do not drop tables, delete events, reset cycles, unassign busy vehicles or mutate other operational records.

## Installable operator PWA

`/traffic-operator` overrides the ERP manifest through its own Next route layout. `/traffic-operator.webmanifest` has a distinct stable `id`, operator `start_url`, scope `/traffic-operator`, standalone display and the existing real TravkinFlow 192/512 PNG and maskable icons. It does not install `/dashboard`. Agronomist monitoring remains in the main application's `/traffic` page.

`InstallTrafficApp` registers `/ptc-sw.js` with the narrow `/traffic-operator` scope and listens for real `beforeinstallprompt`/`appinstalled` events. When the browser has not offered a prompt, it gives honest Chrome Android menu instructions instead of pretending installation succeeded. The existing ERP worker and its caches are not removed or modified. ERP `OfflineRuntime` is disabled while on PTC routes so that it cannot register its broad worker or start its unrelated offline queue there.

The PTC worker has zero CacheStorage use. Only cabinet document navigation is intercepted, using network `no-store`; a connection failure yields a small self-contained offline screen. API/session requests, mutations, RSC and other app routes are neither stored nor replayed. The screen explicitly says fresh statuses are unavailable and actions are not queued. The retry link and online reload return to the same cabinet. A loaded cabinet already blocks actions when its snapshot is stale/offline.

`node scripts/qa-ptc-pwa.cjs` checks 32 actual manifest/PNG/worker behaviors in an isolated harness. Before claiming installation-ready on Product, inspect the hosted manifest link, icon MIME and dimensions, correct worker scope, Chrome installability and standalone launch target. No Google Play, native wrapper or physical-device verification is implied. References: [web.dev manifest guide](https://web.dev/learn/pwa/web-app-manifest), [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
