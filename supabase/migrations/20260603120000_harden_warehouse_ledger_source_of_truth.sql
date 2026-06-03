begin;

create index if not exists idx_stock_ledger_inventory_reason_ref
  on public.stock_ledger_entries(company_id, reason_ref_id, reason_type, warehouse_id, product_id);

create or replace function public.post_inventory_transaction_to_ledger(
  p_transaction_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with src as (
    select
      it.id,
      it.company_id,
      it.product_id,
      coalesce(nullif(it.movement_type, ''), case when it.transaction_type = 'in' then 'receipt' else 'issue' end) as movement_type,
      coalesce(nullif(it.transaction_type, ''), 'out') as transaction_type,
      it.warehouse_id,
      it.source_warehouse_id,
      it.destination_warehouse_id,
      abs(coalesce(nullif(it.base_quantity_kg, 0), it.quantity, 0))::numeric(14,3) as quantity,
      coalesce(it.operation_datetime, it.confirmed_at, it.created_at, it.date::timestamptz, now()) as occurred_at,
      p.id as created_by,
      nullif(trim(coalesce(it.notes, '')), '') as notes
    from public.inventory_transactions it
    left join public.profiles p
      on p.id = coalesce(it.responsible_user_id, it.user_id)
    where it.id = p_transaction_id
      and coalesce(it.status, 'confirmed') = 'confirmed'
      and it.company_id is not null
      and it.product_id is not null
      and abs(coalesce(nullif(it.base_quantity_kg, 0), it.quantity, 0)) > 0
  ),
  expanded as (
    select
      company_id,
      product_id,
      coalesce(destination_warehouse_id, warehouse_id) as warehouse_id,
      'in'::public.ledger_direction as direction,
      quantity,
      'kg'::text as uom,
      quantity as delta_qty_signed,
      'warehouse_receipt'::text as reason_type,
      id as reason_ref_id,
      occurred_at,
      created_by,
      notes
    from src
    where movement_type = 'receipt'

    union all

    select
      company_id,
      product_id,
      coalesce(source_warehouse_id, warehouse_id) as warehouse_id,
      'out'::public.ledger_direction as direction,
      quantity,
      'kg'::text as uom,
      -quantity as delta_qty_signed,
      case when movement_type = 'writeoff' then 'warehouse_writeoff' else 'warehouse_issue' end as reason_type,
      id as reason_ref_id,
      occurred_at,
      created_by,
      notes
    from src
    where movement_type in ('issue', 'writeoff')

    union all

    select
      company_id,
      product_id,
      source_warehouse_id as warehouse_id,
      'out'::public.ledger_direction as direction,
      quantity,
      'kg'::text as uom,
      -quantity as delta_qty_signed,
      'warehouse_transfer'::text as reason_type,
      id as reason_ref_id,
      occurred_at,
      created_by,
      notes
    from src
    where movement_type = 'transfer'

    union all

    select
      company_id,
      product_id,
      destination_warehouse_id as warehouse_id,
      'in'::public.ledger_direction as direction,
      quantity,
      'kg'::text as uom,
      quantity as delta_qty_signed,
      'warehouse_transfer'::text as reason_type,
      id as reason_ref_id,
      occurred_at,
      created_by,
      notes
    from src
    where movement_type = 'transfer'

    union all

    select
      company_id,
      product_id,
      case when transaction_type = 'in' then coalesce(destination_warehouse_id, warehouse_id) else coalesce(source_warehouse_id, warehouse_id) end as warehouse_id,
      case when transaction_type = 'in' then 'in'::public.ledger_direction else 'out'::public.ledger_direction end as direction,
      quantity,
      'kg'::text as uom,
      case when transaction_type = 'in' then quantity else -quantity end as delta_qty_signed,
      'warehouse_adjustment'::text as reason_type,
      id as reason_ref_id,
      occurred_at,
      created_by,
      notes
    from src
    where movement_type = 'adjustment'
  )
  insert into public.stock_ledger_entries (
    company_id,
    product_id,
    warehouse_id,
    direction,
    quantity,
    uom,
    delta_qty_signed,
    reason_type,
    reason_ref_id,
    occurred_at,
    created_by,
    notes
  )
  select
    e.company_id,
    e.product_id,
    e.warehouse_id,
    e.direction,
    e.quantity,
    e.uom,
    e.delta_qty_signed,
    e.reason_type,
    e.reason_ref_id,
    e.occurred_at,
    e.created_by,
    e.notes
  from expanded e
  where e.warehouse_id is not null
    and not exists (
      select 1
      from public.stock_ledger_entries sle
      where sle.company_id = e.company_id
        and sle.reason_ref_id = e.reason_ref_id
        and sle.reason_type = e.reason_type
        and sle.warehouse_id = e.warehouse_id
        and sle.product_id = e.product_id
        and abs(coalesce(sle.delta_qty_signed, 0) - e.delta_qty_signed) < 0.0001
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

select public.post_inventory_transaction_to_ledger(it.id)
from public.inventory_transactions it
where coalesce(it.status, 'confirmed') = 'confirmed'
  and it.company_id is not null;

create or replace view public.v_stock_movements_canonical as
select
  'stock_ledger_entries'::text as source_system,
  sle.id as source_id,
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  coalesce(sle.occurred_at, sle.created_at, now()) as occurred_at,
  'confirmed'::text as status,
  coalesce(nullif(sle.reason_type, ''), case when sle.direction = 'in' then 'receipt' else 'issue' end) as movement_type,
  case when coalesce(sle.delta_qty_signed, 0) > 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_in,
  case when coalesce(sle.delta_qty_signed, 0) < 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_out,
  coalesce(sle.delta_qty_signed, case when sle.direction = 'in' then abs(sle.quantity) else -abs(sle.quantity) end)::numeric as delta_qty,
  coalesce(nullif(sle.uom, ''), 'kg') as uom,
  sle.reason_type,
  sle.ticket_id,
  sle.processing_id
from public.stock_ledger_entries sle
where sle.company_id is not null;

comment on view public.v_stock_movements_canonical is
'Canonical stock movements. Ledger-only source of truth; inventory_transactions are posted into stock_ledger_entries.';

create or replace view public.v_stock_balance_canonical as
select
  m.company_id,
  m.warehouse_id,
  m.product_id,
  sum(m.delta_qty)::numeric(18,3) as quantity,
  max(m.uom) filter (where m.uom is not null and m.uom <> '') as uom,
  min(m.occurred_at) as first_movement_at,
  max(m.occurred_at) as last_movement_at
from public.v_stock_movements_canonical m
group by m.company_id, m.warehouse_id, m.product_id
having abs(sum(m.delta_qty)) > 0.000001;

comment on view public.v_stock_balance_canonical is
'Canonical stock balances by company/warehouse/product, derived only from stock_ledger_entries.';

grant select on public.v_stock_movements_canonical to authenticated;
grant select on public.v_stock_balance_canonical to authenticated;

commit;

notify pgrst, 'reload schema';
