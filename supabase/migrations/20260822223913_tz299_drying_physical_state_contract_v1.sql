-- TZ299 P0: close drying into the existing canonical AFTER_DRYING state.
-- The original TZ297 function used DRIED, which is intentionally not part of
-- inventory_batches_physical_state_v1_check. Patch only that function token.

do $migration$
declare
  v_definition text;
  v_old_token constant text := 'then ''DRIED''';
  v_new_token constant text := 'then ''AFTER_DRYING''';
begin
  select pg_get_functiondef(
    'public.close_processing_material_balance_v1(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  if position(v_new_token in v_definition) > 0 then
    return;
  end if;
  if position(v_old_token in v_definition) = 0 then
    raise exception 'TZ299 drying state preflight failed: expected DRIED token is absent';
  end if;
  if length(v_definition) - length(replace(v_definition, v_old_token, ''))
     <> length(v_old_token) then
    raise exception 'TZ299 drying state preflight failed: expected exactly one DRIED token';
  end if;

  execute replace(v_definition, v_old_token, v_new_token);
end
$migration$;

comment on function public.close_processing_material_balance_v1(uuid,uuid,text)
  is 'TZ297 material balance close; TZ299 aligns drying output with canonical AFTER_DRYING state.';
