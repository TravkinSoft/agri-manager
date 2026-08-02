begin;

alter table public.operations
  drop constraint if exists operations_operation_status_v5_check;
alter table public.operations
  add constraint operations_operation_status_v5_check
  check (
    operation_status is null or operation_status in (
      'planned',
      'accepted',
      'in_progress',
      'paused',
      'ready_to_close',
      'awaiting_approval',
      'completed',
      'cancelled'
    )
  );

alter table public.operations
  drop constraint if exists operations_specialist_task_status_v5_check;
alter table public.operations
  add constraint operations_specialist_task_status_v5_check
  check (
    specialist_task_status is null or specialist_task_status in (
      'new',
      'accepted',
      'waiting_materials',
      'materials_ready',
      'materials_received',
      'in_progress',
      'paused',
      'ready_to_close',
      'awaiting_approval',
      'completed'
    )
  );

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
      'issue',
      'return',
      'progress',
      'progress_v12',
      'complete',
      'finish_v12',
      'variance_review'
    )
  );

create table if not exists public.operation_completion_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  planned_area_ha numeric(12, 4) not null check (planned_area_ha > 0),
  actual_area_ha numeric(12, 4) not null check (actual_area_ha > 0),
  deviation_area_ha numeric(12, 4) not null,
  variance_reason text not null check (length(btrim(variance_reason)) > 0),
  specialist_comment text,
  material_facts jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_comment text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists operation_completion_requests_one_pending
  on public.operation_completion_requests(operation_id)
  where status = 'pending';

create index if not exists operation_completion_requests_company_status
  on public.operation_completion_requests(company_id, status, requested_at desc);

alter table public.operation_completion_requests enable row level security;

drop policy if exists "Users can view company operation completion requests"
  on public.operation_completion_requests;
create policy "Users can view company operation completion requests"
  on public.operation_completion_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.company_id = operation_completion_requests.company_id
        and coalesce(p.status, 'active') = 'active'
    )
  );

revoke all on public.operation_completion_requests
  from public, anon, authenticated;
grant select on public.operation_completion_requests to authenticated;

