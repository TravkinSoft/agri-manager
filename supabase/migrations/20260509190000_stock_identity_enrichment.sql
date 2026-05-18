begin;

-- 1) Enrich ticket_lines with resolved identity snapshots
alter table public.ticket_lines
  add column if not exists variety_name_snapshot text,
  add column if not exists reproduction_name_snapshot text;

-- 2) Enrich stock ledger identity dimensions
alter table public.stock_ledger_entries
  add column if not exists variety_id uuid references public.varieties(id),
  add column if not exists reproduction_id uuid references public.seed_reproductions(id),
  add column if not exists batch_id_text text;

create index if not exists idx_stock_ledger_company_wh_identity
  on public.stock_ledger_entries(company_id, warehouse_id, product_id, variety_id, reproduction_id, batch_id_text);

-- 3) Backfill ledger identity for existing rows from ticket lines
with line_identity as (
  select distinct on (tl.ticket_id, tl.product_id)
    tl.ticket_id,
    tl.product_id,
    tl.variety_id,
    tl.reproduction_id,
    coalesce(nullif(tl.batch_id::text, ''), nullif(tl.lot_id, '')) as batch_id_text
  from public.ticket_lines tl
  where tl.ticket_id is not null
  order by tl.ticket_id, tl.product_id, tl.created_at asc
)
update public.stock_ledger_entries sle
set
  variety_id = li.variety_id,
  reproduction_id = li.reproduction_id,
  batch_id_text = coalesce(li.batch_id_text, sle.batch_id)
from line_identity li
where sle.ticket_id = li.ticket_id
  and sle.product_id = li.product_id
  and sle.company_id is not null
  and (sle.variety_id is null or sle.reproduction_id is null or sle.batch_id_text is null);

-- 4) Canonical identity-aware stock view
create or replace view public.v_stock_balance_identity as
select
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  sle.variety_id,
  sle.reproduction_id,
  sle.batch_id_text as batch_id,
  sum(sle.delta_qty_signed)::numeric(18,3) as quantity,
  max(sle.occurred_at) as last_movement_at
from public.stock_ledger_entries sle
group by
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  sle.variety_id,
  sle.reproduction_id,
  sle.batch_id_text
having abs(sum(sle.delta_qty_signed)) > 0.000001;

comment on view public.v_stock_balance_identity is
  'Identity-aware stock balances grouped by warehouse+product+variety+reproduction+batch.';

commit;

