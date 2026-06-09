begin;

create or replace function public.resolve_actor_context_from_session_v1()
returns table (
  auth_user_id uuid,
  profile_id uuid,
  profile_user_id uuid,
  role text,
  status text,
  company_id uuid,
  email text,
  context_company_id uuid,
  impersonated_profile_id uuid,
  impersonated_company_id uuid,
  impersonated_role text,
  impersonated_status text,
  impersonated_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_profile public.profiles%rowtype;
  v_impersonated public.profiles%rowtype;
  v_impersonation public.global_admin_impersonation_contexts%rowtype;
begin
  if v_auth_user_id is null then
    return;
  end if;

  select *
    into v_profile
  from public.profiles p
  where p.id = v_auth_user_id
     or (v_email <> '' and lower(coalesce(p.email, '')) = v_email)
  order by
    case
      when p.id = v_auth_user_id then 0
      else 2
    end,
    case when coalesce(p.status, 'active') = 'active' then 0 else 1 end
  limit 1;

  if not found then
    return;
  end if;

  select gac.company_id
    into context_company_id
  from public.global_admin_company_contexts gac
  where gac.user_id in (v_profile.id, v_auth_user_id)
  order by
    case
      when gac.user_id = v_profile.id then 0
      when gac.user_id = v_auth_user_id then 1
      else 2
    end
  limit 1;

  select *
    into v_impersonation
  from public.global_admin_impersonation_contexts gai
  where gai.admin_user_id in (v_profile.id, v_auth_user_id)
  order by gai.updated_at desc
  limit 1;

  if v_impersonation.impersonated_profile_id is not null then
    select *
      into v_impersonated
    from public.profiles p
    where p.id = v_impersonation.impersonated_profile_id
    limit 1;
  end if;

  auth_user_id := v_auth_user_id;
  profile_id := v_profile.id;
  profile_user_id := null;
  role := v_profile.role;
  status := v_profile.status;
  company_id := v_profile.company_id;
  email := v_profile.email;
  impersonated_profile_id := v_impersonation.impersonated_profile_id;
  impersonated_company_id := coalesce(v_impersonation.impersonated_company_id, v_impersonated.company_id);
  impersonated_role := v_impersonated.role;
  impersonated_status := v_impersonated.status;
  impersonated_email := v_impersonated.email;
  return next;
end;
$$;

grant execute on function public.resolve_actor_context_from_session_v1() to authenticated;
grant execute on function public.resolve_actor_context_from_session_v1() to service_role;

commit;

notify pgrst, 'reload schema';
