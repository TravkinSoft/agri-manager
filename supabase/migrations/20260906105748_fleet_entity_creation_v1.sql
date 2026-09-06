-- Canonical fleet/person creation for the fleet manager cabinet.
-- The function is server-only, keeps vehicles off the PTC line, and performs
-- exact duplicate checks under one company-scoped transaction lock.
create or replace function public.fleet_create_entity_v1(
  p_actor uuid,
  p_company uuid,
  p_kind text,
  p_name text,
  p_plate text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
  entity_id uuid;
  duplicate_id uuid;
  duplicate_name text;
  duplicate_plate text;
  wanted_plate text;
  normalized_name text;
  wanted_person_key text;
begin
  select * into actor_profile
  from public.profiles
  where id = p_actor
  for share;

  if not found
    or actor_profile.status is distinct from 'active'
    or coalesce(actor_profile.role, '') not in ('fleet_manager', 'company_admin', 'global_admin')
    or (actor_profile.role <> 'global_admin' and actor_profile.company_id is distinct from p_company)
  then
    raise exception 'FLEET_ENTITY_CREATE_FORBIDDEN';
  end if;

  if p_kind not in ('vehicle', 'driver') then
    raise exception 'FLEET_ENTITY_KIND_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fleet-create:' || p_company::text || ':' || p_kind, 0)
  );

  if p_kind = 'vehicle' then
    if length(trim(coalesce(p_name, ''))) < 2
      or length(trim(coalesce(p_name, ''))) > 140
      or length(trim(coalesce(p_plate, ''))) < 2
      or length(trim(coalesce(p_plate, ''))) > 40
    then
      raise exception 'FLEET_VEHICLE_INPUT_INVALID';
    end if;

    wanted_plate := regexp_replace(
      translate(upper(trim(p_plate)), 'АВЕКМНОРСТУХЁ', 'ABEKMHOPCTYXE'),
      '[^A-Z0-9]', '', 'g'
    );
    if length(wanted_plate) < 2 then
      raise exception 'FLEET_VEHICLE_INPUT_INVALID';
    end if;

    select v.id,
      coalesce(nullif(trim(v.name), ''), nullif(trim(v.full_name), ''), 'Машина'),
      coalesce(nullif(trim(v.license_plate), ''), trim(v.plate_number))
    into duplicate_id, duplicate_name, duplicate_plate
    from public.reference_vehicles v
    where v.company_id = p_company
      and v.archived = false
      and regexp_replace(
        translate(
          upper(coalesce(nullif(trim(v.license_plate), ''), trim(v.plate_number))),
          'АВЕКМНОРСТУХЁ', 'ABEKMHOPCTYXE'
        ),
        '[^A-Z0-9]', '', 'g'
      ) = wanted_plate
    order by v.created_at, v.id
    limit 1;

    if duplicate_id is not null then
      return jsonb_build_object(
        'status', 'duplicate', 'kind', 'vehicle',
        'entity', jsonb_build_object(
          'id', duplicate_id, 'name', duplicate_name, 'plate', duplicate_plate
        )
      );
    end if;

    begin
      insert into public.reference_vehicles(
        company_id, user_id, name, full_name, custom_name, type, fleet_type,
        plate_number, license_plate, status, is_active, archived
      ) values (
        p_company, p_actor, trim(p_name), trim(p_name), trim(p_name), 'truck', 'truck',
        trim(p_plate), trim(p_plate), 'free', true, false
      ) returning id into entity_id;
    exception when unique_violation then
      return jsonb_build_object('status', 'duplicate', 'kind', 'vehicle');
    end;

    return jsonb_build_object(
      'status', 'created', 'kind', 'vehicle',
      'entity', jsonb_build_object(
        'id', entity_id, 'name', trim(p_name), 'plate', trim(p_plate)
      )
    );
  end if;

  if length(trim(coalesce(p_name, ''))) < 2
    or length(trim(coalesce(p_name, ''))) > 180
  then
    raise exception 'FLEET_DRIVER_INPUT_INVALID';
  end if;

  normalized_name := trim(regexp_replace(
    lower(translate(trim(p_name), 'Ёё', 'Ее')),
    '[[:space:][:punct:]]+', ' ', 'g'
  ));
  select string_agg(token, ' ' order by token)
  into wanted_person_key
  from unnest(regexp_split_to_array(normalized_name, ' +')) token;
  if wanted_person_key is null or array_length(regexp_split_to_array(normalized_name, ' +'), 1) < 2 then
    raise exception 'FLEET_DRIVER_INPUT_INVALID';
  end if;

  select p.id, p.full_name
  into duplicate_id, duplicate_name
  from public.company_people p
  cross join lateral (
    select string_agg(token, ' ' order by token) as person_key
    from unnest(regexp_split_to_array(
      trim(regexp_replace(
        lower(translate(trim(p.full_name), 'Ёё', 'Ее')),
        '[[:space:][:punct:]]+', ' ', 'g'
      )), ' +'
    )) token
  ) normalized
  where p.company_id = p_company
    and p.deleted_at is null
    and normalized.person_key = wanted_person_key
  order by p.created_at, p.id
  limit 1;

  if duplicate_id is null then
    select s.id, s.full_name
    into duplicate_id, duplicate_name
    from public.reference_specialists s
    cross join lateral (
      select string_agg(token, ' ' order by token) as person_key
      from unnest(regexp_split_to_array(
        trim(regexp_replace(
          lower(translate(trim(s.full_name), 'Ёё', 'Ее')),
          '[[:space:][:punct:]]+', ' ', 'g'
        )), ' +'
      )) token
    ) normalized
    where s.company_id = p_company
      and s.archived = false
      and normalized.person_key = wanted_person_key
    order by s.created_at, s.id
    limit 1;
  end if;

  if duplicate_id is not null then
    return jsonb_build_object(
      'status', 'duplicate', 'kind', 'driver',
      'entity', jsonb_build_object('id', duplicate_id, 'name', duplicate_name)
    );
  end if;

  insert into public.company_people(
    company_id, user_id, full_name, role_type, employment_type, position,
    status, created_by_user_id, updated_by_user_id
  ) values (
    p_company, null, trim(p_name), 'driver', 'unknown', 'Водитель',
    'active', p_actor, p_actor
  ) returning id into entity_id;

  begin
    insert into public.reference_specialists(
      company_id, user_id, person_id, full_name, role, personnel_type, status, archived
    ) values (
      p_company, p_actor, entity_id, trim(p_name), 'driver', 'driver', 'active', false
    );
  exception when unique_violation then
    -- Raising here rolls the company_people insert back with the transaction.
    raise exception 'FLEET_DRIVER_COMPATIBILITY_CONFLICT';
  end;

  return jsonb_build_object(
    'status', 'created', 'kind', 'driver',
    'entity', jsonb_build_object('id', entity_id, 'name', trim(p_name))
  );
end;
$$;

revoke all on function public.fleet_create_entity_v1(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fleet_create_entity_v1(uuid, uuid, text, text, text)
  to service_role;
