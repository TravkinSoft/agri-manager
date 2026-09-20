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
