-- TZ315 processing/stock write-surface corrective.
--
-- Browser JWT roles keep company-scoped read access, but may no longer mutate
-- accounting or processing source-of-truth tables directly. Canonical
-- SECURITY DEFINER functions and explicitly authenticated server routes remain
-- the only write paths. No business rows are changed by this migration.

do $acl$
declare
  v_table text;
  v_policy record;
  v_authenticated_oid oid := (select oid from pg_catalog.pg_roles where rolname = 'authenticated');
begin
  foreach v_table in array array[
    'stock_ledger_entries',
    'inventory_batches',
    'batch_transformations',
    'batch_transformation_inputs',
    'batch_transformation_outputs',
    'batch_transformation_losses',
    'batch_processing_events',
    'processing_documents'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'TZ315 processing ACL prerequisite is missing: public.%', v_table;
    end if;

    execute format(
      'revoke all privileges on table public.%I from public, anon',
      v_table
    );
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated',
      v_table
    );

    -- service_role is the trusted backend identity for the two server-only
    -- compatibility writes. DDL-like table rights are unnecessary.
    execute format(
      'revoke truncate, references, trigger on table public.%I from service_role',
      v_table
    );
    execute format(
      'grant select on table public.%I to authenticated, service_role',
      v_table
    );
    execute format(
      'grant insert, update, delete on table public.%I to service_role',
      v_table
    );

    -- Remove latent authenticated mutation policies as defense in depth. They
    -- are ineffective after the ACL revoke, but retaining them would make a
    -- future accidental GRANT reopen the direct-write bypass.
    for v_policy in
      select p.polname
      from pg_catalog.pg_policy p
      where p.polrelid = format('public.%I', v_table)::regclass
        and p.polcmd in ('*', 'a', 'w', 'd')
        and (
          0::oid = any(p.polroles)
          or (v_authenticated_oid is not null and v_authenticated_oid = any(p.polroles))
        )
    loop
      execute format(
        'drop policy %I on public.%I',
        v_policy.polname,
        v_table
      );
    end loop;

    if not exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = format('public.%I', v_table)::regclass
        and p.polname = format('tz315_%s_read_v1', v_table)
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (company_id = public.get_user_company_id())',
        format('tz315_%s_read_v1', v_table),
        v_table
      );
    end if;
  end loop;
end;
$acl$;

-- This legacy RPC has no current application caller. Keep it available only
-- to the trusted server backend and pin its lookup path; browser users must use
-- the current canonical processing workflows instead.
alter function public.confirm_processing_document(uuid, uuid)
  set search_path = pg_catalog, public;

revoke all on function public.confirm_processing_document(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_processing_document(uuid, uuid)
  to service_role;
