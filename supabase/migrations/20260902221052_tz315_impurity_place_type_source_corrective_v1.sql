-- TZ315: align impurity-removal source validation with the canonical
-- warehouses.place_type contract while preserving legacy warehouse_type rows.
-- No business rows are changed by this migration.

do $tz315_impurity_place_type_source$
declare
  v_signature constant text := 'public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)';
  v_oid oid := pg_catalog.to_regprocedure(v_signature);
  v_definition text;
  v_old constant text :=
    'lower(coalesce(w.warehouse_type, '''')) in (''grain'',''grain_storage'',''harvest'',''crop'',''produce'',''elevator'')';
  v_new constant text :=
    E'(\n'
    || E'        -- TZ315_IMPURITY_PLACE_TYPE_SOURCE_V1\n'
    || E'        w.place_type in (''WAREHOUSE'', ''YARD'', ''DRYER'', ''CLEANER'')\n'
    || E'        or lower(coalesce(w.warehouse_type, '''')) in (''grain'',''grain_storage'',''harvest'',''crop'',''produce'',''elevator'')\n'
    || E'      )';
  v_occurrences integer;
begin
  if v_oid is null then
    raise exception 'TZ315_IMPURITY_FINALIZE_FUNCTION_MISSING' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;

  if pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') = 0 then
    raise exception 'TZ315_IMPURITY_PROCESSING_GATE_MISSING' using errcode = '55000';
  end if;

  if pg_catalog.strpos(v_definition, 'TZ315_IMPURITY_PLACE_TYPE_SOURCE_V1') = 0 then
    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);

    if v_occurrences <> 1 then
      raise exception 'TZ315_IMPURITY_SOURCE_VALIDATION_ANCHOR_COUNT|%', v_occurrences
        using errcode = '55000';
    end if;

    execute pg_catalog.replace(v_definition, v_old, v_new);
  end if;

  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'TZ315_IMPURITY_PLACE_TYPE_SOURCE_V1') = 0
     or pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') = 0
     or pg_catalog.strpos(v_definition, 'w.place_type in (''WAREHOUSE'', ''YARD'', ''DRYER'', ''CLEANER'')') = 0
  then
    raise exception 'TZ315_IMPURITY_PLACE_TYPE_SOURCE_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$tz315_impurity_place_type_source$;

do $tz315_impurity_place_type_acl$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)');
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_owner_oid oid;
  v_authenticated oid := 'authenticated'::pg_catalog.regrole;
  v_service_role oid := 'service_role'::pg_catalog.regrole;
begin
  select owner_role.rolname, proc.prosecdef, proc.proconfig, proc.proowner
  into v_owner, v_security_definer, v_config, v_owner_oid
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_roles owner_role on owner_role.oid = proc.proowner
  where proc.oid = v_oid;

  if v_owner is distinct from 'postgres'
     or v_security_definer is distinct from true
     or not coalesce(v_config @> array['search_path=pg_catalog, public'], false)
     or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.pg_proc proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
       ) acl
       where proc.oid = v_oid
         and (
           acl.privilege_type <> 'EXECUTE'
           or acl.grantee = 0
           or acl.grantee not in (v_owner_oid, v_authenticated, v_service_role)
         )
     )
  then
    raise exception 'TZ315_IMPURITY_PLACE_TYPE_SOURCE_ACL_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$tz315_impurity_place_type_acl$;
