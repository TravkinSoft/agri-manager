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

-- Preserve every already configured fleet outside the owner-curated company.
-- The owner tenant is narrowed below without deleting references or PTC state.
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

-- The two requested existing MTZ assets and the already catalogued red KAMAZ
-- are matched only by stable source provenance. Missing/ambiguous rows abort;
-- the migration never falls back to a fuzzy name or a guessed plate.
do $$
declare
  target_company uuid;
  matched integer;
begin
  select company_id into target_company
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2;

  if target_company is null then return; end if;

  select count(*)::integer into matched
  from public.reference_machines
  where company_id = target_company
    and import_source = 'fixed_assets_osv_2026'
    and import_source_row = any(array[445,446]);
  if matched <> 2 then raise exception 'PTC_REQUIRED_MTZ_SOURCE_AMBIGUOUS'; end if;

  select count(*)::integer into matched
  from public.reference_vehicles
  where company_id = target_company
    and import_source = 'fixed_assets_osv_2026'
    and import_source_row = 78;
  if matched <> 1 then raise exception 'PTC_REQUIRED_KAMAZ_801_SOURCE_AMBIGUOUS'; end if;

  select count(*)::integer into matched
  from public.company_people
  where company_id = target_company
    and deleted_at is null
    and lower(trim(regexp_replace(full_name, '[[:space:]]+', ' ', 'g'))) =
      lower('Калымов Канат Айтенович')
    and role_type = 'mechanic_operator'
    and status = 'active';
  if matched <> 1 then raise exception 'PTC_KALYMOV_PERSON_AMBIGUOUS'; end if;
end;
$$;

-- Never make an in-flight loaded vehicle disappear. Empty non-roster rows may
-- be removed from the PTC screen, but their state/history/repair records stay.
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
      and state.state in ('loaded','unloading')
      and not coalesce((
        vehicle.is_active
        and not coalesce(vehicle.archived, false)
        and (
          vehicle.import_source = 'ptc_owner_roster_2026-09-06'
          or (
            vehicle.import_source = 'fixed_assets_osv_2026'
            and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,78,83,89,128])
          )
          or (
            vehicle.import_source = 'ptc_potato_roster_2026-09-06'
            and vehicle.import_source_row = 1120
          )
          or exists(
            select 1
            from public.reference_machines machine
            where machine.id = vehicle.source_machine_id
              and machine.company_id = vehicle.company_id
              and (
                (machine.import_source = 'fixed_assets_osv_2026' and machine.import_source_row = any(array[445,446]))
                or (
                  machine.import_source = 'ptc_potato_roster_2026-09-06'
                  and machine.import_source_row = any(array[1,2])
                )
              )
          )
        )
      ), false)
  ) then
    raise exception 'PTC_NON_ROSTER_VEHICLE_IN_FLIGHT';
  end if;
end;
$$;

-- Hide every unrelated catalogue row only from PTC. No vehicle, state, event
-- or repair record is deleted or archived.
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
  and not coalesce((
    vehicle.import_source = 'ptc_owner_roster_2026-09-06'
    or (
      vehicle.import_source = 'fixed_assets_osv_2026'
      and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,78,83,89,128])
    )
    or (
      vehicle.import_source = 'ptc_potato_roster_2026-09-06'
      and vehicle.import_source_row = 1120
    )
    or exists(
      select 1
      from public.reference_machines machine
      where machine.id = vehicle.source_machine_id
        and machine.company_id = vehicle.company_id
        and (
          (machine.import_source = 'fixed_assets_osv_2026' and machine.import_source_row = any(array[445,446]))
          or (machine.import_source = 'ptc_potato_roster_2026-09-06' and machine.import_source_row = any(array[1,2]))
        )
    )
  ), false);

-- Exact existing truck roster: the two reconciled owner rows, fourteen fixed
-- asset rows (including the existing red KAMAZ T-801 BN at row 78), and no
-- trailers/passenger/UAZ/Hilux/test/special-purpose rows.
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
      and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,78,83,89,128])
    )
  );

-- KAMAZ 1120 is new. Its user-facing identifier is exactly the supplied 1120;
-- no state registration plate is fabricated. Refuse a second live identity
-- even when it was created without the canonical import provenance.
do $$
declare
  target_company uuid;
