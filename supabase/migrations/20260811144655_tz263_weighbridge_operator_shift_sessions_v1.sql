begin;

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

alter table public.weighbridge_shifts
  add column if not exists operator_person_id uuid references public.company_people(id) on delete restrict,
  add column if not exists opened_by_person_id uuid references public.company_people(id) on delete restrict,
  add column if not exists closed_by_person_id uuid references public.company_people(id) on delete restrict,
  add column if not exists locked_by_person_id uuid references public.company_people(id) on delete set null,
  add column if not exists locked_at timestamptz,
  add column if not exists close_reason text,
  add column if not exists handover_from_shift_id uuid references public.weighbridge_shifts(id) on delete set null;

alter table public.tickets
  add column if not exists created_by_person_id uuid references public.company_people(id) on delete set null,
  add column if not exists finalized_by_person_id uuid references public.company_people(id) on delete set null;

alter table public.ticket_weighings
  add column if not exists operator_person_id uuid references public.company_people(id) on delete set null,
  add column if not exists weighbridge_shift_id uuid references public.weighbridge_shifts(id) on delete set null;

create table if not exists private.weighbridge_operator_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.company_people(id) on delete cascade,
  pin_hash text not null,
  is_active boolean not null default true,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, person_id)
);

create table if not exists private.weighbridge_operator_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shift_id uuid not null references public.weighbridge_shifts(id) on delete cascade,
  person_id uuid not null references public.company_people(id) on delete restrict,
  auth_user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists weighbridge_operator_sessions_lookup_idx
  on private.weighbridge_operator_sessions (company_id, token_hash, status, expires_at);
create index if not exists weighbridge_shifts_company_operator_person_idx
  on public.weighbridge_shifts (company_id, operator_person_id, opened_at desc);
create index if not exists ticket_weighings_shift_person_idx
  on public.ticket_weighings (company_id, weighbridge_shift_id, operator_person_id);

do $guard$
begin
  if exists (
    select 1 from public.weighbridge_shifts
    where status = 'open'
    group by company_id
    having count(*) > 1
  ) then
    raise exception 'TZ263 cannot enforce one open shift: duplicate company shifts exist';
  end if;
end
$guard$;

drop index if exists public.idx_weighbridge_shifts_open_unique;
create unique index if not exists weighbridge_shifts_one_open_per_company_idx
  on public.weighbridge_shifts (company_id)
  where status = 'open';

revoke all on table private.weighbridge_operator_credentials from public, anon, authenticated;
revoke all on table private.weighbridge_operator_sessions from public, anon, authenticated;

create or replace function private.verify_weighbridge_operator_pin_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_pin text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_credential private.weighbridge_operator_credentials%rowtype;
  v_failures integer;
begin
  select * into v_credential
  from private.weighbridge_operator_credentials
  where company_id = p_company_id and person_id = p_person_id
  for update;

  if not found or not v_credential.is_active then
    return jsonb_build_object('ok', false, 'code', 'pin_not_configured');
  end if;
  if v_credential.locked_until is not null and v_credential.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'pin_locked', 'locked_until', v_credential.locked_until);
  end if;
  if p_pin !~ '^[0-9]{6}$' or extensions.crypt(p_pin, v_credential.pin_hash) <> v_credential.pin_hash then
    v_failures := least(v_credential.failed_attempts + 1, 5);
    update private.weighbridge_operator_credentials
    set failed_attempts = case when v_failures >= 5 then 0 else v_failures end,
        locked_until = case when v_failures >= 5 then now() + interval '15 minutes' else null end,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_credential.id;
    return jsonb_build_object(
      'ok', false,
      'code', case when v_failures >= 5 then 'pin_locked' else 'invalid_pin' end,
      'attempts_left', case when v_failures >= 5 then 0 else 5 - v_failures end
    );
  end if;

  update private.weighbridge_operator_credentials
  set failed_attempts = 0, locked_until = null, updated_by = p_actor_id, updated_at = now()
  where id = v_credential.id;
  return jsonb_build_object('ok', true);
end
$function$;

