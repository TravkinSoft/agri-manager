begin;

-- TZ-167: these tables are global catalog or internal import state. They must
-- never inherit company scoping, and anonymous access is not required.
create or replace function private.is_active_global_admin()
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
      and p.role = 'global_admin'
      and p.status = 'active'
  );
$function$;

revoke all on function private.is_active_global_admin() from public, anon;
grant execute on function private.is_active_global_admin() to authenticated, service_role;

-- Global reference data: authenticated read, active global-admin write.
do $block$
declare
  v_table text;
begin
  foreach v_table in array array[
    'global_product_aliases',
    'global_product_supplier_links',
    'global_suppliers',
    'global_supplier_aliases',
    'seed_reproduction_aliases',
    'crop_categories'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_table
    );

    execute format('drop policy if exists %I on public.%I', v_table || '_authenticated_read', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_delete', v_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      v_table || '_authenticated_read',
      v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_active_global_admin()))',
      v_table || '_global_admin_insert',
      v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_active_global_admin())) with check ((select private.is_active_global_admin()))',
      v_table || '_global_admin_update',
      v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_active_global_admin()))',
      v_table || '_global_admin_delete',
      v_table
    );
  end loop;
end
$block$;

-- Internal import/review state: only the active global-admin process may use it.
do $block$
declare
  v_table text;
begin
  foreach v_table in array array[
    'stg_equipment_raw_persistent',
    'equipment_import_review_queue'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_table
    );

    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_read', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_insert', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_update', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_global_admin_delete', v_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_active_global_admin()))',
      v_table || '_global_admin_read',
      v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_active_global_admin()))',
      v_table || '_global_admin_insert',
      v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_active_global_admin())) with check ((select private.is_active_global_admin()))',
      v_table || '_global_admin_update',
      v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_active_global_admin()))',
      v_table || '_global_admin_delete',
      v_table
    );
  end loop;
end
$block$;

revoke all on sequence public.stg_equipment_raw_persistent_id_seq
  from anon, authenticated;
grant usage, select on sequence public.stg_equipment_raw_persistent_id_seq
  to authenticated;

-- The treatment-program sync is the only mutating SECURITY DEFINER RPC called
-- directly by the browser. Preserve its implementation behind a guarded wrapper.
do $block$
begin
  if to_regprocedure('private.sync_treatment_program_links_impl_v1(uuid,uuid,uuid)') is null then
    if to_regprocedure('public.sync_treatment_program_links(uuid,uuid,uuid)') is null then
      raise exception 'public.sync_treatment_program_links(uuid,uuid,uuid) is required';
    end if;

    alter function public.sync_treatment_program_links(uuid, uuid, uuid)
      rename to sync_treatment_program_links_impl_v1;
    alter function public.sync_treatment_program_links_impl_v1(uuid, uuid, uuid)
      set schema private;
  end if;
end
$block$;

alter function private.sync_treatment_program_links_impl_v1(uuid, uuid, uuid)
  set search_path = pg_catalog, public;
revoke all on function private.sync_treatment_program_links_impl_v1(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function private.can_sync_treatment_program_links(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce((select auth.role()), '') = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (
            p.company_id = p_company_id
            and p.role in ('company_admin', 'agronomist', 'director')
          )
        )
    );
$function$;

revoke all on function private.can_sync_treatment_program_links(uuid)
  from public, anon, authenticated;

create or replace function public.sync_treatment_program_links(
  p_company_id uuid,
  p_season_id uuid,
  p_field_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not private.can_sync_treatment_program_links(p_company_id) then
    raise exception 'Not authorized to sync treatment programs for this company'
      using errcode = '42501';
  end if;

  perform private.sync_treatment_program_links_impl_v1(
    p_company_id,
    p_season_id,
    p_field_id
  );
end;
$function$;

-- Lock every public SECURITY DEFINER function to a deterministic, non-writable
-- search path and remove PostgreSQL's default PUBLIC execute grant.
do $block$
declare
  v_function regprocedure;
  v_returns_trigger boolean;
begin
  for v_function, v_returns_trigger in
    select p.oid::regprocedure, p.prorettype = 'pg_catalog.trigger'::regtype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public',
      v_function
    );
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function
    );

    if not v_returns_trigger then
      execute format('grant execute on function %s to service_role', v_function);
    end if;
  end loop;
end
$block$;

-- Browser/session functions with a proven authenticated caller.
grant execute on function public.get_current_company_id() to authenticated;
grant execute on function public.get_my_company_id() to authenticated;
grant execute on function public.get_user_company_id() to authenticated;
grant execute on function public.resolve_actor_context_from_session_v1() to authenticated;
grant execute on function public.sync_treatment_program_links(uuid, uuid, uuid) to authenticated;

comment on function private.is_active_global_admin() is
  'TZ-167 RLS guard: true only for the active global_admin profile matching auth.uid().';
comment on function public.sync_treatment_program_links(uuid, uuid, uuid) is
  'TZ-167 guarded browser RPC. Company users may sync only their own company; global_admin and service_role retain authorized access.';

commit;
