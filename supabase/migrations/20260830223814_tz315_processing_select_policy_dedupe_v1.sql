-- TZ315 processing SELECT-policy deduplication.
--
-- The preceding server-only DML corrective intentionally installed a
-- company-scoped authenticated SELECT policy on every protected processing
-- table. Four tables already had an equivalent legacy SELECT policy, which
-- leaves two permissive policies with OR semantics. This migration removes
-- only those proven-equivalent duplicates. It does not alter grants, RLS,
-- ownership, functions, triggers, or business rows.

do $dedupe$
declare
  v_target record;
  v_relid regclass;
  v_authenticated_oid oid := (
    select r.oid
    from pg_catalog.pg_roles r
    where r.rolname = 'authenticated'
  );
  v_tz_policy text;
  v_tz_exists boolean;
  v_relevant_count integer;
  v_matching_count integer;
  v_duplicate_is_equivalent boolean;
begin
  if v_authenticated_oid is null then
    raise exception 'TZ315 policy dedupe prerequisite is missing: role authenticated';
  end if;

  -- Pass 1: validate the complete policy shape before dropping anything.
  -- A drift on any table aborts the DO statement without partial changes.
  for v_target in
    select *
    from (values
      ('stock_ledger_entries'::text, 'Users can view company stock ledger entries'::text),
      ('inventory_batches', null::text),
      ('batch_transformations', null::text),
      ('batch_transformation_inputs', null::text),
      ('batch_transformation_outputs', null::text),
      ('batch_transformation_losses', 'batch_transformation_losses_read_v1'),
      ('batch_processing_events', 'batch_processing_events_read_v1'),
      ('processing_documents', 'Users can view company processing documents')
    ) as targets(table_name, legacy_policy)
  loop
    v_relid := to_regclass(format('public.%I', v_target.table_name));
    v_tz_policy := format('tz315_%s_read_v1', v_target.table_name);

    if v_relid is null then
      raise exception 'TZ315 policy dedupe prerequisite is missing: public.%', v_target.table_name;
    end if;

    if not (
      select c.relrowsecurity
      from pg_catalog.pg_class c
      where c.oid = v_relid
    ) then
      raise exception 'TZ315 policy dedupe requires RLS on public.%', v_target.table_name;
    end if;

    if v_target.legacy_policy is not null then
      select count(*)
      into v_matching_count
      from pg_catalog.pg_policy p
      where p.polrelid = v_relid
        and p.polname = v_target.legacy_policy
        and p.polpermissive
        and p.polcmd = 'r'
        and p.polroles = array[v_authenticated_oid]::oid[]
        and p.polwithcheck is null
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid, true)
          = 'company_id = get_user_company_id()';

      if v_matching_count <> 1 then
        raise exception
          'TZ315 policy dedupe legacy policy drift on public.%: %',
          v_target.table_name,
          v_target.legacy_policy;
      end if;
    end if;

    select exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = v_relid
        and p.polname = v_tz_policy
    )
    into v_tz_exists;

    if v_target.legacy_policy is null or v_tz_exists then
      select count(*)
      into v_matching_count
      from pg_catalog.pg_policy p
      where p.polrelid = v_relid
        and p.polname = v_tz_policy
        and p.polpermissive
        and p.polcmd = 'r'
        and p.polroles = array[v_authenticated_oid]::oid[]
        and p.polwithcheck is null
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid, true)
          = 'company_id = get_user_company_id()';

      if v_matching_count <> 1 then
        raise exception
          'TZ315 policy dedupe canonical policy drift on public.%: %',
          v_target.table_name,
          v_tz_policy;
      end if;
    end if;

    if v_target.legacy_policy is not null and v_tz_exists then
      select legacy.polqual::text = canonical.polqual::text
        and legacy.polcmd = canonical.polcmd
        and legacy.polpermissive = canonical.polpermissive
        and legacy.polroles = canonical.polroles
        and legacy.polwithcheck is not distinct from canonical.polwithcheck
      into v_duplicate_is_equivalent
      from pg_catalog.pg_policy legacy
      join pg_catalog.pg_policy canonical
        on canonical.polrelid = legacy.polrelid
      where legacy.polrelid = v_relid
        and legacy.polname = v_target.legacy_policy
        and canonical.polname = v_tz_policy;

      if v_duplicate_is_equivalent is distinct from true then
        raise exception
          'TZ315 policy dedupe refuses non-equivalent policies on public.%: % vs %',
          v_target.table_name,
          v_target.legacy_policy,
          v_tz_policy;
      end if;
    end if;

    select count(*)
    into v_relevant_count
    from pg_catalog.pg_policy p
    where p.polrelid = v_relid
      and p.polcmd in ('r', '*')
      and (
        0::oid = any(p.polroles)
        or v_authenticated_oid = any(p.polroles)
      );

    if v_target.legacy_policy is null then
      if v_relevant_count <> 1 then
        raise exception
          'TZ315 policy dedupe found unexpected authenticated SELECT policies on public.%: %',
          v_target.table_name,
          v_relevant_count;
      end if;
    elsif v_relevant_count <> (case when v_tz_exists then 2 else 1 end) then
      raise exception
        'TZ315 policy dedupe found unexpected authenticated SELECT policies on public.%: %',
        v_target.table_name,
        v_relevant_count;
    end if;
  end loop;

  -- Pass 2: legacy policies are retained as the canonical policy names.
  -- The generated TZ315 policy is removed only after structural equivalence
  -- was established for every target table above.
  for v_target in
    select *
    from (values
      ('stock_ledger_entries'::text, 'Users can view company stock ledger entries'::text),
      ('batch_transformation_losses', 'batch_transformation_losses_read_v1'),
      ('batch_processing_events', 'batch_processing_events_read_v1'),
      ('processing_documents', 'Users can view company processing documents')
    ) as targets(table_name, legacy_policy)
  loop
    v_tz_policy := format('tz315_%s_read_v1', v_target.table_name);

    if exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = format('public.%I', v_target.table_name)::regclass
        and p.polname = v_tz_policy
    ) then
      execute format(
        'drop policy %I on public.%I',
        v_tz_policy,
        v_target.table_name
      );
    end if;
  end loop;

  -- Pass 3: assert the final invariant for every table. Exactly one
  -- authenticated company-scoped SELECT policy must remain.
  for v_target in
    select *
    from (values
      ('stock_ledger_entries'::text, 'Users can view company stock ledger entries'::text),
      ('inventory_batches', 'tz315_inventory_batches_read_v1'),
      ('batch_transformations', 'tz315_batch_transformations_read_v1'),
      ('batch_transformation_inputs', 'tz315_batch_transformation_inputs_read_v1'),
      ('batch_transformation_outputs', 'tz315_batch_transformation_outputs_read_v1'),
      ('batch_transformation_losses', 'batch_transformation_losses_read_v1'),
      ('batch_processing_events', 'batch_processing_events_read_v1'),
      ('processing_documents', 'Users can view company processing documents')
    ) as targets(table_name, canonical_policy)
  loop
    v_relid := format('public.%I', v_target.table_name)::regclass;

    select count(*)
    into v_matching_count
    from pg_catalog.pg_policy p
    where p.polrelid = v_relid
      and p.polname = v_target.canonical_policy
      and p.polpermissive
      and p.polcmd = 'r'
      and p.polroles = array[v_authenticated_oid]::oid[]
      and p.polwithcheck is null
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid, true)
        = 'company_id = get_user_company_id()';

    select count(*)
    into v_relevant_count
    from pg_catalog.pg_policy p
    where p.polrelid = v_relid
      and p.polcmd in ('r', '*')
      and (
        0::oid = any(p.polroles)
        or v_authenticated_oid = any(p.polroles)
      );

    if v_matching_count <> 1 or v_relevant_count <> 1 then
      raise exception
        'TZ315 policy dedupe final invariant failed on public.%',
        v_target.table_name;
    end if;
  end loop;
end;
$dedupe$;
