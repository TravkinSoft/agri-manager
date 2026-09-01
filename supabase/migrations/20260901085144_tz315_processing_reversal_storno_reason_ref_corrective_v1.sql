-- TZ315 production-audit corrective.
--
-- A processing reversal can compensate more than one original ledger row for
-- the same physical batch and resulting direction (for example processing
-- input plus an approved/ticketless process loss).  The seed/material event
-- uniqueness index is intentionally keyed by reason_ref_id, so using the
-- transformation id for every compensating row causes a false 23505 conflict.
--
-- Keep the canonical transformation trace in processing_id and use the exact
-- original ledger entry as reason_ref_id.  storno_of_entry_id remains the
-- immutable one-to-one compensation link.  No business rows are changed.

do $migration$
declare
  v_definition text;
  v_old constant text := E'''storno_processing_reversal'', v_t.id, v_entry.batch_id';
  v_new constant text := E'''storno_processing_reversal'', v_entry.id, v_entry.batch_id';
  v_old_count integer;
  v_new_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into v_definition;

  select count(*) into v_old_count
  from pg_catalog.regexp_matches(v_definition, v_old, 'g');
  select count(*) into v_new_count
  from pg_catalog.regexp_matches(v_definition, v_new, 'g');

  if v_new_count = 1 and v_old_count = 0 then
    return;
  end if;
  if v_old_count <> 1 or v_new_count <> 0 then
    raise exception 'TZ315_REVERSAL_STORNO_REASON_REF_PREFLIGHT_FAILED|old=%|new=%',
      v_old_count, v_new_count
      using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

comment on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
  is 'Canonical TZ315 processing reversal; compensating rows use original ledger entry id as reason_ref_id to coexist with seed/material event uniqueness.';

do $migration$
declare
  v_definition text;
  v_proc pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;

  select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
  if pg_catalog.strpos(
       v_definition,
       '''storno_processing_reversal'', v_entry.id, v_entry.batch_id'
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       '''storno_processing_reversal'', v_t.id, v_entry.batch_id'
     ) > 0
  then
    raise exception 'TZ315_REVERSAL_STORNO_REASON_REF_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;

  if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or not pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('postgres', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('public', v_proc.oid, 'EXECUTE')
  then
    raise exception 'TZ315_REVERSAL_STORNO_REASON_REF_SECURITY_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$migration$;
