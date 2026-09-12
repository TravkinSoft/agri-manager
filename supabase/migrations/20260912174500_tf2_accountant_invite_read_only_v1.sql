begin;

-- TF2.5: accountant is an operational account role. Keep this list in sync
-- with the complete canonical account-role contract; no existing role is removed.
alter table public.profiles drop constraint if exists valid_role;
alter table public.profiles add constraint valid_role check (role = any(array[
  'global_admin','company_admin','agronomist','director','accountant',
  'legal_operator','specialist','warehouse','warehouse_operator','weighman',
  'fuel_operator','brigadier','mechanic_operator','vegetable_brigadier',
  'fleet_manager'
]::text[]));

-- Auth trigger: invitation authority comes exclusively from raw_app_meta_data,
-- which only trusted server/admin calls can change. raw_user_meta_data remains
-- usable for display text, but never decides a role or company. A public company
-- signup always receives a new company and a pending owner company_admin profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_company_id uuid;
  invite_company_id uuid;
  user_role text;
  user_full_name text;
  user_company_name text;
  generic_marker jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb)->'generic_invitation_v1';
  traffic_marker jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb)->'ptc_invitation_v1';
  invite_marker jsonb;
begin
  user_full_name := nullif(
    trim(pg_catalog.regexp_replace(
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      '\s+', ' ', 'g'
    )),
    ''
  );
  user_company_name := nullif(
    trim(pg_catalog.regexp_replace(
      coalesce(new.raw_user_meta_data->>'company_name', ''),
      '\s+', ' ', 'g'
    )),
    ''
  );

  if generic_marker is not null and traffic_marker is not null then
    raise exception 'AUTH_INVITATION_AMBIGUOUS';
  end if;

  if generic_marker is not null then
    if coalesce(pg_catalog.jsonb_typeof(generic_marker), '') <> 'object' then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    if coalesce(generic_marker->>'state', '') not in ('provisioning', 'ready') then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(generic_marker->'is_owner'), '') <> 'boolean' then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    invite_marker := generic_marker;
    user_role := pg_catalog.lower(coalesce(invite_marker->>'role', ''));
    if user_role not in (
      'company_admin','agronomist','director','accountant','legal_operator',
      'specialist','warehouse','warehouse_operator','weighman','fuel_operator',
      'brigadier','mechanic_operator','vegetable_brigadier','fleet_manager'
    ) then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    if (generic_marker->>'is_owner')::boolean and user_role <> 'company_admin' then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
  elsif traffic_marker is not null then
    if coalesce(pg_catalog.jsonb_typeof(traffic_marker), '') <> 'object' then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    if coalesce(traffic_marker->>'state', '') not in ('provisioning', 'ready') then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
    invite_marker := traffic_marker;
    user_role := pg_catalog.lower(coalesce(invite_marker->>'role', ''));
    if user_role not in ('mechanic_operator','vegetable_brigadier','fleet_manager') then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
  end if;

  if invite_marker is not null then
    begin
      invite_company_id := nullif(invite_marker->>'company_id', '')::uuid;
    exception when others then
      raise exception 'AUTH_INVITATION_INVALID';
    end;

    if invite_company_id is null then
      raise exception 'AUTH_INVITATION_INVALID';
    end if;
  end if;

  if invite_company_id is not null then
    if not exists (
      select 1 from public.companies c where c.id = invite_company_id
    ) then
      raise exception 'AUTH_INVITATION_COMPANY_NOT_FOUND';
    end if;

    insert into public.profiles (
      id, full_name, email, role, company_id, is_owner, status
    ) values (
      new.id, user_full_name, new.email, user_role,
      invite_company_id, false, 'pending'
    )
    on conflict (id) do update
      set email = excluded.email,
          full_name = coalesce(excluded.full_name, public.profiles.full_name),
          role = excluded.role,
          company_id = excluded.company_id,
          is_owner = false,
          status = 'pending',
          updated_at = pg_catalog.now();

    return new;
  end if;

  insert into public.companies (name)
  values (coalesce(user_company_name, new.email || '''s Company'))
  returning id into new_company_id;

  insert into public.profiles (
    id, full_name, email, role, company_id, is_owner, status
  ) values (
    new.id, user_full_name, new.email, 'company_admin',
    new_company_id, true, 'pending'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        role = 'company_admin',
        company_id = excluded.company_id,
        is_owner = true,
        status = 'pending',
        updated_at = pg_catalog.now();

  return new;
end;
$function$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

-- Company-scoped RLS must stop resolving a tenant as soon as an account is not active.
create or replace function public.get_my_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.company_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
  limit 1;
$function$;

create or replace function public.get_user_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  user_company_id uuid;
  user_role text;
  context_company_id uuid;
begin
  select p.company_id, p.role
    into user_company_id, user_role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'active'
  limit 1;

  if not found then
    return null;
  end if;

  if user_role = 'global_admin' then
    select c.company_id
      into context_company_id
    from public.global_admin_company_contexts c
    where c.user_id = (select auth.uid())
    limit 1;

    if context_company_id is not null then
      return context_company_id;
    end if;
  end if;

  return user_company_id;
end;
$function$;

alter function public.get_my_company_id() owner to postgres;
alter function public.get_user_company_id() owner to postgres;
revoke all on function public.get_my_company_id()
  from public, anon, authenticated, service_role;
revoke all on function public.get_user_company_id()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_company_id()
  to authenticated, service_role;
grant execute on function public.get_user_company_id()
  to authenticated, service_role;

-- The operational write guard deliberately ignores profile status. An inactive
-- director, accountant, or legal operator still cannot mutate rows through an unexpired JWT.
create or replace function public.is_current_user_operational_read_only_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('director', 'accountant', 'legal_operator')
  );
$function$;

-- Retain the existing director-only helper and its active-only behavior for
-- older callers while hardening its search path.
create or replace function public.is_current_user_director_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and pg_catalog.lower(coalesce(p.role, '')) = 'director'
      and pg_catalog.lower(coalesce(p.status, 'active')) = 'active'
  );
$function$;

alter function public.is_current_user_operational_read_only_v1() owner to postgres;
alter function public.is_current_user_director_v1() owner to postgres;
revoke all on function public.is_current_user_operational_read_only_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.is_current_user_director_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.is_current_user_operational_read_only_v1()
  to authenticated, service_role;
grant execute on function public.is_current_user_director_v1()
  to authenticated, service_role;

-- Defense in depth: attach restrictive write policies to every public table
-- which has RLS enabled at the time this migration runs.
do $block$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'user_notifications'
  loop
    execute pg_catalog.format(
      'drop policy if exists operational_read_only_insert_v1 on %I.%I',
      target.schema_name, target.table_name
    );
    execute pg_catalog.format(
      'create policy operational_read_only_insert_v1 on %I.%I as restrictive for insert to authenticated with check (not public.is_current_user_operational_read_only_v1())',
      target.schema_name, target.table_name
    );

    execute pg_catalog.format(
      'drop policy if exists operational_read_only_update_v1 on %I.%I',
      target.schema_name, target.table_name
    );
    execute pg_catalog.format(
      'create policy operational_read_only_update_v1 on %I.%I as restrictive for update to authenticated using (not public.is_current_user_operational_read_only_v1()) with check (not public.is_current_user_operational_read_only_v1())',
      target.schema_name, target.table_name
    );

    execute pg_catalog.format(
      'drop policy if exists operational_read_only_delete_v1 on %I.%I',
      target.schema_name, target.table_name
    );
    execute pg_catalog.format(
      'create policy operational_read_only_delete_v1 on %I.%I as restrictive for delete to authenticated using (not public.is_current_user_operational_read_only_v1())',
      target.schema_name, target.table_name
    );
  end loop;
end;
$block$;

-- Reading one's own notification is personal UI state, not an operational
-- business mutation. Preserve the existing column-level grant and own-row RLS.
drop policy if exists operational_read_only_insert_v1 on public.user_notifications;
drop policy if exists operational_read_only_update_v1 on public.user_notifications;
drop policy if exists operational_read_only_delete_v1 on public.user_notifications;

-- PostgREST pre-request protection also covers mutating RPCs and tables which
-- might otherwise bypass a permissive policy combination.
create or replace function public.enforce_operational_read_only_request_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_method text := pg_catalog.upper(
    coalesce(pg_catalog.current_setting('request.method', true), '')
  );
  request_path text := pg_catalog.btrim(
    coalesce(pg_catalog.current_setting('request.path', true), ''), '/'
  );
begin
  if request_method in ('POST', 'PUT', 'PATCH', 'DELETE')
     and request_path <> 'user_notifications'
     and public.is_current_user_operational_read_only_v1() then
    raise insufficient_privilege
      using message = 'Operational read-only access cannot modify data';
  end if;
end;
$function$;

alter function public.enforce_operational_read_only_request_v1() owner to postgres;
revoke all on function public.enforce_operational_read_only_request_v1()
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enforce_operational_read_only_request_v1()
  to anon, authenticated, service_role, authenticator;

alter role authenticator
  set pgrst.db_pre_request = 'public.enforce_operational_read_only_request_v1';

-- Code-first rollout gate. New application routes call this read-only RPC
-- before creating a company or Auth identity, so they fail closed while this
-- migration is not yet installed instead of leaving trigger-created orphans.
create or replace function public.generic_invite_capabilities_v1()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select 'generic-invite-binder-v1'::text;
$function$;

alter function public.generic_invite_capabilities_v1() owner to postgres;
revoke all on function public.generic_invite_capabilities_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.generic_invite_capabilities_v1()
  to service_role;

-- Atomic generic invite binding. Only the trusted service route can call this.
-- Existing profiles are accepted solely as exact pending retries; only an Auth
-- identity created by the current request may receive a missing profile row.
create or replace function public.bind_invited_profile_v1(
  p_actor uuid,
  p_user uuid,
  p_company uuid,
  p_role text,
  p_name text,
  p_email text,
  p_fresh_auth boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  normalized_role text := pg_catalog.lower(trim(coalesce(p_role, '')));
  normalized_name text := trim(pg_catalog.regexp_replace(
    coalesce(p_name, ''), '\s+', ' ', 'g'
  ));
  normalized_email text := pg_catalog.lower(trim(coalesce(p_email, '')));
  auth_email text;
  auth_metadata jsonb;
begin
  if p_actor is null or p_user is null or p_company is null
     or normalized_role not in (
       'company_admin','agronomist','director','accountant','legal_operator',
       'specialist','warehouse','warehouse_operator','weighman','fuel_operator',
       'brigadier','mechanic_operator','vegetable_brigadier','fleet_manager'
     )
     or pg_catalog.length(normalized_name) = 0
     or pg_catalog.length(normalized_name) > 150
     or pg_catalog.length(normalized_email) > 320
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'GENERIC_INVITE_INVALID';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'GENERIC_INVITE_COMPANY_NOT_FOUND';
  end if;

  select p.* into actor_profile
  from public.profiles p
  where p.id = p_actor
  for share;

  if not found
     or actor_profile.status is distinct from 'active'
     or actor_profile.role is null
     or actor_profile.role not in ('global_admin', 'company_admin')
     or (actor_profile.role = 'company_admin' and actor_profile.company_id is distinct from p_company)
     or (actor_profile.role = 'company_admin' and normalized_role = 'company_admin') then
    raise exception 'GENERIC_INVITE_FORBIDDEN';
  end if;

  -- Serialize every bind/retry for one normalized email before inspecting the
  -- target row. Auth itself remains the unique source of email identities.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('generic-invite:' || normalized_email, 0)
  );

  select pg_catalog.lower(coalesce(u.email::text, '')), u.raw_app_meta_data
    into auth_email, auth_metadata
  from auth.users u
  where u.id = p_user
  for share;

  if not found or auth_email <> normalized_email then
    raise exception 'GENERIC_INVITE_AUTH_MISMATCH';
  end if;

  if auth_metadata ? 'generic_invitation_v1' then
    if coalesce(pg_catalog.jsonb_typeof(auth_metadata->'generic_invitation_v1'), '') <> 'object'
       or coalesce(auth_metadata->'generic_invitation_v1'->>'state', '') not in ('provisioning', 'ready')
       or auth_metadata->'generic_invitation_v1'->>'company_id' is distinct from p_company::text
       or auth_metadata->'generic_invitation_v1'->>'role' is distinct from normalized_role
       or coalesce(pg_catalog.jsonb_typeof(auth_metadata->'generic_invitation_v1'->'is_owner'), '') <> 'boolean'
       or (
         coalesce(auth_metadata->'generic_invitation_v1'->>'is_owner', '') = 'true'
         and (normalized_role <> 'company_admin' or actor_profile.role <> 'global_admin')
       ) then
      raise exception 'GENERIC_INVITE_AUTH_MISMATCH';
    end if;
  end if;

  select p.* into target_profile
  from public.profiles p
  where p.id = p_user
  for update;

  if found then
    if target_profile.status is distinct from 'pending'
       or target_profile.company_id is distinct from p_company
       or target_profile.role is distinct from normalized_role
       or coalesce(target_profile.is_owner, false)
       or (
         target_profile.email is not null
         and pg_catalog.lower(trim(target_profile.email)) <> normalized_email
       ) then
      raise exception 'GENERIC_INVITE_EXISTING_ACCOUNT_CONFLICT';
    end if;

    update public.profiles
    set full_name = normalized_name,
        email = normalized_email,
        updated_at = pg_catalog.now()
    where id = p_user;
  else
    if not coalesce(p_fresh_auth, false) then
      raise exception 'GENERIC_INVITE_PROFILE_REQUIRED';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(auth_metadata->'generic_invitation_v1'), '') <> 'object' then
      raise exception 'GENERIC_INVITE_PROFILE_REQUIRED';
    end if;
    if coalesce(auth_metadata->'generic_invitation_v1'->>'state', '') not in ('provisioning', 'ready')
       or auth_metadata->'generic_invitation_v1'->>'company_id' is distinct from p_company::text
       or auth_metadata->'generic_invitation_v1'->>'role' is distinct from normalized_role
       or coalesce(pg_catalog.jsonb_typeof(auth_metadata->'generic_invitation_v1'->'is_owner'), '') <> 'boolean' then
      raise exception 'GENERIC_INVITE_PROFILE_REQUIRED';
    end if;

    insert into public.profiles (
      id, company_id, role, status, full_name, email, is_owner
    ) values (
      p_user, p_company, normalized_role, 'pending',
      normalized_name, normalized_email, false
    );
  end if;

  return p_user;
end;
$function$;

alter function public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean)
  owner to postgres;
revoke all on function public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean)
  to service_role;

comment on function public.bind_invited_profile_v1(uuid,uuid,uuid,text,text,text,boolean) is
  'TF2.5 exact generic invite binder: active administrator, exact tenant/role/email, pending-only retry, fresh-only insert.';

notify pgrst, 'reload config';

commit;