begin
  select company_id into target_company
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2;
  if target_company is null then return; end if;

  if exists(
    select 1
    from public.reference_vehicles vehicle
    where vehicle.company_id = target_company
      and vehicle.is_active
      and not coalesce(vehicle.archived, false)
      and not coalesce((
        vehicle.import_source = 'ptc_potato_roster_2026-09-06'
        and vehicle.import_source_row = 1120
      ), false)
      and (
        regexp_replace(
          translate(upper(coalesce(nullif(trim(vehicle.license_plate), ''), trim(vehicle.plate_number))),
            'АВЕКМНОРСТУХЁ', 'ABEKMHOPCTYXE'),
          '[^A-Z0-9]', '', 'g'
        ) = '1120'
        or trim(regexp_replace(lower(translate(coalesce(nullif(trim(vehicle.custom_name), ''), nullif(trim(vehicle.name), ''), vehicle.full_name), 'Ёё', 'Ее')),
          '[^[:alnum:]]+', ' ', 'g')) = lower('камаз белый')
      )
  ) then
    raise exception 'PTC_KAMAZ_1120_IDENTITY_CONFLICT';
  end if;
end;
$$;

-- Stable provenance makes reruns idempotent. A rerun never overwrites a
-- manually changed driver, status, active/archive flags, or other operations.
with target_context as (
  select company_id, min(user_id::text)::uuid as user_id
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2
)
insert into public.reference_vehicles(
  company_id, user_id, name, full_name, custom_name, type, fleet_type,
  plate_number, license_plate, status, is_active, archived,
  import_source, import_source_row, source_raw_name, source_clean_name,
  ptc_enabled, primary_responsible_personnel_id
)
select company_id, user_id, 'КАМАЗ белый', 'КАМАЗ белый', 'КАМАЗ белый',
  'truck', 'truck', '1120', '1120', 'free', true, false,
  'ptc_potato_roster_2026-09-06', 1120, 'Камаз Белый 1120', 'КАМАЗ белый 1120', true, null
from target_context
on conflict (company_id, import_source, import_source_row)
where import_source is not null and import_source_row is not null
do nothing;

-- Two tractors have no unambiguous fixed-asset match. Create canonical machine
-- rows with honest unknown plates, not duplicate or made-up transport numbers.
do $$
declare
  target_company uuid;
begin
  select company_id into target_company
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2;
  if target_company is null then return; end if;

  if exists(
    select 1
    from public.reference_machines machine
    where machine.company_id = target_company
      and machine.is_active
      and not coalesce(machine.archived, false)
      and not coalesce((
        machine.import_source = 'ptc_potato_roster_2026-09-06'
        and machine.import_source_row = any(array[1,2])
      ), false)
      and trim(regexp_replace(lower(translate(coalesce(machine.name, machine.full_name), 'Ёё', 'Ее')),
        '[^[:alnum:]]+', ' ', 'g')) = any(array[
          lower('мтз номер неизвестен'), lower('мтз пушкин аренда')
        ])
  ) or exists(
    select 1
    from public.reference_vehicles vehicle
    where vehicle.company_id = target_company
      and vehicle.is_active
      and not coalesce(vehicle.archived, false)
      and vehicle.source_machine_id is null
      and trim(regexp_replace(lower(translate(coalesce(nullif(trim(vehicle.custom_name), ''), nullif(trim(vehicle.name), ''), vehicle.full_name), 'Ёё', 'Ее')),
        '[^[:alnum:]]+', ' ', 'g')) = any(array[
          lower('мтз номер неизвестен'), lower('мтз пушкин аренда')
        ])
  ) then
    raise exception 'PTC_MANUAL_MTZ_IDENTITY_CONFLICT';
  end if;
end;
$$;

