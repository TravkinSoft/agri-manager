-- TZ315 P1 corrective: processing_output_role is nullable in the released
-- tickets schema. SQL `NULL NOT IN (...)` evaluates to UNKNOWN, so the WIP
-- physical-handoff validator must normalize NULL before its allow-list check.
--
-- This migration only replaces the exact released helper definition. It is
-- DDL-only, repeat-safe, and intentionally performs no business-data backfill.

do $migration$
declare
  v_helper_oid oid;
  v_helper_owner text;
  v_helper_security_definer boolean;
  v_helper_config text[];
  v_helper_definition text;
  v_helper_hash text;
  v_route_oid oid;
  v_route_definition text;
  v_anchor_count integer := 0;
  v_old constant text :=
    '     or v_ticket.processing_output_role not in (';
  v_new constant text :=
    E'     -- TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1\n     or coalesce(v_ticket.processing_output_role, '''') not in (';
begin
  v_helper_oid := pg_catalog.to_regprocedure(
    'private.tz315_processing_wip_physical_state_valid_v1(uuid)'
  );
  v_route_oid := pg_catalog.to_regprocedure(
    'public.attach_route_processing_input_ticket_v1(uuid)'
  );
  if v_helper_oid is null or v_route_oid is null then
    raise exception 'TZ315_WIP_ROLE_NULL_GUARD_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    pg_catalog.pg_get_functiondef(proc.oid)
  into
    v_helper_owner,
    v_helper_security_definer,
    v_helper_config,
    v_helper_definition
  from pg_catalog.pg_proc proc
  where proc.oid = v_helper_oid;

  select pg_catalog.pg_get_functiondef(v_route_oid)
  into v_route_definition;
  v_helper_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(v_helper_definition, E'\\s+', ' ', 'g')
  ));

  if v_helper_owner is distinct from 'postgres'
     or coalesce(v_helper_security_definer, false)
     or v_helper_config is distinct from array['search_path=""']::text[]
     or exists (
       select 1
       from pg_catalog.pg_proc helper_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           helper_proc.proacl,
           pg_catalog.acldefault('f', helper_proc.proowner)
         )
       ) helper_acl
       where helper_proc.oid = v_helper_oid
         and helper_acl.grantee = 0
         and helper_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_helper_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_helper_oid, 'EXECUTE'
     )
     or pg_catalog.strpos(
       v_route_definition,
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1'
     ) = 0
     or pg_catalog.strpos(
       v_route_definition,
       'private.tz315_processing_wip_physical_state_valid_v1(p_ticket_id)'
     ) = 0
  then
    raise exception 'TZ315_WIP_ROLE_NULL_GUARD_METADATA_INVALID'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(
       v_helper_definition,
       'TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1'
     ) > 0
  then
    if v_helper_hash is distinct from '61b920fdc9d81a9b4bcd1d221a33edab'
       or pg_catalog.strpos(
         v_helper_definition,
         'coalesce(v_ticket.processing_output_role, '''') not in ('
       ) = 0
    then
      raise exception 'TZ315_WIP_ROLE_NULL_GUARD_REPEAT_HASH_MISMATCH: %',
        v_helper_hash
        using errcode = '55000';
    end if;
  else
    if v_helper_hash is distinct from '924dea6082af7c8c76174756616858c2'
    then
      raise exception 'TZ315_WIP_ROLE_NULL_GUARD_FUNCTION_HASH_MISMATCH: %',
        v_helper_hash
        using errcode = '55000';
    end if;
    select count(*)::integer into v_anchor_count
    from pg_catalog.regexp_matches(
      v_helper_definition,
      E'or\\s+v_ticket\\.processing_output_role\\s+not in\\s*\\(',
      'g'
    );
    if v_anchor_count <> 1
       or pg_catalog.strpos(v_helper_definition, v_old) = 0
    then
      raise exception 'TZ315_WIP_ROLE_NULL_GUARD_ANCHOR_COUNT: %',
        v_anchor_count
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_helper_definition, v_old, v_new);
  end if;
end
$migration$;

do $postconditions$
declare
  v_helper_oid oid :=
    'private.tz315_processing_wip_physical_state_valid_v1(uuid)'::pg_catalog.regprocedure;
  v_helper_owner text;
  v_helper_security_definer boolean;
  v_helper_config text[];
  v_helper_definition text;
  v_helper_hash text;
begin
  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    pg_catalog.pg_get_functiondef(proc.oid)
  into
    v_helper_owner,
    v_helper_security_definer,
    v_helper_config,
    v_helper_definition
  from pg_catalog.pg_proc proc
  where proc.oid = v_helper_oid;
  v_helper_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(v_helper_definition, E'\\s+', ' ', 'g')
  ));

  if v_helper_owner is distinct from 'postgres'
     or coalesce(v_helper_security_definer, false)
     or v_helper_config is distinct from array['search_path=""']::text[]
     or v_helper_hash is distinct from '61b920fdc9d81a9b4bcd1d221a33edab'
     or pg_catalog.strpos(
       v_helper_definition,
       'TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1'
     ) = 0
     or pg_catalog.strpos(
       v_helper_definition,
       'coalesce(v_ticket.processing_output_role, '''') not in ('
     ) = 0
     or exists (
       select 1
       from pg_catalog.pg_proc helper_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           helper_proc.proacl,
           pg_catalog.acldefault('f', helper_proc.proowner)
         )
       ) helper_acl
       where helper_proc.oid = v_helper_oid
         and helper_acl.grantee = 0
         and helper_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_helper_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_helper_oid, 'EXECUTE'
     )
  then
    raise exception 'TZ315_WIP_ROLE_NULL_GUARD_POSTCONDITION_FAILED: %',
      v_helper_hash
      using errcode = '55000';
  end if;
end
$postconditions$;

notify pgrst, 'reload schema';
