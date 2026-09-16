-- Harvest field context and trip snapshots for PTC.
-- This migration is deliberately additive. Existing open combine shifts and
-- in-flight PTC vehicle cycles remain valid and continue in legacy mode until
-- the operator selects a precise crop-structure row.

alter table public.ptc_combine_shifts
  add column if not exists current_crop_structure_id uuid references public.crop_structure(id);

alter table public.ptc_combine_shift_events
  drop constraint if exists ptc_combine_shift_events_command_check;
alter table public.ptc_combine_shift_events
  add constraint ptc_combine_shift_events_command_check
  check (command in ('open','switch','close'));
alter table public.ptc_combine_shift_events
  add column if not exists crop_structure_id uuid references public.crop_structure(id),
  add column if not exists hectares_field_total numeric(12,3),
  add column if not exists field_finished boolean;

alter table public.ptc_events
  add column if not exists crop_structure_id uuid references public.crop_structure(id),
  add column if not exists driver_id uuid references public.company_people(id);

alter table public.tickets
  add column if not exists ptc_event_id uuid references public.ptc_events(id),
  add column if not exists ptc_cycle integer;

create unique index if not exists tickets_one_ptc_trip
  on public.tickets(company_id,ptc_event_id)
  where ptc_event_id is not null and is_voided is not true;
create index if not exists ptc_combine_shift_current_structure_idx
  on public.ptc_combine_shifts(current_crop_structure_id)
  where current_crop_structure_id is not null;
create index if not exists ptc_shift_event_crop_structure_idx
  on public.ptc_combine_shift_events(crop_structure_id)
  where crop_structure_id is not null;
create index if not exists ptc_event_crop_structure_idx
  on public.ptc_events(crop_structure_id)
  where crop_structure_id is not null;
create index if not exists ptc_event_driver_idx
  on public.ptc_events(driver_id)
  where driver_id is not null;

create table if not exists public.ptc_field_progress (
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  crop_structure_id uuid not null references public.crop_structure(id),
  field_id uuid not null references public.fields(id),
  planned_area_ha numeric(12,3) not null check (planned_area_ha >= 0),
  actual_completed_ha numeric(12,3) not null default 0 check (actual_completed_ha >= 0),
  status text not null default 'active' check (status in ('active','paused','completed')),
  version integer not null default 1 check (version > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(company_id,crop_structure_id)
);

create table if not exists public.ptc_combine_field_segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  shift_id uuid not null references public.ptc_combine_shifts(id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id),
  crop_structure_id uuid not null references public.crop_structure(id),
  field_id uuid not null references public.fields(id),
  planned_area_ha numeric(12,3) not null check (planned_area_ha >= 0),
  started_field_total_ha numeric(12,3) not null check (started_field_total_ha >= 0),
  ended_field_total_ha numeric(12,3),
  hectares_segment numeric(12,3),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (close_reason in ('switch','shift_close','field_completed')),
  check (
    (closed_at is null and ended_field_total_ha is null and hectares_segment is null and close_reason is null)
    or
    (closed_at is not null and ended_field_total_ha >= started_field_total_ha and hectares_segment >= 0 and close_reason is not null)
  )
);

create unique index if not exists ptc_one_open_field_segment_per_shift
  on public.ptc_combine_field_segments(shift_id)
  where closed_at is null;
create index if not exists ptc_field_segment_company_history
  on public.ptc_combine_field_segments(company_id,opened_at desc);
create index if not exists ptc_field_progress_structure_idx
  on public.ptc_field_progress(crop_structure_id);
create index if not exists ptc_field_progress_field_idx
  on public.ptc_field_progress(field_id);
create index if not exists ptc_field_segment_shift_idx
  on public.ptc_combine_field_segments(shift_id);
create index if not exists ptc_field_segment_structure_idx
  on public.ptc_combine_field_segments(crop_structure_id);
create index if not exists ptc_field_segment_field_idx
  on public.ptc_combine_field_segments(field_id);
create index if not exists ptc_event_loaded_queue
  on public.ptc_events(company_id,to_state,created_at,id)
  where to_state='loaded';

alter table public.ptc_field_progress enable row level security;
alter table public.ptc_combine_field_segments enable row level security;
revoke all on public.ptc_field_progress,public.ptc_combine_field_segments
  from public,anon,authenticated,service_role;
grant select,insert,update on public.ptc_field_progress to service_role;
grant select,insert,update on public.ptc_combine_field_segments to service_role;

