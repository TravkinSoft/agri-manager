-- Operations V1.3 final role cards and warehouse responsibility boundaries.
-- This migration is first applied only to the assistant QA branch.

alter table public.operation_mutation_receipts
  drop constraint if exists operation_mutation_receipts_action_check;
alter table public.operation_mutation_receipts
  add constraint operation_mutation_receipts_action_check check (
    action in (
      'create',
      'create_v12',
      'activate',
      'material_request',
      'material_edit',
      'request_stage',
      'request_admin_v13',
      'issue',
      'return',
      'warehouse_return_v13',
      'progress',
      'progress_v12',
      'complete',
      'finish_v12',
      'finish_v13',
      'variance_review'
    )
  );

create or replace function public.update_material_request_stage_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_action text,
  p_source_warehouse_id uuid,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_request public.warehouse_issue_requests%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_input jsonb;
  v_response jsonb;
  v_prepared numeric;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  if p_action <> 'ready' then
    raise exception 'Warehouse can only mark a request ready'
      using errcode = '22023';
  end if;
  if p_source_warehouse_id is null then
    raise exception 'Source warehouse is required before materials can be marked ready'
      using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'request_stage', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;
  if v_request.status not in ('new', 'active', 'preparing', 'ready') then
    raise exception 'Material request cannot be prepared in its current stage'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id and w.company_id = p_company_id
  ) then
    raise exception 'Source warehouse does not belong to the target company'
      using errcode = '23503';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Prepared quantities are required before materials can be marked ready'
      using errcode = '22023';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  if exists (
    select 1
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id
      and i.company_id = p_company_id
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
        where x ->> 'item_id' = i.id::text
      )
  ) then
    raise exception 'Prepared quantity is required for every request item'
      using errcode = '23514';
  end if;

  for v_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Prepared item does not belong to the request'
        using errcode = '23503';
    end if;
    v_prepared := coalesce((v_input ->> 'prepared_quantity')::numeric, 0);
    if v_prepared < 0 then
      raise exception 'Prepared quantity must be zero or positive'
        using errcode = '23514';
    end if;

    update public.warehouse_issue_request_items
    set prepared_quantity = round(v_prepared, 4),
        prepared_unit = unit,
        package_size = null,
        package_count = null,
        package_unit = null,
        reconciliation_status = 'prepared'
    where id = v_item.id;
  end loop;

  if not exists (
    select 1
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id
      and i.company_id = p_company_id
      and coalesce(i.prepared_quantity, 0) > 0.000001
  ) then
    raise exception 'At least one prepared quantity must be greater than zero'
      using errcode = '23514';
  end if;

  update public.warehouse_issue_requests
  set status = 'ready',
      warehouse_request_status = 'ready_for_pickup',
      source_warehouse_id = p_source_warehouse_id,
      prepared_at = coalesce(prepared_at, now()),
      ready_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'request_ready_atomic',
    jsonb_build_object(
      'status', v_request.status,
      'source_warehouse_id', p_source_warehouse_id,
      'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb))
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'workflow_status', 'ready'
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'request_stage',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.update_material_request_stage_atomic_v1(
  uuid, uuid, uuid, text, uuid, jsonb, text, text
) from public, anon;
grant execute on function public.update_material_request_stage_atomic_v1(
  uuid, uuid, uuid, text, uuid, jsonb, text, text
) to authenticated;

create or replace function public.replace_operation_materials_atomic_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_operation_patch jsonb,
  p_materials jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_material jsonb;
  v_request_materials jsonb := '[]'::jsonb;
  v_direct_materials jsonb := '[]'::jsonb;
  v_material_rows jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(value), '[]'::jsonb)
    into v_request_materials
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  where coalesce(value ->> 'material_type', '') in (
    'fertilizer', 'pesticide', 'adjuvant', 'ph_corrector',
    'defoamer', 'biological', 'organic', 'other'
  );

  select coalesce(jsonb_agg(value), '[]'::jsonb)
    into v_direct_materials
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  where coalesce(value ->> 'material_type', '') in ('seed', 'fuel', 'water');

  v_base := public.replace_operation_materials_atomic_v1(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    p_operation_patch,
    v_request_materials,
    p_idempotency_key || ':v13-core',
    p_request_fingerprint
  );

  for v_material in
    select value from jsonb_array_elements(v_direct_materials)
  loop
    if coalesce((v_material ->> 'planned_quantity')::numeric, 0) <= 0 then
      raise exception 'Every operation material requires a positive planned quantity'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.operation_materials m
      where m.company_id = p_company_id
        and m.operation_id = p_operation_id
        and m.product_id = (v_material ->> 'product_id')::uuid
        and m.material_type = v_material ->> 'material_type'
    ) then
      insert into public.operation_materials (
        company_id, operation_id, operation_line_id, product_id, batch_id,
        material_type, unit, planned_rate, actual_rate, planned_quantity,
        issued_quantity, notes, created_by_user_id, updated_by_user_id
      ) values (
        p_company_id,
        p_operation_id,
        nullif(v_material ->> 'operation_line_id', '')::uuid,
        (v_material ->> 'product_id')::uuid,
        nullif(v_material ->> 'batch_id', '')::uuid,
        v_material ->> 'material_type',
        v_material ->> 'unit',
        nullif(v_material ->> 'planned_rate', '')::numeric,
        nullif(v_material ->> 'actual_rate', '')::numeric,
        (v_material ->> 'planned_quantity')::numeric,
        0,
        nullif(v_material ->> 'notes', ''),
        auth.uid(),
        auth.uid()
      );
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_material_rows
  from public.operation_materials m
  where m.company_id = p_company_id and m.operation_id = p_operation_id;

  return v_base || jsonb_build_object(
    'operation_materials', v_material_rows,
    'material_logistics', jsonb_build_object(
      'warehouse_request_rows', jsonb_array_length(v_request_materials),
      'weighbridge_seed_rows', (
        select count(*)
        from jsonb_array_elements(v_direct_materials)
        where value ->> 'material_type' = 'seed'
      )
    )
  );
