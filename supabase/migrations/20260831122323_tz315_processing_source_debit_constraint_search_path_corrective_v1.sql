-- TZ315 corrective: close_processing_material_balance_v1 has an empty
-- search_path, so its deferred source-debit constraint must be schema-qualified.
-- This changes no business rows and leaves the already-applied source-debit
-- migration body immutable.

do $migration$
declare
  v_definition text;
  v_old constant text := 'execute ''set constraints trg_processing_output_source_debit_v1 immediate'';';
  v_new constant text := 'execute ''set constraints public.trg_processing_output_source_debit_v1 immediate'';';
begin
  select pg_get_functiondef(
    'public.close_processing_material_balance_v1(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  if position(v_old in v_definition) = 0
     or length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old)
  then
    raise exception
      'TZ315 source-debit constraint qualification preflight failed: expected exactly one canonical anchor'
      using errcode = '23514';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$migration$;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.close_processing_material_balance_v1(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  if position(
    'set constraints public.trg_processing_output_source_debit_v1 immediate'
    in v_definition
  ) = 0 then
    raise exception 'TZ315 source-debit constraint qualification postcondition failed'
      using errcode = '23514';
  end if;
end
$migration$;
