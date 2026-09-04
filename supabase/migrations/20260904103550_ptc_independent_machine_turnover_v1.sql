-- Independent machine turnover. No scale documents, stock or global vehicle status writes.
-- Access is exclusively through server-authenticated API; no direct browser table/RPC access.
create table public.ptc_flows (
  company_id uuid primary key references public.companies(id),
  enabled boolean not null default false,
  field_id uuid references public.fields(id),
  updated_at timestamptz not null default now()
);
create table public.ptc_vehicle_states (
  company_id uuid not null references public.ptc_flows(company_id),
  vehicle_id uuid not null references public.reference_vehicles(id),
  assigned boolean not null default true,
  state text not null default 'empty' check (state in ('empty','loaded','unloading')),
  version integer not null default 0 check (version >= 0),
  cycle integer not null default 0 check (cycle >= 0),
  since timestamptz not null default now(),
  primary key (company_id, vehicle_id),
  check (assigned or state = 'empty')
);
create table public.ptc_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id),
  person_id uuid not null references public.company_people(id),
  role text not null check (role in ('harvester','receiver')),
  login text not null unique,
  password_hash text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (length(login) between 6 and 40),
  check (length(password_hash) = 161)
);
create index ptc_access_company on public.ptc_access(company_id, created_at desc);
create unique index ptc_access_one_active on public.ptc_access(company_id,person_id,role) where revoked_at is null;
create table public.ptc_sessions (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references public.ptc_access(id),
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index ptc_sessions_access on public.ptc_sessions(access_id);
create table public.ptc_login_limits (
  key text primary key check (length(key) <= 100),
  window_started timestamptz not null default now(),
  attempts integer not null default 1
);
create table public.ptc_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  access_id uuid not null references public.ptc_access(id),
  actor_name text not null,
  field_id uuid references public.fields(id),
  idempotency_key uuid not null,
  expected_version integer not null,
  from_state text not null check (from_state in ('empty','loaded','unloading')),
  to_state text not null check (to_state in ('empty','loaded','unloading')),
  cycle integer not null,
  created_at timestamptz not null default now(),
  unique (company_id,idempotency_key),
  foreign key (company_id,vehicle_id) references public.ptc_vehicle_states(company_id,vehicle_id)
);
create index ptc_events_history on public.ptc_events(company_id,created_at desc);
create index ptc_events_access on public.ptc_events(access_id);

create function public.ptc_preserve_events_v1() returns trigger language plpgsql security invoker set search_path = '' as $$
begin raise exception 'PTC_HISTORY_IMMUTABLE'; end $$;
create trigger ptc_events_append_only before update or delete on public.ptc_events for each row execute function public.ptc_preserve_events_v1();

create function public.ptc_check_references_v1() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'ptc_flows' then
    if new.field_id is not null and not exists(select 1 from public.fields f where f.id=new.field_id and f.company_id=new.company_id) then raise exception 'PTC_COMPANY_MISMATCH'; end if;
  elsif tg_table_name = 'ptc_vehicle_states' then
    if not exists(select 1 from public.reference_vehicles v where v.id=new.vehicle_id and v.company_id=new.company_id) then raise exception 'PTC_COMPANY_MISMATCH'; end if;
  elsif tg_table_name = 'ptc_access' then
    if not exists(select 1 from public.company_people p where p.id=new.person_id and p.company_id=new.company_id) then raise exception 'PTC_COMPANY_MISMATCH'; end if;
  end if;
  return new;
end $$;
create trigger ptc_flow_refs before insert or update on public.ptc_flows for each row execute function public.ptc_check_references_v1();
create trigger ptc_vehicle_refs before insert or update on public.ptc_vehicle_states for each row execute function public.ptc_check_references_v1();
create trigger ptc_access_refs before insert or update on public.ptc_access for each row execute function public.ptc_check_references_v1();

-- Persistent, atomic fixed-window limits shared by all application instances.
create function public.ptc_take_login_attempt_v1(p_key text, p_limit integer) returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_limit < 1 or p_limit > 100 or length(p_key)>100 then raise exception 'PTC_INVALID_LIMIT'; end if;
  insert into public.ptc_login_limits as limits (key) values(p_key)
  on conflict (key) do update set
    attempts = case when limits.window_started < now()-interval '10 minutes' then 1 else limits.attempts+1 end,
    window_started = case when limits.window_started < now()-interval '10 minutes' then now() else limits.window_started end
  returning attempts into n;
  return n <= p_limit;
end $$;

