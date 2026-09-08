begin;

alter table public.warehouses
  add column if not exists display_order integer;

comment on column public.warehouses.display_order is
  'Optional company-scoped presentation order. NULL preserves the legacy name-based fallback.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'warehouses_display_order_positive'
      and conrelid = 'public.warehouses'::regclass
  ) then
    alter table public.warehouses
      add constraint warehouses_display_order_positive
      check (display_order is null or display_order > 0)
      not valid;
  end if;
end
$$;

alter table public.warehouses
  validate constraint warehouses_display_order_positive;

create index if not exists warehouses_company_display_order_idx
  on public.warehouses(company_id, display_order, name, id)
  where coalesce(archived, false) = false
    and coalesce(is_archived, false) = false;

create or replace function public.clear_warehouse_display_order_on_archive_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.archived, false) = true or coalesce(new.is_archived, false) = true then
    new.display_order := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_warehouse_display_order_on_archive_v1()
  from public, anon, authenticated;

drop trigger if exists warehouses_clear_display_order_on_archive_v1 on public.warehouses;
create trigger warehouses_clear_display_order_on_archive_v1
before update of archived, is_archived
on public.warehouses
for each row
execute function public.clear_warehouse_display_order_on_archive_v1();

create or replace function public.reorder_warehouses_atomic_v1(
  p_company_id uuid,
  p_warehouse_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_unique_count integer;
  v_active_count integer;
  v_updated_count integer;
  v_result jsonb;
begin
  if p_company_id is null then
    raise exception 'WAREHOUSE_ORDER_COMPANY_REQUIRED' using errcode = '22004';
  end if;

  v_requested_count := coalesce(cardinality(p_warehouse_ids), 0);
  if v_requested_count < 1 or v_requested_count > 500 or array_position(p_warehouse_ids, null) is not null then
    raise exception 'WAREHOUSE_ORDER_INVALID_LIST' using errcode = '22023';
  end if;

  select count(distinct candidate.warehouse_id)::integer
  into v_unique_count
  from unnest(p_warehouse_ids) as candidate(warehouse_id);

  if v_unique_count <> v_requested_count then
    raise exception 'WAREHOUSE_ORDER_DUPLICATE_ID' using errcode = '22023';
  end if;

  -- Consistent row-lock order keeps concurrent reorder requests short and deadlock-safe.
  perform warehouse.id
  from public.warehouses as warehouse
  where warehouse.company_id = p_company_id
    and coalesce(warehouse.archived, false) = false
    and coalesce(warehouse.is_archived, false) = false
  order by warehouse.id
  for update;

  select count(*)::integer
  into v_active_count
  from public.warehouses as warehouse
  where warehouse.company_id = p_company_id
    and coalesce(warehouse.archived, false) = false
    and coalesce(warehouse.is_archived, false) = false;

  if v_active_count <> v_requested_count then
    raise exception 'WAREHOUSE_ORDER_CONFLICT' using errcode = '40001';
  end if;

  if exists (
    select 1
    from unnest(p_warehouse_ids) as candidate(warehouse_id)
    left join public.warehouses as warehouse
      on warehouse.id = candidate.warehouse_id
     and warehouse.company_id = p_company_id
     and coalesce(warehouse.archived, false) = false
     and coalesce(warehouse.is_archived, false) = false
    where warehouse.id is null
  ) then
    raise exception 'WAREHOUSE_ORDER_SCOPE_MISMATCH' using errcode = '42501';
  end if;

  update public.warehouses as warehouse
  set display_order = requested.position::integer
  from unnest(p_warehouse_ids) with ordinality as requested(warehouse_id, position)
  where warehouse.id = requested.warehouse_id
    and warehouse.company_id = p_company_id
    and coalesce(warehouse.archived, false) = false
    and coalesce(warehouse.is_archived, false) = false;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_requested_count then
    raise exception 'WAREHOUSE_ORDER_CONFLICT' using errcode = '40001';
  end if;

  -- Catch a concurrent insert that committed after the first active-set check.
  select count(*)::integer
  into v_active_count
  from public.warehouses as warehouse
  where warehouse.company_id = p_company_id
    and coalesce(warehouse.archived, false) = false
    and coalesce(warehouse.is_archived, false) = false;

  if v_active_count <> v_requested_count then
    raise exception 'WAREHOUSE_ORDER_CONFLICT' using errcode = '40001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', warehouse.id,
        'displayOrder', warehouse.display_order
      )
      order by warehouse.display_order
    ),
    '[]'::jsonb
  )
  into v_result
  from public.warehouses as warehouse
  where warehouse.company_id = p_company_id
    and warehouse.id = any(p_warehouse_ids);

  return jsonb_build_object(
    'companyId', p_company_id,
    'updatedCount', v_updated_count,
    'warehouses', v_result
  );
end;
$$;

comment on function public.reorder_warehouses_atomic_v1(uuid, uuid[]) is
  'Atomically persists the complete active warehouse order for one company. Server-only service_role RPC.';

revoke all on function public.reorder_warehouses_atomic_v1(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_warehouses_atomic_v1(uuid, uuid[])
  to service_role;

commit;

notify pgrst, 'reload schema';