revoke all on function private.verify_weighbridge_operator_pin_v1(uuid, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.set_weighbridge_operator_pin_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_pin text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_person public.company_people%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin', 'director') then
    raise exception 'Operator PIN management is not allowed' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must contain exactly six digits' using errcode = '22023';
  end if;
  select * into v_person from public.company_people
  where id = p_person_id and company_id = p_company_id
    and role_type = 'weighbridge_operator' and status = 'active' and deleted_at is null;
  if not found then
    raise exception 'Active weighbridge operator not found' using errcode = '23503';
  end if;

  insert into private.weighbridge_operator_credentials (
    company_id, person_id, pin_hash, is_active, created_by, updated_by
  ) values (
    p_company_id, p_person_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), p_active, v_actor.id, v_actor.id
  )
  on conflict (company_id, person_id) do update
  set pin_hash = excluded.pin_hash,
      is_active = excluded.is_active,
      failed_attempts = 0,
      locked_until = null,
      updated_by = v_actor.id,
      updated_at = now();

  return jsonb_build_object('ok', true, 'person_id', p_person_id, 'active', p_active);
end
$function$;

create or replace function public.weighbridge_operator_session_state_v1(
  p_company_id uuid,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_operator jsonb;
  v_operators jsonb;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_shift from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc limit 1;

  if nullif(p_session_token, '') is not null then
    select * into v_session
    from private.weighbridge_operator_sessions
    where company_id = p_company_id
      and token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
      and status = 'active'
    order by created_at desc limit 1;
    if found and v_session.expires_at <= now() then
      update private.weighbridge_operator_sessions
      set status = 'expired', revoked_at = now()
      where id = v_session.id;
      v_session := null;
    elsif found and (v_shift.id is distinct from v_session.shift_id or v_shift.status <> 'open') then
      update private.weighbridge_operator_sessions
      set status = 'revoked', revoked_at = now()
      where id = v_session.id;
      v_session := null;
    elsif found then
      update private.weighbridge_operator_sessions set last_seen_at = now() where id = v_session.id;
    end if;
  end if;

  if v_session.id is not null then
    select jsonb_build_object('id', cp.id, 'name', cp.full_name)
      into v_operator from public.company_people cp where cp.id = v_session.person_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cp.id,
    'name', cp.full_name,
    'has_pin', cred.id is not null,
    'pin_active', coalesce(cred.is_active, false),
    'locked_until', cred.locked_until
  ) order by cp.full_name), '[]'::jsonb)
  into v_operators
  from public.company_people cp
  left join private.weighbridge_operator_credentials cred
    on cred.company_id = cp.company_id and cred.person_id = cp.id
  where cp.company_id = p_company_id
    and cp.role_type = 'weighbridge_operator'
    and cp.status = 'active'
    and cp.deleted_at is null;

  return jsonb_build_object(
    'shift', case when v_shift.id is null then null else to_jsonb(v_shift) end,
    'unlocked', v_session.id is not null,
    'session_expires_at', v_session.expires_at,
    'operator', v_operator,
    'operators', v_operators
  );
end
$function$;

create or replace function public.open_or_unlock_weighbridge_shift_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_pin text,
  p_opening_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_person public.company_people%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_pin jsonb;
  v_token text;
  v_expires timestamptz := now() + interval '12 hours';
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_person from public.company_people
  where id = p_person_id and company_id = p_company_id
    and role_type = 'weighbridge_operator' and status = 'active' and deleted_at is null;
  if not found then raise exception 'Active weighbridge operator not found' using errcode = '23503'; end if;

  v_pin := private.verify_weighbridge_operator_pin_v1(p_company_id, p_person_id, p_pin, v_actor.id);
  if not coalesce((v_pin ->> 'ok')::boolean, false) then return v_pin; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift', 0));
  select * into v_shift from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc limit 1 for update;

  if found and v_shift.operator_person_id is not null and v_shift.operator_person_id <> p_person_id then
    return jsonb_build_object('ok', false, 'code', 'handover_required');
  end if;
  if not found then
    insert into public.weighbridge_shifts (
      company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
      opening_note, status, locked_at
    ) values (
      p_company_id, v_actor.id, p_person_id, v_actor.id, p_person_id,
      nullif(btrim(coalesce(p_opening_note, '')), ''), 'open', null
    ) returning * into v_shift;
  else
    update public.weighbridge_shifts
    set operator_id = v_actor.id,
        operator_person_id = p_person_id,
        opened_by_person_id = coalesce(opened_by_person_id, p_person_id),
        locked_at = null,
        locked_by_person_id = null
    where id = v_shift.id returning * into v_shift;
  end if;

  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now()
  where company_id = p_company_id and status = 'active';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.weighbridge_operator_sessions (
    company_id, shift_id, person_id, auth_user_id, token_hash, expires_at
  ) values (
    p_company_id, v_shift.id, p_person_id, v_actor.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires
  );

  return jsonb_build_object(
    'ok', true, 'token', v_token, 'expires_at', v_expires,
    'shift', to_jsonb(v_shift),
    'operator', jsonb_build_object('id', v_person.id, 'name', v_person.full_name)
  );
