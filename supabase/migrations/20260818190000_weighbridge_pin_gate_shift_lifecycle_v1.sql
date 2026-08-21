begin;

alter table public.weighbridge_shifts
  add column if not exists last_activity_at timestamptz;

update public.weighbridge_shifts
set last_activity_at = coalesce(last_activity_at, opened_at, created_at, now())
where last_activity_at is null;

alter table public.weighbridge_shifts
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

create index if not exists weighbridge_shifts_open_activity_idx
  on public.weighbridge_shifts (company_id, last_activity_at)
  where status = 'open';

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
  v_unconfigured_operator_count integer;
  v_lock_reason text;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_shift
  from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if v_shift.id is not null
     and v_shift.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed',
        closed_at = last_activity_at + interval '24 hours',
        closed_by = null,
        closed_by_person_id = operator_person_id,
        close_reason = 'inactivity_24h'
    where id = v_shift.id and status = 'open';
    v_lock_reason := 'inactivity_24h';
    v_shift := null;
  end if;

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
      v_lock_reason := coalesce(v_lock_reason, 'inactivity_24h');
      v_session := null;
    elsif found and (v_shift.id is distinct from v_session.shift_id or v_shift.status <> 'open') then
      update private.weighbridge_operator_sessions
      set status = 'revoked', revoked_at = now()
      where id = v_session.id;
      v_session := null;
    elsif found and not exists (
      select 1
      from public.company_people cp
      join private.weighbridge_operator_credentials cred
        on cred.company_id = cp.company_id and cred.person_id = cp.id
      where cp.id = v_session.person_id
        and cp.company_id = p_company_id
        and cp.role_type = 'weighbridge_operator'
        and cp.status = 'active'
        and cp.deleted_at is null
        and cred.is_active
    ) then
      update private.weighbridge_operator_sessions
      set status = 'revoked', revoked_at = now()
      where id = v_session.id;
      v_lock_reason := 'admin_revoked';
      v_session := null;
    elsif found then
      update private.weighbridge_operator_sessions
      set last_seen_at = now()
      where id = v_session.id;
    end if;
  end if;

  if v_session.id is not null then
    select jsonb_build_object('id', cp.id, 'name', cp.full_name)
    into v_operator
    from public.company_people cp
    where cp.id = v_session.person_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cp.id,
    'name', cp.full_name,
    'has_pin', true,
    'pin_active', true,
    'locked_until', cred.locked_until
  ) order by cp.full_name), '[]'::jsonb)
  into v_operators
  from public.company_people cp
  join private.weighbridge_operator_credentials cred
    on cred.company_id = cp.company_id
   and cred.person_id = cp.id
   and cred.is_active
  where cp.company_id = p_company_id
    and cp.role_type = 'weighbridge_operator'
    and cp.status = 'active'
    and cp.deleted_at is null;

  select count(*)::integer
  into v_unconfigured_operator_count
  from public.company_people cp
  left join private.weighbridge_operator_credentials cred
    on cred.company_id = cp.company_id and cred.person_id = cp.id
  where cp.company_id = p_company_id
    and cp.role_type = 'weighbridge_operator'
    and cp.status = 'active'
    and cp.deleted_at is null
    and (cred.id is null or not cred.is_active);

  return jsonb_build_object(
    'shift', case when v_shift.id is null then null else to_jsonb(v_shift) end,
    'unlocked', v_session.id is not null,
    'session_expires_at', v_session.expires_at,
    'shift_expires_at', case when v_shift.id is null then null else v_shift.last_activity_at + interval '24 hours' end,
    'lock_reason', v_lock_reason,
    'operator', v_operator,
    'operators', v_operators,
    'unconfigured_operator_count', v_unconfigured_operator_count
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
  v_expires timestamptz := now() + interval '24 hours';
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

  if v_shift.id is not null and v_shift.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed', closed_at = last_activity_at + interval '24 hours', closed_by = null,
        closed_by_person_id = operator_person_id, close_reason = 'inactivity_24h'
    where id = v_shift.id and status = 'open';
    v_shift := null;
  end if;

  if v_shift.id is not null and v_shift.operator_person_id is not null and v_shift.operator_person_id <> p_person_id then
    return jsonb_build_object('ok', false, 'code', 'handover_required');
  end if;
  if v_shift.id is null then
    insert into public.weighbridge_shifts (
      company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
      opening_note, status, locked_at, last_activity_at
    ) values (
      p_company_id, v_actor.id, p_person_id, v_actor.id, p_person_id,
      nullif(btrim(coalesce(p_opening_note, '')), ''), 'open', null, now()
    ) returning * into v_shift;
  else
    update public.weighbridge_shifts
    set operator_id = v_actor.id,
        operator_person_id = p_person_id,
        opened_by_person_id = coalesce(opened_by_person_id, p_person_id),
        locked_at = null,
        locked_by_person_id = null,
        last_activity_at = now()
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
    'session_expires_at', v_expires, 'shift_expires_at', v_expires,
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
  v_expires timestamptz := now() + interval '24 hours';
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

  if v_old.id is not null and v_old.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed', closed_at = last_activity_at + interval '24 hours', closed_by = null,
        closed_by_person_id = operator_person_id, close_reason = 'inactivity_24h'
    where id = v_old.id and status = 'open';
    v_old := null;
  end if;

  if v_old.id is not null then
    update public.weighbridge_shifts
    set status = 'closed', closed_at = now(), closed_by = v_actor.id,
        closed_by_person_id = v_old.operator_person_id,
        closing_note = nullif(btrim(coalesce(p_handover_note, '')), ''),
        handover_note = nullif(btrim(coalesce(p_handover_note, '')), ''),
        close_reason = 'handover'
    where id = v_old.id;
  end if;

  insert into public.weighbridge_shifts (
    company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
    opening_note, status, handover_from_shift_id, last_activity_at
  ) values (
    p_company_id, v_actor.id, p_person_id, v_actor.id, p_person_id,
    nullif(btrim(coalesce(p_handover_note, '')), ''), 'open', v_old.id, now()
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
    'session_expires_at', v_expires, 'shift_expires_at', v_expires,
    'previous_shift_id', v_old.id, 'shift', to_jsonb(v_new),
    'operator', jsonb_build_object('id', v_person.id, 'name', v_person.full_name)
  );
end
$function$;

create or replace function public.touch_weighbridge_operator_activity_v1(
  p_company_id uuid,
  p_session_token text,
  p_activity text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_expires timestamptz := now() + interval '24 hours';
begin
  if p_activity not in ('pin_unlock','ticket_create','gross','tare_finalize','ticket_correction','ticket_void','weighing_transfer') then
    raise exception 'Unsupported weighbridge activity' using errcode = '22023';
  end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','director','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_session
  from private.weighbridge_operator_sessions
  where company_id = p_company_id
    and token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and status = 'active'
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'shift_expired'); end if;

  select * into v_shift from public.weighbridge_shifts
  where id = v_session.shift_id and company_id = p_company_id and status = 'open'
  for update;
  if not found then
    update private.weighbridge_operator_sessions
    set status = 'revoked', revoked_at = now()
    where id = v_session.id;
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  if v_session.expires_at <= now()
     or v_shift.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed',
        closed_at = last_activity_at + interval '24 hours',
        closed_by = null,
        closed_by_person_id = operator_person_id,
        close_reason = 'inactivity_24h'
    where id = v_shift.id and status = 'open';
    update private.weighbridge_operator_sessions
    set status = 'expired', revoked_at = now()
    where shift_id = v_shift.id and status = 'active';
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  update public.weighbridge_shifts
  set last_activity_at = now()
  where id = v_shift.id;
  update private.weighbridge_operator_sessions
  set expires_at = v_expires, last_seen_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'shift_id', v_shift.id,
    'last_activity_at', now(),
    'expires_at', v_expires,
    'activity', p_activity
  );
