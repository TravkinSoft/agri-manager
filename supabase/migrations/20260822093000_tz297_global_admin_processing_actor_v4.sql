-- TZ297: Global Admin may manage processing inside the explicitly selected company context.
-- Company-scoped roles remain restricted to their own company.

create or replace function public.tz297_assert_processing_actor_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_allowed_roles text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_auth_profile public.profiles%rowtype;
begin
  if v_auth is null then
    raise exception 'Authenticated session is required' using errcode='42501';
  end if;

  select * into v_actor
  from public.profiles
  where id=p_actor_user_id
    and coalesce(status,'active')='active';

  if not found
     or not (v_actor.role = any(p_allowed_roles))
     or (v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id)
  then
    raise exception 'PROCESSING_FORBIDDEN' using errcode='42501';
  end if;

  if v_auth <> p_actor_user_id then
    select * into v_auth_profile
    from public.profiles
    where id=v_auth
      and coalesce(status,'active')='active';
    if not found or v_auth_profile.role <> 'global_admin' then
      raise exception 'PROCESSING_FORBIDDEN' using errcode='42501';
    end if;
  end if;

  return v_actor.role;
end;
$$;

revoke all on function public.tz297_assert_processing_actor_v1(uuid,uuid,text[]) from public, anon, authenticated;
