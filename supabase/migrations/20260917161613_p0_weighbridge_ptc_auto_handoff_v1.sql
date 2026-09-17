-- The weighbridge is the canonical receiver for a loaded PTC vehicle:
-- ticket create  => loaded -> unloading
-- ticket finalize => unloading -> empty
-- open-ticket void => unloading -> loaded (the trip returns to the queue)
--
-- The transition is executed in the same database transaction as the ticket
-- mutation, so a committed ticket and the PTC board cannot diverge.
create or replace function private.sync_weighbridge_ptc_vehicle_state_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_state public.ptc_vehicle_states%rowtype;
  loaded_event public.ptc_events%rowtype;
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

  select * into vehicle_state
  from public.ptc_vehicle_states state
  where state.company_id = new.company_id
    and state.vehicle_id = new.vehicle_id
    and state.assigned
  for update;

  if tg_op = 'INSERT' then
    if not found or vehicle_state.state is distinct from 'loaded' then
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
        and event.vehicle_id = new.vehicle_id
        and event.cycle = vehicle_state.cycle
        and event.to_state = 'loaded';
    else
      select * into loaded_event
      from public.ptc_events event
      where event.company_id = new.company_id
        and event.vehicle_id = new.vehicle_id
        and event.cycle = vehicle_state.cycle
        and event.to_state = 'loaded'
      order by event.created_at desc, event.id desc
      limit 1;
    end if;

    if not found then
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
      and vehicle_id = new.vehicle_id;

    insert into public.ptc_events(
      company_id, vehicle_id, actor_user_id, actor_name,
      field_id, crop_structure_id, driver_id,
      idempotency_key, expected_version, from_state, to_state, cycle
    ) values (
      new.company_id, new.vehicle_id, actor_id,
      'Весовая · ' || coalesce(new.ticket_no, new.id::text),
      new.field_id, new.crop_structure_allocation_id, new.driver_id,
      new.id, vehicle_state.version, 'loaded', 'unloading', vehicle_state.cycle
    );
    return new;
  end if;

  if tg_op <> 'UPDATE' or new.ptc_cycle is null then
    return new;
  end if;

  if new.is_voided and not old.is_voided and not old.is_finalized then
    target_state := 'loaded';
    actor_id := coalesce(new.voided_by, new.closed_by, new.created_by);
  elsif new.is_finalized and not old.is_finalized and not new.is_voided then
    target_state := 'empty';
    actor_id := coalesce(new.closed_by, new.created_by);
  else
    return new;
  end if;

  if not found
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

drop trigger if exists a_sync_weighbridge_ptc_vehicle_state_v1 on public.tickets;
create trigger a_sync_weighbridge_ptc_vehicle_state_v1
before insert or update of is_finalized, is_voided, status on public.tickets
for each row
execute function private.sync_weighbridge_ptc_vehicle_state_v1();