create or replace function public.create_operation_plan_atomic_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation jsonb,
  p_lines jsonb,
  p_materials jsonb,
  p_structure_change jsonb,
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
  v_base jsonb;
  v_operation_id uuid;
  v_first_line_id uuid;
  v_material jsonb;
  v_request_materials jsonb := '[]'::jsonb;
  v_direct_materials jsonb := '[]'::jsonb;
  v_seed_rows_count integer := 0;
  v_material_rows jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'create_v12',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select coalesce(jsonb_agg(value), '[]'::jsonb)
    into v_request_materials
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  where coalesce(value ->> 'material_type', '') in (
    'fertilizer',
    'pesticide',
    'adjuvant',
    'ph_corrector',
    'defoamer',
    'biological',
    'organic',
    'other'
  );

  select coalesce(jsonb_agg(value), '[]'::jsonb)
    into v_direct_materials
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  where coalesce(value ->> 'material_type', '') in ('seed', 'fuel', 'water');

  select count(*)::integer
    into v_seed_rows_count
  from jsonb_array_elements(v_direct_materials)
  where value ->> 'material_type' = 'seed';

  v_base := public.create_operation_plan_atomic_v1(
    p_company_id,
    p_actor_profile_id,
    p_operation,
    p_lines,
    v_request_materials,
    p_structure_change,
    p_idempotency_key || ':v12-core',
    p_request_fingerprint
  );

  v_operation_id := nullif(v_base -> 'operation' ->> 'id', '')::uuid;
  if v_operation_id is null then
    raise exception 'Atomic operation create did not return an operation id' using errcode = '23514';
  end if;

  select id into v_first_line_id
  from public.operation_lines
  where company_id = p_company_id
    and operation_id = v_operation_id
  order by created_at, id
  limit 1
  for update;

  for v_material in
    select value from jsonb_array_elements(v_direct_materials)
  loop
    if coalesce((v_material ->> 'planned_quantity')::numeric, 0) <= 0 then
      raise exception 'Every operation material requires a positive planned quantity' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.products p
      where p.id = (v_material ->> 'product_id')::uuid
        and (p.company_id is null or p.company_id = p_company_id)
        and coalesce(p.archived, false) = false
    ) then
      raise exception 'Seed product is not available to the target company' using errcode = '23503';
    end if;

    insert into public.operation_materials (
      company_id,
      operation_id,
      operation_line_id,
      product_id,
      batch_id,
      material_type,
      unit,
      planned_rate,
      actual_rate,
      planned_quantity,
      issued_quantity,
      notes,
      created_by_user_id,
      updated_by_user_id
    ) values (
      p_company_id,
      v_operation_id,
      coalesce(nullif(v_material ->> 'operation_line_id', '')::uuid, v_first_line_id),
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
  end loop;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_material_rows
  from public.operation_materials m
  where m.company_id = p_company_id
    and m.operation_id = v_operation_id;

  v_response := v_base
    || jsonb_build_object(
      'operation_materials', v_material_rows,
      'material_logistics', jsonb_build_object(
        'warehouse_request_rows', jsonb_array_length(v_request_materials),
        'weighbridge_seed_rows', v_seed_rows_count
      )
    );

  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'create_v12',
    v_operation_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.create_operation_plan_atomic_v12(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.create_operation_plan_atomic_v12(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.save_operation_progress_atomic_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_completed_area_ha numeric,
  p_stop_reason text,
  p_comment text,
  p_weather_note text,
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
  v_response jsonb;
  v_completed numeric;
  v_planned numeric;
  v_overrun numeric;
  v_last_line_id uuid;
begin
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'progress_v12',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_response := public.save_operation_progress_atomic_v1(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    p_completed_area_ha,
    true,
    p_stop_reason,
    p_comment,
    p_weather_note,
    p_idempotency_key || ':v12-core',
    p_request_fingerprint
  );

  select completed_area_ha, planned_area_ha
    into v_completed, v_planned
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;

  v_overrun := greatest(coalesce(v_completed, 0) - coalesce(v_planned, 0), 0);
  if v_overrun > 0.000001 then
    select id into v_last_line_id
    from public.operation_lines
    where operation_id = p_operation_id
      and company_id = p_company_id
    order by created_at desc, id desc
    limit 1
    for update;

    if v_last_line_id is not null then
      update public.operation_lines
      set actual_area_ha = round(planned_area_ha + v_overrun, 4),
          completed_by = p_actor_profile_id,
          completed_at = coalesce(completed_at, now()),
          updated_by_user_id = auth.uid()
      where id = v_last_line_id;
    end if;
  end if;

  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'progress_v12',
    p_operation_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
) from public, anon;
grant execute on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
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
  v_item public.warehouse_issue_request_items%rowtype;
  v_fact jsonb;
  v_consumed numeric;
  v_returned numeric;
  v_loss numeric;
  v_actual_rate numeric;
  v_seed_quantity numeric;
  v_material_rows jsonb := '[]'::jsonb;
begin
  select * into v_operation
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.operation_materials m
  where m.operation_id = p_operation_id
    and m.company_id = p_company_id
  for update;

  perform 1
  from public.warehouse_issue_requests r
  where r.operation_id = p_operation_id
    and r.company_id = p_company_id
  for update;

  perform 1
  from public.warehouse_issue_request_items i
  join public.warehouse_issue_requests r on r.id = i.request_id
  where r.operation_id = p_operation_id
    and i.company_id = p_company_id
  for update of i;

  if exists (
    select 1
    from public.operation_materials m
    where m.operation_id = p_operation_id
      and m.company_id = p_company_id
      and m.material_type in (
        'fertilizer',
        'pesticide',
        'adjuvant',
        'ph_corrector',
        'defoamer',
        'biological',
        'organic',
        'other'
      )
  ) and not exists (
    select 1
    from public.warehouse_issue_requests r
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
  ) then
    raise exception 'Material request is missing for agrochemical materials' using errcode = '23514';
  end if;

  for v_material in
    select *
    from public.operation_materials
    where operation_id = p_operation_id
      and company_id = p_company_id
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
        raise exception 'Finalized weighbridge seed issue is required before completion' using errcode = '23514';
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

    select value into v_fact
    from jsonb_array_elements(coalesce(p_material_facts, '[]'::jsonb))
    where value ->> 'material_id' = v_material.id::text
       or value ->> 'materialId' = v_material.id::text
       or value ->> 'operation_material_id' = v_material.id::text
       or value ->> 'operationMaterialId' = v_material.id::text
       or value ->> 'product_id' = v_material.product_id::text
       or value ->> 'productId' = v_material.product_id::text
    limit 1;

    if v_fact is null then
      raise exception 'Material fact is required for every issued agrochemical material' using errcode = '23514';
    end if;

    v_consumed := coalesce(
      nullif(v_fact ->> 'consumed_quantity', '')::numeric,
      nullif(v_fact ->> 'consumedQuantity', '')::numeric,
      0
    );
    v_returned := coalesce(
      nullif(v_fact ->> 'returned_quantity', '')::numeric,
      nullif(v_fact ->> 'returnedQuantity', '')::numeric,
      0
    );
    v_loss := coalesce(
      nullif(v_fact ->> 'loss_quantity', '')::numeric,
      nullif(v_fact ->> 'lossQuantity', '')::numeric,
      0
    );
    v_actual_rate := coalesce(
      nullif(v_fact ->> 'actual_rate', '')::numeric,
      nullif(v_fact ->> 'actualRate', '')::numeric
    );

    if v_consumed < 0 or v_returned < 0 or v_loss < 0 or coalesce(v_actual_rate, 0) < 0 then
      raise exception 'Material fact values must be zero or positive' using errcode = '23514';
    end if;
    if abs(coalesce(v_material.issued_quantity, 0) - v_consumed - v_returned - v_loss) > 0.0001 then
      raise exception 'Material reconciliation failed: issued must equal consumed plus returned plus loss'
        using errcode = '23514';
    end if;

    select i.* into v_item
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and i.product_id = v_material.product_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
    order by i.created_at
    limit 1
    for update of i;

    if not found then
      raise exception 'Warehouse request item is missing for operation material' using errcode = '23514';
    end if;
    if coalesce(v_item.return_received_quantity, 0) + 0.000001 < v_returned then
      raise exception 'Declared material return has not been accepted by warehouse' using errcode = '23514';
    end if;
    if coalesce(v_item.substitution_status, 'none') not in ('none', 'approved') then
      raise exception 'Material substitution is not approved' using errcode = '23514';
    end if;
    if abs(coalesce(v_item.consumed_quantity, 0) - v_consumed) > 0.0001
       or abs(coalesce(v_item.returned_quantity, 0) - v_returned) > 0.0001
       or abs(coalesce(v_item.loss_quantity, 0) - v_loss) > 0.0001
       or coalesce(v_item.reconciliation_status, 'pending') <> 'reconciled' then
      raise exception 'Material reconciliation is required before operation close' using errcode = '23514';
    end if;

    update public.operation_materials
    set consumed_quantity = round(v_consumed, 4),
        returned_quantity = round(v_returned, 4),
        loss_quantity = round(v_loss, 4),
        actual_rate = v_actual_rate,
        updated_by_user_id = auth.uid(),
        updated_at = now()
    where id = v_material.id;

    v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
      'material_id', v_material.id,
      'product_id', v_material.product_id,
      'source', 'warehouse',
      'planned_quantity', coalesce(v_material.planned_quantity, 0),
      'issued_quantity', coalesce(v_material.issued_quantity, 0),
      'consumed_quantity', v_consumed,
      'returned_quantity', v_returned,
      'loss_quantity', v_loss,
      'actual_rate', v_actual_rate
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
    raise exception 'Material reconciliation is required before operation close' using errcode = '23514';
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

create or replace function public.finalize_operation_result_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_comment text,
  p_material_facts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.operations%rowtype;
  v_material_rows jsonb;
  v_season_id uuid;
  v_season_year integer;
  v_planned numeric;
  v_actual numeric;
  v_remaining numeric;
  v_percent numeric;
begin
  select * into v_operation
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'cancelled' then
    raise exception 'Cancelled operation cannot be completed' using errcode = '23514';
  end if;

  v_planned := coalesce(v_operation.planned_area_ha, 0);
  v_actual := coalesce(v_operation.completed_area_ha, 0);
  if v_planned <= 0 or v_actual <= 0 then
    raise exception 'Planned and actual operation area are required before completion' using errcode = '23514';
  end if;

  v_material_rows := public.operation_completion_dependencies_v12(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    p_material_facts
  );

  if v_operation.crop_structure_id is not null then
    select c.season_id into v_season_id
    from public.crop_structure c
    where c.id = v_operation.crop_structure_id
      and c.company_id = p_company_id
    for share;
    if v_season_id is not null then
      select s.year into v_season_year
      from public.seasons s
      where s.id = v_season_id
        and s.company_id = p_company_id
        and coalesce(s.archived, false) = false
      for share;
      if not found then
        raise exception 'Operation season is closed or missing' using errcode = '23514';
      end if;
    end if;
  end if;

  update public.warehouse_issue_requests
  set warehouse_request_status = 'closed',
      return_closed_at = coalesce(return_closed_at, now()),
      updated_at = now()
  where operation_id = p_operation_id
    and company_id = p_company_id
    and coalesce(warehouse_request_status, '') <> 'cancelled';

  v_remaining := greatest(v_planned - v_actual, 0);
  v_percent := round((v_actual / v_planned) * 100, 2);

  update public.operations
  set work_status = 'completed',
      status = 'completed',
      operation_status = 'completed',
      specialist_task_status = 'completed',
      completed_at = coalesce(completed_at, now()),
      specialist_comment = btrim(p_comment),
      completed_area_ha = round(v_actual, 4),
      remaining_area_ha = round(v_remaining, 4),
      progress_percent = v_percent,
      last_progress_at = coalesce(last_progress_at, now()),
      updated_at = now()
  where id = p_operation_id
  returning * into v_operation;

  if v_operation.field_id is not null
     and v_season_id is not null
     and not exists (
       select 1
       from public.field_history_entries h
       where h.company_id = p_company_id
         and h.operation_id = p_operation_id
     ) then
    insert into public.field_history_entries (
      company_id,
      field_id,
      season_id,
      season_year,
      history_value,
      original_raw_value,
      source,
      notes,
      operation_id,
      actual_completed_area_ha,
      material_facts,
      material_reconciliation_status
    ) values (
      p_company_id,
      v_operation.field_id,
      v_season_id,
      coalesce(v_season_year, extract(year from now())::integer),
      'Operation completed: ' || coalesce(v_operation.operation_type, 'field work'),
      coalesce(v_operation.operation_type, 'operation completed'),
      'operation_close',
      btrim(p_comment),
      p_operation_id,
      round(v_actual, 4),
      v_material_rows,
      case when jsonb_array_length(v_material_rows) > 0 then 'reconciled' else 'not_required' end
    );
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id,
    p_actor_profile_id,
    'operation',
    p_operation_id::text,
    'completed_v12_atomic',
    jsonb_build_object(
      'planned_area_ha', v_planned,
      'actual_area_ha', v_actual,
      'deviation_area_ha', v_actual - v_planned,
      'material_count', jsonb_array_length(v_material_rows)
    )
  );

  return jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'material_facts', v_material_rows,
    'field_history_persisted', true
  );