with target_context as (
  select target.company_id, machine.user_id
  from (
    select company_id
    from public.reference_vehicles
    where import_source = 'ptc_owner_roster_2026-09-06'
      and company_id is not null
    group by company_id
    having count(*) = 2
  ) target
  join public.reference_machines machine on machine.company_id = target.company_id
    and machine.import_source = 'fixed_assets_osv_2026'
    and machine.import_source_row = 445
)
insert into public.reference_machines(
  company_id, user_id, name, full_name, type, status, is_active, archived,
  category, machinery_type, description, import_source, import_source_row,
  source_raw_name, source_clean_name
)
select company_id, user_id, source.name, source.name, 'tractor', 'free', true, false,
  'tractor', 'tractor', source.description, 'ptc_potato_roster_2026-09-06',
  source.source_row, source.name, source.name
from target_context
cross join (values
  (1, 'МТЗ (номер неизвестен)', 'Номер неизвестен. Водители сменные; постоянная привязка не назначена.'),
  (2, 'МТЗ (Пушкин — аренда)', 'Водитель: Грязнов, имя неизвестно. Постоянная привязка не назначена.')
) source(source_row, name, description)
on conflict (company_id, import_source, import_source_row)
where import_source is not null and import_source_row is not null
do nothing;

-- Add only the genuinely missing named driver. Kалымов is reused from the
-- canonical mechanic_operator record; no duplicate "driver" person is made.
with target_companies as (
  select company_id
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2
)
insert into public.company_people(
  company_id, user_id, full_name, role_type, employment_type, position,
  status, notes, created_by_user_id, updated_by_user_id
)
select company_id, null, 'Теребол Айбол', 'driver', 'unknown', 'Водитель',
  'active', 'PTC: МТЗ 075', null, null
from target_companies target
where not exists(
  select 1 from public.company_people person
  where person.company_id = target.company_id
    and person.deleted_at is null
    and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Теребол Айбол')
);

do $$
declare
  target_company uuid;
  matched integer;
begin
  select company_id into target_company
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2;
  if target_company is null then return; end if;

  select count(*)::integer into matched
  from public.company_people
  where company_id = target_company and deleted_at is null
    and role_type = 'driver' and status = 'active'
    and lower(trim(regexp_replace(full_name, '[[:space:]]+', ' ', 'g'))) = lower('Теребол Айбол');
  if matched <> 1 then raise exception 'PTC_TEREBOL_PERSON_AMBIGUOUS'; end if;
end;
$$;

-- A manually disabled or repurposed compatibility row is operational state,
-- not seed data. Fail closed instead of silently reactivating or changing it.
do $$
declare
  incompatible integer;