end;
$$;

revoke all on function public.replace_operation_materials_atomic_v13(
  uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.replace_operation_materials_atomic_v13(
  uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.ensure_operation_material_request_atomic_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_response jsonb;
  v_request_id uuid;
begin
  select count(*) into v_count
  from public.operation_materials m
  where m.company_id = p_company_id
    and m.operation_id = p_operation_id
    and m.material_type in (
      'fertilizer', 'pesticide', 'adjuvant', 'ph_corrector',
      'defoamer', 'biological', 'organic', 'other'
    );
  if v_count = 0 then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'material_request', jsonb_build_object(
        'created', false,
        'skipped_reason', 'no_warehouse_managed_materials'
      )
    );
  end if;

  v_response := public.ensure_operation_material_request_atomic_v1(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    p_idempotency_key || ':v13-core',
    p_request_fingerprint
  );
  v_request_id := nullif(v_response -> 'material_request' ->> 'request_id', '')::uuid;
  if v_request_id is not null then
    delete from public.warehouse_issue_request_items i
    where i.request_id = v_request_id
      and i.company_id = p_company_id
      and coalesce(i.product_category, '') in ('seed', 'seed_planting_material');
  end if;
  return v_response;
end;
$$;

revoke all on function public.ensure_operation_material_request_atomic_v13(
  uuid, uuid, uuid, text, text
) from public, anon;
grant execute on function public.ensure_operation_material_request_atomic_v13(
  uuid, uuid, uuid, text, text
) to authenticated;

create or replace function public.advance_operation_after_material_reconciliation_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.operations%rowtype;
  v_pending public.operation_completion_requests%rowtype;
  v_material_rows jsonb;
  v_response jsonb;
begin
  if p_operation_id is null then
    return jsonb_build_object('advanced', false, 'reason', 'operation_missing');
  end if;
  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found or coalesce(v_operation.operation_status, '') <> 'ready_to_close' then
    return jsonb_build_object('advanced', false, 'reason', 'operation_not_waiting');
  end if;
  if exists (
    select 1
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
      and coalesce(i.reconciliation_status, 'pending') <> 'reconciled'
  ) then
    return jsonb_build_object('advanced', false, 'reason', 'reconciliation_pending');
  end if;

  select * into v_pending
  from public.operation_completion_requests
  where operation_id = p_operation_id
    and company_id = p_company_id
    and status = 'pending'
  order by requested_at desc
  limit 1
  for update;
  if found then
    update public.operations
    set operation_status = 'awaiting_approval',
        specialist_task_status = 'awaiting_approval',
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
    return jsonb_build_object(
      'advanced', true,
      'awaiting_agronomist_approval', true,
      'operation', to_jsonb(v_operation),
      'completion_request_id', v_pending.id
    );
  end if;

  v_material_rows := public.operation_completion_dependencies_v12(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    '[]'::jsonb
  );
  v_response := public.finalize_operation_result_v12(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    coalesce(nullif(btrim(v_operation.specialist_comment), ''), 'Completed after material reconciliation'),
    v_material_rows
  );
  return jsonb_build_object(
    'advanced', true,
    'completed', true,
    'result', v_response
  );
end;
$$;

revoke all on function public.advance_operation_after_material_reconciliation_v13(
  uuid, uuid, uuid
) from public, anon, authenticated;

create or replace function public.finish_operation_atomic_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_shift_completed_area_ha numeric,
  p_variance_reason text,
  p_comment text,
  p_material_facts jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_operation public.operations%rowtype;
  v_deviation numeric;
  v_request public.operation_completion_requests%rowtype;
  v_response jsonb;
  v_unreconciled integer;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  if coalesce(p_shift_completed_area_ha, 0) < 0 then
    raise exception 'Current shift area cannot be negative' using errcode = '22023';
  end if;
  if nullif(btrim(p_comment), '') is null then
    raise exception 'Completion comment is required' using errcode = '22023';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'finish_v13', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'already_completed', true);
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'finish_v13', p_operation_id, p_idempotency_key,
      p_request_fingerprint, p_actor_profile_id, v_response
    );
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id,
      p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist']::text[]
    );
  end if;

  if coalesce(p_shift_completed_area_ha, 0) > 0 then
    perform public.save_operation_progress_atomic_v12(
      p_company_id,
      p_actor_profile_id,
      p_operation_id,
      p_shift_completed_area_ha,
      null,
      p_comment,
      null,
      p_idempotency_key || ':finish-progress',
      p_request_fingerprint
    );
  end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if coalesce(v_operation.completed_area_ha, 0) <= 0 then
    raise exception 'Actual area is required before completion' using errcode = '23514';
  end if;
  v_deviation := round(v_operation.completed_area_ha - v_operation.planned_area_ha, 4);
  if abs(v_deviation) > 0.0001 and nullif(btrim(p_variance_reason), '') is null then
    raise exception 'Variance reason is required when actual area differs from plan'
      using errcode = '22023';
  end if;

  select count(*) into v_unreconciled
  from public.warehouse_issue_request_items i
  join public.warehouse_issue_requests r on r.id = i.request_id
  where r.operation_id = p_operation_id
    and r.company_id = p_company_id
    and i.company_id = p_company_id
    and coalesce(r.warehouse_request_status, '') <> 'cancelled'
    and coalesce(i.reconciliation_status, 'pending') <> 'reconciled';

  if v_unreconciled > 0 then
    if abs(v_deviation) > 0.0001 then
      update public.operation_completion_requests
      set status = 'rejected',
          reviewed_at = coalesce(reviewed_at, now()),
          review_comment = coalesce(review_comment, 'Superseded by a new specialist submission'),
          updated_at = now()
      where operation_id = p_operation_id
        and company_id = p_company_id
        and status = 'pending';
      insert into public.operation_completion_requests (
        company_id, operation_id, requested_by,
        planned_area_ha, actual_area_ha, deviation_area_ha,
        variance_reason, specialist_comment, material_facts
      ) values (
        p_company_id,
        p_operation_id,
        p_actor_profile_id,
        round(v_operation.planned_area_ha, 4),
        round(v_operation.completed_area_ha, 4),
        v_deviation,
        btrim(p_variance_reason),
        btrim(p_comment),
        '[]'::jsonb
      ) returning * into v_request;
    end if;

    update public.operations
    set status = 'in_progress',
        work_status = 'in_progress',
        operation_status = 'ready_to_close',
        specialist_task_status = 'ready_to_close',
        specialist_comment = btrim(p_comment),
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;

    insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
    values (
      p_company_id,
      p_actor_profile_id,
      'operation',
      p_operation_id::text,
      'operation_waiting_material_reconciliation_v13',
      jsonb_build_object(
        'planned_area_ha', v_operation.planned_area_ha,
        'actual_area_ha', v_operation.completed_area_ha,
        'deviation_area_ha', v_deviation,
        'completion_request_id', v_request.id
      )
    );
    v_response := jsonb_build_object(
      'operation', to_jsonb(v_operation),
      'waiting_material_reconciliation', true,
      'completion_request', case
        when v_request.id is null then null
        else to_jsonb(v_request)
      end
    );
  else
    v_response := public.finish_operation_atomic_v12(
      p_company_id,
      p_actor_profile_id,
      p_operation_id,
      0,
      p_variance_reason,
      p_comment,
      coalesce(p_material_facts, '[]'::jsonb),
      p_idempotency_key || ':v12-finalize',
      p_request_fingerprint
    );
  end if;

  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'finish_v13',
    p_operation_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.finish_operation_atomic_v13(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, text
) from public, anon;
grant execute on function public.finish_operation_atomic_v13(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, text
) to authenticated;

