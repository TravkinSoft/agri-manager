# Оборот машин — независимый модуль с единым входом TravkinFlow

## Current contract

`/traffic` is the agronomist/company-admin/global-admin observer and configuration page. `/traffic-operator` uses the normal Supabase email/password account and verified main Auth session. No independent PTC password, cookie, role picker or session fallback remains.

Canonical account roles (defined by the central auth/invitation work):

- `mechanic_operator` (Механизатор) → cabinet «Комбайнёр», only `empty → loaded`.
- `vegetable_brigadier` (Бригадир овощной) → cabinet «Приёмка картофеля», only `loaded → unloading → empty`.

Each transition is manually confirmed with the exact vehicle plate. There are no imports, links, writes or automatic transitions involving weighing, gross/tare, tickets, stock, ledger, GPS or AI. Empty means without cargo, not proof of arrival at the field.

## Normal invitations and staff binding

An administrator invites the employee through the normal «Пользователи» page, selects the appropriate role and binds the account to one existing active employee in the company. The employee follows the email invitation, sets their normal TravkinFlow password and signs in. Password recovery uses the existing normal recovery flow. The PTC access panel is read-only guidance and account/link status; agronomists cannot mint credentials or roles.

Authoritative identity is `profiles.id = auth.users.id`; `company_people.user_id` references that profile. The operator API calls `getServerActorFromSession(ignoreImpersonation:true,skipCache:true)`, rejects legacy profile/Auth aliases, then rechecks exact active profile role, company and exactly one active/nondeleted same-company employee link. Admin/observer roles cannot operate by bypassing the cabinet. The client sends the shared Authorization header for every PTC read/write. Missing session becomes login state, not a retry loop. Account changes abort old reads and discard old account snapshots; logout uses normal Supabase local-session sign-out.

## Flow configuration

One company has one optional field and up to 100 assigned existing fleet vehicles. No fleet, staff or field records are duplicated or updated by PTC. Driver attribution is shown only from the same company's active, nonarchived `reference_specialists` driver referenced by `primary_responsible_personnel_id`.

The manager selects machines and optional field and acknowledges newly assigned machines are empty. Busy machines cannot be unassigned and the field cannot change until they are empty. Disabling, re-enabling or removing/re-adding an empty machine preserves its version, cycle and timestamps.

## Database and retired legacy auth

Apply both PTC migrations and the separately owned central role/person-binding migration before releasing the unified-auth UI:

1. `20260904103550_ptc_independent_machine_turnover_v1.sql` — original six RLS-enabled tables and state/configuration functions.
2. `20260904112119_ptc_unified_account_auth_v1.sql` — additive actor-based transition and retirement of separate passwords.

The second migration adds nullable `ptc_events.actor_user_id` (profile FK), makes old `access_id` nullable and requires at least one actor reference. Old events are not rewritten or deleted. New events record the authoritative profile, employee name and original field ID. The append-only trigger remains intact.

`ptc_actor_transition_v1(p_actor,p_vehicle,p_version,p_target,p_key)` is SECURITY INVOKER with empty search_path, callable only by the server service role. It locks and rechecks authoritative active profile, enabled company flow, active linked person and assigned vehicle; enforces exact role/state/version; updates state and inserts one event atomically. A repeat command replays the existing event without changing time/version/cycle. Cross-vehicle duplicate keys roll back and map to HTTP 409. Current company/role/status/person are rechecked even for replay.

The old `ptc_transition_v1` is replaced by an always-retired function, and its service/public execution permission is revoked. Service access to old `ptc_access`, `ptc_sessions` and `ptc_login_limits` is revoked, while every row remains preserved. `/api/traffic/session` returns 410 without reading or mutating cookies/data. The old password-generation library and manager issue/revoke API commands are removed. Rolling back to the old password UI deliberately does not restore its authority.

The central service role needs its existing SELECT/UPDATE privileges to acquire row SHARE locks on profiles/personnel; PTC does not add or broaden privileges on those existing tables. Main records are only read/locked by the transition, never modified.

## Mobile, synchronization and PWA

All PTC interfaces are mobile-first, including manager setup, account guidance and history. Explicit 48px touch minimums, 16px inputs, compact narrow layouts, wrapped plates, full-card actions and bounded scrolling dialogs. Manager history retains vehicle/field labels even when a machine is no longer assigned. Existing navigation order remains; permitted mobile users enter through «Ещё».

Visible clients poll canonical snapshots every eight seconds after the previous request finishes. Manager catalogs are paginated and omitted from repeated compact snapshots. Operator responses omit manager event history. Focus, online, pageshow and visible-tab return force refresh; hidden tabs do not poll. Old/offline data is marked stale and actions are disabled. There is no optimistic write or offline write replay.

The operator route overrides the ERP manifest with `/traffic-operator.webmanifest`: distinct identity, standalone start at `/traffic-operator?source=pwa`, scope `/traffic-operator`, existing real 192/512 PNG and maskable icons. The manager remains on normal `/traffic`.

`/ptc-sw.js` is registered only for `/traffic-operator`. It has zero CacheStorage use and only intercepts cabinet document navigation, network no-store with a small honest offline fallback. API/session, mutations, RSC and other app routes are not stored or replayed. ERP OfflineRuntime is disabled on PTC routes; its existing worker and caches are untouched. The install CTA listens to real browser install events and gives honest Chrome Android instructions when a prompt is unavailable.

## Local gates and hosted acceptance

- `node scripts/qa-ptc-unified-auth.cjs`: 33 actual PostgreSQL assertions against both PTC migrations in isolated PGlite, including preserved legacy events, canonical roles/links/company checks and denied retired auth.
- `node scripts/qa-ptc-independent-mvp.cjs`: 37 historical baseline state/configuration assertions against the original migration alone; not evidence that legacy auth remains usable after migration 2.
- `node node_modules/tsx/dist/cli.mjs scripts/qa-ptc-model.ts`: 61 model, role and client/auth-contract assertions.
- `node scripts/qa-ptc-pwa.cjs`: 32 manifest/icon/worker behavior assertions.
- `node node_modules/tsx/dist/cli.mjs scripts/qa-ptc-mobile-css.ts`: eight actual generated Tailwind-rule assertions.
- Full TypeScript and scoped Next lint.

PGlite's queued concurrent calls are not a proof of a multi-connection database race; hosted QA separately validates the final schema. Hosted acceptance must verify real invitations/password setup, two normal operator logins, role/company boundaries, complete cross-cabinet cycle, stale/offline and account-switch behavior, actual manifest MIME/worker scope/installability and mobile DOM at 320/360/390/412 CSS px. Desktop emulation is not physical Android testing. PWA first; no native wrapper, Google Play build or publication in this work.

## Release and rollback

Hosted DDL, deployment and live acceptance belong to the root release owner. Keep migrations additive, retain all events/test history and merge fresh main changes. Emergency rollback is tenant flow disable, preserving state/history, followed if needed by UI rollback. Never drop PTC tables, reset cycles, unassign busy vehicles or alter warehouse/weighing records.

References: [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Supabase sign-out](https://supabase.com/docs/reference/javascript/auth-signout), [web.dev manifest](https://web.dev/learn/pwa/web-app-manifest), [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
