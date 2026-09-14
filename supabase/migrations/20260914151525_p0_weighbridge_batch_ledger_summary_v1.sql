begin;

-- The impurity picker only needs one balance and one unit-validity flag per
-- physical inventory batch. Resolve the canonical and two legacy identities
-- once in Postgres instead of downloading the same ledger rows through three
-- paginated Data API reads.
create index if not exists idx_stock_ledger_picker_batch_text_v1
  on public.stock_ledger_entries(company_id, warehouse_id, batch_id_text)
  where inventory_batch_id is null
    and batch_id_text is not null;

create index if not exists idx_stock_ledger_picker_legacy_batch_v1
  on public.stock_ledger_entries(company_id, warehouse_id, batch_id)
  where inventory_batch_id is null
    and batch_id_text is null
    and batch_id is not null;

create or replace function public.weighbridge_batch_ledger_summary_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_inventory_batch_ids uuid[]
)
returns table (
  inventory_batch_id uuid,
  balance_kg numeric(18,3),
  has_invalid_uom boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested_input as materialized (
    select distinct requested_id as inventory_batch_id
    from pg_catalog.unnest(coalesce(p_inventory_batch_ids, '{}'::uuid[])) as requested(requested_id)
    where requested_id is not null
  ), requested as materialized (
    select
      batch.id as inventory_batch_id,
      batch.warehouse_id
    from requested_input input
    join public.inventory_batches batch
      on batch.id = input.inventory_batch_id
     and batch.company_id = p_company_id
    where p_company_id is not null
      and (p_warehouse_id is null or batch.warehouse_id = p_warehouse_id)
  ), resolved_ledger as materialized (
    select
      entry.inventory_batch_id,
      entry.delta_qty_signed,
      entry.uom
    from public.stock_ledger_entries entry
    join requested
      on requested.inventory_batch_id = entry.inventory_batch_id
     and requested.warehouse_id = entry.warehouse_id
    where entry.company_id = p_company_id
      and entry.inventory_batch_id is not null

    union all

    select
      requested.inventory_batch_id,
      entry.delta_qty_signed,
      entry.uom
    from public.stock_ledger_entries entry
    join requested
      on entry.batch_id_text = requested.inventory_batch_id::text
     and requested.warehouse_id = entry.warehouse_id
    where entry.company_id = p_company_id
      and entry.inventory_batch_id is null
      and entry.batch_id_text is not null

    union all

    select
      requested.inventory_batch_id,
      entry.delta_qty_signed,
      entry.uom
    from public.stock_ledger_entries entry
    join requested
      on entry.batch_id = requested.inventory_batch_id::text
     and requested.warehouse_id = entry.warehouse_id
    where entry.company_id = p_company_id
      and entry.inventory_batch_id is null
      and entry.batch_id_text is null
      and entry.batch_id is not null
  )
  select
    requested.inventory_batch_id,
    coalesce(sum(resolved_ledger.delta_qty_signed), 0)::numeric(18,3) as balance_kg,
    coalesce(
      bool_or(
        lower(btrim(coalesce(resolved_ledger.uom, ''))) not in ('kg', 'кг', 'g', 'г', 'gr')
      ) filter (where resolved_ledger.inventory_batch_id is not null),
      false
    ) as has_invalid_uom
  from requested
  left join resolved_ledger
    on resolved_ledger.inventory_batch_id = requested.inventory_batch_id
  group by requested.inventory_batch_id
  order by requested.inventory_batch_id;
$function$;

comment on function public.weighbridge_batch_ledger_summary_v1(uuid, uuid, uuid[])
is 'Server-only company-scoped ledger balance and invalid-UOM summary for requested batches; optionally restricts to one warehouse.';

revoke all on function public.weighbridge_batch_ledger_summary_v1(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.weighbridge_batch_ledger_summary_v1(uuid, uuid, uuid[])
  to service_role;

notify pgrst, 'reload schema';

commit;
