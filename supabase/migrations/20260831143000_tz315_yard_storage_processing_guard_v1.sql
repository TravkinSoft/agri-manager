-- TZ315: ordinary YARD movements are storage movements, never implicit processing.
--
-- This migration is intentionally fail-closed. It only upgrades the exact
-- predecessor restored by 20260830223600 and leaves historical YARD processing
-- rows intact while preventing new implicit YARD outputs.

do $migration$
declare
  v_function_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_acl text[];
  v_definition text;
  v_definition_md5 text;
  v_patched_definition text;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.sync_grain_movement_shadow_v1(uuid)'
  );

  if v_function_oid is null then
    raise exception 'TZ315_YARD_STORAGE_GUARD_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    array(
      select pg_catalog.format(
        '%s:%s:%s:%s',
        case
          when acl.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(acl.grantee)
        end,
        pg_catalog.pg_get_userbyid(acl.grantor),
        acl.privilege_type,
        acl.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
      ) acl
      order by
        case
          when acl.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(acl.grantee)
        end,
        pg_catalog.pg_get_userbyid(acl.grantor),
        acl.privilege_type,
        acl.is_grantable
    ),
    pg_catalog.pg_get_functiondef(proc.oid),
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid))
  into
    v_owner,
    v_security_definer,
    v_config,
    v_acl,
    v_definition,
    v_definition_md5
  from pg_catalog.pg_proc proc
  where proc.oid = v_function_oid;

  if v_owner <> 'postgres'
     or not coalesce(v_security_definer, false)
     or v_config is distinct from array['search_path=public, pg_temp']::text[]
     or v_acl is distinct from array[
       'postgres:postgres:EXECUTE:f',
       'service_role:postgres:EXECUTE:f'
     ]::text[]
  then
    raise exception 'TZ315_YARD_STORAGE_GUARD_SECURITY_METADATA_DRIFT'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(
       v_definition,
       'TZ315_YARD_STORAGE_PROCESSING_GUARD_V1'
     ) > 0
  then
    if v_definition_md5 <> '79964ce51c6eb14f475894c6d26f4c85'
       or pg_catalog.strpos(
         v_definition,
         'if v_destination_type in (''DRYER'', ''CLEANER'') then'
       ) = 0
       or pg_catalog.strpos(
         v_definition,
         'if v_source_type in (''DRYER'', ''CLEANER'') then'
       ) = 0
       or pg_catalog.strpos(
         v_definition,
         'if v_destination_type in (''YARD'', ''DRYER'', ''CLEANER'') then'
       ) > 0
       or pg_catalog.strpos(
         v_definition,
         'if v_source_type in (''YARD'', ''DRYER'', ''CLEANER'') then'
       ) > 0
    then
      raise exception 'TZ315_YARD_STORAGE_GUARD_POSTCONDITION_DRIFT'
        using errcode = '55000';
    end if;
  elsif v_definition_md5 = '1f943fc078f4384c6064ea077aa9b643' then
    v_patched_definition := pg_catalog.replace(
      v_definition,
      '  if v_destination_type in (''YARD'', ''DRYER'', ''CLEANER'') then',
      E'  -- TZ315_YARD_STORAGE_PROCESSING_GUARD_V1\n'
        || '  if v_destination_type in (''DRYER'', ''CLEANER'') then'
    );
    v_patched_definition := pg_catalog.replace(
      v_patched_definition,
      '  if v_source_type in (''YARD'', ''DRYER'', ''CLEANER'') then',
      '  if v_source_type in (''DRYER'', ''CLEANER'') then'
    );

    if v_patched_definition = v_definition
       or pg_catalog.strpos(
         v_patched_definition,
         'TZ315_YARD_STORAGE_PROCESSING_GUARD_V1'
       ) = 0
       or pg_catalog.strpos(
         v_patched_definition,
         'if v_destination_type in (''YARD'', ''DRYER'', ''CLEANER'') then'
       ) > 0
       or pg_catalog.strpos(
         v_patched_definition,
         'if v_source_type in (''YARD'', ''DRYER'', ''CLEANER'') then'
       ) > 0
    then
      raise exception 'TZ315_YARD_STORAGE_GUARD_PATCH_ANCHOR_MISMATCH'
        using errcode = '55000';
    end if;

    execute v_patched_definition;
  else
    raise exception 'TZ315_YARD_STORAGE_GUARD_DEFINITION_DRIFT: %',
      v_definition_md5
      using errcode = '55000';
  end if;
end;
$migration$;

comment on function public.sync_grain_movement_shadow_v1(uuid) is
  'Canonical shadow reconciliation. Ordinary YARD movements remain storage; historical YARD processing rows remain intact.';

do $verify$
declare
  v_function_oid oid;
  v_definition text;
  v_definition_md5 text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_acl text[];
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.sync_grain_movement_shadow_v1(uuid)'
  );

  select
    pg_catalog.pg_get_functiondef(proc.oid),
    pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid)),
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    array(
      select pg_catalog.format(
        '%s:%s:%s:%s',
        case
          when acl.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(acl.grantee)
        end,
        pg_catalog.pg_get_userbyid(acl.grantor),
        acl.privilege_type,
        acl.is_grantable
      )
      from pg_catalog.aclexplode(
        coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
      ) acl
      order by
        case
          when acl.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(acl.grantee)
        end,
        pg_catalog.pg_get_userbyid(acl.grantor),
        acl.privilege_type,
        acl.is_grantable
    )
  into
    v_definition,
    v_definition_md5,
    v_owner,
    v_security_definer,
    v_config,
    v_acl
  from pg_catalog.pg_proc proc
  where proc.oid = v_function_oid;

  if v_function_oid is null
     or v_definition_md5 <> '79964ce51c6eb14f475894c6d26f4c85'
     or pg_catalog.strpos(
       coalesce(v_definition, ''),
       'TZ315_YARD_STORAGE_PROCESSING_GUARD_V1'
     ) = 0
     or pg_catalog.strpos(
       coalesce(v_definition, ''),
       'if v_destination_type in (''DRYER'', ''CLEANER'') then'
     ) = 0
     or pg_catalog.strpos(
       coalesce(v_definition, ''),
       'if v_source_type in (''DRYER'', ''CLEANER'') then'
     ) = 0
     or v_owner <> 'postgres'
     or not coalesce(v_security_definer, false)
     or v_config is distinct from array['search_path=public, pg_temp']::text[]
     or v_acl is distinct from array[
       'postgres:postgres:EXECUTE:f',
       'service_role:postgres:EXECUTE:f'
     ]::text[]
  then
    raise exception 'TZ315_YARD_STORAGE_GUARD_VERIFICATION_FAILED'
      using errcode = '55000';
  end if;
end;
$verify$;
