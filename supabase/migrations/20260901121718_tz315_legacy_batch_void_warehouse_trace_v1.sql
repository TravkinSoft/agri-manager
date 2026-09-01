-- TZ315 S19 corrective.
--
-- A legacy supplier batch can have inventory_batches.warehouse_id = NULL while
-- its immutable source receipt ledger proves the exact warehouse. Extend the
-- canonical finalized-ticket storno to recognise only that source-ticket trace.
-- No business rows are changed.

do $migration$
declare
  v_definition text;
  v_old_forward constant text := 'b.warehouse_id = sle.warehouse_id';
  v_old_reverse constant text := 'sle.warehouse_id = b.warehouse_id';
  v_old_base constant text := 'b.warehouse_id = base.warehouse_id';
  v_new_sle constant text := E'/* TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_V1 */ (\n        b.warehouse_id = sle.warehouse_id\n        or (\n          b.warehouse_id is null\n          and exists (\n            select 1\n            from public.stock_ledger_entries legacy_trace\n            where legacy_trace.company_id = b.company_id\n              and legacy_trace.ticket_id = b.source_ticket_id\n              and legacy_trace.product_id = b.product_id\n              and legacy_trace.warehouse_id = sle.warehouse_id\n              and legacy_trace.delta_qty_signed > 0\n              and coalesce(\n                legacy_trace.inventory_batch_id::text,\n                nullif(legacy_trace.batch_id_text, ''''),\n                nullif(legacy_trace.batch_id, '''')\n              ) = b.id::text\n          )\n        )\n      )';
  v_new_base constant text := E'/* TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_V1 */ (\n        b.warehouse_id = base.warehouse_id\n        or (\n          b.warehouse_id is null\n          and exists (\n            select 1\n            from public.stock_ledger_entries legacy_trace\n            where legacy_trace.company_id = b.company_id\n              and legacy_trace.ticket_id = b.source_ticket_id\n              and legacy_trace.product_id = b.product_id\n              and legacy_trace.warehouse_id = base.warehouse_id\n              and legacy_trace.delta_qty_signed > 0\n              and coalesce(\n                legacy_trace.inventory_batch_id::text,\n                nullif(legacy_trace.batch_id_text, ''''),\n                nullif(legacy_trace.batch_id, '''')\n              ) = b.id::text\n          )\n        )\n      )';
  v_marker_count integer;
  v_forward_count integer;
  v_reverse_count integer;
  v_base_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.void_ticket_with_storno_v2(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  select count(*) into v_marker_count
  from pg_catalog.regexp_matches(v_definition, 'TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_V1', 'g');
  if v_marker_count = 6 then
    return;
  end if;
  if v_marker_count <> 0 then
    raise exception 'TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_PARTIAL_PATCH|markers=%',
      v_marker_count using errcode = '55000';
  end if;

  select count(*) into v_forward_count
  from pg_catalog.regexp_matches(v_definition, v_old_forward, 'g');
  select count(*) into v_reverse_count
  from pg_catalog.regexp_matches(v_definition, v_old_reverse, 'g');
  select count(*) into v_base_count
  from pg_catalog.regexp_matches(v_definition, v_old_base, 'g');
  if v_forward_count <> 2 or v_reverse_count <> 3 or v_base_count <> 1 then
    raise exception 'TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_PREFLIGHT_FAILED|forward=%|reverse=%|base=%',
      v_forward_count, v_reverse_count, v_base_count using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_forward, v_new_sle);
  v_definition := pg_catalog.replace(v_definition, v_old_reverse, v_new_sle);
  v_definition := pg_catalog.replace(v_definition, v_old_base, v_new_base);
  execute v_definition;
end
$migration$;

comment on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  is 'Canonical server-only ticket void; legacy supplier batches require an immutable source-receipt warehouse trace.';

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
  from pg_catalog.regexp_matches(v_definition, 'TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_V1', 'g');

  if v_marker_count <> 6
     or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege('public', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
  then
    raise exception 'TZ315_LEGACY_BATCH_VOID_WAREHOUSE_TRACE_POSTCONDITION_FAILED'
      using errcode = '55000';
  end if;
end
$migration$;
