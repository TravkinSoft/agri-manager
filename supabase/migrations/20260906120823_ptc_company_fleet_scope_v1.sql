-- PTC uses an explicit company fleet instead of every row in reference_vehicles.
-- Historical weighbridge/audit assets remain untouched and retain their links.
alter table public.reference_vehicles
  add column if not exists ptc_enabled boolean not null default false,
  add column if not exists source_machine_id uuid null references public.reference_machines(id) on delete restrict;

-- A projected agricultural tractor is neither a cargo truck nor a trailer.
-- Keeping that distinction in the legacy fleet_type column makes this
-- migration safe before the application release: the currently deployed
-- weighbridge already ignores the `tractor` kind.
alter table public.reference_vehicles
  drop constraint if exists reference_vehicles_fleet_type_check_v2;
alter table public.reference_vehicles
  add constraint reference_vehicles_fleet_type_check_v2
  check (fleet_type in ('truck','grain_truck','dump_truck','tractor_trailer','tractor'));

create unique index if not exists ux_reference_vehicles_source_machine
  on public.reference_vehicles(source_machine_id)
  where source_machine_id is not null;

create index if not exists idx_reference_vehicles_ptc_company
  on public.reference_vehicles(company_id, ptc_enabled, archived, is_active);

-- Preserve every existing configured fleet outside the owner-curated company.
update public.reference_vehicles vehicle
set ptc_enabled = true
where exists (
  select 1
  from public.ptc_vehicle_states state
  where state.company_id = vehicle.company_id
    and state.vehicle_id = vehicle.id
);

-- Zero owner markers means this deployment has no owner-curated tenant and the
-- data-specific part is a safe no-op. Any partial or ambiguous marker set is a
-- migration error rather than a guess about another company.
do $$
declare
  marker_rows integer;
  marker_companies integer;
begin
  select count(*)::integer, count(distinct company_id)::integer
  into marker_rows, marker_companies
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null;

  if marker_rows <> 0 and (marker_rows <> 2 or marker_companies <> 1) then
    raise exception 'PTC_OWNER_ROSTER_MARKERS_AMBIGUOUS';
  end if;
end;
$$;

-- Abort instead of hiding a vehicle that somebody put on the line between the
-- source audit and release. The release procedure rechecks this condition.
do $$
begin
  if exists(
    with target_companies as (
      select company_id
      from public.reference_vehicles
      where import_source = 'ptc_owner_roster_2026-09-06'
        and company_id is not null
      group by company_id
      having count(*) = 2
    )
    select 1
    from public.ptc_vehicle_states state
    join target_companies target on target.company_id = state.company_id
    join public.reference_vehicles vehicle on vehicle.id = state.vehicle_id
    where state.assigned
      and not coalesce((
        vehicle.import_source = 'ptc_owner_roster_2026-09-06'
        or (
          vehicle.import_source = 'fixed_assets_osv_2026'
          and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,83,89,128])
        )
      ), false)
  ) then
    raise exception 'PTC_NON_ROSTER_VEHICLE_ASSIGNED';
  end if;
end;
$$;

-- The presence of the exact two owner-roster rows identifies the intended
-- company without embedding a generated company UUID in a data migration.
with target_companies as (
  select company_id
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2
)
update public.reference_vehicles vehicle
set ptc_enabled = false
from target_companies target
where vehicle.company_id = target.company_id
  and not exists(
    select 1
    from public.ptc_vehicle_states state
    where state.company_id = vehicle.company_id
      and state.vehicle_id = vehicle.id
      and state.assigned
  );

-- Exact truck roster supplied by the owner: 13 verified OSV source rows plus
-- the two manually reconciled ZIL records. Matching uses stable provenance,
-- never generated row IDs or fuzzy names.
with target_companies as (
  select company_id
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2
)
update public.reference_vehicles vehicle
set ptc_enabled = true
from target_companies target
where vehicle.company_id = target.company_id
  and vehicle.is_active
  and not coalesce(vehicle.archived, false)
  and (
    vehicle.import_source = 'ptc_owner_roster_2026-09-06'
    or (
      vehicle.import_source = 'fixed_assets_osv_2026'
      and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,83,89,128])
    )
  );

-- Project real tractor assets into the transport domain used by PTC. The
-- source_machine_id keeps one canonical link and makes the projection
-- idempotent. Internal plate_number values satisfy the legacy transport
-- constraint but are never presented to users.
with target_companies as (
  select company_id
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2
), source_tractors as (
  select machine.*
  from public.reference_machines machine
  join target_companies target on target.company_id = machine.company_id
  where machine.import_source = 'fixed_assets_osv_2026'
    and machine.import_source_row = any(array[
      39,129,207,208,209,440,441,442,443,444,445,446,447,448,449,450,
      452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,
      468,469,470,471,472,475
    ])
    and machine.is_active
    and not coalesce(machine.archived, false)
)
insert into public.reference_vehicles(
  company_id, user_id, name, full_name, custom_name, type, fleet_type,
  plate_number, license_plate, status, is_active, archived,
  import_source, import_source_row, inventory_number, vin, serial_number,
  manufacture_year, source_raw_name, source_clean_name,
  source_machine_id, ptc_enabled
)
select
  tractor.company_id,
  tractor.user_id,
  coalesce(nullif(trim(tractor.name), ''), nullif(trim(tractor.full_name), ''), 'Трактор'),
  coalesce(nullif(trim(tractor.full_name), ''), nullif(trim(tractor.name), ''), 'Трактор'),
  coalesce(nullif(trim(tractor.full_name), ''), nullif(trim(tractor.name), ''), 'Трактор'),
  'tractor',
  'tractor',
  'PTC-TRACTOR-' || replace(tractor.id::text, '-', ''),
  case
    when trim(coalesce(tractor.license_plate, '')) ~ '[0-9]'
      and upper(trim(tractor.license_plate)) !~ '^(OSV|IMPORT|SOURCE|ROW)'
      and lower(trim(tractor.license_plate)) not in ('трактор', 'без номера')
    then trim(tractor.license_plate)
    else null
  end,
  coalesce(nullif(trim(tractor.status), ''), 'free'),
  true,
  false,
  'ptc_machine_projection_v1',
  tractor.import_source_row,
  tractor.inventory_number,
  tractor.vin,
  tractor.serial_number,
  tractor.manufacture_year,
  tractor.source_raw_name,
  tractor.source_clean_name,
  tractor.id,
  true