end;
$$;

revoke all on function public.finalize_operation_result_v12(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;

create or replace function public.finish_operation_atomic_v12(
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
  v_material_rows jsonb;
  v_request public.operation_completion_requests%rowtype;
  v_response jsonb;
  v_deviation numeric;
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
    p_company_id,
    'finish_v12',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'already_completed', true);
    return public.operation_mutation_receipt_finish_v1(
      p_company_id,
      'finish_v12',
      p_operation_id,
      p_idempotency_key,
      p_request_fingerprint,
      p_actor_profile_id,
      v_response
    );
  end if;
  if coalesce(v_operation.operation_status, v_operation.status) = 'cancelled' then
    raise exception 'Cancelled operation cannot be completed' using errcode = '23514';
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
  where id = p_operation_id
    and company_id = p_company_id
  for update;

  if coalesce(v_operation.completed_area_ha, 0) <= 0 then
    raise exception 'Actual area is required before completion' using errcode = '23514';
  end if;

  v_deviation := round(v_operation.completed_area_ha - v_operation.planned_area_ha, 4);
  v_material_rows := public.operation_completion_dependencies_v12(
    p_company_id,
    p_actor_profile_id,
    p_operation_id,
    p_material_facts
  );

  if abs(v_deviation) <= 0.0001 then
    v_response := public.finalize_operation_result_v12(
      p_company_id,
      p_actor_profile_id,
      p_operation_id,
      p_comment,
      v_material_rows
    );
  else
    if nullif(btrim(p_variance_reason), '') is null then
      raise exception 'Variance reason is required when actual area differs from plan' using errcode = '22023';
    end if;

    update public.operation_completion_requests
    set status = 'rejected',
        reviewed_at = coalesce(reviewed_at, now()),
        review_comment = coalesce(review_comment, 'Superseded by a new specialist submission'),
        updated_at = now()
    where operation_id = p_operation_id
      and company_id = p_company_id
      and status = 'pending';

    insert into public.operation_completion_requests (
      company_id,
      operation_id,
      requested_by,
      planned_area_ha,
      actual_area_ha,
      deviation_area_ha,
      variance_reason,
      specialist_comment,
      material_facts
    ) values (
      p_company_id,
      p_operation_id,
      p_actor_profile_id,
      round(v_operation.planned_area_ha, 4),
      round(v_operation.completed_area_ha, 4),
      v_deviation,
      btrim(p_variance_reason),
      btrim(p_comment),
      v_material_rows
    ) returning * into v_request;

    update public.operations
    set status = 'in_progress',
        work_status = 'in_progress',
        operation_status = 'awaiting_approval',
        specialist_task_status = 'awaiting_approval',
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
      'variance_requested_atomic',
      jsonb_build_object(
        'planned_area_ha', v_operation.planned_area_ha,
        'actual_area_ha', v_operation.completed_area_ha,
        'deviation_area_ha', v_deviation,
        'variance_reason', btrim(p_variance_reason),
        'completion_request_id', v_request.id
      )
    );

    v_response := jsonb_build_object(
      'operation', to_jsonb(v_operation),
      'completion_request', to_jsonb(v_request),
      'awaiting_agronomist_approval', true,
      'material_facts', v_material_rows
    );
  end if;

  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'finish_v12',
    p_operation_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.finish_operation_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, text
) from public, anon;
grant execute on function public.finish_operation_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, text
) to authenticated;

