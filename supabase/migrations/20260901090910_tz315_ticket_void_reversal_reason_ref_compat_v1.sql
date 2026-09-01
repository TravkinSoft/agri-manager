-- TZ315 production-audit corrective.
--
-- Whole-processing reversal now identifies every compensating ledger row by
-- the exact original ledger entry in reason_ref_id. The canonical ticket-void
-- guard must recognise that collision-safe reference while remaining backward
-- compatible with receipts written by the earlier processing-id convention.
-- No business rows are changed.

do $migration$
declare
  v_definition text;
  v_old constant text := 'reversal.reason_ref_id is not distinct from base.processing_id';
  v_new constant text := E'/* TZ315_STORNO_REASON_REF_COMPAT_V1 */ (\n            reversal.reason_ref_id is not distinct from base.id\n            or reversal.reason_ref_id is not distinct from base.processing_id\n          )';
  v_old_count integer;
  v_marker_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  select count(*) into v_marker_count
  from pg_catalog.regexp_matches(v_definition, 'TZ315_STORNO_REASON_REF_COMPAT_V1', 'g');
  if v_marker_count = 3 then
    return;
  end if;
  if v_marker_count <> 0 then
    raise exception 'TZ315_TICKET_VOID_REVERSAL_REASON_REF_PARTIAL_PATCH|markers=%',
      v_marker_count using errcode = '55000';
  end if;

  select count(*) into v_old_count
  from pg_catalog.regexp_matches(v_definition, v_old, 'g');
  if v_old_count <> 3 then
    raise exception 'TZ315_TICKET_VOID_REVERSAL_REASON_REF_PREFLIGHT_FAILED|old=%',
      v_old_count using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

comment on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  is 'Canonical server-only ticket void; processing reversal accepts original-entry reason refs and legacy processing refs.';

do $migration$
declare
  v_definition text;
  v_proc pg_catalog.pg_proc%rowtype;
  v_marker_count integer;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure;

  select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
  select count(*) into v_marker_count
  from pg_catalog.regexp_matches(v_definition, 'TZ315_STORNO_REASON_REF_COMPAT_V1', 'g');

  if v_marker_count <> 3
     or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('public', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
  then
    raise exception 'TZ315_TICKET_VOID_REVERSAL_REASON_REF_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$migration$;
