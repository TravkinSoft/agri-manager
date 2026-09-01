-- TZ315 production-audit corrective.
--
-- A processing output ticket can become the canonical input document of a
-- downstream processing cycle. Once that downstream cycle has an immutable
-- reversal receipt, the parent reversal may safely continue. An unreversed or
-- unrelated downstream link remains fail-closed. No business rows are changed.

do $migration$
declare
  v_definition text;
  v_old constant text := 'tk.linked_processing_id is distinct from v_t.id';
  v_new constant text := E'/* TZ315_REVERSED_DOWNSTREAM_CHAIN_V1 */ (\n          tk.linked_processing_id is distinct from v_t.id\n          and not exists (\n            select 1\n            from public.batch_transformation_inputs downstream_input\n            join public.batch_processing_reversals downstream_reversal\n              on downstream_reversal.transformation_id = downstream_input.transformation_id\n             and downstream_reversal.company_id = v_t.company_id\n             and downstream_reversal.season_id = v_t.season_id\n            where downstream_input.source_ticket_id = tk.id\n              and downstream_input.transformation_id = tk.linked_processing_id\n              and downstream_input.company_id = v_t.company_id\n          )\n        )';
  v_old_count integer;
  v_marker_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure
  ) into v_definition;

  select count(*) into v_marker_count
  from pg_catalog.regexp_matches(v_definition, 'TZ315_REVERSED_DOWNSTREAM_CHAIN_V1', 'g');
  if v_marker_count = 2 then
    return;
  end if;
  if v_marker_count <> 0 then
    raise exception 'TZ315_REVERSAL_DOWNSTREAM_CHAIN_PARTIAL_PATCH|markers=%',
      v_marker_count using errcode = '55000';
  end if;

  select count(*) into v_old_count
  from pg_catalog.regexp_matches(v_definition, v_old, 'g');
  if v_old_count <> 2 then
    raise exception 'TZ315_REVERSAL_DOWNSTREAM_CHAIN_PREFLIGHT_FAILED|old=%',
      v_old_count using errcode = '55000';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

comment on function public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)
  is 'Canonical TZ315 processing reversal; parent may reverse only after a linked downstream cycle has an immutable reversal receipt.';

do $migration$
declare
  v_definition text;
  v_proc pg_catalog.pg_proc%rowtype;
  v_marker_count integer;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;

  select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
  select count(*) into v_marker_count
  from pg_catalog.regexp_matches(v_definition, 'TZ315_REVERSED_DOWNSTREAM_CHAIN_V1', 'g');

  if v_marker_count <> 2
     or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('public', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
  then
    raise exception 'TZ315_REVERSAL_DOWNSTREAM_CHAIN_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$migration$;
