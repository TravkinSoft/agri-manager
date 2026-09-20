-- P0: Auth admin createUser applies app_metadata AFTER its users INSERT.
-- Version matches the successfully applied Production migration.
-- Validate the final trusted metadata atomically before commit, not too early.
-- Role allowlists, pending state, archived-company guard and tenant isolation
-- remain unchanged. No existing users, profiles or companies are modified.
set local lock_timeout = '2s';
set local statement_timeout = '10s';

-- Supabase owns auth.users; postgres has TRIGGER but cannot DROP its trigger
-- directly. Use the documented function-owner replacement, guarded so CASCADE
-- can remove ONLY this one trigger. Everything is recreated atomically.
do $guard$
begin
  if (select count(*) from pg_depend where refclassid='pg_proc'::regclass
      and refobjid='public.handle_new_user()'::regprocedure) <> 1
    or not exists (
      select 1 from pg_depend d join pg_trigger t on d.classid='pg_trigger'::regclass and d.objid=t.oid
      where d.refclassid='pg_proc'::regclass and d.refobjid='public.handle_new_user()'::regprocedure
        and t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_created'
    ) then
    raise exception 'AUTH_TRIGGER_DEPENDENCY_DRIFT';
  end if;
end;
$guard$;
drop function public.handle_new_user() cascade;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- GoTrue inserts auth.users before applying admin app_metadata in the same
  -- transaction. This INSERT constraint trigger runs at transaction end.
  -- NEW is the original INSERT snapshot: read the final row, never authorize
  -- from caller-editable user_metadata or a marker copied by the client.
  select u.* into new from auth.users u where u.id = new.id;
  if not found then
    return null; -- A user created and removed in this transaction needs no profile.
  end if;
  generic_marker := coalesce(new.raw_app_meta_data, '{}'::jsonb)->'generic_invitation_v1';
  traffic_marker := coalesce(new.raw_app_meta_data, '{}'::jsonb)->'ptc_invitation_v1';

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
      select 1 from public.companies c where c.id = invite_company_id and c.archived_at is null
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

  -- An invitation must use a trusted marker above. A markerless account is
  -- a deliberate company registration only when its company name is supplied.
  -- Never silently turn a failed/legacy invitation into an email-named tenant.
  if user_company_name is null then
    raise exception 'AUTH_COMPANY_NAME_REQUIRED';
  end if;

  insert into public.companies (name)
  values (user_company_name)
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

create constraint trigger on_auth_user_created
  after insert on auth.users
  deferrable initially deferred
  for each row execute function public.handle_new_user();

-- Preserve the original postgres-only execution boundary after recreation.
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
comment on function public.handle_new_user() is
  'Validate final server-owned invitation app_metadata at Auth transaction commit; never trust user_metadata for company or role.';
