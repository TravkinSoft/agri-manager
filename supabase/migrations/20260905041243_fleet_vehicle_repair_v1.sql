-- Technical availability is independent of weighing/PTC cargo states.
-- No backfill: an absent record means no repair mark and version 0.
create table public.fleet_vehicle_repairs (
  vehicle_id uuid primary key references public.reference_vehicles(id),
  company_id uuid not null references public.companies(id),
  in_repair boolean not null,
  version integer not null check (version > 0),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id)
);
create index fleet_repairs_company on public.fleet_vehicle_repairs(company_id, vehicle_id);
create index fleet_repairs_actor on public.fleet_vehicle_repairs(changed_by);
create table public.fleet_vehicle_repair_events (
  vehicle_id uuid not null references public.reference_vehicles(id),
  version integer not null,
  company_id uuid not null references public.companies(id),
  in_repair boolean not null,
  created_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  primary key(vehicle_id, version)
);
create index fleet_repair_events_company on public.fleet_vehicle_repair_events(company_id, created_at desc);
create index fleet_repair_events_actor on public.fleet_vehicle_repair_events(actor_id);
alter table public.fleet_vehicle_repairs enable row level security;
alter table public.fleet_vehicle_repair_events enable row level security;
revoke all on public.fleet_vehicle_repairs, public.fleet_vehicle_repair_events from public, anon, authenticated;
grant select, insert, update on public.fleet_vehicle_repairs to service_role;
grant select, insert on public.fleet_vehicle_repair_events to service_role;
revoke update, delete, truncate on public.fleet_vehicle_repair_events from service_role;

create function public.fleet_set_vehicle_repair_v1(
  p_actor uuid, p_company uuid, p_vehicle uuid, p_in_repair boolean, p_expected_version integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.profiles%rowtype; r public.fleet_vehicle_repairs%rowtype;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active' or coalesce(a.role,'') not in ('fleet_manager','company_admin','global_admin')
    or (a.role<>'global_admin' and a.company_id is distinct from p_company)
    then raise exception 'FLEET_REPAIR_FORBIDDEN'; end if;
  if p_in_repair is null or p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647
    then raise exception 'FLEET_REPAIR_INVALID'; end if;
  -- The same lock is used by new PTC loading; no check-then-load race.
  perform pg_advisory_xact_lock(hashtextextended('fleet-repair:'||p_vehicle::text,0));
  perform 1 from public.reference_vehicles where id=p_vehicle and company_id=p_company and not archived and is_active for share;
  if not found then raise exception 'FLEET_REPAIR_VEHICLE_UNAVAILABLE'; end if;
  select * into r from public.fleet_vehicle_repairs where vehicle_id=p_vehicle for update;
  if found and r.company_id<>p_company then raise exception 'FLEET_REPAIR_FORBIDDEN'; end if;
  if coalesce(r.version,0)<>p_expected_version then
    -- A lost response may be retried, but never overwrite a newer repair/return cycle.
    if r.version=p_expected_version+1 and r.in_repair=p_in_repair then
      return jsonb_build_object('companyId',p_company,'vehicleId',p_vehicle,'inRepair',r.in_repair,'version',r.version,'changedAt',r.changed_at);
    end if;
    raise exception 'FLEET_REPAIR_CONFLICT';
  end if;
  if coalesce(r.in_repair,false)=p_in_repair then
    return jsonb_build_object('companyId',p_company,'vehicleId',p_vehicle,'inRepair',p_in_repair,'version',coalesce(r.version,0),'changedAt',r.changed_at);
  end if;
  insert into public.fleet_vehicle_repairs(vehicle_id,company_id,in_repair,version,changed_at,changed_by)
    values(p_vehicle,p_company,p_in_repair,p_expected_version+1,now(),p_actor)
    on conflict(vehicle_id) do update set in_repair=excluded.in_repair,version=excluded.version,changed_at=excluded.changed_at,changed_by=excluded.changed_by
    returning * into r;
  insert into public.fleet_vehicle_repair_events(vehicle_id,version,company_id,in_repair,actor_id,created_at)
    values(p_vehicle,r.version,p_company,r.in_repair,p_actor,r.changed_at);
  return jsonb_build_object('companyId',p_company,'vehicleId',p_vehicle,'inRepair',r.in_repair,'version',r.version,'changedAt',r.changed_at);
end $$;
revoke all on function public.fleet_set_vehicle_repair_v1(uuid,uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.fleet_set_vehicle_repair_v1(uuid,uuid,uuid,boolean,integer) to service_role;

-- Existing actor, company, person, version and idempotency checks are retained.
create or replace function public.ptc_actor_transition_v1(p_actor uuid,p_vehicle uuid,p_version integer,p_target text,p_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.profiles%rowtype; person public.company_people%rowtype; s public.ptc_vehicle_states%rowtype; e public.ptc_events%rowtype; company uuid; linked_count integer;
begin
  select * into a from public.profiles where id=p_actor for share;
  if not found or a.status is distinct from 'active' or a.company_id is null or coalesce(a.role,'') not in ('mechanic_operator','vegetable_brigadier') then raise exception 'PTC_UNAUTHORIZED'; end if;
  company:=a.company_id;
  perform 1 from public.ptc_flows where company_id=company and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;
  perform 1 from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null order by id for share;
  select count(*) into linked_count from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
  if linked_count<>1 then raise exception 'PTC_PERSON_LINK_REQUIRED'; end if;
  select * into person from public.company_people where user_id=p_actor and company_id=company and status='active' and deleted_at is null;
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
    (a.role='vegetable_brigadier' and s.state='loaded' and p_target='unloading') or
    (a.role='vegetable_brigadier' and s.state='unloading' and p_target='empty')) then raise exception 'PTC_FORBIDDEN_TRANSITION'; end if;
  if p_target='loaded' and exists(select 1 from public.fleet_vehicle_repairs where vehicle_id=p_vehicle and company_id=company and in_repair)
    then raise exception 'FLEET_VEHICLE_IN_REPAIR'; end if;
  update public.ptc_vehicle_states set state=p_target,version=version+1,since=now(),cycle=cycle+case when p_target='loaded' then 1 else 0 end
    where company_id=company and vehicle_id=p_vehicle;
  insert into public.ptc_events(company_id,vehicle_id,actor_user_id,actor_name,field_id,idempotency_key,expected_version,from_state,to_state,cycle)
    values(company,p_vehicle,p_actor,person.full_name,(select field_id from public.ptc_flows where company_id=company),p_key,p_version,s.state,p_target,s.cycle+case when p_target='loaded' then 1 else 0 end) returning * into e;
  return jsonb_build_object('replayed',false,'eventId',e.id);
end $$;
revoke all on function public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.ptc_actor_transition_v1(uuid,uuid,integer,text,uuid) to service_role;
