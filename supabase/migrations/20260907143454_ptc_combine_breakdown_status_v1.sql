-- Additive combine-operator availability state. This is deliberately separate
-- from vehicle cargo state, vehicle repair, shifts and the last-vehicle marker.
-- No row means "working" at version 0; once created, the current row is kept so
-- optimistic versions remain monotonic across breakdown/recovery cycles.
create table public.ptc_combine_operator_statuses (
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id),
  operator_person_id uuid not null references public.company_people(id),
  operator_name text not null check (length(trim(operator_name)) > 0),
  is_broken boolean not null,
  version integer not null check (version > 0),
  changed_at timestamptz not null default now(),
  primary key (company_id, operator_user_id)
);

create index ptc_combine_operator_active_breakdowns_idx
  on public.ptc_combine_operator_statuses(company_id, changed_at desc)
  where is_broken;
create index ptc_combine_operator_status_user_idx
  on public.ptc_combine_operator_statuses(operator_user_id);
create index ptc_combine_operator_status_person_idx
  on public.ptc_combine_operator_statuses(operator_person_id);

create table public.ptc_combine_operator_status_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ptc_flows(company_id) on delete cascade,
  operator_user_id uuid not null references public.profiles(id),
  operator_person_id uuid not null references public.company_people(id),
  operator_name text not null check (length(trim(operator_name)) > 0),
  shift_id uuid references public.ptc_combine_shifts(id),
  from_broken boolean not null,
  to_broken boolean not null,
  expected_version integer not null check (expected_version >= 0),
  result_version integer not null check (
    result_version > 0 and result_version = expected_version + 1
  ),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (from_broken <> to_broken),
  unique (company_id, idempotency_key),
  unique (company_id, operator_user_id, result_version)
);

create index ptc_combine_operator_status_event_history_idx
  on public.ptc_combine_operator_status_events(company_id, created_at desc);
create index ptc_combine_operator_status_event_user_idx
  on public.ptc_combine_operator_status_events(operator_user_id);
create index ptc_combine_operator_status_event_person_idx
  on public.ptc_combine_operator_status_events(operator_person_id);
create index ptc_combine_operator_status_event_shift_idx
  on public.ptc_combine_operator_status_events(shift_id)
  where shift_id is not null;

create trigger ptc_combine_operator_status_events_append_only
  before update or delete on public.ptc_combine_operator_status_events
  for each row execute function public.ptc_preserve_events_v1();

alter table public.ptc_combine_operator_statuses enable row level security;
alter table public.ptc_combine_operator_status_events enable row level security;

revoke all on public.ptc_combine_operator_statuses,
  public.ptc_combine_operator_status_events
  from public, anon, authenticated, service_role;
grant select, insert, update on public.ptc_combine_operator_statuses to service_role;
grant select, insert on public.ptc_combine_operator_status_events to service_role;

