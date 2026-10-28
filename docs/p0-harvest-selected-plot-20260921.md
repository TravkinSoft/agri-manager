# P0: preserve the weighman's selected harvest plot — 2026-09-21

## Evidence and boundary

- Production health and Vercel identify `dpl_G5ya8aLGuUSz8fneULLRjcZLJp9s`, `agri-manager-gbxb8q4e4-travkin-ais-projects.vercel.app`, READY. Health SHA is null. Exact source baseline from the recorded release is `fc0ba489b1047b2f82c13559ab5cea7016032c63`.
- Isolated branch `codex/p0-harvest-selected-plot-20260921` starts at that baseline. Master and other worktrees remain untouched.
- Live Supabase project `bhsemlvmkikpntabctml`; company `10000000-0000-0000-0000-000000000001`. Last migration `20260920182051 p0_invite_deferred_auth_metadata_v1`. This hotfix requires no schema migration.
- Owner confirmed that Iskakov and Kulinich's latest intake belong to vinograd **24 ha**, not vinograd **54 ha**. No permission to invent a gross/tare weight is inferred.

## Cause / annotation

1. Queue auto-fill and manual transport selection unconditionally copied the PTC event's plot over an already selected/restored workspace plot.
2. Manually changing plot cleared the physical trip link. The API rediscovered that same trip by driver and rejected the selected plot because it differed from the combine's event.
3. Live 409 logs for Iskakov confirm the fallback matched the correct driver/vehicle/cycle. The combine's current segment and the loaded events still refer to 54 ha.

## Fix

- PTC fills a plot only into a completely blank plot selection. Queue refresh, new vehicle, successful ticket reset and restored workspaces cannot replace an existing plot.
- A plot edit does not detach the physical PTC trip. Server-side company/season/allocation validation remains mandatory.
- The API separates cargo origin from trip identity, records both in server-generated audit data, and preserves vehicle/driver/cycle/state and duplicate protections.
- No scale connector, PIN, stock balance, deduction, shift boundary or authorization change.

## Data repair plan

Only open Kulinich ticket ending `43V9`: changed field/source/plot to the owner-confirmed 24 ha at 2026-09-21 15:04:29 UTC. Gross 20,740 kg, warehouse, driver, vehicle, trip, status and all weighing rows stayed unchanged. Required still-active/not-finalized/not-voided, identical cargo identity, no generated inventory batch. Old/new identities saved in `audit_json.p0_plot_correction_20260921`. Dry-run transaction succeeded and rolled back before the guarded commit.

Ayткен currently has two finalized 5,030 kg tickets, one per plot, total 10,060 kg. Do not duplicate or alter those masses; exact total confirmation remains pending.

## Verification before release

- TypeScript noEmit: PASS.
- Executable tests of the actual form callbacks and API trip validation block: 16 PASS.
- PGlite current PTC trigger regressions, including differing ticket/event plots and confirmed tare only: 20 PASS.
- Physical authenticated browser/live receipt checks and Production release: pending.
