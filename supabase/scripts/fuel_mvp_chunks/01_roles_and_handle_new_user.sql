-- 01: roles + handle_new_user update

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'valid_role'
  ) then
    alter table public.profiles drop constraint valid_role;
  end if;

  alter table public.profiles
    add constraint valid_role
    check (
      role in (
        'global_admin',
        'company_admin',
        'agronomist',
        'specialist',
        'warehouse',
        'weighman',
        'fuel_operator'
      )
    );
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  invite_company_id uuid;
  user_role text;
  user_full_name text;
  valid_roles text[] := array[
    'global_admin',
    'company_admin',
    'agronomist',
    'specialist',
    'warehouse',
    'weighman',
    'fuel_operator'
  ];
begin
  user_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  if user_role = 'admin' then
    user_role := 'company_admin';
  end if;
  if user_role is null or user_role = '' or not (user_role = any(valid_roles)) then
    user_role := 'agronomist';
  end if;

  user_full_name := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g'), '');

  begin
    invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  exception when others then
    invite_company_id := null;
  end;

  if invite_company_id is not null then
    if exists (select 1 from public.companies where id = invite_company_id) then
      insert into public.profiles (id, full_name, email, role, company_id, is_owner)
      values (new.id, user_full_name, new.email, user_role, invite_company_id, false)
      on conflict (id) do nothing;
    else
      insert into public.companies (name)
      values (new.email || '''s Company')
      returning id into new_company_id;

      insert into public.profiles (id, full_name, email, role, company_id, is_owner)
      values (new.id, user_full_name, new.email, user_role, new_company_id, true)
      on conflict (id) do nothing;
    end if;
  else
    insert into public.companies (name)
    values (coalesce(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    returning id into new_company_id;

    insert into public.profiles (id, full_name, email, role, company_id, is_owner)
    values (new.id, user_full_name, new.email, user_role, new_company_id, true)
    on conflict (id) do nothing;
  end if;

  return new;
exception when others then
  raise warning 'handle_new_user failed for user %: % %', new.id, sqlerrm, sqlstate;
  return new;
end;
$$;
