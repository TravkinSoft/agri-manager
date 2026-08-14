begin;

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
  v_has_pin boolean;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Operator PIN management is not allowed' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_person
  from public.company_people
  where id = p_person_id
    and company_id = p_company_id
    and role_type = 'weighbridge_operator';
  if not found then
    raise exception 'Weighbridge operator not found' using errcode = '23503';
  end if;

  if p_active then
    if v_person.status <> 'active' or v_person.deleted_at is not null then
      raise exception 'Active weighbridge operator not found' using errcode = '23503';
    end if;
    if p_pin is null or p_pin !~ '^[0-9]{6}$' then
      raise exception 'PIN must contain exactly six digits' using errcode = '22023';
    end if;

    insert into private.weighbridge_operator_credentials (
      company_id, person_id, pin_hash, is_active, created_by, updated_by
    ) values (
      p_company_id,
      p_person_id,
      extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      true,
      v_actor.id,
      v_actor.id
    )
    on conflict (company_id, person_id) do update
    set pin_hash = excluded.pin_hash,
        is_active = true,
        failed_attempts = 0,
        locked_until = null,
        updated_by = v_actor.id,
        updated_at = now();
  else
    update private.weighbridge_operator_credentials
    set is_active = false,
        failed_attempts = 0,
        locked_until = null,
        updated_by = v_actor.id,
        updated_at = now()
    where company_id = p_company_id and person_id = p_person_id;
  end if;

  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now()
  where company_id = p_company_id
    and person_id = p_person_id
    and status = 'active';

  select exists (
    select 1
    from private.weighbridge_operator_credentials
    where company_id = p_company_id and person_id = p_person_id
  ) into v_has_pin;

  return jsonb_build_object(
    'ok', true,
    'person_id', p_person_id,
    'pin_configured', v_has_pin,
    'access_enabled', p_active and v_has_pin
  );
end
$function$;

create or replace function public.weighbridge_operator_access_state_v1(
  p_company_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_person public.company_people%rowtype;
  v_credential private.weighbridge_operator_credentials%rowtype;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Operator PIN management is not allowed' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_person
  from public.company_people
  where id = p_person_id and company_id = p_company_id;
  if not found then
    raise exception 'Employee not found' using errcode = '23503';
  end if;

  select * into v_credential
  from private.weighbridge_operator_credentials
  where company_id = p_company_id and person_id = p_person_id;

  return jsonb_build_object(
    'person_id', v_person.id,
    'is_weighbridge_operator', v_person.role_type = 'weighbridge_operator',
    'employee_status', v_person.status,
    'pin_configured', v_credential.id is not null,
    'access_enabled',
      v_person.role_type = 'weighbridge_operator'
      and v_person.status = 'active'
      and v_person.deleted_at is null
      and v_credential.id is not null
      and v_credential.is_active
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

    update private.weighbridge_operator_sessions
    set status = 'revoked', revoked_at = now()
    where company_id = new.company_id
      and person_id = new.id
      and status = 'active';
  end if;
  return new;
end
$function$;

drop trigger if exists company_people_revoke_weighbridge_access_v1 on public.company_people;
create trigger company_people_revoke_weighbridge_access_v1
after update of role_type, status, deleted_at on public.company_people
for each row execute function private.revoke_weighbridge_operator_access_on_person_change_v1();

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
    'operator', v_operator,
    'operators', v_operators,
    'unconfigured_operator_count', v_unconfigured_operator_count
  );
end
$function$;

revoke all on function public.set_weighbridge_operator_pin_v1(uuid, uuid, text, boolean)
  from public, anon;
grant execute on function public.set_weighbridge_operator_pin_v1(uuid, uuid, text, boolean)
  to authenticated;

revoke all on function public.weighbridge_operator_access_state_v1(uuid, uuid)
  from public, anon;
grant execute on function public.weighbridge_operator_access_state_v1(uuid, uuid)
  to authenticated;

revoke all on function private.revoke_weighbridge_operator_access_on_person_change_v1()
  from public, anon, authenticated;

commit;
