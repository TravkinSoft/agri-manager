-- TZ-248: keep the factual seed rate derived from canonical consumption and area.

create or replace function public.calculate_seed_fact_rate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_id uuid;
  v_area_ha numeric;
begin
  if coalesce(new.material_kind, new.product_category, '') <> 'seed'
     or new.source_mix_component_id is not null
     or new.crop_id is null
     or new.variety_id is null
     or new.reproduction_id is null then
    return new;
  end if;

  select r.operation_id
    into v_operation_id
  from public.warehouse_issue_requests r
  where r.id = new.request_id
    and r.company_id = new.company_id;

  if v_operation_id is null then
    return new;
  end if;

  select coalesce(
           nullif(o.completed_area_ha, 0),
           nullif(o.planned_area_ha, 0),
           nullif(sum(coalesce(l.actual_area_ha, l.planned_area_ha, 0)), 0)
         )
    into v_area_ha
  from public.operations o
  left join public.operation_lines l
    on l.operation_id = o.id
   and l.company_id = o.company_id
  where o.id = v_operation_id
    and o.company_id = new.company_id
  group by o.completed_area_ha, o.planned_area_ha;

  new.actual_rate_per_ha := case
    when new.consumed_quantity is not null and v_area_ha > 0
      then round(new.consumed_quantity / v_area_ha, 4)
    else null
  end;

  return new;
end;
$$;

revoke all on function public.calculate_seed_fact_rate_v1()
  from public, anon, authenticated;

drop trigger if exists calculate_seed_fact_rate_v1
  on public.warehouse_issue_request_items;
create trigger calculate_seed_fact_rate_v1
before insert or update of consumed_quantity, request_id, company_id, product_id
on public.warehouse_issue_request_items
for each row execute function public.calculate_seed_fact_rate_v1();

create or replace function public.sync_seed_operation_material_rate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_id uuid;
begin
  if coalesce(new.material_kind, new.product_category, '') <> 'seed'
     or new.source_mix_component_id is not null
     or new.actual_rate_per_ha is null then
    return new;
  end if;

  select r.operation_id
    into v_operation_id
  from public.warehouse_issue_requests r
  where r.id = new.request_id
    and r.company_id = new.company_id;

  if v_operation_id is null then
    return new;
  end if;

  update public.operation_materials m
  set actual_rate = new.actual_rate_per_ha,
      updated_by_user_id = coalesce(auth.uid(), m.updated_by_user_id),
      updated_at = now()
  where m.operation_id = v_operation_id
    and m.company_id = new.company_id
    and m.product_id = new.product_id
    and m.material_type = 'seed'
    and m.source_mix_component_id is null
    and m.crop_id is not distinct from new.crop_id
    and m.variety_id is not distinct from new.variety_id
    and m.reproduction_id is not distinct from new.reproduction_id;

  return new;
end;
$$;

revoke all on function public.sync_seed_operation_material_rate_v1()
  from public, anon, authenticated;

drop trigger if exists sync_seed_operation_material_rate_v1
  on public.warehouse_issue_request_items;
create trigger sync_seed_operation_material_rate_v1
after insert or update of consumed_quantity, actual_rate_per_ha
on public.warehouse_issue_request_items
for each row execute function public.sync_seed_operation_material_rate_v1();

-- Backfill only the derived rate fields; factual quantities remain unchanged.
update public.warehouse_issue_request_items i
set consumed_quantity = i.consumed_quantity
where coalesce(i.material_kind, i.product_category, '') = 'seed'
  and i.source_mix_component_id is null
  and i.consumed_quantity is not null
  and i.crop_id is not null
  and i.variety_id is not null
  and i.reproduction_id is not null;

do $postcheck$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'warehouse_issue_request_items'
      and t.tgname = 'calculate_seed_fact_rate_v1'
      and not t.tgisinternal
  ) then
    raise exception 'Seed factual rate trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'warehouse_issue_request_items'
      and t.tgname = 'sync_seed_operation_material_rate_v1'
      and not t.tgisinternal
  ) then
    raise exception 'Seed operation material rate sync trigger is missing';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';
