-- Additive account role; does not edit fleet, drivers, tickets or traffic states.
alter table public.profiles drop constraint valid_role;
alter table public.profiles add constraint valid_role check (role = any(array[
  'global_admin','company_admin','agronomist','director','legal_operator','specialist',
  'warehouse','warehouse_operator','weighman','fuel_operator','brigadier',
  'mechanic_operator','vegetable_brigadier','fleet_manager'
]::text[]));

-- Keep the existing atomic, administrator-only invitation flow and all conflict checks.
create or replace function public.ptc_bind_invited_profile_v1(
  p_actor uuid, p_user uuid, p_company uuid, p_role text, p_name text, p_email text,
  p_person uuid, p_create_person boolean, p_fresh_auth boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare target public.profiles%rowtype; person public.company_people%rowtype; result_person uuid;
begin
  if p_role not in ('mechanic_operator','vegetable_brigadier','fleet_manager') or length(trim(p_name))=0 then
    raise exception 'PTC_INVALID_INVITATION';
  end if;
  perform 1 from public.profiles where id=p_actor and status='active'
    and (role='global_admin' or (role='company_admin' and company_id=p_company)) for share;
  if not found then raise exception 'PTC_INVITE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ptc-invite:'||p_company::text,0));
  select * into target from public.profiles where id=p_user for update;
  if found and (
    (target.company_id is not null and target.company_id<>p_company)
    or target.role in ('global_admin','company_admin')
    or (not p_fresh_auth and (target.role<>p_role or coalesce(target.status,'active')<>'pending'))
  ) then raise exception 'PTC_EXISTING_ACCOUNT_CONFLICT'; end if;
  if p_person is not null then
    select * into person from public.company_people where id=p_person and company_id=p_company
      and status='active' and deleted_at is null for update;
    if not found or (person.user_id is not null and person.user_id<>p_user) then
      raise exception 'PTC_PERSON_ALREADY_LINKED_OR_UNAVAILABLE';
    end if;
    result_person:=person.id;
  elsif p_create_person then
    if exists(select 1 from public.company_people where company_id=p_company and deleted_at is null
      and lower(regexp_replace(trim(full_name),'\s+',' ','g'))=lower(regexp_replace(trim(p_name),'\s+',' ','g'))) then
      raise exception 'PTC_SELECT_EXISTING_PERSON';
    end if;
  else raise exception 'PTC_PERSON_REQUIRED'; end if;
  if exists(select 1 from public.company_people where user_id=p_user and deleted_at is null
    and id is distinct from result_person) then raise exception 'PTC_USER_ALREADY_LINKED'; end if;
  insert into public.profiles(id,company_id,role,status,full_name,email,is_owner)
    values(p_user,p_company,p_role,'pending',trim(p_name),lower(trim(p_email)),false)
    on conflict(id) do update set company_id=excluded.company_id,role=excluded.role,
      status='pending',full_name=excluded.full_name,email=excluded.email;
  if result_person is null then
    insert into public.company_people(company_id,user_id,full_name,role_type,position,status,created_by_user_id,updated_by_user_id)
      values(p_company,p_user,trim(p_name),case when p_role='mechanic_operator' then 'mechanic_operator' else 'manager' end,
        case p_role when 'mechanic_operator' then 'Механизатор'
          when 'fleet_manager' then 'Заведующий автопарком' else 'Бригадир овощной' end,
        'active',p_actor,p_actor)
      returning id into result_person;
  else
    update public.company_people set user_id=p_user,updated_by_user_id=p_actor where id=result_person;
  end if;
  return result_person;
end $$;
revoke all on function public.ptc_bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ptc_bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,uuid,boolean,boolean) to service_role;