create or replace function public.ptc_set_combine_shift_v2(
  p_actor uuid,
  p_command text,
  p_shift uuid,
  p_crop_structure uuid,
  p_hectares_field_total numeric,
  p_field_finished boolean,
  p_confirm_outside_tolerance boolean,
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
  current_segment public.ptc_combine_field_segments%rowtype;
  target_structure public.crop_structure%rowtype;
  target_progress public.ptc_field_progress%rowtype;
  prior_event public.ptc_combine_shift_events%rowtype;
  linked_count integer;
  segment_delta numeric(12,3);
  shift_total numeric(12,3);
  completion_tolerance numeric(12,3);
begin
  if p_command not in ('open','switch','close') or p_key is null then
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
      or (p_shift is not null and prior_event.shift_id<>p_shift)
      or prior_event.crop_structure_id is distinct from p_crop_structure
      or prior_event.hectares_field_total is distinct from p_hectares_field_total
      or prior_event.field_finished is distinct from p_field_finished then
      raise exception 'PTC_KEY_CONFLICT';
    end if;
    select * into current_shift from public.ptc_combine_shifts where id=prior_event.shift_id;
    return jsonb_build_object(
      'ok',true,'replayed',true,'eventId',prior_event.id,'shiftId',current_shift.id,
      'status',case when current_shift.closed_at is null then 'open' else 'closed' end,
      'openedAt',current_shift.opened_at,'closedAt',current_shift.closed_at,
      'hectaresShift',current_shift.hectares_shift,
      'hectaresFieldTotal',current_shift.hectares_field_total,
      'cropStructureId',current_shift.current_crop_structure_id
    );
  end if;

  if p_command='open' then
    if p_shift is not null or p_crop_structure is null or p_hectares_field_total is not null then
      raise exception 'PTC_SHIFT_INVALID';
    end if;
    if exists(select 1 from public.ptc_combine_shifts
      where company_id=actor_profile.company_id and operator_user_id=p_actor and closed_at is null) then
      raise exception 'PTC_SHIFT_ALREADY_OPEN';
    end if;
    select * into target_structure from public.crop_structure
      where id=p_crop_structure and company_id=actor_profile.company_id
        and archived=false and land_use_type='crop' for share;
    if not found then raise exception 'PTC_FIELD_UNAVAILABLE'; end if;
    insert into public.ptc_field_progress(
      company_id,crop_structure_id,field_id,planned_area_ha,updated_by
    ) values(
      actor_profile.company_id,target_structure.id,target_structure.field_id,
      coalesce(target_structure.area,0),p_actor
    ) on conflict(company_id,crop_structure_id) do update set
      field_id=excluded.field_id,planned_area_ha=excluded.planned_area_ha,
      updated_by=excluded.updated_by,updated_at=now()
    returning * into target_progress;
    if target_progress.status='completed' then raise exception 'PTC_FIELD_ALREADY_COMPLETED'; end if;
    insert into public.ptc_combine_shifts(
      company_id,operator_user_id,operator_person_id,operator_name,field_id,current_crop_structure_id
    ) values(
      actor_profile.company_id,p_actor,actor_person.id,actor_person.full_name,
      target_structure.field_id,target_structure.id
    ) returning * into current_shift;
    insert into public.ptc_combine_field_segments(
      company_id,shift_id,operator_user_id,crop_structure_id,field_id,
      planned_area_ha,started_field_total_ha
    ) values(
      actor_profile.company_id,current_shift.id,p_actor,target_structure.id,
      target_structure.field_id,target_progress.planned_area_ha,target_progress.actual_completed_ha
    );
  else
    if p_shift is null or p_hectares_field_total is null
      or p_hectares_field_total<0 or p_hectares_field_total>1000000 then
      raise exception 'PTC_SHIFT_INVALID';
    end if;
    select * into current_shift from public.ptc_combine_shifts
      where id=p_shift and company_id=actor_profile.company_id
        and operator_user_id=p_actor and closed_at is null for update;
    if not found then raise exception 'PTC_SHIFT_CONFLICT'; end if;
    select * into current_segment from public.ptc_combine_field_segments
      where shift_id=current_shift.id and closed_at is null for update;

    -- A shift opened before this migration has no exact structure segment.
    -- It is allowed to close without changing any PTC vehicle or cycle state.
    if found then
      if p_hectares_field_total < current_segment.started_field_total_ha then
        raise exception 'PTC_FIELD_PROGRESS_BACKWARDS';
      end if;
      completion_tolerance:=greatest(1::numeric,current_segment.planned_area_ha*0.03);
      if coalesce(p_field_finished,false)
        and abs(p_hectares_field_total-current_segment.planned_area_ha)>completion_tolerance
        and not coalesce(p_confirm_outside_tolerance,false) then
        raise exception 'PTC_FIELD_COMPLETION_OUTSIDE_TOLERANCE';
      end if;
      segment_delta:=p_hectares_field_total-current_segment.started_field_total_ha;
      update public.ptc_combine_field_segments set
        ended_field_total_ha=p_hectares_field_total,
        hectares_segment=segment_delta,
        closed_at=now(),
        close_reason=case
          when coalesce(p_field_finished,false) then 'field_completed'
          when p_command='switch' then 'switch'
          else 'shift_close'
        end
        where id=current_segment.id;
      update public.ptc_field_progress set
        actual_completed_ha=p_hectares_field_total,
        status=case when coalesce(p_field_finished,false) then 'completed'
          when p_command='switch' then 'paused' else 'active' end,
        version=version+1,updated_by=p_actor,updated_at=now()
        where company_id=actor_profile.company_id
          and crop_structure_id=current_segment.crop_structure_id;
    else
      segment_delta:=greatest(0,p_hectares_field_total-coalesce(current_shift.hectares_field_total,0));
    end if;

    select coalesce(sum(hectares_segment),0) into shift_total
      from public.ptc_combine_field_segments where shift_id=current_shift.id;
    if current_segment.id is null then shift_total:=coalesce(segment_delta,0); end if;
    if p_command='switch' then
      if p_crop_structure is null
        or p_crop_structure is not distinct from current_shift.current_crop_structure_id then
        raise exception 'PTC_SHIFT_INVALID';
      end if;
      select * into target_structure from public.crop_structure
        where id=p_crop_structure and company_id=actor_profile.company_id
          and archived=false and land_use_type='crop' for share;
      if not found then raise exception 'PTC_FIELD_UNAVAILABLE'; end if;
      insert into public.ptc_field_progress(
        company_id,crop_structure_id,field_id,planned_area_ha,updated_by
      ) values(
        actor_profile.company_id,target_structure.id,target_structure.field_id,
        coalesce(target_structure.area,0),p_actor
      ) on conflict(company_id,crop_structure_id) do update set
        field_id=excluded.field_id,planned_area_ha=excluded.planned_area_ha,
        updated_by=excluded.updated_by,updated_at=now()
      returning * into target_progress;
      if target_progress.status='completed' then raise exception 'PTC_FIELD_ALREADY_COMPLETED'; end if;
      insert into public.ptc_combine_field_segments(
        company_id,shift_id,operator_user_id,crop_structure_id,field_id,
        planned_area_ha,started_field_total_ha
      ) values(
        actor_profile.company_id,current_shift.id,p_actor,target_structure.id,
        target_structure.field_id,target_progress.planned_area_ha,target_progress.actual_completed_ha
      );
      update public.ptc_combine_shifts set
        field_id=target_structure.field_id,current_crop_structure_id=target_structure.id,
        hectares_shift=shift_total,hectares_field_total=target_progress.actual_completed_ha,
        updated_at=now()
        where id=current_shift.id returning * into current_shift;
    else
      update public.ptc_combine_shifts set
        closed_at=now(),hectares_shift=coalesce(shift_total,segment_delta,0),
        hectares_field_total=p_hectares_field_total,updated_at=now()
        where id=current_shift.id returning * into current_shift;
    end if;
  end if;

  insert into public.ptc_combine_shift_events(
    company_id,shift_id,actor_user_id,command,idempotency_key,
    crop_structure_id,hectares_field_total,field_finished
  ) values(
    actor_profile.company_id,current_shift.id,p_actor,p_command,p_key,
    p_crop_structure,p_hectares_field_total,p_field_finished
  ) returning * into prior_event;
  return jsonb_build_object(
    'ok',true,'replayed',false,
    'eventId',case when prior_event.id is null then p_key else prior_event.id end,
    'shiftId',current_shift.id,
    'status',case when current_shift.closed_at is null then 'open' else 'closed' end,
    'openedAt',current_shift.opened_at,'closedAt',current_shift.closed_at,
    'hectaresShift',current_shift.hectares_shift,
    'hectaresFieldTotal',current_shift.hectares_field_total,
    'cropStructureId',current_shift.current_crop_structure_id
  );
end;
$$;

revoke all on function public.ptc_set_combine_shift_v2(uuid,text,uuid,uuid,numeric,boolean,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.ptc_set_combine_shift_v2(uuid,text,uuid,uuid,numeric,boolean,boolean,uuid)
  to service_role;

-- Preserve exact plot and assigned driver at the moment the combine operator
-- sends the vehicle. Later PTC stages copy that immutable trip context.
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
