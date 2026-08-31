-- TZ315 corrective for the universal processing gate preflight.
--
-- PostgreSQL ACL arrays are sets semantically, but the next immutable migration
-- used an order-sensitive text comparison. Reissue the already-approved execute
-- ACL in the canonical order it expects. This migration does not replace the
-- function, its owner, SECURITY DEFINER attribute, search_path, or any business
-- row; it fails closed if the pre-gate contract is not exactly the known one.

do $tz315_acl_order_corrective$
declare
  v_function regprocedure := 'public.finalize_weighbridge_ticket_for_session_v1(uuid)'::regprocedure;
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_definition_hash text;
  v_body_hash text;
  v_gate_present boolean;
  v_authenticated oid := 'authenticated'::regrole;
  v_service_role oid := 'service_role'::regrole;
  v_anon oid := 'anon'::regrole;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = v_function;

  select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
  v_definition_hash := pg_catalog.md5(pg_catalog.regexp_replace(v_definition, '\s+', ' ', 'g'));
  v_body_hash := pg_catalog.md5(pg_catalog.regexp_replace(v_proc.prosrc, '\s+', ' ', 'g'));
  v_gate_present := pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') > 0;

  if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.provolatile <> 'v'
     or v_proc.proparallel <> 'u'
     or v_proc.proconfig is null
     or pg_catalog.cardinality(v_proc.proconfig) <> 1
     or v_proc.proconfig[1] is distinct from 'search_path=pg_catalog, public'
     or not (
       (not v_gate_present
         and v_definition_hash = 'd653502088a41e030e391bfad9a3a04e'
         and v_body_hash = '33d7f0f183e53187288ed7976d2fd3c3')
       or
       (v_gate_present
         and v_definition_hash = 'a685c63ed8783adfad051f613cdfcead'
         and v_body_hash = 'db5ee414f7f7150970846d4853710da1')
     )
  then
    raise exception 'TZ315_UNIVERSAL_GATE_ACL_ORDER_PRECONDITION_MISMATCH'
      using errcode = '55000';
  end if;

  -- This is intentionally an ACL set comparison: ordering is not a security
  -- property. The pre-state must expose execute to precisely these principals.
  if not pg_catalog.has_function_privilege('authenticated', v_function, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_function, 'execute')
     or pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or exists (
       select 1
       from pg_catalog.aclexplode(v_proc.proacl) as acl
       where acl.privilege_type <> 'EXECUTE'
          or acl.grantee = 0
          or acl.grantee not in (v_proc.proowner, v_authenticated, v_service_role)
     )
  then
    raise exception 'TZ315_UNIVERSAL_GATE_ACL_SET_PRECONDITION_MISMATCH'
      using errcode = '55000';
  end if;
end
$tz315_acl_order_corrective$;

revoke all privileges on function public.finalize_weighbridge_ticket_for_session_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid)
  to service_role, authenticated;

do $tz315_acl_order_postcondition$
declare
  v_function regprocedure := 'public.finalize_weighbridge_ticket_for_session_v1(uuid)'::regprocedure;
  v_proc pg_catalog.pg_proc%rowtype;
  v_authenticated oid := 'authenticated'::regrole;
  v_service_role oid := 'service_role'::regrole;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = v_function;

  if not pg_catalog.has_function_privilege('authenticated', v_function, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_function, 'execute')
     or pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or exists (
       select 1
       from pg_catalog.aclexplode(v_proc.proacl) as acl
       where acl.privilege_type <> 'EXECUTE'
          or acl.grantee = 0
          or acl.grantee not in (v_proc.proowner, v_authenticated, v_service_role)
     )
     or not exists (
       select 1 from pg_catalog.aclexplode(v_proc.proacl) as acl
       where acl.grantee = v_authenticated and acl.privilege_type = 'EXECUTE'
     )
     or not exists (
       select 1 from pg_catalog.aclexplode(v_proc.proacl) as acl
       where acl.grantee = v_service_role and acl.privilege_type = 'EXECUTE'
     )
  then
    raise exception 'TZ315_UNIVERSAL_GATE_ACL_ORDER_POSTCONDITION_MISMATCH'
      using errcode = '55000';
  end if;
end
$tz315_acl_order_postcondition$;
