# P0: soil-ticket statement timeout — 20 September 2026

## Production incident and root cause

The operator reported soil tickets completing only after 2–3 attempts. The screenshot reads `Ошибка создания: canceling statement due to statement timeout`; both creation and finalization use the same expensive ledger-identity lookups.

Production `authenticated`/`authenticator` statement timeout is 8 seconds. Successful PostgREST statement statistics already approach the limit: create max 7,991.8 ms (163 calls), finalize max 7,941.9 ms (160 calls at initial check). These statistics do not identify the exact failed request.

The real 18:33-local ticket has 152 source batches. Existing indexes support canonical UUID or legacy keys separately, but the functions use `COALESCE(inventory_batch_id::text, NULLIF(btrim(batch_id_text), ''), NULLIF(btrim(batch_id), ''))`. The planner consequently rescanned 13,548 warehouse ledger rows for each of 152 sources. Several balance/UOM checks repeat this work in create/finalize.

## Applied change

Production Supabase migration `20260920134731_p0_impurity_ledger_identity_index_v1` is applied. A B-tree index matches the existing exact identity expression, prefixed by company and warehouse, with quantity/UOM payload. It is valid and ready; size 11 MB on a 104,645-row / 50 MB table.

No ticket, stock, allocation, reservation, identity, RLS, idempotency or timeout semantics changed. No business writes were executed for verification. The bounded build used lock_timeout 250 ms and statement_timeout 4 s. No Vercel deployment was necessary; current web deployment `dpl_7q2kEtdsuT8TmDRXCNBizLxYVXmT` was not replaced.

## Evidence

Same read-only EXPLAIN ANALYZE query over source group `b05e196f-d065-4869-bf89-212fbf1c8bd4`:

| Metric | Before | After |
|---|---:|---:|
| Execution time | 1,500.061 ms | 30.331 ms |
| Source batches | 152 | 152 |
| Lookup | warehouse bitmap + identity filter | exact identity index scan |
| Rows discarded per source | 13,463 | 0 |

About 49.5x faster for this measured subquery, **not a claim of whole-ticket latency**.

Local command: `node node_modules/tsx/dist/cli.mjs scripts/qa-p0-shared-impurity-pglite.ts --v5 --identity-index`.
Result: **29/29 PASS**, including 208-source finalization, repeated-finalize idempotency, exact mass allocation, both close orders, ordinary reservations/processing protection, insufficient-stock rollback and storno.

Read-only Production audit: six most recently finalized soil tickets had exactly one group impurity debit and signed net ticket movement matching soil mass (4,560 / 6,020 / 7,800 / 4,620 / 5,860 / 4,040 kg). No duplicate net debit in this inspected set. The operator finalized the previously open 4,560 kg ticket during investigation, before index publication; we did not finalize it.

## Verification boundary

Index deployment and the real-data query speedup are LIVE VERIFIED. Full create/finalize behavior is regression-tested locally; a new ordinary operator close after index deployment has not yet been timed. Do not claim all possible timeouts eliminated or artificially close an active ticket to obtain a timing.

Rollback, only if required after investigation: drop this new index with bounded locking; this restores prior performance without changing business data. This is a database-only hotfix branch based on the prior audited weighbridge worktree; do not deploy its whole web tree over newer Production branding/other updates.
