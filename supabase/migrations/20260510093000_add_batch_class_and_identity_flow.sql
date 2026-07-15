begin;

-- 1) Batch class model
alter table public.inventory_batches
  add column if not exists batch_class text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_batches_batch_class_check'
      and conrelid = 'public.inventory_batches'::regclass
  ) then
    alter table public.inventory_batches
      add constraint inventory_batches_batch_class_check
      check (batch_class in ('commodity','seed','feed','waste','processing','rejected'));
  end if;
end $$;

update public.inventory_batches
set batch_class = case
  when status in ('ready_for_seeding','treated') then 'seed'
  when status in ('forage') then 'feed'
  when status in ('waste') then 'waste'
  when status in ('rejected') then 'rejected'
  when status in ('drying','cleaning','conditioned','calibrated') then 'processing'
  else 'commodity'
end
where batch_class is null;

alter table public.inventory_batches
  alter column batch_class set default 'commodity',
  alter column batch_class set not null;

-- 2) Carry class on ledger for stable warehouse reads
alter table public.stock_ledger_entries
  add column if not exists batch_class text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_ledger_entries_batch_class_check'
      and conrelid = 'public.stock_ledger_entries'::regclass
  ) then
    alter table public.stock_ledger_entries
      add constraint stock_ledger_entries_batch_class_check
      check (batch_class in ('commodity','seed','feed','waste','processing','rejected'));
  end if;
end $$;

update public.stock_ledger_entries sle
set batch_class = coalesce(
  sle.batch_class,
  case
    when lower(coalesce(sle.reason_type,'')) in ('disposal','waste','writeoff') then 'waste'
    when lower(coalesce(sle.reason_type,'')) like 'drying_%' then 'processing'
    else 'commodity'
  end
)
where sle.batch_class is null;

alter table public.stock_ledger_entries
  drop constraint if exists stock_ledger_entries_variety_id_fkey,
  drop constraint if exists stock_ledger_entries_reproduction_id_fkey;

drop index if exists public.idx_stock_ledger_company_wh_identity_class;
drop index if exists public.idx_stock_ledger_company_wh_identity;

create index idx_stock_ledger_company_wh_identity
  on public.stock_ledger_entries(company_id, warehouse_id, product_id, variety_id, reproduction_id);

-- 3) Identity view includes class
drop view if exists public.v_stock_balance_identity;
create or replace view public.v_stock_balance_identity as
select
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  sle.variety_id,
  sle.reproduction_id,
  nullif(trim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') as batch_id,
  sum(
    case
      when sle.direction = 'in' then coalesce(sle.quantity, 0)
      when sle.direction = 'out' then -coalesce(sle.quantity, 0)
      else coalesce(sle.delta_qty_signed, 0)
    end
  )::numeric as quantity,
  max(sle.occurred_at) as last_movement_at,
  coalesce(sle.batch_class, 'commodity') as batch_class
from public.stock_ledger_entries sle
group by
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  sle.variety_id,
  sle.reproduction_id,
  nullif(trim(coalesce(sle.batch_id_text, sle.batch_id, '')), ''),
  coalesce(sle.batch_class, 'commodity');

comment on view public.v_stock_balance_identity is
  'Identity-aware stock balances grouped by warehouse+product+variety+reproduction+batch+batch_class.';

commit;