create or replace function public.review_operation_variance_atomic_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_decision text,
  p_comment text,
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
  v_request public.operation_completion_requests%rowtype;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and nullif(btrim(p_comment), '') is null then
    raise exception 'Rejection comment is required' using errcode = '22023';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'variance_review',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;

  select * into v_request
  from public.operation_completion_requests
  where operation_id = p_operation_id
    and company_id = p_company_id
    and status = 'pending'
  order by requested_at desc
  limit 1
  for update;
  if not found then
    raise exception 'Pending completion request was not found' using errcode = 'P0002';
  end if;

  if p_decision = 'approve' then
    v_response := public.finalize_operation_result_v12(
      p_company_id,
      p_actor_profile_id,
      p_operation_id,
      coalesce(nullif(btrim(v_request.specialist_comment), ''), 'Approved by agronomist'),
      v_request.material_facts
    );

    update public.operation_completion_requests
    set status = 'approved',
        reviewed_by = p_actor_profile_id,
        review_comment = nullif(btrim(p_comment), ''),
        reviewed_at = now(),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;

    v_response := v_response || jsonb_build_object('completion_request', to_jsonb(v_request));
  else
    update public.operation_completion_requests
    set status = 'rejected',
        reviewed_by = p_actor_profile_id,
        review_comment = btrim(p_comment),
        reviewed_at = now(),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;

    update public.operations
    set status = 'in_progress',
        work_status = 'in_progress',
        operation_status = 'in_progress',
        specialist_task_status = 'in_progress',
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;

    insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
    values (
      p_company_id,
      p_actor_profile_id,
      'operation',
      p_operation_id::text,
      'variance_rejected_atomic',
      jsonb_build_object(
        'completion_request_id', v_request.id,
        'review_comment', btrim(p_comment)
      )
    );

    v_response := jsonb_build_object(
      'operation', to_jsonb(v_operation),
      'completion_request', to_jsonb(v_request),
      'returned_to_specialist', true
    );
  end if;

  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'variance_review',
    p_operation_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.review_operation_variance_atomic_v12(
  uuid, uuid, uuid, text, text, text, text
) from public, anon;
grant execute on function public.review_operation_variance_atomic_v12(
  uuid, uuid, uuid, text, text, text, text
) to authenticated;

commit;