create or replace function public.reconcile_material_return_by_warehouse_atomic_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_close_without_return boolean,
  p_items jsonb,
  p_transactions jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_request public.warehouse_issue_requests%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_input jsonb;
  v_tx jsonb;
  v_tx_id uuid;
  v_return numeric;
  v_next_return numeric;
  v_next_consumed numeric;
  v_tx_return numeric;
  v_operation_advance jsonb;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'warehouse_return_v13', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;
  if v_request.status not in ('issued', 'issued_by_warehouse', 'partially_issued') then
    raise exception 'Physical return is allowed only after warehouse issue'
      using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is null then
    raise exception 'Source warehouse is required for physical return'
      using errcode = '23514';
  end if;
  if not coalesce(p_close_without_return, false)
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
       where coalesce((x ->> 'returned_quantity')::numeric, 0) > 0.000001
     ) then
    raise exception 'Physical return quantity is required'
      using errcode = '22023';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  for v_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Return item does not belong to the request'
        using errcode = '23503';
    end if;
    v_return := coalesce((v_input ->> 'returned_quantity')::numeric, 0);
    if v_return < 0 then
      raise exception 'Return quantity must be zero or positive'
        using errcode = '23514';
    end if;
    v_next_return := coalesce(v_item.return_received_quantity, 0) + v_return;
    if v_next_return + coalesce(v_item.loss_quantity, 0)
       > coalesce(v_item.issued_quantity, 0) + 0.000001 then
      raise exception 'Return and loss exceed issued quantity'
        using errcode = '23514';
    end if;

    select coalesce(sum((tx ->> 'quantity_input')::numeric), 0)
      into v_tx_return
    from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) tx
    where tx ->> 'warehouse_issue_request_item_id' = v_item.id::text;
    if abs(v_tx_return - v_return) > 0.0001 then
      raise exception 'Return ledger payload does not match physical quantity'
        using errcode = '23514';
    end if;
  end loop;

  for v_tx in
    select value from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb))
  loop
    insert into public.inventory_transactions (
      warehouse_id, source_warehouse_id, destination_warehouse_id,
      product_id, quantity, base_quantity_kg,
      transaction_type, movement_type, status, operation_datetime, date, notes,
      responsible_user_id, confirmed_at, user_id, company_id,
      warehouse_issue_request_id, warehouse_issue_request_item_id,
      operation_id, field_id, quantity_input, input_uom,
      base_quantity, base_uom, mass_kg, density_kg_per_l, density_unit,
      density_source, density_verification_status, density_verified_at,
      batch_class, unit_source, unit_contract_version
    ) values (
      v_request.source_warehouse_id, null, v_request.source_warehouse_id,
      (v_tx ->> 'product_id')::uuid,
      (v_tx ->> 'quantity')::numeric,
      nullif(v_tx ->> 'base_quantity_kg', '')::numeric,
      'in', 'adjustment', 'confirmed', now(), current_date,
      coalesce(nullif(v_tx ->> 'notes', ''), 'Physical warehouse return'),
      v_request.assigned_specialist_id, now(), auth.uid(), p_company_id,
      p_request_id, (v_tx ->> 'warehouse_issue_request_item_id')::uuid,
      v_request.operation_id, v_request.field_id,
      (v_tx ->> 'quantity_input')::numeric, v_tx ->> 'input_uom',
      nullif(v_tx ->> 'base_quantity', '')::numeric,
      nullif(v_tx ->> 'base_uom', ''),
      nullif(v_tx ->> 'mass_kg', '')::numeric,
      nullif(v_tx ->> 'density_kg_per_l', '')::numeric,
      nullif(v_tx ->> 'density_unit', ''),
      nullif(v_tx ->> 'density_source', ''),
      nullif(v_tx ->> 'density_verification_status', ''),
      nullif(v_tx ->> 'density_verified_at', '')::timestamptz,
      nullif(v_tx ->> 'batch_class', ''),
      nullif(v_tx ->> 'unit_source', ''),
      nullif(v_tx ->> 'unit_contract_version', '')::smallint
    ) returning id into v_tx_id;
    perform public.post_inventory_transaction_to_ledger(v_tx_id);
  end loop;

  for v_item in
    select *
    from public.warehouse_issue_request_items
    where request_id = p_request_id and company_id = p_company_id
    order by created_at, id
    for update
  loop
    select coalesce((value ->> 'returned_quantity')::numeric, 0)
      into v_return
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    where value ->> 'item_id' = v_item.id::text
    limit 1;
    v_return := coalesce(v_return, 0);
    v_next_return := coalesce(v_item.return_received_quantity, 0) + v_return;
    v_next_consumed := greatest(
      coalesce(v_item.issued_quantity, 0)
      - v_next_return
      - coalesce(v_item.loss_quantity, 0),
      0
    );

    update public.warehouse_issue_request_items
    set returned_quantity = round(v_next_return, 4),
        return_received_quantity = round(v_next_return, 4),
        consumed_quantity = round(v_next_consumed, 4),
        shortage_quantity = 0,
        reconciliation_status = 'reconciled',
        return_comment = case
          when coalesce(p_close_without_return, false)
            then 'Warehouse confirmed that there is no physical return'
          else 'Physical return accepted by warehouse'
        end
    where id = v_item.id;
  end loop;

  update public.operation_materials m
  set consumed_quantity = q.consumed_quantity,
      returned_quantity = q.returned_quantity,
      loss_quantity = q.loss_quantity,
      actual_rate = case
        when coalesce(o.completed_area_ha, 0) > 0
          then round(q.consumed_quantity / o.completed_area_ha, 4)
        else m.actual_rate
      end,
      updated_by_user_id = auth.uid(),
      updated_at = now()
  from (
    select i.product_id,
           sum(coalesce(i.consumed_quantity, 0)) as consumed_quantity,
           sum(coalesce(i.returned_quantity, 0)) as returned_quantity,
           sum(coalesce(i.loss_quantity, 0)) as loss_quantity
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id and i.company_id = p_company_id
    group by i.product_id
  ) q,
  public.operations o
  where m.operation_id = v_request.operation_id
    and m.company_id = p_company_id
    and m.product_id = q.product_id
    and o.id = m.operation_id;

  update public.warehouse_issue_requests
  set warehouse_request_status = 'closed',
      return_expected_at = coalesce(return_expected_at, now()),
      return_received_at = case
        when jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)) > 0
          then now()
        else return_received_at
      end,
      return_closed_at = now(),
      return_received_by_user_id = p_actor_profile_id,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  v_operation_advance := public.advance_operation_after_material_reconciliation_v13(
    p_company_id,
    p_actor_profile_id,
    v_request.operation_id
  );

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'warehouse_return_reconciled_atomic_v13',
    jsonb_build_object(
      'close_without_return', coalesce(p_close_without_return, false),
      'transaction_count', jsonb_array_length(coalesce(p_transactions, '[]'::jsonb))
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'reconciled', true,
    'operation_advance', v_operation_advance
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'warehouse_return_v13',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.reconcile_material_return_by_warehouse_atomic_v13(
  uuid, uuid, uuid, boolean, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.reconcile_material_return_by_warehouse_atomic_v13(
  uuid, uuid, uuid, boolean, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.admin_transition_material_request_atomic_v13(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_action text,
  p_reason text,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_request public.warehouse_issue_requests%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_input jsonb;
  v_loss numeric;
  v_next_loss numeric;
  v_consumed numeric;
  v_unreconciled integer;
  v_operation_advance jsonb;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin']::text[]
  );
  if p_action not in ('return_to_preparation', 'cancel', 'record_loss') then
    raise exception 'Unsupported admin request action' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Admin reason is required' using errcode = '22023';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'request_admin_v13', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  if p_action in ('return_to_preparation', 'cancel') then
    if v_request.status in ('issued', 'issued_by_warehouse', 'partially_issued', 'received_confirmed') then
      raise exception 'Issued request cannot be returned or cancelled'
        using errcode = '23514';
    end if;
    update public.warehouse_issue_requests
    set status = case when p_action = 'cancel' then 'cancelled' else 'active' end,
        warehouse_request_status = case when p_action = 'cancel' then 'cancelled' else 'pending' end,
        ready_at = case when p_action = 'return_to_preparation' then null else ready_at end,
        cancelled_at = case when p_action = 'cancel' then now() else cancelled_at end,
        comment = concat_ws(E'\n', nullif(comment, ''), 'ADMIN: ' || btrim(p_reason)),
        updated_at = now()
    where id = p_request_id
    returning * into v_request;

    if p_action = 'return_to_preparation' then
      update public.warehouse_issue_request_items
      set reconciliation_status = 'pending'
      where request_id = p_request_id and company_id = p_company_id;
    else
      update public.warehouse_issue_request_items
      set reconciliation_status = 'cancelled'
      where request_id = p_request_id and company_id = p_company_id;
    end if;
  else
    if v_request.status not in ('issued', 'issued_by_warehouse', 'partially_issued') then
      raise exception 'Loss can only be recorded after warehouse issue'
        using errcode = '23514';
    end if;
    if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
      raise exception 'Loss items are required' using errcode = '22023';
    end if;

    for v_input in
      select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
      select * into v_item
      from public.warehouse_issue_request_items
      where id = (v_input ->> 'item_id')::uuid
        and request_id = p_request_id
        and company_id = p_company_id
      for update;
      if not found then
        raise exception 'Loss item does not belong to the request'
          using errcode = '23503';
      end if;
      v_loss := coalesce((v_input ->> 'loss_quantity')::numeric, 0);
      if v_loss <= 0 then
        raise exception 'Loss quantity must be greater than zero'
          using errcode = '23514';
      end if;
      v_next_loss := coalesce(v_item.loss_quantity, 0) + v_loss;
      if v_next_loss + coalesce(v_item.return_received_quantity, 0)
         > coalesce(v_item.issued_quantity, 0) + 0.000001 then
        raise exception 'Loss and return exceed issued quantity'
          using errcode = '23514';
      end if;
      v_consumed := greatest(
        coalesce(v_item.issued_quantity, 0)
        - coalesce(v_item.return_received_quantity, 0)
        - v_next_loss,
        0
      );
      update public.warehouse_issue_request_items
      set loss_quantity = round(v_next_loss, 4),
          loss_reason = btrim(p_reason),
          loss_comment = btrim(p_reason),
          consumed_quantity = round(v_consumed, 4),
          returned_quantity = coalesce(return_received_quantity, 0),
          shortage_quantity = 0,
          reconciliation_status = 'reconciled'
      where id = v_item.id;
    end loop;

    update public.operation_materials m
    set consumed_quantity = q.consumed_quantity,
        returned_quantity = q.returned_quantity,
        loss_quantity = q.loss_quantity,
        actual_rate = case
          when coalesce(o.completed_area_ha, 0) > 0
            then round(q.consumed_quantity / o.completed_area_ha, 4)
          else m.actual_rate
        end,
        updated_by_user_id = auth.uid(),
        updated_at = now()
    from (
      select i.product_id,
             sum(coalesce(i.consumed_quantity, 0)) as consumed_quantity,
             sum(coalesce(i.returned_quantity, 0)) as returned_quantity,
             sum(coalesce(i.loss_quantity, 0)) as loss_quantity
      from public.warehouse_issue_request_items i
      where i.request_id = p_request_id and i.company_id = p_company_id
      group by i.product_id
    ) q,
    public.operations o
    where m.operation_id = v_request.operation_id
      and m.company_id = p_company_id
      and m.product_id = q.product_id
      and o.id = m.operation_id;

    select count(*) into v_unreconciled
    from public.warehouse_issue_request_items
    where request_id = p_request_id
      and company_id = p_company_id
      and coalesce(reconciliation_status, 'pending') <> 'reconciled';
    if v_unreconciled = 0 then
      update public.warehouse_issue_requests
      set warehouse_request_status = 'closed',
          return_closed_at = now(),
          updated_at = now()
      where id = p_request_id
      returning * into v_request;
      v_operation_advance := public.advance_operation_after_material_reconciliation_v13(
        p_company_id,
        p_actor_profile_id,
        v_request.operation_id
      );
    end if;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'request_admin_' || p_action || '_atomic_v13',
    jsonb_build_object(
      'reason', btrim(p_reason),
      'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb))
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'action', p_action,
    'reason', btrim(p_reason),
    'operation_advance', v_operation_advance
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'request_admin_v13',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.admin_transition_material_request_atomic_v13(
  uuid, uuid, uuid, text, text, jsonb, text, text
) from public, anon;
grant execute on function public.admin_transition_material_request_atomic_v13(
  uuid, uuid, uuid, text, text, jsonb, text, text
) to authenticated;

create or replace function public.operation_completion_dependencies_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_material_facts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.operations%rowtype;
  v_material public.operation_materials%rowtype;
  v_seed_quantity numeric;
  v_item_count integer;
  v_issued numeric;
  v_consumed numeric;
  v_returned numeric;
  v_loss numeric;
  v_unreconciled integer;
  v_material_rows jsonb := '[]'::jsonb;
begin
  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.operation_materials m
  where m.operation_id = p_operation_id and m.company_id = p_company_id
  for update;
  perform 1
  from public.warehouse_issue_requests r
  where r.operation_id = p_operation_id and r.company_id = p_company_id
  for update;
  perform 1
  from public.warehouse_issue_request_items i
  join public.warehouse_issue_requests r on r.id = i.request_id
  where r.operation_id = p_operation_id and i.company_id = p_company_id
  for update of i;

  if exists (
    select 1
    from public.operation_materials m
    where m.operation_id = p_operation_id
      and m.company_id = p_company_id
      and m.material_type in (
        'fertilizer', 'pesticide', 'adjuvant', 'ph_corrector',
        'defoamer', 'biological', 'organic', 'other'
      )
  ) and not exists (
    select 1
    from public.warehouse_issue_requests r
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
  ) then
    raise exception 'Material request is missing for agrochemical materials'
      using errcode = '23514';
  end if;

  for v_material in
    select *
    from public.operation_materials
    where operation_id = p_operation_id and company_id = p_company_id
    order by created_at, id
    for update
  loop
    if v_material.material_type = 'seed' then
      select coalesce(sum(coalesce(tl.quantity, tl.net_line_weight_kg, 0)), 0)
        into v_seed_quantity
      from public.tickets t
      join public.ticket_lines tl on tl.ticket_id = t.id
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and t.op_type = 'issue_to_field'
        and t.is_finalized = true
        and coalesce(t.is_voided, false) = false
        and tl.product_id = v_material.product_id;
      if v_seed_quantity <= 0.000001 then
        raise exception 'Finalized weighbridge seed issue is required before completion'
          using errcode = '23514';
      end if;
      update public.operation_materials
      set issued_quantity = round(v_seed_quantity, 4),
          consumed_quantity = round(v_seed_quantity, 4),
          returned_quantity = 0,
          loss_quantity = 0,
          actual_rate = case
            when coalesce(v_operation.completed_area_ha, 0) > 0
              then round(v_seed_quantity / v_operation.completed_area_ha, 4)
            else null
          end,
          updated_by_user_id = auth.uid(),
          updated_at = now()
      where id = v_material.id;
      v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
        'material_id', v_material.id,
        'product_id', v_material.product_id,
        'source', 'weighbridge',
        'planned_quantity', coalesce(v_material.planned_quantity, 0),
        'issued_quantity', v_seed_quantity,
        'consumed_quantity', v_seed_quantity,
        'returned_quantity', 0,
        'loss_quantity', 0
      ));
      continue;
    end if;

    if v_material.material_type in ('water', 'fuel') then
      continue;
    end if;

    select count(*),
           coalesce(sum(coalesce(i.issued_quantity, 0)), 0),
           coalesce(sum(coalesce(i.consumed_quantity, 0)), 0),
           coalesce(sum(coalesce(i.returned_quantity, 0)), 0),
           coalesce(sum(coalesce(i.loss_quantity, 0)), 0),
           count(*) filter (
             where coalesce(i.reconciliation_status, 'pending') <> 'reconciled'
           )
      into v_item_count, v_issued, v_consumed, v_returned, v_loss, v_unreconciled
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and i.product_id = v_material.product_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled';

    if v_item_count = 0 then
      raise exception 'Warehouse request item is missing for operation material'
        using errcode = '23514';
    end if;
    if v_unreconciled > 0 then
      raise exception 'Material reconciliation is required before operation close'
        using errcode = '23514';
    end if;
    if abs(v_issued - v_consumed - v_returned - v_loss) > 0.0001 then
      raise exception 'Material reconciliation failed: issued must equal consumed plus returned plus loss'
        using errcode = '23514';
    end if;

    update public.operation_materials
    set issued_quantity = round(v_issued, 4),
        consumed_quantity = round(v_consumed, 4),
        returned_quantity = round(v_returned, 4),
        loss_quantity = round(v_loss, 4),
        actual_rate = case
          when coalesce(v_operation.completed_area_ha, 0) > 0
            then round(v_consumed / v_operation.completed_area_ha, 4)
          else actual_rate
        end,
        updated_by_user_id = auth.uid(),
        updated_at = now()
    where id = v_material.id;

    v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
      'material_id', v_material.id,
      'product_id', v_material.product_id,
      'source', 'warehouse',
      'planned_quantity', coalesce(v_material.planned_quantity, 0),
      'issued_quantity', v_issued,
      'consumed_quantity', v_consumed,
      'returned_quantity', v_returned,
      'loss_quantity', v_loss,
      'actual_rate', case
        when coalesce(v_operation.completed_area_ha, 0) > 0
          then round(v_consumed / v_operation.completed_area_ha, 4)
        else null
      end
    ));
  end loop;

  if exists (
    select 1
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
      and coalesce(i.reconciliation_status, 'pending') <> 'reconciled'
  ) then
    raise exception 'Material reconciliation is required before operation close'
      using errcode = '23514';
  end if;

  if coalesce(v_operation.operation_category_slug, '') = 'harvesting'
     or coalesce(v_operation.operation_type_slug, '') = 'harvesting' then
    if exists (
      select 1
      from public.tickets t
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and coalesce(t.is_voided, false) = false
        and not (t.is_finalized or t.status::text in ('finalized', 'closed'))
    ) then
      raise exception 'Linked weighbridge tickets must be finalized before harvest completion'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.tickets t
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and t.op_type = 'harvest_incoming'
        and coalesce(t.is_voided, false) = false
        and (t.is_finalized or t.status::text in ('finalized', 'closed'))
    ) then
      raise exception 'Finalized harvest weighbridge ticket is required before completion'
        using errcode = '23514';
    end if;
  end if;

  return v_material_rows;
end;
$$;

revoke all on function public.operation_completion_dependencies_v12(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