create function public.ptc_set_combine_breakdown_v1(
  p_actor uuid,
  p_is_broken boolean,
  p_expected_version integer,
  p_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
  actor_person public.company_people%rowtype;
  current_status public.ptc_combine_operator_statuses%rowtype;
  saved_status public.ptc_combine_operator_statuses%rowtype;
  prior_event public.ptc_combine_operator_status_events%rowtype;
  active_shift_id uuid;
  linked_count integer;
  current_is_broken boolean;
  current_version integer;
begin
  if p_actor is null
     or p_is_broken is null
     or p_expected_version is null
     or p_expected_version < 0
     or p_expected_version >= 2147483647
     or p_key is null then
    raise exception 'PTC_COMBINE_STATUS_INVALID';
  end if;

  select * into actor_profile
  from public.profiles
  where id = p_actor
  for share;

  if not found
     or actor_profile.status is distinct from 'active'
     or actor_profile.company_id is null
     or coalesce(actor_profile.role, '') <> 'mechanic_operator' then
    raise exception 'PTC_COMBINE_STATUS_FORBIDDEN';
  end if;

  -- Lock every currently matching row in a stable order before validating the
  -- exact-one invariant and reading the identity used in both state and event.
  perform 1
  from public.company_people person
  where person.user_id = p_actor
    and person.company_id = actor_profile.company_id
    and person.status = 'active'
    and person.deleted_at is null
  order by person.id
  for share;

  select count(*) into linked_count
  from public.company_people person
  where person.user_id = p_actor
    and person.company_id = actor_profile.company_id
    and person.status = 'active'
    and person.deleted_at is null;

  if linked_count <> 1 then
    raise exception 'PTC_PERSON_LINK_REQUIRED';
  end if;

  select * into actor_person
  from public.company_people
  where user_id = p_actor
    and company_id = actor_profile.company_id
    and status = 'active'
    and deleted_at is null;

  perform 1
  from public.ptc_flows
  where company_id = actor_profile.company_id
    and enabled
  for share;

  if not found then
    raise exception 'PTC_DISABLED';
  end if;

  -- The key lock gives deterministic conflicts even if two operators reuse the
  -- same tenant-scoped idempotency key concurrently. The actor lock serializes
  -- all version changes for one operator, including first-row creation.
  perform pg_advisory_xact_lock(hashtextextended(
    'ptc-combine-status-key:' || actor_profile.company_id::text || ':' || p_key::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'ptc-combine-status-actor:' || actor_profile.company_id::text || ':' || p_actor::text,
    0
  ));

  select * into prior_event
  from public.ptc_combine_operator_status_events
  where company_id = actor_profile.company_id
    and idempotency_key = p_key;

  if found then
    if prior_event.operator_user_id <> p_actor
       or prior_event.to_broken is distinct from p_is_broken
       or prior_event.expected_version <> p_expected_version then
      raise exception 'PTC_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'eventId', prior_event.id,
      'operatorUserId', prior_event.operator_user_id,
      'operatorPersonId', prior_event.operator_person_id,
      'operatorName', prior_event.operator_name,
      'isBroken', prior_event.to_broken,
      'version', prior_event.result_version,
      'changedAt', prior_event.created_at,
      'shiftId', prior_event.shift_id
    );
  end if;

  select * into current_status
  from public.ptc_combine_operator_statuses
  where company_id = actor_profile.company_id
    and operator_user_id = p_actor
  for update;

  if found then
    current_is_broken := current_status.is_broken;
    current_version := current_status.version;
  else
    current_is_broken := false;
    current_version := 0;
  end if;

  if current_version <> p_expected_version then
    raise exception 'PTC_COMBINE_STATUS_VERSION_CONFLICT';
  end if;

  if current_is_broken = p_is_broken then
    raise exception 'PTC_COMBINE_STATUS_NO_CHANGE';
  end if;

  select shift.id into active_shift_id
  from public.ptc_combine_shifts shift
  where shift.company_id = actor_profile.company_id
    and shift.operator_user_id = p_actor
    and shift.closed_at is null;

  insert into public.ptc_combine_operator_statuses (
    company_id,
    operator_user_id,
    operator_person_id,
    operator_name,
    is_broken,
    version,
    changed_at
  ) values (
    actor_profile.company_id,
    p_actor,
    actor_person.id,
    actor_person.full_name,
    p_is_broken,
    current_version + 1,
    now()
  )
  on conflict (company_id, operator_user_id) do update set
    operator_person_id = excluded.operator_person_id,
    operator_name = excluded.operator_name,
    is_broken = excluded.is_broken,
    version = excluded.version,
    changed_at = excluded.changed_at
  returning * into saved_status;

  insert into public.ptc_combine_operator_status_events (
    company_id,
    operator_user_id,
    operator_person_id,
    operator_name,
    shift_id,
    from_broken,
    to_broken,
    expected_version,
    result_version,
    idempotency_key,
    created_at
  ) values (
    actor_profile.company_id,
    p_actor,
    actor_person.id,
    actor_person.full_name,
    active_shift_id,
    current_is_broken,
    p_is_broken,
    current_version,
    current_version + 1,
    p_key,
    saved_status.changed_at
  )
  returning * into prior_event;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'eventId', prior_event.id,
    'operatorUserId', saved_status.operator_user_id,
    'operatorPersonId', saved_status.operator_person_id,
    'operatorName', saved_status.operator_name,
    'isBroken', saved_status.is_broken,
    'version', saved_status.version,
    'changedAt', saved_status.changed_at,
    'shiftId', prior_event.shift_id
  );
end;
$$;

revoke all on function public.ptc_set_combine_breakdown_v1(
  uuid, boolean, integer, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.ptc_set_combine_breakdown_v1(
  uuid, boolean, integer, uuid
) to service_role;

comment on table public.ptc_combine_operator_statuses is
  'Current per-operator combine availability; absence means working at version 0.';
comment on table public.ptc_combine_operator_status_events is
  'Append-only combine breakdown and recovery history; shift_id is optional context only.';
comment on function public.ptc_set_combine_breakdown_v1(uuid, boolean, integer, uuid) is
  'Sets only the active mechanic operator represented by p_actor; independent from vehicle and shift state.';
