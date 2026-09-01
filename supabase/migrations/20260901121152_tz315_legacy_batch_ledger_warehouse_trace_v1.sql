begin;

-- Legacy supplier batches created before warehouse trace hardening may have a
-- NULL inventory_batches.warehouse_id while their immutable receipt ledger
-- already proves the exact warehouse. Keep the batch snapshot unchanged and
-- accept a ledger row only when that pre-existing trace matches company,
-- product, warehouse and batch UUID.
create or replace function public.populate_ledger_inventory_batch_trace_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_allocation public.warehouse_issue_request_item_allocations%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_has_legacy_warehouse_trace boolean := false;
begin
  if new.inventory_batch_id is null and new.warehouse_issue_allocation_id is not null then
    select * into v_allocation
    from public.warehouse_issue_request_item_allocations a
    where a.id = new.warehouse_issue_allocation_id
      and a.company_id = new.company_id;
    if not found then
      raise exception 'Ledger allocation does not belong to the target company'
        using errcode = '23503';
    end if;
    new.inventory_batch_id := v_allocation.batch_id;
  end if;

  if new.inventory_batch_id is null
     and coalesce(new.batch_id_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_batch
    from public.inventory_batches b
    where b.id = new.batch_id_text::uuid
      and b.company_id = new.company_id;
    if found then new.inventory_batch_id := v_batch.id; end if;
  end if;

  if new.inventory_batch_id is null then return new; end if;

  if v_batch.id is null or v_batch.id is distinct from new.inventory_batch_id then
    select * into v_batch
    from public.inventory_batches b
    where b.id = new.inventory_batch_id
      and b.company_id = new.company_id;
  end if;
  if not found then
    raise exception 'Ledger inventory batch does not belong to the target company'
      using errcode = '23503';
  end if;
  if v_batch.product_id is distinct from new.product_id then
    raise exception 'Ledger product does not match the inventory batch'
      using errcode = '23514';
  end if;

  if v_batch.warehouse_id is null then
    select exists (
      select 1
      from public.stock_ledger_entries trace
      where trace.company_id = new.company_id
        and trace.product_id = new.product_id
        and trace.warehouse_id = new.warehouse_id
        and (
          trace.inventory_batch_id = v_batch.id
          or trace.batch_id_text = v_batch.id::text
          or trace.batch_id = v_batch.id::text
        )
    ) into v_has_legacy_warehouse_trace;
    if not v_has_legacy_warehouse_trace then
      raise exception 'Legacy inventory batch has no ledger trace for the requested warehouse'
        using errcode = '23514';
    end if;
  elsif v_batch.warehouse_id is distinct from new.warehouse_id then
    raise exception 'Ledger warehouse does not match the inventory batch'
      using errcode = '23514';
  end if;

  new.crop_id := coalesce(v_batch.crop_id, new.crop_id);
  new.variety_id := coalesce(v_batch.variety_id, new.variety_id);
  new.reproduction_id := coalesce(v_batch.reproduction_id, new.reproduction_id);
  new.batch_class := coalesce(v_batch.batch_class, new.batch_class, 'commodity');
  new.batch_id := v_batch.id::text;
  new.batch_id_text := v_batch.id::text;

  if v_batch.batch_class = 'seed' then
    if v_batch.uom <> 'kg' or new.uom <> 'kg'
       or v_batch.crop_id is null
       or v_batch.variety_id is null
       or v_batch.reproduction_id is null then
      raise exception 'Seed batch must use exact identity and canonical kg'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'stock_ledger_entries'
      and trigger_row.tgname = 'populate_ledger_inventory_batch_trace_v2'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'Required populate_ledger_inventory_batch_trace_v2 trigger is missing';
  end if;
end
$guard$;

commit;
