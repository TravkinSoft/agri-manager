CREATE OR REPLACE FUNCTION public.finalize_weighbridge_shared_impurity_pool_ticket_v1(p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_settlement jsonb;
  v_group_id uuid;
begin
  v_result := private.finalize_weighbridge_shared_impurity_pool_ticket_v1(
    p_ticket_id,
    p_session_token,
    p_tare_weight_kg,
    p_tare_variance_confirmed,
    p_idempotency_key
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;
  v_group_id := nullif(v_result ->> 'pool_id', '')::uuid;
  if v_group_id is null then
    select g.id into v_group_id
    from public.weighbridge_shared_impurity_groups g
    where g.ticket_id = p_ticket_id;
  end if;
  v_settlement := private.settle_shared_impurity_members_v2(v_group_id);
  return v_result || v_settlement || pg_catalog.jsonb_build_object(
    'member_resolution_status', 'proportional'
  );
end
$function$

