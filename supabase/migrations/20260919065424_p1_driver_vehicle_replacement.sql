-- Explicit transport, confirmed close, and protection from legacy receiver clients.
alter table public.ptc_events add column replaces_event_id uuid references public.ptc_events(id);
-- Service-only audit; completed tickets and historical PTC events are immutable here.
create table public.ptc_vehicle_replacements (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  actor_id uuid not null references public.profiles(id),
  driver_id uuid not null references public.company_people(id),
  source_vehicle_id uuid not null references public.reference_vehicles(id),
  target_vehicle_id uuid not null references public.reference_vehicles(id),
  source_version integer not null,
  target_version integer not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ptc_vehicle_replacements enable row level security;
revoke all on public.ptc_vehicle_replacements from public, anon, authenticated;
grant select, insert on public.ptc_vehicle_replacements to service_role;

create function public.ptc_replace_driver_vehicle_v1(
  p_actor uuid, p_company uuid, p_driver uuid, p_source uuid, p_target uuid,
  p_source_version integer, p_target_version integer,
  p_source_assignment uuid, p_target_assignment uuid, p_key uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a public.profiles%rowtype;
  s public.ptc_vehicle_states%rowtype;
  d public.ptc_vehicle_states%rowtype;
  src public.reference_vehicles%rowtype;
  dst public.reference_vehicles%rowtype;
  loaded public.ptc_events%rowtype;
  arrived public.ptc_events%rowtype;
  saved public.ptc_vehicle_replacements%rowtype;
  vid uuid;
  specialist uuid;
  new_event uuid;
  ticket_ids uuid[];
  result jsonb;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active'
    or coalesce(a.role,'') not in ('global_admin','company_admin','fleet_manager','agronomist','weighman')
    or (a.role<>'global_admin' and a.company_id is distinct from p_company)
  then raise exception 'PTC_REPLACE_FORBIDDEN'; end if;
  if p_source is null or p_target is null or p_driver is null or p_key is null
    or p_source=p_target or p_source_version is null or p_target_version is null
  then raise exception 'PTC_REPLACE_INVALID'; end if;

  -- Same ordering as line/repair commands. NOWAIT prevents an inverse lock with
  -- a concurrent ticket finalization (which locks its ticket before PTC).
  perform 1 from public.ptc_flows where company_id=p_company and enabled for update;
  if not found then raise exception 'PTC_DISABLED'; end if;
  select * into saved from public.ptc_vehicle_replacements where id=p_key;
  if found then
    if saved.company_id<>p_company or saved.actor_id<>p_actor or saved.driver_id<>p_driver
      or saved.source_vehicle_id<>p_source or saved.target_vehicle_id<>p_target
      or saved.source_version<>p_source_version or saved.target_version<>p_target_version
    then raise exception 'PTC_KEY_CONFLICT'; end if;
    return saved.receipt || jsonb_build_object('replayed',true);
  end if;
  for vid in select unnest(array[p_source,p_target]) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('fleet-repair:'||vid::text,0));
    if not pg_try_advisory_xact_lock(hashtextextended('weighbridge-ptc:'||p_company::text||':'||vid::text,0))
      then raise exception 'PTC_REPLACE_BUSY'; end if;
  end loop;
  perform 1 from public.tickets where company_id=p_company
    and (vehicle_id in (p_source,p_target) or driver_id=p_driver)
    and not is_finalized and not is_voided and status::text not in ('finalized','voided')
    order by id for update nowait;
  perform 1 from public.ptc_vehicle_states where company_id=p_company
    and vehicle_id in (p_source,p_target) order by vehicle_id for update nowait;
  perform 1 from public.reference_vehicles where company_id=p_company
    and id in (p_source,p_target) order by id for update nowait;
  select * into src from public.reference_vehicles where company_id=p_company and id=p_source;
  select * into dst from public.reference_vehicles where company_id=p_company and id=p_target;
  if src.id is null or dst.id is null or not dst.ptc_enabled or not dst.is_active or dst.archived
    then raise exception 'PTC_REPLACE_INVALID'; end if;
  if src.primary_responsible_personnel_id is distinct from p_source_assignment
    or dst.primary_responsible_personnel_id is distinct from p_target_assignment
    then raise exception 'PTC_REPLACE_CONFLICT'; end if;
  select * into s from public.ptc_vehicle_states where company_id=p_company and vehicle_id=p_source;
  select * into d from public.ptc_vehicle_states where company_id=p_company and vehicle_id=p_target;
  if s.vehicle_id is null or not s.assigned or s.version<>p_source_version
    or coalesce(d.version,0)<>p_target_version then raise exception 'PTC_REPLACE_CONFLICT'; end if;
  if coalesce(d.assigned,false) or coalesce(d.state,'empty')<>'empty'
    or exists(select 1 from public.fleet_vehicle_repairs where company_id=p_company and vehicle_id=p_target and in_repair)
    or exists(select 1 from public.tickets where company_id=p_company and vehicle_id=p_target
      and not is_finalized and not is_voided and status::text not in ('finalized','voided'))
    then raise exception 'PTC_REPLACE_TARGET_BUSY'; end if;
  select rs.id into specialist from public.reference_specialists rs
    join public.company_people cp on cp.id=rs.person_id and cp.company_id=rs.company_id
    where rs.company_id=p_company and rs.person_id=p_driver and not rs.archived and rs.status='active'
      and cp.status='active' and cp.deleted_at is null and cp.role_type in ('driver','mechanic_operator');
  if specialist is null then raise exception 'PTC_REPLACE_DRIVER_CHANGED'; end if;
  if src.primary_responsible_personnel_id is distinct from specialist then
    raise exception 'PTC_REPLACE_DRIVER_CHANGED'; end if;
  if exists(select 1 from public.ptc_vehicle_states st join public.reference_vehicles rv
    on rv.id=st.vehicle_id and rv.company_id=st.company_id
    where st.company_id=p_company and st.assigned and st.vehicle_id<>p_source
      and rv.primary_responsible_personnel_id=specialist)
    then raise exception 'PTC_REPLACE_DRIVER_CHANGED'; end if;

  if s.state in ('loaded','unloading') then
    select * into loaded from public.ptc_events where company_id=p_company
      and vehicle_id=p_source and cycle=s.cycle and to_state='loaded'
      order by created_at desc,id desc limit 1;
    if loaded.id is null or loaded.driver_id is distinct from p_driver
      then raise exception 'PTC_REPLACE_DRIVER_CHANGED'; end if;
  end if;
  -- Only the current, unfinalized, properly linked harvest ticket may follow.
  if exists(select 1 from public.tickets where company_id=p_company
    and (vehicle_id=p_source or driver_id=p_driver) and not is_finalized and not is_voided
    and status::text not in ('finalized','voided')
    and (vehicle_id is distinct from p_source or driver_id is distinct from p_driver
      or op_type::text<>'harvest_incoming' or correction_of_ticket_id is not null
      or ptc_cycle is distinct from s.cycle or ptc_event_id is distinct from loaded.id))
    then raise exception 'PTC_REPLACE_TICKET_CONFLICT'; end if;
  select coalesce(array_agg(id),array[]::uuid[]) into ticket_ids from public.tickets
    where company_id=p_company and vehicle_id=p_source and not is_finalized and not is_voided
      and status::text not in ('finalized','voided');
  if cardinality(ticket_ids)>1 or (cardinality(ticket_ids)>0 and s.state<>'unloading')
    then raise exception 'PTC_REPLACE_TICKET_CONFLICT'; end if;

  insert into public.ptc_vehicle_states(company_id,vehicle_id,assigned,state,version,cycle,since)
    values(p_company,p_target,true,s.state,coalesce(d.version,0)+1,coalesce(d.cycle,0)+1,s.since)
    on conflict(company_id,vehicle_id) do update set assigned=true,state=excluded.state,
      version=excluded.version,cycle=excluded.cycle,since=excluded.since returning * into d;
  if loaded.id is not null then
    -- Copy only the active trip context to a new event; never rewrite past trips.
    insert into public.ptc_events(company_id,vehicle_id,actor_user_id,actor_name,field_id,
      crop_structure_id,driver_id,idempotency_key,expected_version,from_state,to_state,cycle,created_at,replaces_event_id)
      values(p_company,p_target,loaded.actor_user_id,loaded.actor_name,loaded.field_id,
      loaded.crop_structure_id,p_driver,p_key,p_target_version,'empty','loaded',d.cycle,loaded.created_at,loaded.id)
      returning id into new_event;
    if s.state='unloading' then
      select * into arrived from public.ptc_events where company_id=p_company and vehicle_id=p_source
        and cycle=s.cycle and to_state='unloading' order by created_at desc,id desc limit 1;
      insert into public.ptc_events(company_id,vehicle_id,actor_user_id,actor_name,field_id,
        crop_structure_id,driver_id,idempotency_key,expected_version,from_state,to_state,cycle,created_at,replaces_event_id)
        values(p_company,p_target,p_actor,'Замена машины · '||coalesce(a.full_name,'Сотрудник'),loaded.field_id,
        loaded.crop_structure_id,p_driver,gen_random_uuid(),d.version,'loaded','unloading',d.cycle,
        coalesce(arrived.created_at,s.since),arrived.id);
    end if;
  end if;
  update public.tickets set vehicle_id=p_target,ptc_event_id=new_event,ptc_cycle=d.cycle,
    audit_json=coalesce(audit_json,'{}'::jsonb)||jsonb_build_object('ptc_vehicle_replacement',
      jsonb_build_object('id',p_key,'from',p_source,'to',p_target,'driverId',p_driver,'at',now()))
    where company_id=p_company and id=any(ticket_ids);
  update public.reference_vehicles set primary_responsible_personnel_id=null
    where company_id=p_company and id=p_source;
  update public.reference_vehicles set primary_responsible_personnel_id=specialist
    where company_id=p_company and id=p_target;
  update public.ptc_last_vehicle_markers set vehicle_id=p_target
    where company_id=p_company and vehicle_id=p_source;
  update public.ptc_vehicle_states set assigned=false,state='empty',version=version+1,since=now()
    where company_id=p_company and vehicle_id=p_source;
  update public.ptc_flows set updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where company_id=p_company;
  result:=jsonb_build_object('companyId',p_company,'sourceVehicleId',p_source,'vehicleId',p_target,
    'driverId',p_driver,'state',s.state,'ptcEventId',new_event,'ptcCycle',d.cycle,
    'ticketIds',ticket_ids,'replacementId',p_key,'replayed',false);
  insert into public.ptc_vehicle_replacements(id,company_id,actor_id,driver_id,source_vehicle_id,
    target_vehicle_id,source_version,target_version,receipt)
    values(p_key,p_company,p_actor,p_driver,p_source,p_target,p_source_version,p_target_version,result);
  return result;
end;
$$;
revoke all on function public.ptc_replace_driver_vehicle_v1(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ptc_replace_driver_vehicle_v1(uuid,uuid,uuid,uuid,uuid,integer,integer,uuid,uuid,uuid)
  to service_role;

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


create or replace function public.ptc_actor_transition_v1(
  p_actor uuid,p_vehicle uuid,p_version integer,p_target text,p_key uuid
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a public.profiles%rowtype;
  person public.company_people%rowtype;
  s public.ptc_vehicle_states%rowtype;
  e public.ptc_events%rowtype;
  marker public.ptc_last_vehicle_markers%rowtype;
  active_shift public.ptc_combine_shifts%rowtype;
  loaded_event public.ptc_events%rowtype;
  company uuid;
  linked_count integer;
  actor_label text;
  event_field uuid;
  event_structure uuid;
  event_driver uuid;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active' or a.company_id is null
    or coalesce(a.role,'') not in ('mechanic_operator','weighman','vegetable_brigadier') then
    raise exception 'PTC_UNAUTHORIZED';
  end if;
  company:=a.company_id;
  perform 1 from public.ptc_flows where company_id=company and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;
  if a.role='weighman' then
    actor_label:=coalesce(nullif(trim(a.full_name),''),'Весовщик');
  else
    select count(*) into linked_count from public.company_people
      where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
    if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
    select * into person from public.company_people
      where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
    actor_label:=person.full_name;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-repair:'||p_vehicle::text,0));
  select * into s from public.ptc_vehicle_states
    where company_id=company and vehicle_id=p_vehicle and assigned for update;
  if not found then raise exception 'PTC_NOT_ASSIGNED'; end if;
  select * into e from public.ptc_events where company_id=company and idempotency_key=p_key;
  if found then
    if e.vehicle_id<>p_vehicle or e.actor_user_id is distinct from p_actor
      or e.expected_version<>p_version or e.to_state<>p_target then
      raise exception 'PTC_KEY_CONFLICT';
    end if;
    return jsonb_build_object('replayed',true,'eventId',e.id);
  end if;
  -- An old receiver tab cannot release a vehicle still waiting for tare.
  if p_target='empty' and exists(
    select 1 from public.tickets t
    where t.company_id=company and t.vehicle_id=p_vehicle
      and t.op_type='harvest_incoming' and not t.is_finalized and not t.is_voided
      and t.status::text not in ('finalized','voided')
      and t.correction_of_ticket_id is null
      and (t.ptc_cycle=s.cycle or t.ptc_cycle is null)
  ) then raise exception 'PTC_OPEN_TICKET_WAITING_TARE'; end if;
  if s.version<>p_version then raise exception 'PTC_VERSION_CONFLICT'; end if;
  if not ((a.role='mechanic_operator' and s.state='empty' and p_target='loaded') or
    (a.role='weighman' and s.state='loaded' and p_target='unloading') or
    (a.role='vegetable_brigadier' and s.state='unloading' and p_target='empty')) then
    raise exception 'PTC_FORBIDDEN_TRANSITION';
  end if;
  if p_target='loaded' and exists(select 1 from public.fleet_vehicle_repairs
    where vehicle_id=p_vehicle and company_id=company and in_repair) then
    raise exception 'FLEET_VEHICLE_IN_REPAIR';
  end if;

  if p_target='loaded' then
    select * into active_shift from public.ptc_combine_shifts
      where company_id=company and operator_user_id=p_actor and closed_at is null
      order by opened_at desc limit 1 for share;
    if not found then raise exception 'PTC_SHIFT_REQUIRED'; end if;
    event_field:=coalesce(active_shift.field_id,
      (select field_id from public.ptc_flows where company_id=company));
    event_structure:=active_shift.current_crop_structure_id;
    select rs.person_id into event_driver
      from public.reference_vehicles rv
      join public.reference_specialists rs
        on rs.id=rv.primary_responsible_personnel_id
       and rs.company_id=company and rs.status='active' and rs.archived=false
      join public.company_people cp
        on cp.id=rs.person_id and cp.company_id=company
       and cp.status='active' and cp.deleted_at is null
      where rv.id=p_vehicle and rv.company_id=company;
  else
    select * into loaded_event from public.ptc_events
      where company_id=company and vehicle_id=p_vehicle and cycle=s.cycle
        and to_state='loaded'
      order by created_at desc,id desc limit 1;
    event_field:=coalesce(loaded_event.field_id,
      (select field_id from public.ptc_flows where company_id=company));
    event_structure:=loaded_event.crop_structure_id;
    event_driver:=loaded_event.driver_id;
  end if;

  update public.ptc_vehicle_states set
    state=p_target,version=version+1,since=now(),
    cycle=cycle+case when p_target='loaded' then 1 else 0 end
    where company_id=company and vehicle_id=p_vehicle;
  insert into public.ptc_events(
    company_id,vehicle_id,actor_user_id,actor_name,field_id,crop_structure_id,driver_id,
    idempotency_key,expected_version,from_state,to_state,cycle
  ) values(
    company,p_vehicle,p_actor,actor_label,event_field,event_structure,event_driver,
    p_key,p_version,s.state,p_target,s.cycle+case when p_target='loaded' then 1 else 0 end
  ) returning * into e;
  if a.role='vegetable_brigadier' and p_target='empty' then
    delete from public.ptc_last_vehicle_markers
      where company_id=company and vehicle_id=p_vehicle returning * into marker;
    if found then
      insert into public.ptc_last_vehicle_events(
        company_id,vehicle_id,actor_user_id,actor_name,command,action,idempotency_key
      ) values(company,p_vehicle,p_actor,actor_label,'system','auto_cleared',p_key);
    end if;
  end if;
  return jsonb_build_object('replayed',false,'eventId',e.id);
end;
$$;
