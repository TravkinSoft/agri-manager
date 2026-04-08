/*
  Enforce invite-only onboarding:
  - profiles are created only when auth user has invited_by_company metadata
  - non-invite signups are rejected at DB trigger level
*/

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
declare
  invite_company_id uuid;
  user_role text;
begin
  invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  user_role := coalesce(new.raw_user_meta_data->>'role', 'specialist');

  if invite_company_id is null then
    raise exception 'Self-signup is disabled. User must be invited by company admin.';
  end if;

  if not exists (select 1 from public.companies where id = invite_company_id) then
    raise exception 'Invalid company ID in invitation';
  end if;

  insert into public.profiles (id, email, role, company_id, is_owner, status)
  values (
    new.id,
    new.email,
    user_role,
    invite_company_id,
    false,
    'pending'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = excluded.role,
    company_id = excluded.company_id,
    status = 'pending';

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