from source_tractors tractor
on conflict (source_machine_id) where source_machine_id is not null do update
set
  name = excluded.name,
  full_name = excluded.full_name,
  custom_name = excluded.custom_name,
  type = excluded.type,
  fleet_type = excluded.fleet_type,
  plate_number = excluded.plate_number,
  license_plate = excluded.license_plate,
  status = excluded.status,
  is_active = excluded.is_active,
  archived = excluded.archived,
  import_source = excluded.import_source,
  import_source_row = excluded.import_source_row,
  inventory_number = excluded.inventory_number,
  vin = excluded.vin,
  serial_number = excluded.serial_number,
  manufacture_year = excluded.manufacture_year,
  source_raw_name = excluded.source_raw_name,
  source_clean_name = excluded.source_clean_name,
  ptc_enabled = true;

-- Fleet-manager-created cargo rows have no import provenance. Enrol them in
-- PTC atomically at insert time; imported/global catalogue rows remain opt-in.
create or replace function public.ptc_default_manual_vehicle_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.company_id is not null
    and new.import_source is null
    and new.source_machine_id is null
    and lower(coalesce(new.type, '')) in ('truck', 'grain_truck', 'dump_truck', 'tractor', 'tractor_unit')
  then
    new.ptc_enabled := true;
  end if;
  return new;
end;
$$;

drop trigger if exists ptc_default_manual_vehicle on public.reference_vehicles;
create trigger ptc_default_manual_vehicle
before insert on public.reference_vehicles
for each row execute function public.ptc_default_manual_vehicle_v1();

-- Keep the company/reference guard authoritative for direct API/RPC calls.
create or replace function public.ptc_check_references_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'ptc_flows' then
    if new.field_id is not null and not exists(
      select 1 from public.fields field
      where field.id = new.field_id and field.company_id = new.company_id
    ) then
      raise exception 'PTC_COMPANY_MISMATCH';
    end if;
  elsif tg_table_name = 'ptc_vehicle_states' then
    if not exists(
      select 1 from public.reference_vehicles vehicle
      where vehicle.id = new.vehicle_id
        and vehicle.company_id = new.company_id
    ) then
      raise exception 'PTC_COMPANY_MISMATCH';
    end if;
    -- Validate only entry onto the line. An already assigned vehicle must
    -- remain transitionable and removable if its catalogue row is archived
    -- or disabled concurrently.
    if new.assigned
      and (
        tg_op = 'INSERT'
        or not coalesce(old.assigned, false)
        or new.company_id is distinct from old.company_id
        or new.vehicle_id is distinct from old.vehicle_id
      )
      and not exists(
      select 1 from public.reference_vehicles vehicle
      where vehicle.id = new.vehicle_id
        and vehicle.company_id = new.company_id
        and vehicle.ptc_enabled
        and vehicle.is_active
        and not coalesce(vehicle.archived, false)
    ) then
      -- The second token keeps the pre-release application compatible: its
      -- older error mapper already turns PTC_INACTIVE_VEHICLE into HTTP 409.
      raise exception 'PTC_INELIGIBLE_VEHICLE PTC_INACTIVE_VEHICLE';
    end if;
  elsif tg_table_name = 'ptc_access' then
    if not exists(
      select 1 from public.company_people person
      where person.id = new.person_id and person.company_id = new.company_id
    ) then
      raise exception 'PTC_COMPANY_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ptc_default_manual_vehicle_v1()
  from public, anon, authenticated;
grant execute on function public.ptc_default_manual_vehicle_v1()
  to service_role;

-- A transport projection must never point at another company's machine.
create or replace function public.ptc_check_vehicle_machine_company_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source_machine_id is not null and not exists(
    select 1
    from public.reference_machines machine
    where machine.id = new.source_machine_id
      and machine.company_id = new.company_id
  ) then
    raise exception 'PTC_MACHINE_COMPANY_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists ptc_vehicle_machine_company on public.reference_vehicles;
create trigger ptc_vehicle_machine_company
before insert or update of company_id, source_machine_id on public.reference_vehicles
for each row execute function public.ptc_check_vehicle_machine_company_v1();

revoke all on function public.ptc_check_vehicle_machine_company_v1()
  from public, anon, authenticated;
grant execute on function public.ptc_check_vehicle_machine_company_v1()
  to service_role;

-- Preserve the same tenant invariant if a canonical machine is edited later.
create or replace function public.ptc_check_machine_vehicle_company_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id and exists(
    select 1
    from public.reference_vehicles vehicle
    where vehicle.source_machine_id = new.id
      and vehicle.company_id is distinct from new.company_id
  ) then
    raise exception 'PTC_MACHINE_COMPANY_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists ptc_machine_vehicle_company on public.reference_machines;
create trigger ptc_machine_vehicle_company
before update of company_id on public.reference_machines
for each row execute function public.ptc_check_machine_vehicle_company_v1();

revoke all on function public.ptc_check_machine_vehicle_company_v1()
  from public, anon, authenticated;
grant execute on function public.ptc_check_machine_vehicle_company_v1()
  to service_role;
