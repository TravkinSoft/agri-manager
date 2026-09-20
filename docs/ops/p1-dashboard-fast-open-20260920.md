# Dashboard first-open performance — 2026-09-20

## User annotation

`/dashboard`, upper summary spinner: slow even on a good connection. Optimize the complete first screen and repeat navigation, retaining correct totals and committed-ticket refresh.

## Changes

- Run receipts, stock, removal tickets, period context and combine-plot history concurrently once authorized. Within receipt enrichment, run references, lot lineage, attributed impurities and trip-duration reads concurrently. Keep complete pagination, canonical correction/void handling and mass calculations.
- Join simultaneous receipt reads for summary/champions only in the same server instance, within 5 seconds. Key includes a SHA-256 fingerprint of credentials, real/effective actor, company, role and impersonation. Every request is authorized before joining. Settled/error results are removed immediately; at most 32 in-flight entries. No server TTL cache or public CDN cache.
- Expose `Server-Timing` phases for subsequent real request measurements; replies remain private/no-store.
- Show a layout skeleton without fake KPI zeros on cold navigation. On repeat navigation, show the last successful tab-memory snapshot (maximum reuse age 2 minutes), explicitly marked saved/updating until verified. No persistent browser storage.
- Separate snapshot keys by user, last sign-in, profile, role, company and impersonation. Clear on signout; reject late/aborted responses. Scope is checked during render, before effects.
- Coalesce refreshes: an event during a running read queues a fresh read instead of aborting the current one. A failed refresh keeps last good values with a stale/error notice. Reads time out after 30 seconds.
- Preserve ticket-event refresh and 15-second fallback; PTC uses live events plus 5-second fallback. Vehicle-state events no longer recalculate all harvest totals; combine shifts/segments/field progress do.
- Load unrelated legacy dashboard tables/services only for roles that use them. No business data, accounting formulas, permissions or database schema changed.

## Verification before release

- Production read-only EXPLAIN: stock view execution 1180.35 ms; impurity attribution RPC 1373.608 ms. These are DB timings, not full browser latency.
- `qa-tz265-harvest-dashboard.ts`: 63/63 PASS.
- `qa-dashboard-fast-load.ts`: in-flight dedup; post-close fresh reads; failure eviction; cache TTL, bounds, company/role/login separation; auth-before-share; parallel scheduling; lazy legacy import. Old/new route response equality on a controlled fixture. Fixed-latency route benchmark: 318.1 ms -> 150.1 ms. This is NOT a production performance measurement.
- `qa-dashboard-fast-browser.cjs`: real dashboard component in local Edge, mocked network; cold skeleton, warm snapshot (2.7 ms synchronous render), stale notice, queued close events, network error recovery, company switch, signout, mobile no horizontal overflow, zero browser errors. Screenshots in ignored `.artifacts/dashboard-fast-browser`.
- TypeScript full-project check PASS.
- Two additional historical scripts fail identically on clean base `97360b8` and this patch: `qa-p0-harvest-period-movement.ts:43` expects the old gross driver total (777070) instead of current clean total (698627.344); `qa-p0-harvest-correction-lineage.ts:72` expects a removed source layout. Neither script nor accounting logic changed to hide these baseline failures.
- Authenticated live UI measurement is NOT VERIFIED: in-app browser tool fails before opening with `failed to write kernel assets (os error 3)`. Local browser regression is not represented as live Production UI verification.

## Release gate

Use a Production-target build without domain assignment first; only promote the verified READY artifact. Recheck current Production baseline to avoid overwriting a concurrent release. User has authorized publication of these dashboard fixes. Record deployment and post-release checks below after completion.
