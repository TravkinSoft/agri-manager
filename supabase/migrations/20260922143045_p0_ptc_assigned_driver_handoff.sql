-- P0: driver reassignment must not orphan a weighbridge ticket from its PTC cycle.
-- Version aligned to the successful Supabase apply_migration receipt.
-- No historical or operational rows are changed by this migration.
create or replace function private.sync_weighbridge_ptc_vehicle_state_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_state public.ptc_vehicle_states%rowtype;
  loaded_event public.ptc_events%rowtype;
  driver_vehicle_ids uuid[];
  assigned_driver_id uuid;
  actor_id uuid;
  event_key uuid;
  event_hash text;
  target_state text;
begin
  if new.op_type is distinct from 'harvest_incoming'
    or new.vehicle_id is null
    or new.correction_of_ticket_id is not null
    or new.weigh_method = 'manual_override_with_reason'
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'weighbridge-ptc:' || new.company_id::text || ':' || new.vehicle_id::text,
    0
  ));

  if tg_op = 'INSERT' then
    -- A loaded trip is immutable history. A validated CURRENT assignment may
    -- identify a replacement driver for this SAME vehicle, never another truck.
    select person.id into assigned_driver_id
    from public.reference_vehicles vehicle
    join public.reference_specialists specialist
      on specialist.id = vehicle.primary_responsible_personnel_id
      and specialist.company_id = vehicle.company_id
    join public.company_people person
      on person.id = specialist.person_id and person.company_id = vehicle.company_id
    where vehicle.id = new.vehicle_id and vehicle.company_id = new.company_id
      and specialist.status = 'active' and specialist.archived = false
      and person.status = 'active' and person.deleted_at is null
      and (
        (specialist.personnel_type = 'driver' and person.role_type = 'driver')
        or (specialist.personnel_type = 'machine_operator' and person.role_type = 'mechanic_operator'
          and (vehicle.type::text = 'tractor' or vehicle.fleet_type::text = 'tractor'))
      );

    if new.ptc_event_id is null and new.driver_id is not null
      and new.driver_id is distinct from assigned_driver_id then
      select coalesce(array_agg(candidate.vehicle_id order by candidate.vehicle_id), array[]::uuid[])
      into driver_vehicle_ids
      from (
        select state.vehicle_id
        from public.ptc_vehicle_states state
        where state.company_id = new.company_id
          and state.assigned
          and state.state = 'loaded'
          and exists (
            select 1
            from public.ptc_events event
            where event.company_id = state.company_id
              and event.vehicle_id = state.vehicle_id
              and event.cycle = state.cycle
              and event.to_state = 'loaded'
              and event.driver_id = new.driver_id
          )
        order by state.vehicle_id
        limit 2
      ) candidate;

      if cardinality(driver_vehicle_ids) <> 1 then
        if exists (
          select 1 from public.ptc_vehicle_states state
          where state.company_id = new.company_id and state.vehicle_id = new.vehicle_id
            and state.assigned and state.state = 'loaded'
        ) then
          raise exception 'PTC_DRIVER_ASSIGNMENT_CHANGED';
        end if;
        return new;
      end if;

      select * into vehicle_state
      from public.ptc_vehicle_states state
      where state.company_id = new.company_id
        and state.vehicle_id = driver_vehicle_ids[1]
        and state.assigned
        and state.state = 'loaded'
      for update;
      if new.vehicle_id is distinct from vehicle_state.vehicle_id then
        raise exception 'PTC_VEHICLE_REPLACEMENT_REQUIRED';
      end if;
    else
      select * into vehicle_state
      from public.ptc_vehicle_states state
      where state.company_id = new.company_id
        and state.vehicle_id = new.vehicle_id
        and state.assigned
      for update;
    end if;

    if vehicle_state.vehicle_id is null or vehicle_state.state is distinct from 'loaded' then
      if new.ptc_event_id is not null then
        raise exception 'PTC_TRIP_STATE_CHANGED';
      end if;
      return new;
    end if;

    if new.ptc_event_id is not null then
      select * into loaded_event
      from public.ptc_events event
      where event.id = new.ptc_event_id
        and event.company_id = new.company_id
        and event.vehicle_id = vehicle_state.vehicle_id
        and event.cycle = vehicle_state.cycle
        and event.to_state = 'loaded'
        and (new.driver_id is null or event.driver_id = new.driver_id
          or new.driver_id = assigned_driver_id);
    else
      select * into loaded_event
      from public.ptc_events event
      where event.company_id = new.company_id
        and event.vehicle_id = vehicle_state.vehicle_id
        and event.cycle = vehicle_state.cycle
        and event.to_state = 'loaded'
        and (new.driver_id is null or event.driver_id = new.driver_id
          or new.driver_id = assigned_driver_id)
      order by event.created_at desc, event.id desc
      limit 1;
    end if;

    if loaded_event.id is null then
      raise exception 'PTC_LOADED_EVENT_NOT_FOUND';
    end if;
    if new.ptc_cycle is not null and new.ptc_cycle is distinct from vehicle_state.cycle then
      raise exception 'PTC_TRIP_STATE_CHANGED';
    end if;

    actor_id := coalesce(new.created_by, new.responsible_user_id);
    if actor_id is null then
      raise exception 'PTC_WEIGHBRIDGE_ACTOR_REQUIRED';
    end if;

    -- Under the state row lock, prevent another non-void ticket for this cycle.
    if exists (
      select 1 from public.tickets ticket
      where ticket.company_id = new.company_id and ticket.vehicle_id = new.vehicle_id
        and ticket.ptc_cycle = vehicle_state.cycle and ticket.op_type = 'harvest_incoming'
        and not ticket.is_voided and ticket.correction_of_ticket_id is null
    ) then
      raise exception 'PTC_TRIP_ALREADY_TICKETED';
    end if;

    -- Server-built evidence; never rewrite the old load event or old tickets.
    new.audit_json := coalesce(new.audit_json, '{}'::jsonb) - 'ptc_driver_change';
    if new.driver_id is not null and loaded_event.driver_id is distinct from new.driver_id then
      new.audit_json := new.audit_json || jsonb_build_object('ptc_driver_change',
        jsonb_build_object(
          'source', 'current_vehicle_assignment',
          'vehicle_id', new.vehicle_id, 'ptc_event_id', loaded_event.id,
          'previous_driver_id', loaded_event.driver_id, 'driver_id', new.driver_id,
          'actor_profile_id', actor_id, 'recorded_at', now()
        ));
    end if;

    new.ptc_event_id := loaded_event.id;
    new.ptc_cycle := vehicle_state.cycle;

    update public.ptc_vehicle_states
    set state = 'unloading',
        version = version + 1,
        since = now()
    where company_id = new.company_id
      and vehicle_id = vehicle_state.vehicle_id;

    insert into public.ptc_events(
      company_id, vehicle_id, actor_user_id, actor_name,
      field_id, crop_structure_id, driver_id,
      idempotency_key, expected_version, from_state, to_state, cycle
    ) values (
      new.company_id, vehicle_state.vehicle_id, actor_id,
      'Весовая · ' || coalesce(new.ticket_no, new.id::text),
      new.field_id, new.crop_structure_allocation_id, new.driver_id,
      new.id, vehicle_state.version, 'loaded', 'unloading', vehicle_state.cycle
    );
    return new;
  end if;

  if tg_op <> 'UPDATE' or new.ptc_cycle is null then
    return new;
  end if;

  select * into vehicle_state
  from public.ptc_vehicle_states state
  where state.company_id = new.company_id
    and state.vehicle_id = new.vehicle_id
    and state.assigned
  for update;

  if new.is_voided and not old.is_voided and not old.is_finalized then
    target_state := 'loaded';
    actor_id := coalesce(new.voided_by, new.closed_by, new.created_by);
  elsif new.is_finalized and not old.is_finalized and not new.is_voided then
    if new.status::text <> 'finalized' or new.finalized_at is null
      or new.tare_weight_kg is null or new.tare_weight_kg <= 0 then
      raise exception 'PTC_CONFIRMED_CLOSE_REQUIRED';
    end if;
    target_state := 'empty';
    actor_id := coalesce(new.closed_by, new.created_by);
  else
    return new;
  end if;

  if vehicle_state.vehicle_id is null
    or vehicle_state.cycle is distinct from new.ptc_cycle
    or vehicle_state.state not in ('loaded', 'unloading')
  then
    return new;
  end if;
  if actor_id is null then
    raise exception 'PTC_WEIGHBRIDGE_ACTOR_REQUIRED';
  end if;

  update public.ptc_vehicle_states
  set state = target_state,
      version = version + 1,
      since = now()
  where company_id = new.company_id
    and vehicle_id = new.vehicle_id;

  event_hash := md5('weighbridge:' || target_state || ':' || new.id::text);
  event_key := (
    substr(event_hash, 1, 8) || '-' ||
    substr(event_hash, 9, 4) || '-' ||
    substr(event_hash, 13, 4) || '-' ||
    substr(event_hash, 17, 4) || '-' ||
    substr(event_hash, 21, 12)
  )::uuid;

  insert into public.ptc_events(
    company_id, vehicle_id, actor_user_id, actor_name,
    field_id, crop_structure_id, driver_id,
    idempotency_key, expected_version, from_state, to_state, cycle
  ) values (
    new.company_id, new.vehicle_id, actor_id,
    'Весовая · ' || coalesce(new.ticket_no, new.id::text),
    new.field_id, new.crop_structure_allocation_id, new.driver_id,
    event_key, vehicle_state.version, vehicle_state.state, target_state, vehicle_state.cycle
  )
  on conflict (company_id, idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function private.sync_weighbridge_ptc_vehicle_state_v1()
  from public, anon, authenticated;