end
$function$;

create or replace function public.handover_weighbridge_shift_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_pin text,
  p_handover_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_person public.company_people%rowtype;
  v_old public.weighbridge_shifts%rowtype;
  v_new public.weighbridge_shifts%rowtype;
  v_pin jsonb;
  v_token text;
  v_expires timestamptz := now() + interval '12 hours';
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_person from public.company_people
  where id = p_person_id and company_id = p_company_id
    and role_type = 'weighbridge_operator' and status = 'active' and deleted_at is null;
  if not found then raise exception 'Active weighbridge operator not found' using errcode = '23503'; end if;
  v_pin := private.verify_weighbridge_operator_pin_v1(p_company_id, p_person_id, p_pin, v_actor.id);
  if not coalesce((v_pin ->> 'ok')::boolean, false) then return v_pin; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift', 0));
  select * into v_old from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc limit 1 for update;
  if not found then
    return public.open_or_unlock_weighbridge_shift_v1(p_company_id, p_person_id, p_pin, 'Открыта после передачи');
  end if;
  if v_old.operator_person_id = p_person_id then
    return public.open_or_unlock_weighbridge_shift_v1(p_company_id, p_person_id, p_pin, null);
  end if;

  update public.weighbridge_shifts
  set status = 'closed', closed_at = now(), closed_by = v_actor.id,
      closed_by_person_id = v_old.operator_person_id,
      closing_note = nullif(btrim(coalesce(p_handover_note, '')), ''),
      handover_note = nullif(btrim(coalesce(p_handover_note, '')), ''),
      close_reason = 'handover'
  where id = v_old.id;

  insert into public.weighbridge_shifts (
    company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
    opening_note, status, handover_from_shift_id
  ) values (
    p_company_id, v_actor.id, p_person_id, v_actor.id, p_person_id,
    nullif(btrim(coalesce(p_handover_note, '')), ''), 'open', v_old.id
  ) returning * into v_new;

  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now()
  where company_id = p_company_id and status = 'active';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.weighbridge_operator_sessions (
    company_id, shift_id, person_id, auth_user_id, token_hash, expires_at
  ) values (
    p_company_id, v_new.id, p_person_id, v_actor.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires
  );
  return jsonb_build_object(
    'ok', true, 'token', v_token, 'expires_at', v_expires,
    'previous_shift_id', v_old.id, 'shift', to_jsonb(v_new),
    'operator', jsonb_build_object('id', v_person.id, 'name', v_person.full_name)
  );
end
$function$;

create or replace function public.lock_weighbridge_operator_session_v1(
  p_company_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_session private.weighbridge_operator_sessions%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_session from private.weighbridge_operator_sessions
  where company_id = p_company_id
    and token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and status = 'active'
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', true, 'already_locked', true); end if;
  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now() where id = v_session.id;
  update public.weighbridge_shifts
  set locked_at = now(), locked_by_person_id = v_session.person_id
  where id = v_session.shift_id and status = 'open';
  return jsonb_build_object('ok', true, 'shift_id', v_session.shift_id);
end
$function$;

create or replace function private.revoke_weighbridge_sessions_on_shift_close_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if old.status = 'open' and new.status = 'closed' then
    update private.weighbridge_operator_sessions
    set status = 'revoked', revoked_at = now()
    where shift_id = new.id and status = 'active';
  end if;
  return new;
end
$function$;

drop trigger if exists revoke_weighbridge_sessions_on_shift_close_v1 on public.weighbridge_shifts;
create trigger revoke_weighbridge_sessions_on_shift_close_v1
after update of status on public.weighbridge_shifts
for each row execute function private.revoke_weighbridge_sessions_on_shift_close_v1();

revoke all on function public.set_weighbridge_operator_pin_v1(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.weighbridge_operator_session_state_v1(uuid, text) from public, anon;
revoke all on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) from public, anon;
revoke all on function public.handover_weighbridge_shift_v1(uuid, uuid, text, text) from public, anon;
revoke all on function public.lock_weighbridge_operator_session_v1(uuid, text) from public, anon;
grant execute on function public.set_weighbridge_operator_pin_v1(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.weighbridge_operator_session_state_v1(uuid, text) to authenticated;
grant execute on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.handover_weighbridge_shift_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.lock_weighbridge_operator_session_v1(uuid, text) to authenticated;

commit;
