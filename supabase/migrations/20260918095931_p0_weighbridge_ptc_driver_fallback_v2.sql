-- A duplicated vehicle directory entry must not leave a real PTC trip in
-- "loaded" after the weighbridge opens its ticket. The canonical fallback is
-- the internal driver_id (shown to users as the driver's full name), and it is
-- accepted only when exactly one assigned loaded PTC trip matches.
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
    if new.ptc_event_id is null and new.driver_id is not null then
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
        return new;
      end if;

      select * into vehicle_state
      from public.ptc_vehicle_states state
      where state.company_id = new.company_id
        and state.vehicle_id = driver_vehicle_ids[1]
        and state.assigned
        and state.state = 'loaded'
      for update;
      new.vehicle_id := vehicle_state.vehicle_id;
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
        and (new.driver_id is null or event.driver_id = new.driver_id);
    else
      select * into loaded_event
      from public.ptc_events event
      where event.company_id = new.company_id
        and event.vehicle_id = vehicle_state.vehicle_id
        and event.cycle = vehicle_state.cycle
        and event.to_state = 'loaded'
        and (new.driver_id is null or event.driver_id = new.driver_id)
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

-- Reinstall explicitly so the corrected function remains the only automatic
-- handoff path for inserts and ticket close/void updates.
drop trigger if exists a_sync_weighbridge_ptc_vehicle_state_v1 on public.tickets;
create trigger a_sync_weighbridge_ptc_vehicle_state_v1
before insert or update of is_finalized, is_voided, status on public.tickets
for each row
execute function private.sync_weighbridge_ptc_vehicle_state_v1();

-- Repair only recent, still-open harvest tickets with exactly one loaded trip
-- for their canonical driver. This covers the ticket that exposed this bug
-- without guessing across duplicate names or multiple active vehicles.
do $$
declare
  ticket_row public.tickets%rowtype;
  state_row public.ptc_vehicle_states%rowtype;
  event_row public.ptc_events%rowtype;
  candidate_vehicle_ids uuid[];
  actor_id uuid;
begin
  for ticket_row in
    select ticket.*
    from public.tickets ticket
    where ticket.op_type = 'harvest_incoming'
      and not ticket.is_voided
      and not ticket.is_finalized
      and ticket.status in ('draft', 'active', 'ready_to_close')
      and ticket.driver_id is not null
      and ticket.ptc_event_id is null
      and ticket.ptc_cycle is null
      and ticket.created_at >= now() - interval '12 hours'
  loop
    select coalesce(array_agg(candidate.vehicle_id order by candidate.vehicle_id), array[]::uuid[])
    into candidate_vehicle_ids
    from (
      select state.vehicle_id
      from public.ptc_vehicle_states state
      where state.company_id = ticket_row.company_id
        and state.assigned
        and state.state = 'loaded'
        and exists (
          select 1
          from public.ptc_events event
          where event.company_id = state.company_id
            and event.vehicle_id = state.vehicle_id
            and event.cycle = state.cycle
            and event.to_state = 'loaded'
            and event.driver_id = ticket_row.driver_id
        )
      order by state.vehicle_id
      limit 2
    ) candidate;

    if cardinality(candidate_vehicle_ids) <> 1 then
      continue;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'weighbridge-ptc:' || ticket_row.company_id::text || ':' || candidate_vehicle_ids[1]::text,
      0
    ));
    select * into state_row
    from public.ptc_vehicle_states state
    where state.company_id = ticket_row.company_id
      and state.vehicle_id = candidate_vehicle_ids[1]
      and state.assigned
      and state.state = 'loaded'
    for update;
    if state_row.vehicle_id is null then
      continue;
    end if;

    select * into event_row
    from public.ptc_events event
    where event.company_id = state_row.company_id
      and event.vehicle_id = state_row.vehicle_id
      and event.cycle = state_row.cycle
      and event.to_state = 'loaded'
      and event.driver_id = ticket_row.driver_id
    order by event.created_at desc, event.id desc
    limit 1;
    actor_id := coalesce(ticket_row.created_by, ticket_row.responsible_user_id);
    if event_row.id is null or actor_id is null then
      continue;
    end if;

    update public.tickets
    set vehicle_id = state_row.vehicle_id,
        ptc_event_id = event_row.id,
        ptc_cycle = state_row.cycle
    where id = ticket_row.id
      and company_id = ticket_row.company_id
      and not is_voided
      and not is_finalized;

    update public.ptc_vehicle_states
    set state = 'unloading',
        version = version + 1,
        since = now()
    where company_id = state_row.company_id
      and vehicle_id = state_row.vehicle_id
      and state = 'loaded';

    insert into public.ptc_events(
      company_id, vehicle_id, actor_user_id, actor_name,
      field_id, crop_structure_id, driver_id,
      idempotency_key, expected_version, from_state, to_state, cycle
    ) values (
      ticket_row.company_id, state_row.vehicle_id, actor_id,
      'Весовая · ' || coalesce(ticket_row.ticket_no, ticket_row.id::text),
      ticket_row.field_id, ticket_row.crop_structure_allocation_id, ticket_row.driver_id,
      ticket_row.id, state_row.version, 'loaded', 'unloading', state_row.cycle
    )
    on conflict (company_id, idempotency_key) do nothing;
  end loop;
end;
$$;
