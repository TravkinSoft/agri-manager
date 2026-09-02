-- Keep the already-applied opening-balance migration immutable.
-- Correct the zero-source branch: unknown origin has no invented source quantity.

do $$
declare
  v_oid oid;
  v_definition text;
  v_before text := 'if v_source_with_quantity_count = v_source_count and abs(v_source_sum - v_quantity) > 0.001 then';
  v_after text := 'if v_source_count > 0 and v_source_with_quantity_count = v_source_count and abs(v_source_sum - v_quantity) > 0.001 then';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_warehouse_opening_balance_atomic_v1'
    and pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_actor_profile_id uuid, p_season_id uuid, p_document_id uuid, p_document_no text, p_snapshot_at timestamp with time zone, p_notes text, p_lines jsonb, p_idempotency_key text, p_request_fingerprint text';

  if v_oid is null then
    raise exception 'Canonical warehouse opening balance function is missing';
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if position(v_after in v_definition) > 0 then
    return;
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'Canonical warehouse opening balance function body is unexpected';
  end if;
  execute replace(v_definition, v_before, v_after);
end;
$$;

revoke all on function public.create_warehouse_opening_balance_atomic_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, text, text
) from public, anon, service_role;
grant execute on function public.create_warehouse_opening_balance_atomic_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, text, jsonb, text, text
) to authenticated;
