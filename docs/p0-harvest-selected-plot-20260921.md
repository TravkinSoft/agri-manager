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
- Destination lock regression tests: 12 PASS. Total: 48 PASS.
- Scoped ESLint: no errors; seven existing hook-dependency warnings in the weighbridge page.
- Production cloud build, type check and model smoke: PASS.

## Production release and final read-back

- Source commit: `087b33ba10441918fb93d135d8bce8d6c6c83638`, pushed to `origin/codex/p0-harvest-selected-plot-20260921`; master unchanged.
- Deployment: `dpl_7ErVdq5uDwxN3M3Tz1qEe6JdXWwZ`, `agri-manager-etzk1oxwb-travkin-ais-projects.vercel.app`, READY, Production environment.
- Created with `--prod --skip-domain`, checked its authenticated health endpoint before promotion. Explicit `--scope travkin-ais-projects` resolved the initial CLI authorization error without new login or permission changes.
- Promoted at approximately 15:12 UTC. `https://travkinflow.com/api/healthz` at 15:12:41 UTC returned `ok: true`, `environment: production`, and the new deployment hostname. Health commit remains null; source identity comes from the clean committed upload checkout.
- No database migration applied. Only the specifically authorized, audited Kulinich ticket correction was committed.
- Read-back at 15:13:09 UTC: Kulinich still active, not finalized or voided, 24 ha plot, gross 20,740 kg, original warehouse, PTC unloading cycle 112 unchanged.
- Iskakov remains loaded cycle 80; no new ticket since 14:00 UTC. Actual receipt creation after refresh is **NOT LIVE VERIFIED**: an operator must enter the real current weight. No invented or test Production ticket was created.
- Aitken remains two finalized 5,030 kg receipts (54 ha and 24 ha), total 10,060 kg. These amounts were not changed or posted again. Physical total confirmation is still required; do not assume the two equal records alone prove the intended total.
- Initial post-promotion runtime error query returned no errors; the observation window was short and is not a substitute for the next real receipt.

## Operator action

Record any unsaved weight, refresh the weighbridge once, explicitly select vinograd 24 ha, then retry Iskakov with the real gross weight. Do not reopen or duplicate Kulinich. Existing receipts and weighings were not cleared by the release.
