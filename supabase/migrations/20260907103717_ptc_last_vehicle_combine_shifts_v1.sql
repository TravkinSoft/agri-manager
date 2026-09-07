-- Additive PTC metadata only. Existing vehicle state, cycle and event rows are
-- untouched: the marker is not a traffic state and hectares are operator notes.
create table public.ptc_last_vehicle_markers (
  company_id uuid primary key references public.ptc_flows(company_id) on delete cascade,
  vehicle_id uuid not null references public.reference_vehicles(id),
  marked_by_user_id uuid not null references public.profiles(id),
  marked_by_name text not null,
  marked_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table public.ptc_last_vehicle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  vehicle_id uuid not null references public.reference_vehicles(id),
  previous_vehicle_id uuid references public.reference_vehicles(id),
  actor_user_id uuid references public.profiles(id),
  actor_name text not null,
  command text not null check (command in ('mark','clear','system')),
  action text not null check (action in ('marked','transferred','cleared','auto_cleared','invalidated')),
  idempotency_key uuid,
  created_at timestamptz not null default now()
);
create unique index ptc_last_vehicle_event_key
  on public.ptc_last_vehicle_events(company_id,idempotency_key)
  where idempotency_key is not null;
create index ptc_last_vehicle_event_history
  on public.ptc_last_vehicle_events(company_id,created_at desc);

create table public.ptc_combine_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id),
  operator_person_id uuid references public.company_people(id),
  operator_name text not null,
  field_id uuid references public.fields(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  hectares_shift numeric(12,3),
  hectares_field_total numeric(12,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (closed_at is null and hectares_shift is null and hectares_field_total is null)
    or
    (closed_at is not null and closed_at >= opened_at and hectares_shift >= 0 and hectares_field_total >= 0)
  )
);
create unique index ptc_combine_shift_one_open_per_operator
  on public.ptc_combine_shifts(company_id,operator_user_id)
  where closed_at is null;
create index ptc_combine_shift_company_history
  on public.ptc_combine_shifts(company_id,opened_at desc);

create table public.ptc_combine_shift_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  shift_id uuid not null references public.ptc_combine_shifts(id),
  actor_user_id uuid not null references public.profiles(id),
  command text not null check (command in ('open','close')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,idempotency_key)
);
create index ptc_combine_shift_event_history
  on public.ptc_combine_shift_events(company_id,created_at desc);

create trigger ptc_last_vehicle_events_append_only
  before update or delete on public.ptc_last_vehicle_events
  for each row execute function public.ptc_preserve_events_v1();
create trigger ptc_combine_shift_events_append_only
  before update or delete on public.ptc_combine_shift_events
  for each row execute function public.ptc_preserve_events_v1();

alter table public.ptc_last_vehicle_markers enable row level security;
alter table public.ptc_last_vehicle_events enable row level security;
alter table public.ptc_combine_shifts enable row level security;
alter table public.ptc_combine_shift_events enable row level security;
revoke all on public.ptc_last_vehicle_markers,public.ptc_last_vehicle_events,
  public.ptc_combine_shifts,public.ptc_combine_shift_events
  from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.ptc_last_vehicle_markers to service_role;
grant select,insert on public.ptc_last_vehicle_events to service_role;
grant select,insert,update on public.ptc_combine_shifts to service_role;
grant select,insert on public.ptc_combine_shift_events to service_role;

