# P0: nonblocking impurity selection and live champions — 2026-09-20

## User-approved annotation

1. An open impurity ticket selects exact source provenance, not a reservation of the entire party. At close, lock the company/season gate and source batches in their existing order, validate original identity/hashes, re-read ledger mass, reject ordinary commitments and processing allocations, and atomically settle only the measured impurity. A later concurrent ticket rebases its source masses to the remaining stock. Preserve the opening snapshot in the group audit when rebasing.
2. Champion periods load together from one canonical receipt/attributed-impurity read, without warehouse balances or combine/plot queries. Button changes require no network request. Ticket changes trigger refresh; 15-second polling, focus and online refresh remain fallbacks. Cached rows are scoped to authenticated/effective user, role and company; stale responses are aborted. Show the last successful update time.

## Safety boundary

- No changes to historical closed documents, weights, destinations or ledger entries.
- No disabled stock checks, RLS, authentication or ordinary reservations.
- A genuinely insufficient, externally committed, depleted or identity-changed source still fails safely; no promise that impossible stock can be posted.
- Exact source IDs are retained: no new receipts or other plots silently added while closing.
- Existing public RPC signatures/grants are unchanged. Existing private function security modes are preserved.
- Retry uses existing idempotency keys; receipt of a UI event alone never posts stock.

## Verification

- PGlite against captured Production function definitions: 28/28 PASS.
- Both close orders for two open documents on the same sources, repeated finalize, ordinary reservations, processing allocations, genuine insufficient stock with full rollback, void/storno, shift handover and 208-source scale test.
- Repeated small closes exposed generic-plan degradation in the large-source fixture; close/settlement now use per-call query plans. Full fixture passes under the existing 8-second scale assertion.
- Dashboard contracts and period-math regression: 63/63 PASS; all four period results equal the unchanged canonical calculation, including close/void and attributed soil.
- TypeScript: PASS; git diff whitespace check: PASS.
- Supabase migration applied through managed apply_migration. Prior live definitions are preserved in `shared-impurity-baseline/` as fixtures/recovery evidence; MD5 baseline checks abort on unexpected concurrent function changes.
- Before migration: 0 open shared groups, 0 reserved kg; Karataev finalized, net 4320, sole net ledger effect -4320. No operational document changes were issued by this task.

## Release / rollback

- Base: 98a24ce (contains company invitation isolation fixes); separate worktree/branch.
- The DB change is backward compatible with the currently deployed UI. A UI rollback must keep the database safety fix.
- Do not blindly restore the old unique-selected-source index after rollout: multiple legitimate open selections may then exist. A database rollback would require a fresh read-only inventory and explicit recovery review, not deletion/cancellation of documents.
- Browser session and live user-close E2E verification must be reported separately from static tests and deployment readiness.

## Production evidence

- Runtime code commit: `bd91fc8621009613af034ae7ead10999e04d016d`, pushed to private `origin/codex/p0-impurity-concurrency-live-ranking-20260920`.
- Managed DB migration: `20260920084008`, `p0_shared_impurity_nonblocking_v5`; local migration filename aligned to that returned version.
- Deployment `dpl_2o34JdeQJ5tWEzQ2BKbW8xpFed1r`, READY, Next.js 13.5.1, build completed in 37 seconds; promoted successfully.
- `https://travkinflow.com/api/healthz` at 08:43:59 UTC: `ok:true`, environment production, deployment `agri-manager-8ki7wg63w-travkin-ais-projects.vercel.app`. Health commit is null (Vercel CLI metadata), so it is not claimed as independent commit proof.
- New champions endpoint unauthenticated: HTTP 401, Missing authorization token.
- Post-release runtime error/fatal scan scoped to this deployment, last 5 minutes: no rows returned. This is a short observation, not proof of all future requests.
- View retains `security_invoker=true`; all three relevant function ACLs exactly match the before snapshot. Advisor still reports the pre-existing intentional authenticated SECURITY DEFINER RPC grants; no privilege expansion was made. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter).
- Karataev after release: finalized, net 4320, exactly 1 ledger row, effect -4320 kg.
- Authenticated browser click/E2E smoke: NOT LIVE VERIFIED. Desktop browser tool failed to initialize (`failed to write kernel assets`, OS error 3). No fake production ticket was created to work around this limitation.
