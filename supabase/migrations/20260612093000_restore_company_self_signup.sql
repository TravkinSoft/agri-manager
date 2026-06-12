/*
  Restore company self-signup while keeping invited-user onboarding.

  Context:
  - The previous handle_new_user version enforced invite-only signup.
  - The public registration page creates a company and sends Supabase email
    confirmation, so non-invited signup must be allowed.
*/

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
  user_company_name text;
  valid_roles text[] := array[
    'global_admin',
    'company_admin',
    'agronomist',
    'director',
    'legal_operator',
    'specialist',
    'warehouse',
    'warehouse_operator',
    'weighman',
    'fuel_operator',
    'brigadier'
  ];
begin
  user_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  if user_role = 'admin' then
    user_role := 'company_admin';
  end if;
  if user_role is null or user_role = '' or not (user_role = any(valid_roles)) then
    user_role := 'specialist';
  end if;

  user_full_name := nullif(
    trim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g')),
    ''
  );
  user_company_name := nullif(
    trim(regexp_replace(coalesce(new.raw_user_meta_data->>'company_name', ''), '\s+', ' ', 'g')),
    ''
  );

  begin
    invite_company_id := nullif(new.raw_user_meta_data->>'invited_by_company', '')::uuid;
  exception when others then
    invite_company_id := null;
  end;

  if invite_company_id is not null then
    if not exists (select 1 from public.companies where id = invite_company_id) then
      raise exception 'Invalid company ID in invitation';
    end if;

    insert into public.profiles (id, full_name, email, role, company_id, is_owner, status)
    values (new.id, user_full_name, new.email, user_role, invite_company_id, false, 'pending')
    on conflict (id) do update
      set email = excluded.email,
          full_name = coalesce(excluded.full_name, public.profiles.full_name),
          role = excluded.role,
          company_id = excluded.company_id,
          is_owner = false,
          status = 'pending',
          updated_at = now();

    return new;
  end if;

  insert into public.companies (name)
  values (coalesce(user_company_name, new.email || '''s Company'))
  returning id into new_company_id;

  insert into public.profiles (id, full_name, email, role, company_id, is_owner, status)
  values (
    new.id,
    user_full_name,
    new.email,
    case when user_role = 'company_admin' then 'company_admin' else 'company_admin' end,
    new_company_id,
    true,
    'active'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        role = 'company_admin',
        company_id = excluded.company_id,
        is_owner = true,
        status = 'active',
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
