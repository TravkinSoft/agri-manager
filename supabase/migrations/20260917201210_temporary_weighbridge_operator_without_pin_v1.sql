-- Temporary owner-approved P0 mode: authenticated weighbridge users must still
-- select the responsible operator, but the operator PIN is not required.
-- Revoke this function and switch WEIGHBRIDGE_PIN_REQUIRED back to true when
-- the owner asks to restore PIN enforcement.

create or replace function public.temporary_select_weighbridge_operator_without_pin_v1(
  p_company_id uuid,
  p_person_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor record;
  v_effective_role text;
  v_effective_status text;
  v_effective_company_id uuid;
  v_person public.company_people%rowtype;
  v_old public.weighbridge_shifts%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_token text;
  v_expires timestamptz := now() + interval '24 hours';
begin
  select * into v_actor
  from public.resolve_actor_context_from_session_v1()
  limit 1;

  if not found then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  if v_actor.impersonated_profile_id is not null then
    v_effective_role := v_actor.impersonated_role;
    v_effective_status := v_actor.impersonated_status;
    v_effective_company_id := v_actor.impersonated_company_id;
  else
    v_effective_role := v_actor.role;
    v_effective_status := v_actor.status;
    v_effective_company_id := v_actor.company_id;
  end if;

  if coalesce(v_effective_status, 'active') <> 'active'
     or v_effective_role not in ('global_admin', 'company_admin', 'director', 'weighman') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  if v_actor.impersonated_profile_id is not null then
    if v_effective_company_id is distinct from p_company_id then
      raise exception 'Cross-company access denied' using errcode = '42501';
    end if;
  elsif v_actor.role = 'global_admin' then
    if v_actor.context_company_id is distinct from p_company_id then
      raise exception 'Selected company does not match global admin context' using errcode = '42501';
    end if;
  elsif v_effective_company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;

  select * into v_person
  from public.company_people
  where id = p_person_id
    and company_id = p_company_id
    and role_type = 'weighbridge_operator'
    and status = 'active'
    and deleted_at is null;
  if not found then
    raise exception 'Active weighbridge operator not found' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':weighbridge_shift', 0));
  select * into v_old
  from public.weighbridge_shifts
  where company_id = p_company_id and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if v_old.id is not null and v_old.last_activity_at + interval '24 hours' <= now() then
    update public.weighbridge_shifts
    set status = 'closed',
        closed_at = last_activity_at + interval '24 hours',
        closed_by = null,
        closed_by_person_id = operator_person_id,
        close_reason = 'inactivity_24h'
    where id = v_old.id and status = 'open';
    v_old := null;
  end if;

  if v_old.id is null then
    insert into public.weighbridge_shifts (
      company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
      opening_note, status, locked_at, last_activity_at
    ) values (
      p_company_id, v_actor.auth_user_id, p_person_id, v_actor.auth_user_id, p_person_id,
      nullif(btrim(coalesce(p_note, '')), ''), 'open', null, now()
    ) returning * into v_shift;
  elsif v_old.operator_person_id is not null and v_old.operator_person_id <> p_person_id then
    update public.weighbridge_shifts
    set status = 'closed',
        closed_at = now(),
        closed_by = v_actor.auth_user_id,
        closed_by_person_id = v_old.operator_person_id,
        closing_note = nullif(btrim(coalesce(p_note, '')), ''),
        handover_note = nullif(btrim(coalesce(p_note, '')), ''),
        close_reason = 'handover'
    where id = v_old.id;

    insert into public.weighbridge_shifts (
      company_id, operator_id, operator_person_id, opened_by, opened_by_person_id,
      opening_note, status, handover_from_shift_id, last_activity_at
    ) values (
      p_company_id, v_actor.auth_user_id, p_person_id, v_actor.auth_user_id, p_person_id,
      nullif(btrim(coalesce(p_note, '')), ''), 'open', v_old.id, now()
    ) returning * into v_shift;
  else
    update public.weighbridge_shifts
    set operator_id = v_actor.auth_user_id,
        operator_person_id = p_person_id,
        opened_by_person_id = coalesce(opened_by_person_id, p_person_id),
        locked_at = null,
        locked_by_person_id = null,
        last_activity_at = now()
    where id = v_old.id
    returning * into v_shift;
  end if;

  update private.weighbridge_operator_sessions
  set status = 'revoked', revoked_at = now()
  where company_id = p_company_id and status = 'active';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.weighbridge_operator_sessions (
    company_id, shift_id, person_id, auth_user_id, token_hash, expires_at
  ) values (
    p_company_id, v_shift.id, p_person_id, v_actor.auth_user_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires
  );

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires,
    'session_expires_at', v_expires,
    'shift_expires_at', v_expires,
    'shift', to_jsonb(v_shift),
    'operator', jsonb_build_object('id', v_person.id, 'name', v_person.full_name)
  );
end
$function$;

revoke all on function public.temporary_select_weighbridge_operator_without_pin_v1(uuid, uuid, text)
from public, anon;
grant execute on function public.temporary_select_weighbridge_operator_without_pin_v1(uuid, uuid, text)
to authenticated;