create function public.ptc_configure_v1(p_company uuid, p_enabled boolean, p_field uuid, p_vehicles uuid[]) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_vehicles is null or cardinality(p_vehicles)>100 or array_position(p_vehicles,null) is not null then raise exception 'PTC_INVALID_FLEET'; end if;
  insert into public.ptc_flows(company_id) values(p_company) on conflict do nothing;
  perform 1 from public.ptc_flows where company_id=p_company for update;
  if p_field is not null and not exists(select 1 from public.fields where id=p_field and company_id=p_company and not coalesce(archived,false)) then raise exception 'PTC_COMPANY_MISMATCH'; end if;
  if exists(select 1 from unnest(p_vehicles) vid where not exists(select 1 from public.reference_vehicles v where v.id=vid and v.company_id=p_company)) then raise exception 'PTC_COMPANY_MISMATCH'; end if;
  -- Existing assigned vehicles remain visible even if the global fleet record becomes inactive.
  if exists(select 1 from unnest(p_vehicles) vid where not exists(select 1 from public.ptc_vehicle_states s where s.company_id=p_company and s.vehicle_id=vid and s.assigned)
    and not exists(select 1 from public.reference_vehicles v where v.id=vid and v.company_id=p_company and v.is_active and not coalesce(v.archived,false))) then raise exception 'PTC_INACTIVE_VEHICLE'; end if;
  perform 1 from public.ptc_vehicle_states where company_id=p_company order by vehicle_id for update;
  if exists(select 1 from public.ptc_vehicle_states where company_id=p_company and state<>'empty' and not (vehicle_id=any(p_vehicles))) then raise exception 'PTC_ACTIVE_VEHICLE'; end if;
  if exists(select 1 from public.ptc_vehicle_states where company_id=p_company and state<>'empty') and
    exists(select 1 from public.ptc_flows where company_id=p_company and field_id is distinct from p_field) then raise exception 'PTC_ACTIVE_FIELD'; end if;
  update public.ptc_flows set enabled=p_enabled,field_id=p_field,updated_at=now() where company_id=p_company;
  update public.ptc_vehicle_states set assigned=false where company_id=p_company and not (vehicle_id=any(p_vehicles));
  insert into public.ptc_vehicle_states(company_id,vehicle_id)
    select p_company, vid from (select distinct unnest(p_vehicles) as vid) v
    on conflict (company_id,vehicle_id) do update set assigned=true;
end $$;

create function public.ptc_transition_v1(p_token_hash text,p_vehicle uuid,p_version integer,p_target text,p_key uuid) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.ptc_access%rowtype; s public.ptc_vehicle_states%rowtype; e public.ptc_events%rowtype; company uuid; actor text;
begin
  select g.company_id into company from public.ptc_sessions sess join public.ptc_access g on g.id=sess.access_id
    where sess.token_hash=p_token_hash and sess.revoked_at is null and sess.expires_at>now() and g.revoked_at is null;
  if company is null then raise exception 'PTC_UNAUTHORIZED'; end if;
  perform 1 from public.ptc_flows where company_id=company and enabled for share;
  if not found then raise exception 'PTC_DISABLED'; end if;
  select g.* into a from public.ptc_access g join public.ptc_sessions sess on sess.access_id=g.id
    where sess.token_hash=p_token_hash and sess.revoked_at is null and sess.expires_at>now() and g.revoked_at is null for share of g,sess;
  if not found then raise exception 'PTC_UNAUTHORIZED'; end if;
  select full_name into actor from public.company_people where id=a.person_id and company_id=company and status='active' and deleted_at is null for share;
  if not found then raise exception 'PTC_UNAUTHORIZED'; end if;
  select * into s from public.ptc_vehicle_states where company_id=company and vehicle_id=p_vehicle and assigned for update;
  if not found then raise exception 'PTC_NOT_ASSIGNED'; end if;
  select * into e from public.ptc_events where company_id=company and idempotency_key=p_key;
  if found then
    if e.vehicle_id<>p_vehicle or e.access_id<>a.id or e.expected_version<>p_version or e.to_state<>p_target then raise exception 'PTC_KEY_CONFLICT'; end if;
    return jsonb_build_object('replayed',true,'eventId',e.id);
  end if;
  if s.version<>p_version then raise exception 'PTC_VERSION_CONFLICT'; end if;
  if not ((a.role='harvester' and s.state='empty' and p_target='loaded') or
    (a.role='receiver' and s.state='loaded' and p_target='unloading') or
    (a.role='receiver' and s.state='unloading' and p_target='empty')) then raise exception 'PTC_FORBIDDEN_TRANSITION'; end if;
  update public.ptc_vehicle_states set state=p_target,version=version+1,since=now(),cycle=cycle+case when p_target='loaded' then 1 else 0 end
    where company_id=company and vehicle_id=p_vehicle;
  insert into public.ptc_events(company_id,vehicle_id,access_id,actor_name,field_id,idempotency_key,expected_version,from_state,to_state,cycle)
    values(company,p_vehicle,a.id,actor,(select field_id from public.ptc_flows where company_id=company),p_key,p_version,s.state,p_target,s.cycle+case when p_target='loaded' then 1 else 0 end) returning * into e;
  return jsonb_build_object('replayed',false,'eventId',e.id);
end $$;

alter table public.ptc_flows enable row level security;
alter table public.ptc_vehicle_states enable row level security;
alter table public.ptc_access enable row level security;
alter table public.ptc_sessions enable row level security;
alter table public.ptc_login_limits enable row level security;
alter table public.ptc_events enable row level security;
revoke all on public.ptc_flows,public.ptc_vehicle_states,public.ptc_access,public.ptc_sessions,public.ptc_login_limits,public.ptc_events from public,anon,authenticated,service_role;
grant select,insert,update on public.ptc_flows,public.ptc_vehicle_states,public.ptc_access,public.ptc_sessions,public.ptc_login_limits to service_role;
grant select,insert on public.ptc_events to service_role;
revoke all on function public.ptc_preserve_events_v1(),public.ptc_check_references_v1(),public.ptc_take_login_attempt_v1(text,integer),public.ptc_configure_v1(uuid,boolean,uuid,uuid[]),public.ptc_transition_v1(text,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.ptc_preserve_events_v1(),public.ptc_check_references_v1(),public.ptc_take_login_attempt_v1(text,integer),public.ptc_configure_v1(uuid,boolean,uuid,uuid[]),public.ptc_transition_v1(text,uuid,integer,text,uuid) to service_role;
