/*
  EIC (Единый источник чтения) - Phase 1 stabilization
  -----------------------------------------------------
  Goal:
  - Keep existing write flows intact
  - Introduce one canonical read layer for stock movements and balances
  - Support both current movement sources:
      1) inventory_transactions
      2) stock_ledger_entries
*/

-- 1) Canonical movement stream
-- transfer from inventory_transactions is split into 2 movements:
--   out from source warehouse, in to destination warehouse
create or replace view public.v_stock_movements_canonical as
with inventory_base as (
  select
    'inventory_transactions'::text as source_system,
    it.id as source_id,
    it.company_id,
    it.product_id,
    coalesce(it.operation_datetime, it.created_at, (it.date::timestamptz)) as occurred_at,
    coalesce(nullif(it.status, ''), 'confirmed') as status,
    coalesce(nullif(it.transaction_type, ''), 'in') as transaction_type,
    coalesce(nullif(it.movement_type, ''), case when it.transaction_type = 'in' then 'receipt' else 'issue' end) as movement_type,
    it.source_warehouse_id,
    it.destination_warehouse_id,
    it.warehouse_id as legacy_warehouse_id,
    it.quantity,
    coalesce(nullif(p.unit, ''), 'kg') as uom,
    null::uuid as ticket_id,
    null::uuid as processing_id,
    it.notes as reason_type
  from public.inventory_transactions it
  join public.products p on p.id = it.product_id
  where it.company_id is not null
    and coalesce(it.status, 'confirmed') = 'confirmed'
),
inventory_expanded as (
  -- receipt
  select
    source_system,
    source_id,
    company_id,
    coalesce(destination_warehouse_id, legacy_warehouse_id) as warehouse_id,
    product_id,
    occurred_at,
    status,
    'receipt'::text as movement_type,
    quantity::numeric as quantity_in,
    0::numeric as quantity_out,
    abs(quantity)::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type = 'receipt'
    and coalesce(destination_warehouse_id, legacy_warehouse_id) is not null

  union all

  -- issue
  select
    source_system,
    source_id,
    company_id,
    coalesce(source_warehouse_id, legacy_warehouse_id) as warehouse_id,
    product_id,
    occurred_at,
    status,
    'issue'::text as movement_type,
    0::numeric as quantity_in,
    quantity::numeric as quantity_out,
    (-abs(quantity))::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type in ('issue', 'writeoff')
    and coalesce(source_warehouse_id, legacy_warehouse_id) is not null

  union all

  -- adjustment in
  select
    source_system,
    source_id,
    company_id,
    coalesce(destination_warehouse_id, legacy_warehouse_id, source_warehouse_id) as warehouse_id,
    product_id,
    occurred_at,
    status,
    'adjustment_in'::text as movement_type,
    quantity::numeric as quantity_in,
    0::numeric as quantity_out,
    abs(quantity)::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type = 'adjustment'
    and coalesce(destination_warehouse_id, legacy_warehouse_id, source_warehouse_id) is not null
    and transaction_type = 'in'

  union all

  -- adjustment out
  select
    source_system,
    source_id,
    company_id,
    coalesce(source_warehouse_id, legacy_warehouse_id, destination_warehouse_id) as warehouse_id,
    product_id,
    occurred_at,
    status,
    'adjustment_out'::text as movement_type,
    0::numeric as quantity_in,
    quantity::numeric as quantity_out,
    (-abs(quantity))::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type = 'adjustment'
    and coalesce(source_warehouse_id, legacy_warehouse_id, destination_warehouse_id) is not null
    and transaction_type = 'out'

  union all

  -- transfer out
  select
    source_system,
    source_id,
    company_id,
    source_warehouse_id as warehouse_id,
    product_id,
    occurred_at,
    status,
    'transfer_out'::text as movement_type,
    0::numeric as quantity_in,
    quantity::numeric as quantity_out,
    (-abs(quantity))::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type = 'transfer'
    and source_warehouse_id is not null

  union all

  -- transfer in
  select
    source_system,
    source_id,
    company_id,
    destination_warehouse_id as warehouse_id,
    product_id,
    occurred_at,
    status,
    'transfer_in'::text as movement_type,
    quantity::numeric as quantity_in,
    0::numeric as quantity_out,
    abs(quantity)::numeric as delta_qty,
    uom,
    reason_type,
    ticket_id,
    processing_id
  from inventory_base
  where movement_type = 'transfer'
    and destination_warehouse_id is not null
),
ledger_expanded as (
  select
    'stock_ledger_entries'::text as source_system,
    sle.id as source_id,
    sle.company_id,
    sle.warehouse_id,
    sle.product_id,
    coalesce(sle.occurred_at, sle.created_at, now()) as occurred_at,
    'confirmed'::text as status,
    coalesce(nullif(sle.reason_type, ''), 'ledger') as movement_type,
    case when sle.delta_qty_signed > 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_in,
    case when sle.delta_qty_signed < 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_out,
    sle.delta_qty_signed::numeric as delta_qty,
    coalesce(nullif(sle.uom, ''), 'kg') as uom,
    sle.reason_type,
    sle.ticket_id,
    sle.processing_id
  from public.stock_ledger_entries sle
  where sle.company_id is not null
    and coalesce(sle.is_storno, false) = false
)
select * from inventory_expanded
union all
select * from ledger_expanded;

comment on view public.v_stock_movements_canonical is
'Canonical stock movements for read-only use across UI/dashboard/assistant. Includes confirmed inventory transactions and non-storno stock ledger entries.';

-- 2) Canonical balance snapshot
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
having sum(m.delta_qty) <> 0;

comment on view public.v_stock_balance_canonical is
'Canonical stock balances by company/warehouse/product.';

-- 3) Canonical helper function
create or replace function public.get_stock_balance_canonical(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
  from public.v_stock_balance_canonical
  where company_id = p_company_id
    and warehouse_id = p_warehouse_id
    and product_id = p_product_id;
$$;

-- 4) Reconciliation view (for diagnostics)
create or replace view public.v_stock_balance_reconciliation as
with inv as (
  select
    company_id,
    warehouse_id,
    product_id,
    sum(delta_qty)::numeric(18,3) as qty_inventory
  from public.v_stock_movements_canonical
  where source_system = 'inventory_transactions'
  group by company_id, warehouse_id, product_id
),
led as (
  select
    company_id,
    warehouse_id,
    product_id,
    sum(delta_qty)::numeric(18,3) as qty_ledger
  from public.v_stock_movements_canonical
  where source_system = 'stock_ledger_entries'
  group by company_id, warehouse_id, product_id
)
select
  coalesce(inv.company_id, led.company_id) as company_id,
  coalesce(inv.warehouse_id, led.warehouse_id) as warehouse_id,
  coalesce(inv.product_id, led.product_id) as product_id,
  coalesce(inv.qty_inventory, 0)::numeric(18,3) as qty_inventory,
  coalesce(led.qty_ledger, 0)::numeric(18,3) as qty_ledger,
  (coalesce(inv.qty_inventory, 0) - coalesce(led.qty_ledger, 0))::numeric(18,3) as diff
from inv
full outer join led
  on inv.company_id = led.company_id
 and inv.warehouse_id = led.warehouse_id
 and inv.product_id = led.product_id
where abs(coalesce(inv.qty_inventory, 0) - coalesce(led.qty_ledger, 0)) > 0.0001;

comment on view public.v_stock_balance_reconciliation is
'Rows where inventory-transactions and stock-ledger derived balances differ.';