end
$function$;

create or replace function private.revoke_weighbridge_operator_access_on_person_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if old.role_type = 'weighbridge_operator'
     and (
       new.role_type <> 'weighbridge_operator'
       or new.status <> 'active'
       or new.deleted_at is not null
     ) then
    update private.weighbridge_operator_credentials
    set is_active = false,
        failed_attempts = 0,
        locked_until = null,
        updated_by = coalesce(new.updated_by_user_id, updated_by),
        updated_at = now()
    where company_id = new.company_id and person_id = new.id;

    update public.weighbridge_shifts
    set status = 'closed', closed_at = now(), close_reason = 'admin_revoked',
        closed_by = coalesce(new.updated_by_user_id, closed_by),
        closed_by_person_id = operator_person_id
    where company_id = new.company_id
      and operator_person_id = new.id
      and status = 'open';

    update private.weighbridge_operator_sessions
    set status = 'revoked', revoked_at = now()
    where company_id = new.company_id
      and person_id = new.id
      and status = 'active';
  end if;
  return new;
end
$function$;

create or replace function private.close_weighbridge_shift_on_operator_access_disabled_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if old.is_active and not new.is_active then
    update public.weighbridge_shifts
    set status = 'closed',
        closed_at = now(),
        close_reason = 'admin_revoked',
        closed_by = coalesce(new.updated_by, closed_by),
        closed_by_person_id = operator_person_id
    where company_id = new.company_id
      and operator_person_id = new.person_id
      and status = 'open';

    update private.weighbridge_operator_sessions
    set status = 'revoked', revoked_at = now()
    where company_id = new.company_id
      and person_id = new.person_id
      and status = 'active';
  end if;
  return new;
end
$function$;

drop trigger if exists close_weighbridge_shift_on_operator_access_disabled_v1
  on private.weighbridge_operator_credentials;
create trigger close_weighbridge_shift_on_operator_access_disabled_v1
after update of is_active on private.weighbridge_operator_credentials
for each row execute function private.close_weighbridge_shift_on_operator_access_disabled_v1();

revoke all on function public.weighbridge_operator_session_state_v1(uuid, text) from public, anon;
revoke all on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) from public, anon;
revoke all on function public.handover_weighbridge_shift_v1(uuid, uuid, text, text) from public, anon;
revoke all on function public.touch_weighbridge_operator_activity_v1(uuid, text, text) from public, anon;
grant execute on function public.weighbridge_operator_session_state_v1(uuid, text) to authenticated;
grant execute on function public.open_or_unlock_weighbridge_shift_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.handover_weighbridge_shift_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.touch_weighbridge_operator_activity_v1(uuid, text, text) to authenticated;
revoke all on function private.revoke_weighbridge_operator_access_on_person_change_v1() from public, anon, authenticated;
revoke all on function private.close_weighbridge_shift_on_operator_access_disabled_v1() from public, anon, authenticated;

commit;
