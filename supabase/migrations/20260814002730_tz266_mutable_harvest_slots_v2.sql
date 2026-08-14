begin;

do $block$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name = 'weighbridge_active_harvests'
    and constraint_type = 'UNIQUE'
    and constraint_name in (
      select constraint_name
      from information_schema.key_column_usage
      where table_schema = 'public'
        and table_name = 'weighbridge_active_harvests'
      group by constraint_name
      having array_agg(column_name::text order by ordinal_position) = array[
        'company_id', 'season_id', 'crop_structure_id', 'warehouse_id'
      ]::text[]
    );

  if v_constraint_name is not null then
    execute format(
      'alter table public.weighbridge_active_harvests drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$block$;

create unique index if not exists weighbridge_active_harvests_active_context_uidx
  on public.weighbridge_active_harvests(company_id, season_id, crop_structure_id, warehouse_id)
  where status = 'active';

create or replace function private.validate_weighbridge_active_harvest_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_structure public.crop_structure%rowtype;
  v_season public.seasons%rowtype;
  v_field public.fields%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_active_count integer;
begin
  select * into v_structure
  from public.crop_structure
  where id = new.crop_structure_id;

  if not found
    or v_structure.company_id is distinct from new.company_id
    or v_structure.season_id is distinct from new.season_id
    or v_structure.field_id is distinct from new.field_id
    or coalesce(v_structure.archived, false)
    or v_structure.crop_id is null then
    raise exception 'Active harvest crop structure is invalid' using errcode = '23514';
  end if;

  select * into v_season
  from public.seasons
  where id = new.season_id;

  if not found
    or v_season.company_id is distinct from new.company_id
    or coalesce(v_season.archived, false) then
    raise exception 'Active harvest season is invalid' using errcode = '23514';
  end if;

  select * into v_field
  from public.fields
  where id = new.field_id;

  if not found
    or v_field.company_id is distinct from new.company_id
    or coalesce(v_field.archived, false) then
    raise exception 'Active harvest field is invalid' using errcode = '23514';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = new.warehouse_id;

  if not found
    or v_warehouse.company_id is distinct from new.company_id
    or coalesce(v_warehouse.archived, false)
    or lower(coalesce(v_warehouse.warehouse_type, '')) not in (
      'grain', 'seed', 'vegetable', 'potato_storage', 'temporary'
    ) then
    raise exception 'Active harvest reception warehouse is invalid' using errcode = '23514';
  end if;

  if new.status = 'active'
    and (case
      when tg_op = 'INSERT' then true
      else old.status is distinct from 'active'
    end) then
    perform pg_advisory_xact_lock(hashtextextended(
      new.company_id::text || ':' || new.season_id::text || ':weighbridge-active-harvests',
      0
    ));

    select count(*) into v_active_count
    from public.weighbridge_active_harvests route
    where route.company_id = new.company_id
      and route.season_id = new.season_id
      and route.status = 'active'
      and route.id is distinct from new.id;

    if v_active_count >= 4 then
      raise exception 'Maximum 4 active harvest workspaces' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  if new.status = 'active' then
    new.closed_at := null;
    new.closed_by := null;
  elsif new.closed_at is null then
    new.closed_at := now();
  end if;

  return new;
end;
$function$;

commit;
