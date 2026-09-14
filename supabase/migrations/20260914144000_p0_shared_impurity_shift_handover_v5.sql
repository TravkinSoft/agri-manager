-- P0: an open double-weighing ticket must survive a legitimate shift handover.
-- The first weighing remains attributed to the opening shift; the second
-- weighing and finalization are attributed to the current active session.

do $patch_shared_impurity_shift_handover$
declare
  v_definition text;
  v_old text := $needle$
  if v_ticket.shift_id is distinct from v_shift.id
     or v_ticket.created_by_person_id is distinct from v_session.person_id
  then
    raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
  end if;$needle$;
  v_new text := $replacement$
  if v_ticket.shift_id is distinct from v_shift.id then
    if v_ticket.created_by_person_id is distinct from v_session.person_id
       or not exists (
         select 1
         from public.weighbridge_shifts opening_shift
         where opening_shift.id = v_ticket.shift_id
           and opening_shift.company_id = v_ticket.company_id
           and opening_shift.operator_person_id = v_ticket.created_by_person_id
           and opening_shift.status = 'closed'
       )
    then
      raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
    end if;
  elsif v_ticket.created_by_person_id is distinct from v_session.person_id then
    raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
  end if;$replacement$;
begin
  select pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid), pg_catalog.chr(13), '')
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';

  if v_definition is null or pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'SHARED_IMPURITY_V5_HANDOVER_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$patch_shared_impurity_shift_handover$;

do $patch_shared_impurity_opening_weighing_attribution$
declare
  v_definition text;
  v_old text := $needle$
      and tw.operator_user_id = v_pool.created_by
      and tw.operator_person_id = v_session.person_id
      and tw.weighbridge_shift_id = v_shift.id$needle$;
  v_new text := $replacement$
      and tw.operator_user_id = v_pool.created_by
      and tw.operator_person_id = v_ticket.created_by_person_id
      and tw.weighbridge_shift_id = v_ticket.shift_id$replacement$;
begin
  select pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid), pg_catalog.chr(13), '')
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';

  if v_definition is null or pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'SHARED_IMPURITY_V5_GROSS_EVENT_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$patch_shared_impurity_opening_weighing_attribution$;

do $patch_shared_impurity_wrapper_early_result$
declare
  v_definition text;
  v_old text := $needle$
  v_group_id := nullif(v_result ->> 'pool_id', '')::uuid;
  if v_group_id is null then$needle$;
  v_new text := $replacement$
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;
  v_group_id := nullif(v_result ->> 'pool_id', '')::uuid;
  if v_group_id is null then$replacement$;
begin
  select pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid), pg_catalog.chr(13), '')
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';

  if v_definition is null or pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'SHARED_IMPURITY_V5_WRAPPER_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$patch_shared_impurity_wrapper_early_result$;

comment on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) is
  'Finalizes a shared impurity ticket atomically, supports same-operator shift handover, returns non-mutating confirmation/session results before member settlement, and preserves exact per-source stock identities.';

do $verify_shared_impurity_handover_v5$
declare
  v_engine text;
  v_wrapper text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)'::pg_catalog.regprocedure
  ) into v_engine;
  select pg_catalog.pg_get_functiondef(
    'public.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)'::pg_catalog.regprocedure
  ) into v_wrapper;
  if pg_catalog.strpos(v_engine, 'opening_shift.status = ''closed''') = 0
     or pg_catalog.strpos(v_engine, 'tw.weighbridge_shift_id = v_ticket.shift_id') = 0
     or pg_catalog.strpos(v_wrapper, 'return v_result') = 0
  then
    raise exception 'SHARED_IMPURITY_V5_PATCH_VERIFICATION_FAILED';
  end if;
end
$verify_shared_impurity_handover_v5$;