create function public.ptc_set_last_vehicle_v1(
  p_actor uuid,
  p_vehicle uuid,
  p_command text,
  p_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  actor_profile public.profiles%rowtype;
  actor_person public.company_people%rowtype;
  current_marker public.ptc_last_vehicle_markers%rowtype;
  saved_marker public.ptc_last_vehicle_markers%rowtype;
  prior_event public.ptc_last_vehicle_events%rowtype;
  linked_count integer;
  effective_action text;
begin
  if p_command not in ('mark','clear') or p_vehicle is null or p_key is null then
    raise exception 'PTC_LAST_VEHICLE_INVALID';
  end if;
  select * into actor_profile from public.profiles where id=p_actor for share;
  if not found or actor_profile.status is distinct from 'active'
    or actor_profile.company_id is null
    or coalesce(actor_profile.role,'') <> 'mechanic_operator' then
    raise exception 'PTC_LAST_VEHICLE_FORBIDDEN';
  end if;
  select count(*) into linked_count from public.company_people
    where user_id=p_actor and company_id=actor_profile.company_id
      and status='active' and deleted_at is null;
  if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
  select * into actor_person from public.company_people
    where user_id=p_actor and company_id=actor_profile.company_id
      and status='active' and deleted_at is null;
  perform 1 from public.ptc_flows
    where company_id=actor_profile.company_id and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ptc-last:'||actor_profile.company_id::text,0));
  select * into prior_event from public.ptc_last_vehicle_events
    where company_id=actor_profile.company_id and idempotency_key=p_key;
  if found then
    if prior_event.actor_user_id is distinct from p_actor
      or prior_event.command<>p_command or prior_event.vehicle_id<>p_vehicle then
      raise exception 'PTC_KEY_CONFLICT';
    end if;
    select * into saved_marker from public.ptc_last_vehicle_markers
      where company_id=actor_profile.company_id;
    return jsonb_build_object(
      'ok',true,'replayed',true,'eventId',prior_event.id,
      'marker',case when found then jsonb_build_object(
        'vehicleId',saved_marker.vehicle_id,'markedAt',saved_marker.marked_at,
        'version',saved_marker.version) else null end
    );
  end if;

  select * into current_marker from public.ptc_last_vehicle_markers
    where company_id=actor_profile.company_id for update;
  if p_command='mark' then
    perform 1 from public.ptc_vehicle_states s
      where s.company_id=actor_profile.company_id and s.vehicle_id=p_vehicle
        and s.assigned and s.state='empty' for share;
    if not found then raise exception 'PTC_LAST_VEHICLE_UNAVAILABLE'; end if;
    if exists(select 1 from public.fleet_vehicle_repairs r
      where r.company_id=actor_profile.company_id and r.vehicle_id=p_vehicle and r.in_repair) then
      raise exception 'PTC_LAST_VEHICLE_UNAVAILABLE';
    end if;
    effective_action:=case when current_marker.company_id is null
      or current_marker.vehicle_id=p_vehicle then 'marked' else 'transferred' end;
    insert into public.ptc_last_vehicle_markers(
      company_id,vehicle_id,marked_by_user_id,marked_by_name,marked_at,version
    ) values(
      actor_profile.company_id,p_vehicle,p_actor,actor_person.full_name,now(),
      coalesce(current_marker.version,0)+1
    ) on conflict(company_id) do update set
      vehicle_id=excluded.vehicle_id,
      marked_by_user_id=excluded.marked_by_user_id,
      marked_by_name=excluded.marked_by_name,
      marked_at=excluded.marked_at,
      version=excluded.version
    returning * into saved_marker;
  else
    if current_marker.company_id is null or current_marker.vehicle_id<>p_vehicle then
      raise exception 'PTC_LAST_VEHICLE_CONFLICT';
    end if;
    delete from public.ptc_last_vehicle_markers
      where company_id=actor_profile.company_id and vehicle_id=p_vehicle;
    effective_action:='cleared';
  end if;

  insert into public.ptc_last_vehicle_events(
    company_id,vehicle_id,previous_vehicle_id,actor_user_id,actor_name,
    command,action,idempotency_key
  ) values(
    actor_profile.company_id,p_vehicle,
    case when effective_action='transferred' then current_marker.vehicle_id else null end,
    p_actor,actor_person.full_name,p_command,effective_action,p_key
  ) returning * into prior_event;
  return jsonb_build_object(
    'ok',true,'replayed',false,'eventId',prior_event.id,
    'marker',case when p_command='mark' then jsonb_build_object(
      'vehicleId',saved_marker.vehicle_id,'markedAt',saved_marker.marked_at,
      'version',saved_marker.version) else null end
  );
end;
$$;

create function public.ptc_set_combine_shift_v1(
  p_actor uuid,
  p_command text,
  p_shift uuid,
  p_hectares_shift numeric,
  p_hectares_field_total numeric,
  p_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  actor_profile public.profiles%rowtype;
  actor_person public.company_people%rowtype;
  current_shift public.ptc_combine_shifts%rowtype;
  prior_event public.ptc_combine_shift_events%rowtype;
  linked_count integer;
begin
  if p_command not in ('open','close') or p_key is null then
    raise exception 'PTC_SHIFT_INVALID';
  end if;
  select * into actor_profile from public.profiles where id=p_actor for share;
  if not found or actor_profile.status is distinct from 'active'
    or actor_profile.company_id is null
    or coalesce(actor_profile.role,'') <> 'mechanic_operator' then
    raise exception 'PTC_SHIFT_FORBIDDEN';
  end if;
  select count(*) into linked_count from public.company_people
    where user_id=p_actor and company_id=actor_profile.company_id
      and status='active' and deleted_at is null;
  if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
  select * into actor_person from public.company_people
    where user_id=p_actor and company_id=actor_profile.company_id
      and status='active' and deleted_at is null;
  perform 1 from public.ptc_flows
    where company_id=actor_profile.company_id and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ptc-shift:'||actor_profile.company_id::text||':'||p_actor::text,0));
  select * into prior_event from public.ptc_combine_shift_events
    where company_id=actor_profile.company_id and idempotency_key=p_key;
  if found then
    if prior_event.actor_user_id<>p_actor or prior_event.command<>p_command
      or (p_shift is not null and prior_event.shift_id<>p_shift) then
      raise exception 'PTC_KEY_CONFLICT';
    end if;
    select * into current_shift from public.ptc_combine_shifts where id=prior_event.shift_id;
    return jsonb_build_object(
      'ok',true,'replayed',true,'eventId',prior_event.id,'shiftId',current_shift.id,
      'status',case when current_shift.closed_at is null then 'open' else 'closed' end,
      'openedAt',current_shift.opened_at,'closedAt',current_shift.closed_at,
      'hectaresShift',current_shift.hectares_shift,
      'hectaresFieldTotal',current_shift.hectares_field_total
    );
  end if;

  if p_command='open' then
    if p_shift is not null or p_hectares_shift is not null or p_hectares_field_total is not null then
      raise exception 'PTC_SHIFT_INVALID';
    end if;
    if exists(select 1 from public.ptc_combine_shifts
      where company_id=actor_profile.company_id and operator_user_id=p_actor and closed_at is null) then
      raise exception 'PTC_SHIFT_ALREADY_OPEN';
    end if;
    insert into public.ptc_combine_shifts(
      company_id,operator_user_id,operator_person_id,operator_name,field_id
    ) values(
      actor_profile.company_id,p_actor,actor_person.id,actor_person.full_name,
      (select field_id from public.ptc_flows where company_id=actor_profile.company_id)
    ) returning * into current_shift;
  else
    if p_shift is null or p_hectares_shift is null or p_hectares_field_total is null
      or p_hectares_shift<0 or p_hectares_field_total<0
      or p_hectares_shift>1000000 or p_hectares_field_total>1000000 then
      raise exception 'PTC_SHIFT_INVALID';
    end if;
    select * into current_shift from public.ptc_combine_shifts
      where id=p_shift and company_id=actor_profile.company_id
        and operator_user_id=p_actor and closed_at is null for update;
    if not found then raise exception 'PTC_SHIFT_CONFLICT'; end if;
    update public.ptc_combine_shifts set
      closed_at=now(),hectares_shift=p_hectares_shift,
      hectares_field_total=p_hectares_field_total,updated_at=now()
      where id=current_shift.id returning * into current_shift;
  end if;

  insert into public.ptc_combine_shift_events(
    company_id,shift_id,actor_user_id,command,idempotency_key
  ) values(
    actor_profile.company_id,current_shift.id,p_actor,p_command,p_key
  ) returning * into prior_event;
  return jsonb_build_object(
    'ok',true,'replayed',false,'eventId',prior_event.id,'shiftId',current_shift.id,
    'status',case when current_shift.closed_at is null then 'open' else 'closed' end,
    'openedAt',current_shift.opened_at,'closedAt',current_shift.closed_at,
    'hectaresShift',current_shift.hectares_shift,
    'hectaresFieldTotal',current_shift.hectares_field_total
  );
end;
$$;

-- Receiver completion clears the marker in the same transaction as
-- unloading -> empty. A failed transition therefore cannot lose the marker.
create or replace function public.ptc_actor_transition_v1(p_actor uuid,p_vehicle uuid,p_version integer,p_target text,p_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.profiles%rowtype; person public.company_people%rowtype; s public.ptc_vehicle_states%rowtype; e public.ptc_events%rowtype; marker public.ptc_last_vehicle_markers%rowtype; company uuid; linked_count integer; actor_label text;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active' or a.company_id is null or coalesce(a.role,'') not in ('mechanic_operator','weighman','vegetable_brigadier') then raise exception 'PTC_UNAUTHORIZED'; end if;
  company:=a.company_id;
  perform 1 from public.ptc_flows where company_id=company and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;
  if a.role='weighman' then
    actor_label:=coalesce(nullif(trim(a.full_name),''),'Весовщик');
  else
    perform 1 from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null order by id for share;
    select count(*) into linked_count from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
    if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
    select * into person from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
    actor_label:=person.full_name;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-repair:'||p_vehicle::text,0));
  select * into s from public.ptc_vehicle_states where company_id=company and vehicle_id=p_vehicle and assigned for update;
  if not found then raise exception 'PTC_NOT_ASSIGNED'; end if;
  select * into e from public.ptc_events where company_id=company and idempotency_key=p_key;
  if found then
    if e.vehicle_id<>p_vehicle or e.actor_user_id is distinct from p_actor or e.expected_version<>p_version or e.to_state<>p_target then raise exception 'PTC_KEY_CONFLICT'; end if;
    return jsonb_build_object('replayed',true,'eventId',e.id);
  end if;
  if s.version<>p_version then raise exception 'PTC_VERSION_CONFLICT'; end if;
  if not ((a.role='mechanic_operator' and s.state='empty' and p_target='loaded') or
    (a.role='weighman' and s.state='loaded' and p_target='unloading') or
    (a.role='vegetable_brigadier' and s.state='unloading' and p_target='empty')) then raise exception 'PTC_FORBIDDEN_TRANSITION'; end if;
  if p_target='loaded' and exists(select 1 from public.fleet_vehicle_repairs where vehicle_id=p_vehicle and company_id=company and in_repair)
    then raise exception 'FLEET_VEHICLE_IN_REPAIR'; end if;
  update public.ptc_vehicle_states set state=p_target,version=version+1,since=now(),cycle=cycle+case when p_target='loaded' then 1 else 0 end
    where company_id=company and vehicle_id=p_vehicle;
  insert into public.ptc_events(company_id,vehicle_id,actor_user_id,actor_name,field_id,idempotency_key,expected_version,from_state,to_state,cycle)
    values(company,p_vehicle,p_actor,actor_label,(select field_id from public.ptc_flows where company_id=company),p_key,p_version,s.state,p_target,s.cycle+case when p_target='loaded' then 1 else 0 end) returning * into e;
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
end $$;

-- Invalidate impossible markers when a manager removes a vehicle from the line
-- or sends it to repair. These triggers do not change traffic state/history.
create function public.ptc_clear_invalid_last_vehicle_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare marker public.ptc_last_vehicle_markers%rowtype; actor_id uuid; actor_label text;
begin
  if tg_table_name='fleet_vehicle_repairs' then
    if not new.in_repair then return new; end if;
    actor_id:=new.changed_by;
    select coalesce(nullif(trim(full_name),''),'Система') into actor_label
      from public.profiles where id=actor_id;
  elsif tg_table_name='ptc_vehicle_states' then
    if new.assigned or not old.assigned then return new; end if;
  else
    return new;
  end if;
  delete from public.ptc_last_vehicle_markers
    where company_id=new.company_id and vehicle_id=new.vehicle_id returning * into marker;
  if found then
    insert into public.ptc_last_vehicle_events(
      company_id,vehicle_id,actor_user_id,actor_name,command,action
    ) values(new.company_id,new.vehicle_id,actor_id,coalesce(actor_label,'Система'),'system','invalidated');
  end if;
  return new;
end $$;
create trigger ptc_last_vehicle_repair_guard
  after insert or update of in_repair on public.fleet_vehicle_repairs
  for each row execute function public.ptc_clear_invalid_last_vehicle_v1();
create trigger ptc_last_vehicle_line_guard
  after update of assigned on public.ptc_vehicle_states
  for each row execute function public.ptc_clear_invalid_last_vehicle_v1();

revoke all on function public.ptc_set_last_vehicle_v1(uuid,uuid,text,uuid),
  public.ptc_set_combine_shift_v1(uuid,text,uuid,numeric,numeric,uuid),
  public.ptc_clear_invalid_last_vehicle_v1(),
  public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid)
  from public,anon,authenticated;
grant execute on function public.ptc_set_last_vehicle_v1(uuid,uuid,text,uuid),
  public.ptc_set_combine_shift_v1(uuid,text,uuid,numeric,numeric,uuid),
  public.ptc_clear_invalid_last_vehicle_v1(),
  public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid)
  to service_role;
