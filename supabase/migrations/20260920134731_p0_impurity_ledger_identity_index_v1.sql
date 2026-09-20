-- P0: impurity create/finalize repeatedly resolve the exact ledger batch key.
-- Filename version matches the Production migration recorded by Supabase.
-- Existing UUID-only/legacy-only indexes cannot satisfy this COALESCE predicate.
-- Production: 152 sources x 13,548 warehouse entries per pass; ~1.5 s/pass.
-- Keep the predicate, accounting, reservations, RLS and idempotency unchanged.
-- Fail fast rather than queue behind a live weighing transaction. The small
-- (104k rows / 50 MB at deployment) index build also has a strict time budget.
set local lock_timeout = '250ms';
set local statement_timeout = '4s';

create index idx_stock_ledger_exact_batch_identity_v1
  on public.stock_ledger_entries (
    company_id,
    warehouse_id,
    (coalesce(
      inventory_batch_id::text,
      nullif(btrim(batch_id_text), ''),
      nullif(btrim(batch_id), '')
    ))
  )
  include (delta_qty_signed, uom);

comment on index public.idx_stock_ledger_exact_batch_identity_v1 is
  'Exact canonical/legacy batch identity used by impurity balance and UOM checks; no accounting semantics change.';