begin
  select count(*)::integer into incompatible
  from public.company_people person
  join public.reference_specialists specialist
    on specialist.company_id = person.company_id
   and not coalesce(specialist.archived, false)
   and (
     specialist.person_id = person.id
     or lower(trim(regexp_replace(specialist.full_name, '[[:space:]]+', ' ', 'g'))) =
       lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g')))
   )
  where person.deleted_at is null and person.status = 'active'
    and (
      (person.role_type = 'mechanic_operator' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Калымов Канат Айтенович'))
      or (person.role_type = 'driver' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Теребол Айбол'))
    )
    and exists(
      select 1 from public.reference_vehicles marker
      where marker.company_id = person.company_id
        and marker.import_source = 'ptc_owner_roster_2026-09-06'
    )
    and (
      (specialist.person_id is not null and specialist.person_id <> person.id)
      or specialist.status is distinct from 'active'
      or specialist.personnel_type is distinct from
        case when person.role_type = 'mechanic_operator' then 'machine_operator' else 'driver' end
      or specialist.role is distinct from
        case when person.role_type = 'mechanic_operator' then 'mechanic_operator' else 'driver' end
    );

  if incompatible > 0 then
    raise exception 'PTC_SPECIALIST_BRIDGE_INACTIVE_OR_INCOMPATIBLE';
  end if;
end;
$$;

-- Link/reuse the compatibility specialists required by the existing vehicle
-- FK. mechanic_operator maps to the legacy machine_operator specialist type.
with target_people as (
  select person.id, person.company_id, person.full_name,
    case when person.role_type = 'mechanic_operator' then 'machine_operator' else 'driver' end as specialist_type,
    case when person.role_type = 'mechanic_operator' then 'mechanic_operator' else 'driver' end as specialist_role
  from public.company_people person
  where person.deleted_at is null and person.status = 'active'
    and (
      (person.role_type = 'mechanic_operator' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Калымов Канат Айтенович'))
      or (person.role_type = 'driver' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Теребол Айбол'))
    )
    and exists(
      select 1 from public.reference_vehicles marker
      where marker.company_id = person.company_id
        and marker.import_source = 'ptc_owner_roster_2026-09-06'
    )
)
update public.reference_specialists specialist
set person_id = person.id,
  full_name = person.full_name
from target_people person
where specialist.company_id = person.company_id
  and not coalesce(specialist.archived, false)
  and specialist.status = 'active'
  and specialist.personnel_type = person.specialist_type
  and specialist.role = person.specialist_role
  and (
    specialist.person_id = person.id
    or (
      specialist.person_id is null
      and lower(trim(regexp_replace(specialist.full_name, '[[:space:]]+', ' ', 'g'))) =
        lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g')))
    )
  );

with target_people as (
  select person.id, person.company_id, person.full_name,
    case when person.role_type = 'mechanic_operator' then 'machine_operator' else 'driver' end as specialist_type,
    case when person.role_type = 'mechanic_operator' then 'mechanic_operator' else 'driver' end as specialist_role,
    min(marker.user_id::text)::uuid as actor_id
  from public.company_people person
  join public.reference_vehicles marker on marker.company_id = person.company_id
    and marker.import_source = 'ptc_owner_roster_2026-09-06'
  where person.deleted_at is null and person.status = 'active'
    and (
      (person.role_type = 'mechanic_operator' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Калымов Канат Айтенович'))
      or (person.role_type = 'driver' and lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) = lower('Теребол Айбол'))
    )
  group by person.id, person.company_id, person.full_name, person.role_type
)
insert into public.reference_specialists(
  company_id, user_id, person_id, full_name, role, personnel_type, status, archived
)
select person.company_id, person.actor_id, person.id, person.full_name,
  person.specialist_role, person.specialist_type, 'active', false
from target_people person
where not exists(
  select 1 from public.reference_specialists specialist
  where specialist.company_id = person.company_id
    and specialist.person_id = person.id
    and not coalesce(specialist.archived, false)
);

-- Project exactly MTZ 075, MTZ 878, and the two manual MTZ rows. Internal
-- PTC-TRACTOR keys satisfy the legacy non-null plate constraint and are hidden
-- by the UI whenever license_plate is genuinely unknown.
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
  where (
      (machine.import_source = 'fixed_assets_osv_2026' and machine.import_source_row = any(array[445,446]))
      or (machine.import_source = 'ptc_potato_roster_2026-09-06' and machine.import_source_row = any(array[1,2]))
    )
    and machine.is_active
    and not coalesce(machine.archived, false)
), person_specialists as (
  select person.company_id, person.full_name, specialist.id,
    lower(trim(regexp_replace(person.full_name, '[[:space:]]+', ' ', 'g'))) as person_key
  from public.company_people person
  join public.reference_specialists specialist on specialist.company_id = person.company_id
    and specialist.person_id = person.id
    and specialist.status = 'active'
    and not coalesce(specialist.archived, false)
  where person.status = 'active' and person.deleted_at is null
)
insert into public.reference_vehicles(
  company_id, user_id, name, full_name, custom_name, type, fleet_type,
  plate_number, license_plate, status, is_active, archived,
  import_source, import_source_row, inventory_number, vin, serial_number,
  manufacture_year, source_raw_name, source_clean_name,
  source_machine_id, ptc_enabled, primary_responsible_personnel_id
)
select
  tractor.company_id,
  tractor.user_id,
  case
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 445 then 'МТЗ 075'
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 446 then 'МТЗ 878'
    else tractor.name
  end,
  case
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 445 then 'МТЗ 075'
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 446 then 'МТЗ 878'
    else tractor.full_name
  end,
  case
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 445 then 'МТЗ 075'
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 446 then 'МТЗ 878'
    else tractor.full_name
  end,
  'tractor', 'tractor',
  'PTC-TRACTOR-' || replace(tractor.id::text, '-', ''),
  case
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 445 then 'T 075 ALB'
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 446 then 'T 878 ATD'
    else null
  end,
  coalesce(nullif(trim(tractor.status), ''), 'free'), true, false,
  'ptc_machine_projection_v1', tractor.import_source_row,
  tractor.inventory_number, tractor.vin, tractor.serial_number,
  tractor.manufacture_year, tractor.source_raw_name, tractor.source_clean_name,
  tractor.id, true,
  case
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 445 then (
      select specialist.id from person_specialists specialist
      where specialist.company_id = tractor.company_id and specialist.person_key = lower('Теребол Айбол')
    )
    when tractor.import_source = 'fixed_assets_osv_2026' and tractor.import_source_row = 446 then (
      select specialist.id from person_specialists specialist
      where specialist.company_id = tractor.company_id and specialist.person_key = lower('Калымов Канат Айтенович')
    )
    else null
  end
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
  import_source = excluded.import_source,
  import_source_row = excluded.import_source_row,
  inventory_number = excluded.inventory_number,
  vin = excluded.vin,
  serial_number = excluded.serial_number,
  manufacture_year = excluded.manufacture_year,
  source_raw_name = excluded.source_raw_name,
  source_clean_name = excluded.source_clean_name;

-- Enable newly seeded exact roster rows only when they remain operational.
-- Existing assignments, statuses, and active/archive decisions are preserved.
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
    (vehicle.import_source = 'fixed_assets_osv_2026' and vehicle.import_source_row = 78)
    or (vehicle.import_source = 'ptc_potato_roster_2026-09-06' and vehicle.import_source_row = 1120)
    or exists(
      select 1
      from public.reference_machines machine
      where machine.id = vehicle.source_machine_id
        and machine.company_id = vehicle.company_id
        and (
          (machine.import_source = 'fixed_assets_osv_2026' and machine.import_source_row = any(array[445,446]))
          or (machine.import_source = 'ptc_potato_roster_2026-09-06' and machine.import_source_row = any(array[1,2]))
        )
    )
  );

-- Only the guarded fleet-manager RPC marks this provenance. A generic direct
-- insert no longer silently enrolls arbitrary trucks/tractors into PTC.
create or replace function public.ptc_default_manual_vehicle_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.company_id is not null
    and new.import_source = 'ptc_fleet_manager_manual_v1'
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

-- A loaded/unloading vehicle must stay visible until the operational cycle is
-- completed. This protects later catalogue edits, not just this migration.
create or replace function public.ptc_protect_in_flight_visibility_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
      not coalesce(new.ptc_enabled, false)
      or not coalesce(new.is_active, false)
      or coalesce(new.archived, false)
    )
    and exists(
      select 1
      from public.ptc_vehicle_states state
      where state.company_id = old.company_id
        and state.vehicle_id = old.id
        and state.assigned
        and state.state in ('loaded','unloading')
    )
  then
    raise exception 'PTC_IN_FLIGHT_VEHICLE_MUST_REMAIN_VISIBLE';
  end if;
  return new;
end;
$$;

drop trigger if exists ptc_protect_in_flight_visibility on public.reference_vehicles;
create trigger ptc_protect_in_flight_visibility
before update of ptc_enabled, is_active, archived on public.reference_vehicles
for each row execute function public.ptc_protect_in_flight_visibility_v1();

revoke all on function public.ptc_protect_in_flight_visibility_v1()
  from public, anon, authenticated;
grant execute on function public.ptc_protect_in_flight_visibility_v1()
  to service_role;

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
    -- Validate entry onto the line and entry into an in-flight state. An
    -- already assigned but disabled empty vehicle can still be removed, but
    -- it cannot become a hidden loaded/unloading vehicle.
    if new.assigned
      and (
        tg_op = 'INSERT'
        or not coalesce(old.assigned, false)
        or new.company_id is distinct from old.company_id
        or new.vehicle_id is distinct from old.vehicle_id
        or (
          new.state in ('loaded','unloading')
          and new.state is distinct from old.state
        )
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

-- Final release invariant for the owner tenant: exactly 21 unique, active and
-- visible PTC vehicles, composed only of 2 owner rows, 14 confirmed OSV
-- trucks, KAMAZ 1120, and the four explicitly requested MTZ projections.
do $$
declare
  target_company uuid;
  raw_enabled_total integer;
  enabled_total integer;
  owner_total integer;
  fixed_total integer;
  fixed_keys integer;
  kamaz_1120_total integer;
  tractor_total integer;
  tractor_keys integer;
begin
  select company_id into target_company
  from public.reference_vehicles
  where import_source = 'ptc_owner_roster_2026-09-06'
    and company_id is not null
  group by company_id
  having count(*) = 2;
  if target_company is null then return; end if;

  select count(*)::integer into raw_enabled_total
  from public.reference_vehicles vehicle
  where vehicle.company_id = target_company
    and vehicle.ptc_enabled;

  select count(*)::integer into enabled_total
  from public.reference_vehicles vehicle
  where vehicle.company_id = target_company
    and vehicle.ptc_enabled
    and vehicle.is_active
    and not coalesce(vehicle.archived, false);

  select count(*)::integer into owner_total
  from public.reference_vehicles vehicle
  where vehicle.company_id = target_company
    and vehicle.import_source = 'ptc_owner_roster_2026-09-06'
    and vehicle.ptc_enabled and vehicle.is_active
    and not coalesce(vehicle.archived, false);

  select count(*)::integer, count(distinct vehicle.import_source_row)::integer
  into fixed_total, fixed_keys
  from public.reference_vehicles vehicle
  where vehicle.company_id = target_company
    and vehicle.import_source = 'fixed_assets_osv_2026'
    and vehicle.import_source_row = any(array[47,48,49,50,51,69,70,72,73,76,78,83,89,128])
    and vehicle.ptc_enabled and vehicle.is_active
    and not coalesce(vehicle.archived, false);

  select count(*)::integer into kamaz_1120_total
  from public.reference_vehicles vehicle
  where vehicle.company_id = target_company
    and vehicle.import_source = 'ptc_potato_roster_2026-09-06'
    and vehicle.import_source_row = 1120
    and vehicle.ptc_enabled and vehicle.is_active
    and not coalesce(vehicle.archived, false);

  select count(*)::integer,
    count(distinct (machine.import_source || ':' || machine.import_source_row::text))::integer
  into tractor_total, tractor_keys
  from public.reference_vehicles vehicle
  join public.reference_machines machine
    on machine.id = vehicle.source_machine_id
   and machine.company_id = vehicle.company_id
  where vehicle.company_id = target_company
    and vehicle.ptc_enabled and vehicle.is_active
    and not coalesce(vehicle.archived, false)
    and (
      (machine.import_source = 'fixed_assets_osv_2026' and machine.import_source_row = any(array[445,446]))
      or (machine.import_source = 'ptc_potato_roster_2026-09-06' and machine.import_source_row = any(array[1,2]))
    );

  if raw_enabled_total <> 21
    or enabled_total <> 21
    or owner_total <> 2
    or fixed_total <> 14
    or fixed_keys <> 14
    or kamaz_1120_total <> 1
    or tractor_total <> 4
    or tractor_keys <> 4
  then
    raise exception
      'PTC_CURATED_ROSTER_POSTCONDITION expected=21 enabled=% active=% owner=% fixed=% fixed_keys=% kamaz1120=% tractors=% tractor_keys=%',
      raw_enabled_total, enabled_total, owner_total, fixed_total, fixed_keys, kamaz_1120_total, tractor_total, tractor_keys;
  end if;

  if exists(
    select normalized_plate
    from (
      select regexp_replace(
        translate(upper(coalesce(nullif(trim(vehicle.license_plate), ''), trim(vehicle.plate_number))),
          'АВЕКМНОРСТУХЁ', 'ABEKMHOPCTYXE'),
        '[^A-Z0-9]', '', 'g'
      ) as normalized_plate
      from public.reference_vehicles vehicle
      where vehicle.company_id = target_company
        and vehicle.ptc_enabled and vehicle.is_active
        and not coalesce(vehicle.archived, false)
        and nullif(trim(vehicle.license_plate), '') is not null
    ) plates
    where normalized_plate <> ''
    group by normalized_plate
    having count(*) > 1
  ) then
    raise exception 'PTC_CURATED_ROSTER_DUPLICATE_PLATE';
  end if;
end;
$$;
