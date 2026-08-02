begin;

create table if not exists public.operation_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null,
  scope_id uuid,
  idempotency_key text not null,
  request_fingerprint text not null,
  response_payload jsonb not null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint operation_mutation_receipts_action_check check (
    action in ('create', 'activate', 'material_request', 'material_edit', 'request_stage', 'issue', 'return', 'progress', 'complete')
  ),
  constraint operation_mutation_receipts_unique unique (company_id, action, idempotency_key)
);

alter table public.operation_mutation_receipts
  drop constraint if exists operation_mutation_receipts_action_check;
alter table public.operation_mutation_receipts
  add constraint operation_mutation_receipts_action_check check (
    action in ('create', 'activate', 'material_request', 'material_edit', 'request_stage', 'issue', 'return', 'progress', 'complete')
  );

create index if not exists idx_operation_mutation_receipts_scope
  on public.operation_mutation_receipts(company_id, action, scope_id, created_at desc);

alter table public.operation_mutation_receipts enable row level security;
revoke all on table public.operation_mutation_receipts from public, anon, authenticated;

create or replace function public.assert_operation_mutation_actor_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_allowed_roles text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_auth_profile public.profiles%rowtype;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required' using errcode = '42501';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_profile_id
    and coalesce(status, 'active') = 'active'
  limit 1;

  if not found then
    raise exception 'Active actor profile was not found' using errcode = '42501';
  end if;

  if not (coalesce(v_actor.role, '') = any(p_allowed_roles)) then
    raise exception 'Actor role cannot perform this operation mutation' using errcode = '42501';
  end if;

  if v_actor.id = v_auth_user_id then
    if v_actor.company_id is distinct from p_company_id then
      raise exception 'Actor does not belong to the target company' using errcode = '42501';
    end if;
    return v_actor.role;
  end if;

  select * into v_auth_profile
  from public.profiles
  where id = v_auth_user_id
    and coalesce(status, 'active') = 'active'
  limit 1;

  if not found or v_auth_profile.role <> 'global_admin' then
    raise exception 'Authenticated user cannot act as the selected profile' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.global_admin_company_contexts c
    where c.user_id = v_auth_profile.id
      and c.company_id = p_company_id
  ) and not exists (
    select 1
    from public.global_admin_impersonation_contexts c
    where c.admin_user_id = v_auth_profile.id
      and c.impersonated_profile_id = p_actor_profile_id
      and c.impersonated_company_id = p_company_id
  ) then
    raise exception 'Global admin company context does not match the target company' using errcode = '42501';
  end if;

  if v_actor.company_id is distinct from p_company_id then
    raise exception 'Selected actor does not belong to the target company' using errcode = '42501';
  end if;

  return v_actor.role;
end;
$$;

revoke all on function public.assert_operation_mutation_actor_v1(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function public.operation_mutation_receipt_begin_v1(
  p_company_id uuid,
  p_action text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.operation_mutation_receipts%rowtype;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Idempotency-Key is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'Request fingerprint is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_action || ':' || p_idempotency_key, 0));

  select * into v_receipt
  from public.operation_mutation_receipts
  where company_id = p_company_id
    and action = p_action
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_receipt.request_fingerprint <> p_request_fingerprint then
      raise exception 'Idempotency-Key was already used with a different payload' using errcode = '23505';
    end if;
    return v_receipt.response_payload || jsonb_build_object('idempotent_replay', true);
  end if;

  return null;
end;
$$;

create or replace function public.operation_mutation_receipt_finish_v1(
  p_company_id uuid,
  p_action text,
  p_scope_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_actor_profile_id uuid,
  p_response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.operation_mutation_receipts (
    company_id, action, scope_id, idempotency_key, request_fingerprint,
    response_payload, created_by_profile_id
  ) values (
    p_company_id, p_action, p_scope_id, p_idempotency_key, p_request_fingerprint,
    p_response_payload, p_actor_profile_id
  );
  return p_response_payload || jsonb_build_object('idempotent_replay', false);
end;
$$;

revoke all on function public.operation_mutation_receipt_begin_v1(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.operation_mutation_receipt_finish_v1(uuid, text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.create_operation_plan_atomic_v1(
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
  v_existing public.operations%rowtype;
  v_operation public.operations%rowtype;
  v_source_structure public.crop_structure%rowtype;
  v_line jsonb;
  v_material jsonb;
  v_change_mode text := nullif(p_structure_change ->> 'mode', '');
  v_crop_structure_id uuid := nullif(p_operation ->> 'crop_structure_id', '')::uuid;
  v_field_id uuid := nullif(p_operation ->> 'field_id', '')::uuid;
  v_operation_type_slug text := nullif(p_operation ->> 'operation_type_slug', '');
  v_operation_category_slug text := nullif(p_operation ->> 'operation_category_slug', '');
  v_requires_line boolean;
  v_has_materials boolean := jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) > 0;
  v_planned_area numeric := 0;
  v_first_line_id uuid;
  v_request public.warehouse_issue_requests%rowtype;
  v_response jsonb;
  v_season_id uuid;
  v_target_structure_id uuid;
  v_line_rows jsonb;
  v_material_rows jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'create', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_existing
  from public.operations
  where company_id = p_company_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if coalesce(v_existing.request_fingerprint, v_existing.operation_config ->> 'request_fingerprint', '') <> p_request_fingerprint then
      raise exception 'Idempotency-Key was already used with a different payload' using errcode = '23505';
    end if;
    if not exists (select 1 from public.operation_lines l where l.operation_id = v_existing.id) then
      raise exception 'Existing operation is incomplete: execution line is missing' using errcode = '23514';
    end if;
    if exists (select 1 from public.operation_materials m where m.operation_id = v_existing.id)
       and not exists (select 1 from public.warehouse_issue_requests r where r.operation_id = v_existing.id) then
      raise exception 'Existing operation is incomplete: material request is missing' using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb)
      into v_line_rows
    from public.operation_lines l where l.operation_id = v_existing.id;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
      into v_material_rows
    from public.operation_materials m where m.operation_id = v_existing.id;
    v_response := jsonb_build_object(
      'operation', to_jsonb(v_existing),
      'operation_lines', v_line_rows,
      'operation_line', v_line_rows -> 0,
      'operation_materials', v_material_rows,
      'material_request', jsonb_build_object('created', false, 'skipped_reason', 'idempotent_replay')
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'create', v_existing.id, p_idempotency_key, p_request_fingerprint,
      p_actor_profile_id, v_response
    );
  end if;

  if v_field_id is null then
    raise exception 'field_id is required by the current operations schema' using errcode = '23502';
  end if;
  if not exists (select 1 from public.fields f where f.id = v_field_id and f.company_id = p_company_id) then
    raise exception 'Selected field does not belong to the target company' using errcode = '23503';
  end if;

  v_requires_line := coalesce(v_operation_type_slug, v_operation_category_slug, '')
    not in ('service_operation', 'transport', 'post_harvest_operation');

  if v_requires_line and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Operation execution line is required' using errcode = '23514';
  end if;
  if v_has_materials and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Material operation requires at least one operation line' using errcode = '23514';
  end if;

  if v_change_mode is not null then
    if coalesce(v_operation_type_slug, v_operation_category_slug, '') <> 'planting' then
      raise exception 'Crop structure changes are only allowed for planting operations' using errcode = '23514';
    end if;
    select * into v_source_structure
    from public.crop_structure
    where id = nullif(p_structure_change ->> 'source_id', '')::uuid
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Source crop structure row was not found' using errcode = '23503';
    end if;
    v_season_id := v_source_structure.season_id;

    if v_change_mode = 'area_split' then
      if abs(v_source_structure.area - (p_structure_change -> 'source_before' ->> 'area')::numeric) > 0.0001 then
        raise exception 'Crop structure was changed by another user' using errcode = '40001';
      end if;
      v_target_structure_id := nullif(p_structure_change -> 'target_after' ->> 'id', '')::uuid;
      update public.crop_structure
      set area = (p_structure_change -> 'source_after' ->> 'area')::numeric
      where id = v_source_structure.id and company_id = p_company_id;

      insert into public.crop_structure (
        id, company_id, field_id, season_id, crop_id, variety_id, reproduction_id,
        area, status, notes, archived, user_id
      ) values (
        v_target_structure_id,
        p_company_id,
        v_source_structure.field_id,
        v_source_structure.season_id,
        nullif(p_structure_change -> 'target_after' ->> 'crop_id', '')::uuid,
        nullif(p_structure_change -> 'target_after' ->> 'variety_id', '')::uuid,
        nullif(p_structure_change -> 'target_after' ->> 'reproduction_id', '')::uuid,
        (p_structure_change -> 'target_after' ->> 'area')::numeric,
        'planned',
        'Created from atomic operation area split',
        false,
        auth.uid()
      );
      v_crop_structure_id := v_target_structure_id;
    elsif v_change_mode = 'crop_replace' then
      update public.crop_structure
      set crop_id = nullif(p_structure_change -> 'target_after' ->> 'crop_id', '')::uuid,
          variety_id = nullif(p_structure_change -> 'target_after' ->> 'variety_id', '')::uuid,
          reproduction_id = nullif(p_structure_change -> 'target_after' ->> 'reproduction_id', '')::uuid
      where id = v_source_structure.id and company_id = p_company_id;
      v_crop_structure_id := v_source_structure.id;
    else
      raise exception 'Unsupported crop structure mutation' using errcode = '22023';
    end if;
  elsif v_crop_structure_id is not null then
    select * into v_source_structure
    from public.crop_structure
    where id = v_crop_structure_id and company_id = p_company_id
    for share;
    if not found or v_source_structure.field_id <> v_field_id then
      raise exception 'crop_structure_id must belong to the selected field and company' using errcode = '23503';
    end if;
    v_season_id := v_source_structure.season_id;
  end if;

  if v_season_id is not null then
    perform 1 from public.seasons s
    where s.id = v_season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
    for share;
    if not found then
      raise exception 'Operation season is closed or missing' using errcode = '23514';
    end if;
  end if;

  select coalesce(sum((line ->> 'planned_area_ha')::numeric), 0)
    into v_planned_area
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line;

  insert into public.operations (
    company_id, field_id, crop_structure_id, operation_type, date, notes,
    user_id, status, work_status, responsible_user_id,
    operation_category_slug, operation_type_slug, machine_id, equipment_id, transport_id,
    operation_target, rate_per_ha, spray_volume_per_ha, operation_config,
    idempotency_key, request_fingerprint,
    operation_status, specialist_task_status, planned_area_ha, completed_area_ha,
    remaining_area_ha, progress_percent
  ) values (
    p_company_id,
    v_field_id,
    v_crop_structure_id,
    p_operation ->> 'operation_type',
    (p_operation ->> 'date')::date,
    nullif(p_operation ->> 'notes', ''),
    auth.uid(),
    'planned',
    'active',
    nullif(p_operation ->> 'responsible_user_id', '')::uuid,
    v_operation_category_slug,
    v_operation_type_slug,
    nullif(p_operation ->> 'machine_id', '')::uuid,
    nullif(p_operation ->> 'equipment_id', '')::uuid,
    nullif(p_operation ->> 'transport_id', '')::uuid,
    nullif(p_operation ->> 'operation_target', ''),
    nullif(p_operation ->> 'rate_per_ha', '')::numeric,
    nullif(p_operation ->> 'spray_volume_per_ha', '')::numeric,
    coalesce(p_operation -> 'operation_config', '{}'::jsonb),
    p_idempotency_key,
    p_request_fingerprint,
    'planned',
    case when v_has_materials then 'waiting_materials' else 'new' end,
    v_planned_area,
    0,
    v_planned_area,
    0
  ) returning * into v_operation;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.operation_lines (
      company_id, operation_id, field_id, crop_id, variety_id, reproduction_id,
      planned_area_ha, actual_area_ha, row_spacing_m, seed_spacing_cm,
      calculated_plants_per_ha, calculated_total_plants, notes,
      created_by_user_id, updated_by_user_id
    ) values (
      p_company_id,
      v_operation.id,
      nullif(v_line ->> 'field_id', '')::uuid,
      nullif(v_line ->> 'crop_id', '')::uuid,
      nullif(v_line ->> 'variety_id', '')::uuid,
      nullif(v_line ->> 'reproduction_id', '')::uuid,
      (v_line ->> 'planned_area_ha')::numeric,
      nullif(v_line ->> 'actual_area_ha', '')::numeric,
      nullif(v_line ->> 'row_spacing_m', '')::numeric,
      nullif(v_line ->> 'seed_spacing_cm', '')::numeric,
      nullif(v_line ->> 'calculated_plants_per_ha', '')::numeric,
      nullif(v_line ->> 'calculated_total_plants', '')::numeric,
      nullif(v_line ->> 'notes', ''),
      auth.uid(), auth.uid()
    ) returning id into v_target_structure_id;
    if v_first_line_id is null then v_first_line_id := v_target_structure_id; end if;
  end loop;

  for v_material in select value from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    if coalesce((v_material ->> 'planned_quantity')::numeric, 0) <= 0 then
      raise exception 'Every material requires a positive planned quantity' using errcode = '23514';
    end if;
    insert into public.operation_materials (
      company_id, operation_id, operation_line_id, product_id, batch_id,
      material_type, unit, planned_rate, actual_rate, planned_quantity,
      issued_quantity, notes, created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, v_operation.id,
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
      auth.uid(), auth.uid()
    );
  end loop;

  if v_has_materials then
    if v_operation.responsible_user_id is null then
      raise exception 'Material operation requires a responsible specialist' using errcode = '23514';
    end if;
    insert into public.warehouse_issue_requests (
      company_id, operation_id, field_id, operation_line_id, crop_id, variety_id, reproduction_id,
      recipient_user_id, assigned_specialist_id, planned_datetime, comment, status,
      warehouse_request_status
    ) values (
      p_company_id, v_operation.id, v_operation.field_id, v_first_line_id,
      nullif(p_operation ->> 'crop_id', '')::uuid,
      nullif(p_operation ->> 'variety_id', '')::uuid,
      nullif(p_operation ->> 'reproduction_id', '')::uuid,
      v_operation.responsible_user_id, v_operation.responsible_user_id,
      v_operation.date::timestamp + time '08:00',
      'Auto-created atomically from operation', 'new', 'pending'
    ) returning * into v_request;

    insert into public.warehouse_issue_request_items (
      request_id, company_id, product_id, product_category,
      required_quantity, planned_quantity, issued_quantity, unit, planned_rate_per_ha,
      prepared_quantity, expected_consumed_quantity, expected_return_quantity,
      return_received_quantity, loss_quantity, shortage_quantity,
      reconciliation_status, substitution_status, planned_product_id, actual_product_id,
      prepared_unit, issued_unit, received_unit, package_unit
    )
    select
      v_request.id, p_company_id, m.product_id, m.material_type,
      m.planned_quantity, m.planned_quantity, 0, m.unit, m.planned_rate,
      0, 0, 0, 0, 0, m.planned_quantity,
      'pending', 'none', m.product_id, m.product_id,
      m.unit, m.unit, m.unit, m.unit
    from public.operation_materials m
    where m.operation_id = v_operation.id and m.company_id = p_company_id;
  end if;

  if v_change_mode is not null then
    insert into public.crop_structure_change_events (
      company_id, field_id, season_id, source_crop_structure_id, new_crop_structure_id,
      operation_id, change_type, old_crop_id, new_crop_id, old_area_ha, new_area_ha,
      payload, created_by_user_id
    ) values (
      p_company_id,
      v_source_structure.field_id,
      v_source_structure.season_id,
      v_source_structure.id,
      v_crop_structure_id,
      v_operation.id,
      case when v_change_mode = 'area_split' then 'area_split' else 'crop_replace' end,
      v_source_structure.crop_id,
      nullif(p_structure_change -> 'target_after' ->> 'crop_id', '')::uuid,
      v_source_structure.area,
      (p_structure_change -> 'target_after' ->> 'area')::numeric,
      p_structure_change,
      auth.uid()
    );
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', v_operation.id::text, 'created_atomic',
    jsonb_build_object('line_count', jsonb_array_length(coalesce(p_lines, '[]'::jsonb)),
                       'material_count', jsonb_array_length(coalesce(p_materials, '[]'::jsonb)),
                       'material_request_id', v_request.id)
  );

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb)
    into v_line_rows from public.operation_lines l where l.operation_id = v_operation.id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
    into v_material_rows from public.operation_materials m where m.operation_id = v_operation.id;

  v_response := jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'operation_lines', v_line_rows,
    'operation_line', v_line_rows -> 0,
    'operation_materials', v_material_rows,
    'material_request', case when v_request.id is null
      then jsonb_build_object('created', false, 'skipped_reason', 'no_planned_materials')
      else jsonb_build_object('created', true, 'request_id', v_request.id, 'request_number', v_request.request_number,
                              'request_status', v_request.status)
    end
  );

  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'create', v_operation.id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.create_operation_plan_atomic_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.create_operation_plan_atomic_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text) to authenticated;

create or replace function public.replace_operation_materials_atomic_v1(
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
  v_replay jsonb;
  v_operation public.operations%rowtype;
  v_request public.warehouse_issue_requests%rowtype;
  v_material jsonb;
  v_has_materials boolean := jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) > 0;
  v_first_line_id uuid;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'material_edit', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;

  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) in ('in_progress', 'ready_to_close', 'completed', 'cancelled')
     or v_operation.started_at is not null
     or exists (
       select 1 from public.operation_progress p
       where p.operation_id = p_operation_id and p.company_id = p_company_id
     ) then
    raise exception 'Materials cannot be changed after execution has started' using errcode = '23514';
  end if;

  select * into v_request
  from public.warehouse_issue_requests
  where operation_id = p_operation_id and company_id = p_company_id
  for update;

  if found and (
    coalesce(v_request.status, '') in ('partially_issued', 'issued', 'issued_by_warehouse', 'received_confirmed')
    or v_request.issued_at is not null
    or exists (
      select 1 from public.warehouse_issue_request_items i
      where i.request_id = v_request.id and coalesce(i.issued_quantity, 0) > 0
    )
  ) then
    raise exception 'Materials cannot be changed after warehouse issue' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) m
    where nullif(m ->> 'product_id', '') is null
       or nullif(m ->> 'material_type', '') is null
       or nullif(m ->> 'unit', '') is null
       or coalesce((m ->> 'planned_quantity')::numeric, 0) <= 0
  ) then
    raise exception 'Every material requires product, type, unit and positive planned quantity' using errcode = '23514';
  end if;

  select l.id into v_first_line_id
  from public.operation_lines l
  where l.operation_id = p_operation_id and l.company_id = p_company_id
  order by l.created_at
  limit 1
  for update;

  if v_has_materials and v_first_line_id is null then
    raise exception 'Material operation requires an operation line' using errcode = '23514';
  end if;

  update public.operations
  set operation_type = case when p_operation_patch ? 'operation_type' then p_operation_patch ->> 'operation_type' else operation_type end,
      date = case when p_operation_patch ? 'date' then (p_operation_patch ->> 'date')::date else date end,
      notes = case when p_operation_patch ? 'notes' then nullif(p_operation_patch ->> 'notes', '') else notes end,
      responsible_user_id = case when p_operation_patch ? 'responsible_user_id' then nullif(p_operation_patch ->> 'responsible_user_id', '')::uuid else responsible_user_id end,
      operation_category_slug = case when p_operation_patch ? 'operation_category_slug' then nullif(p_operation_patch ->> 'operation_category_slug', '') else operation_category_slug end,
      operation_type_slug = case when p_operation_patch ? 'operation_type_slug' then nullif(p_operation_patch ->> 'operation_type_slug', '') else operation_type_slug end,
      machine_id = case when p_operation_patch ? 'machine_id' then nullif(p_operation_patch ->> 'machine_id', '')::uuid else machine_id end,
      equipment_id = case when p_operation_patch ? 'equipment_id' then nullif(p_operation_patch ->> 'equipment_id', '')::uuid else equipment_id end,
      transport_id = case when p_operation_patch ? 'transport_id' then nullif(p_operation_patch ->> 'transport_id', '')::uuid else transport_id end,
      operation_target = case when p_operation_patch ? 'operation_target' then nullif(p_operation_patch ->> 'operation_target', '') else operation_target end,
      rate_per_ha = case when p_operation_patch ? 'rate_per_ha' then nullif(p_operation_patch ->> 'rate_per_ha', '')::numeric else rate_per_ha end,
      spray_volume_per_ha = case when p_operation_patch ? 'spray_volume_per_ha' then nullif(p_operation_patch ->> 'spray_volume_per_ha', '')::numeric else spray_volume_per_ha end,
      operation_config = case when p_operation_patch ? 'operation_config' then p_operation_patch -> 'operation_config' else operation_config end,
      specialist_task_status = case when v_has_materials then 'waiting_materials' else 'new' end,
      updated_at = now()
  where id = p_operation_id and company_id = p_company_id
  returning * into v_operation;

  delete from public.operation_materials
  where operation_id = p_operation_id and company_id = p_company_id;

  for v_material in select value from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    insert into public.operation_materials (
      company_id, operation_id, operation_line_id, product_id, batch_id,
      material_type, unit, planned_rate, actual_rate, planned_quantity,
      issued_quantity, notes, created_by_user_id, updated_by_user_id
    ) values (
      p_company_id, p_operation_id, v_first_line_id,
      (v_material ->> 'product_id')::uuid,
      nullif(v_material ->> 'batch_id', '')::uuid,
      v_material ->> 'material_type', v_material ->> 'unit',
      nullif(v_material ->> 'planned_rate', '')::numeric,
      nullif(v_material ->> 'actual_rate', '')::numeric,
      (v_material ->> 'planned_quantity')::numeric,
      0, nullif(v_material ->> 'notes', ''), auth.uid(), auth.uid()
    );
  end loop;

  if not v_has_materials then
    if v_request.id is not null then
      delete from public.warehouse_issue_requests
      where id = v_request.id and company_id = p_company_id;
    end if;
  else
    if v_operation.responsible_user_id is null then
      raise exception 'Material operation requires a responsible specialist' using errcode = '23514';
    end if;
    if v_request.id is null then
      insert into public.warehouse_issue_requests (
        company_id, operation_id, field_id, operation_line_id,
        recipient_user_id, assigned_specialist_id, planned_datetime,
        comment, status, warehouse_request_status
      ) values (
        p_company_id, p_operation_id, v_operation.field_id, v_first_line_id,
        v_operation.responsible_user_id, v_operation.responsible_user_id,
        v_operation.date::timestamp + time '08:00',
        'Created atomically after material edit', 'new', 'pending'
      ) returning * into v_request;
    else
      update public.warehouse_issue_requests
      set recipient_user_id = v_operation.responsible_user_id,
          assigned_specialist_id = v_operation.responsible_user_id,
          planned_datetime = v_operation.date::timestamp + time '08:00',
          operation_line_id = v_first_line_id,
          status = 'new',
          warehouse_request_status = 'pending',
          updated_at = now()
      where id = v_request.id
      returning * into v_request;
      delete from public.warehouse_issue_request_items where request_id = v_request.id;
    end if;

    insert into public.warehouse_issue_request_items (
      request_id, company_id, product_id, product_category,
      required_quantity, planned_quantity, issued_quantity, unit, planned_rate_per_ha,
      prepared_quantity, expected_consumed_quantity, expected_return_quantity,
      return_received_quantity, loss_quantity, shortage_quantity,
      reconciliation_status, substitution_status, planned_product_id, actual_product_id,
      prepared_unit, issued_unit, received_unit, package_unit
    )
    select
      v_request.id, p_company_id, m.product_id, m.material_type,
      m.planned_quantity, m.planned_quantity, 0, m.unit, m.planned_rate,
      0, 0, 0, 0, 0, m.planned_quantity,
      'pending', 'none', m.product_id, m.product_id,
      m.unit, m.unit, m.unit, m.unit
    from public.operation_materials m
    where m.operation_id = p_operation_id and m.company_id = p_company_id;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', p_operation_id::text, 'materials_replaced_atomic',
    jsonb_build_object('material_count', jsonb_array_length(coalesce(p_materials, '[]'::jsonb)),
                       'material_request_id', v_request.id)
  );

  v_response := jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'material_request', case when v_request.id is null
      then jsonb_build_object('created', false, 'skipped_reason', 'no_planned_materials')
      else jsonb_build_object('created', true, 'request_id', v_request.id, 'request_number', v_request.request_number)
    end
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'material_edit', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.replace_operation_materials_atomic_v1(uuid, uuid, uuid, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.replace_operation_materials_atomic_v1(uuid, uuid, uuid, jsonb, jsonb, text, text) to authenticated;

create or replace function public.transition_operation_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_transition text,
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
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  if p_transition not in ('accept', 'start') then
    raise exception 'Unsupported operation transition' using errcode = '22023';
  end if;
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'activate', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    raise exception 'Operation is already completed' using errcode = '23514';
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id
     and public.assert_operation_mutation_actor_v1(
       p_company_id, p_actor_profile_id,
       array['global_admin', 'company_admin', 'agronomist']::text[]
     ) is null then
    raise exception 'Operation is assigned to another specialist' using errcode = '42501';
  end if;

  if p_transition = 'accept' then
    update public.operations
    set status = 'accepted', operation_status = 'accepted', specialist_task_status = 'accepted',
        accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;

    update public.warehouse_issue_requests
    set status = case when status = 'new' then 'active' else status end,
        warehouse_request_status = case when warehouse_request_status is null then 'pending' else warehouse_request_status end,
        updated_at = now()
    where operation_id = p_operation_id and company_id = p_company_id
      and status not in ('cancelled', 'issued', 'issued_by_warehouse');
  else
    if exists (
      select 1 from public.warehouse_issue_requests r
      where r.operation_id = p_operation_id and r.company_id = p_company_id
        and coalesce(r.status, '') not in ('issued', 'issued_by_warehouse', 'partially_issued')
    ) then
      raise exception 'Materials must be issued before operation start' using errcode = '23514';
    end if;
    update public.operations
    set status = 'in_progress', work_status = 'in_progress', operation_status = 'in_progress',
        specialist_task_status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (p_company_id, p_actor_profile_id, 'operation', p_operation_id::text,
          p_transition || '_atomic', to_jsonb(v_operation));

  v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'transition', p_transition);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'activate', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text) to authenticated;

create or replace function public.save_operation_progress_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_completed_area_ha numeric,
  p_allow_overrun boolean,
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
  v_operation public.operations%rowtype;
  v_line public.operation_lines%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_planned numeric;
  v_previous numeric;
  v_completed numeric;
  v_remaining numeric;
  v_percent numeric;
  v_status text;
  v_line_remaining numeric;
  v_line_actual numeric;
  v_expected numeric;
  v_shortage numeric;
  v_expected_return numeric;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  if coalesce(p_completed_area_ha, 0) <= 0 then
    raise exception 'Completed area must be greater than zero' using errcode = '22023';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'progress', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled operation cannot receive progress' using errcode = '23514';
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist']::text[]
    );
  end if;

  perform 1 from public.operation_lines l
  where l.operation_id = p_operation_id and l.company_id = p_company_id
  for update;

  select coalesce(sum(l.planned_area_ha), 0),
         coalesce(sum(p.completed_area_ha), 0)
    into v_planned, v_previous
  from public.operation_lines l
  left join public.operation_progress p
    on p.operation_id = l.operation_id and p.company_id = l.company_id
  where l.operation_id = p_operation_id and l.company_id = p_company_id;

  -- The join above repeats progress per line; use the canonical totals independently.
  select coalesce(sum(planned_area_ha), 0) into v_planned
  from public.operation_lines
  where operation_id = p_operation_id and company_id = p_company_id;
  select coalesce(sum(completed_area_ha), 0) into v_previous
  from public.operation_progress
  where operation_id = p_operation_id and company_id = p_company_id;

  if v_planned <= 0 then
    raise exception 'Operation planned area is required before progress reporting' using errcode = '23514';
  end if;

  v_completed := v_previous + p_completed_area_ha;
  if not coalesce(p_allow_overrun, false) and v_completed > v_planned + 0.000001 then
    raise exception 'Completed area exceeds planned area' using errcode = '23514';
  end if;
  if not coalesce(p_allow_overrun, false) then v_completed := least(v_completed, v_planned); end if;
  v_remaining := greatest(v_planned - v_completed, 0);
  v_percent := round((v_completed / v_planned) * 100, 2);
  v_status := case when v_remaining <= 0.000001 then 'ready_to_close'
                   when nullif(btrim(p_stop_reason), '') is not null then 'paused'
                   else 'in_progress' end;

  insert into public.operation_progress (
    operation_id, company_id, reported_by, reported_at,
    completed_area_ha, remaining_area_ha, progress_percent,
    status_after_report, stop_reason, comment, weather_note
  ) values (
    p_operation_id, p_company_id, p_actor_profile_id, now(),
    round(p_completed_area_ha, 4), round(v_remaining, 4), v_percent,
    v_status, nullif(btrim(p_stop_reason), ''), nullif(btrim(p_comment), ''), nullif(btrim(p_weather_note), '')
  );

  v_line_remaining := v_completed;
  for v_line in
    select * from public.operation_lines
    where operation_id = p_operation_id and company_id = p_company_id
    order by created_at
    for update
  loop
    v_line_actual := least(greatest(v_line_remaining, 0), v_line.planned_area_ha);
    v_line_remaining := greatest(v_line_remaining - v_line_actual, 0);
    update public.operation_lines
    set actual_area_ha = round(v_line_actual, 4),
        completed_by = case when v_line_actual > 0 then p_actor_profile_id else completed_by end,
        completed_at = case when v_line_actual >= v_line.planned_area_ha - 0.000001 then coalesce(completed_at, now()) else null end,
        updated_by_user_id = auth.uid()
    where id = v_line.id;
  end loop;

  for v_item in
    select i.*
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and i.company_id = p_company_id
    order by i.created_at
    for update of i
  loop
    v_expected := round(coalesce(v_item.planned_quantity, v_item.required_quantity, 0) * least(v_completed / v_planned, 1), 4);
    v_shortage := greatest(v_expected - coalesce(v_item.issued_quantity, 0), 0);
    v_expected_return := greatest(coalesce(v_item.issued_quantity, 0) - v_expected, 0);
    update public.warehouse_issue_request_items
    set expected_consumed_quantity = v_expected,
        expected_return_quantity = v_expected_return,
        shortage_quantity = v_shortage,
        reconciliation_status = case
          when v_shortage > 0.000001 then 'shortage'
          when v_status = 'ready_to_close' and v_expected_return > 0.000001 then 'return_required'
          else 'in_progress'
        end
    where id = v_item.id;
  end loop;

  update public.operations
  set status = 'in_progress', work_status = 'in_progress',
      operation_status = v_status, specialist_task_status = v_status,
      planned_area_ha = round(v_planned, 4), completed_area_ha = round(v_completed, 4),
      remaining_area_ha = round(v_remaining, 4), progress_percent = v_percent,
      last_progress_at = now(), last_stop_reason = nullif(btrim(p_stop_reason), ''),
      started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_operation_id
  returning * into v_operation;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', p_operation_id::text, 'progress_saved_atomic',
    jsonb_build_object('shift_completed_area_ha', p_completed_area_ha,
                       'completed_area_ha', v_completed, 'remaining_area_ha', v_remaining,
                       'progress_percent', v_percent, 'status_after_report', v_status)
  );

  v_response := jsonb_build_object('progress', jsonb_build_object(
    'operation_id', p_operation_id,
    'shift_completed_area_ha', round(p_completed_area_ha, 4),
    'planned_area_ha', round(v_planned, 4),
    'completed_area_ha', round(v_completed, 4),
    'remaining_area_ha', round(v_remaining, 4),
    'progress_percent', v_percent,
    'status_after_report', v_status,
    'progress_persisted', true,
    'v5_state_persisted', true,
    'material_expectations_persisted', true
  ));
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'progress', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.save_operation_progress_atomic_v1(uuid, uuid, uuid, numeric, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.save_operation_progress_atomic_v1(uuid, uuid, uuid, numeric, boolean, text, text, text, text, text) to authenticated;

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
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  if p_action not in ('preparing', 'ready', 'cancel') then
    raise exception 'Unsupported material request stage action' using errcode = '22023';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'request_stage', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Material request was not found' using errcode = 'P0002'; end if;
  if v_request.status in ('issued', 'issued_by_warehouse', 'partially_issued', 'received_confirmed') then
    raise exception 'Issued material request stage cannot be changed' using errcode = '23514';
  end if;
  if p_action = 'ready' and p_source_warehouse_id is null then
    raise exception 'Source warehouse is required before materials can be marked ready' using errcode = '23514';
  end if;
  if p_source_warehouse_id is not null and not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id and w.company_id = p_company_id
  ) then
    raise exception 'Source warehouse does not belong to the target company' using errcode = '23503';
  end if;

  perform 1 from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  if p_action = 'ready' then
    if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
      raise exception 'Prepared quantities are required before materials can be marked ready' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.warehouse_issue_request_items i
      where i.request_id = p_request_id and i.company_id = p_company_id
        and not exists (
          select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
          where x ->> 'item_id' = i.id::text
        )
    ) then
      raise exception 'Prepared quantity is required for every request item' using errcode = '23514';
    end if;
  end if;

  for v_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
      and request_id = p_request_id and company_id = p_company_id
    for update;
    if not found then raise exception 'Prepared item does not belong to the request' using errcode = '23503'; end if;
    v_prepared := coalesce((v_input ->> 'prepared_quantity')::numeric, 0);
    if v_prepared < 0 then
      raise exception 'Prepared quantity must be zero or positive' using errcode = '23514';
    end if;
    update public.warehouse_issue_request_items
    set prepared_quantity = round(v_prepared, 4),
        prepared_unit = coalesce(nullif(v_input ->> 'prepared_unit', ''), unit),
        package_size = nullif(v_input ->> 'package_size', '')::numeric,
        package_count = nullif(v_input ->> 'package_count', '')::numeric,
        package_unit = coalesce(nullif(v_input ->> 'package_unit', ''), unit),
        reconciliation_status = case when p_action = 'ready' then 'prepared' else 'pending' end
    where id = v_item.id;
  end loop;

  update public.warehouse_issue_requests
  set status = case p_action when 'preparing' then 'preparing' when 'ready' then 'ready' else 'cancelled' end,
      warehouse_request_status = case p_action when 'preparing' then 'collecting' when 'ready' then 'ready_for_pickup' else 'cancelled' end,
      source_warehouse_id = coalesce(p_source_warehouse_id, source_warehouse_id),
      collecting_at = case when p_action = 'preparing' then now() else collecting_at end,
      prepared_at = case when p_action = 'preparing' then now() else prepared_at end,
      ready_at = case when p_action = 'ready' then now() else ready_at end,
      cancelled_at = case when p_action = 'cancel' then now() else cancelled_at end,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'warehouse_issue_request', p_request_id::text,
    'request_' || p_action || '_atomic',
    jsonb_build_object('status', v_request.status, 'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)))
  );

  v_response := jsonb_build_object('request', to_jsonb(v_request), 'workflow_status', p_action);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'request_stage', p_request_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.update_material_request_stage_atomic_v1(uuid, uuid, uuid, text, uuid, jsonb, text, text) from public, anon;
grant execute on function public.update_material_request_stage_atomic_v1(uuid, uuid, uuid, text, uuid, jsonb, text, text) to authenticated;

create or replace function public.confirm_material_request_receipt_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
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
  v_prepared_total numeric;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'request_stage', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Material request was not found' using errcode = 'P0002'; end if;
  if v_request.status = 'received_confirmed' then
    v_response := jsonb_build_object('result', to_jsonb(v_request), 'workflow_status', 'issued', 'already_confirmed', true);
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'request_stage', p_request_id, p_idempotency_key, p_request_fingerprint,
      p_actor_profile_id, v_response
    );
  end if;
  if v_request.status <> 'ready' then
    raise exception 'Materials can be accepted only after warehouse marks the request ready' using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is null then
    raise exception 'Source warehouse is not set for request' using errcode = '23514';
  end if;
  if v_request.assigned_specialist_id is not null
     and v_request.assigned_specialist_id <> p_actor_profile_id then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist']::text[]
    );
  end if;

  perform 1 from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;
  select coalesce(sum(prepared_quantity), 0) into v_prepared_total
  from public.warehouse_issue_request_items
  where request_id = p_request_id and company_id = p_company_id;
  if v_prepared_total <= 0.000001 then
    raise exception 'Warehouse has not prepared any available materials for this request' using errcode = '23514';
  end if;

  update public.warehouse_issue_request_items
  set received_quantity = round(coalesce(prepared_quantity, 0), 4),
      received_unit = coalesce(prepared_unit, unit),
      reconciliation_status = 'received'
  where request_id = p_request_id and company_id = p_company_id;

  update public.warehouse_issue_requests
  set status = 'received_confirmed', warehouse_request_status = 'picked_up_by_specialist',
      picked_up_at = now(), received_confirmed_at = now(), specialist_confirmed_at = now(),
      received_confirmed_by_user_id = p_actor_profile_id,
      specialist_confirmed_by_user_id = p_actor_profile_id,
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'warehouse_issue_request', p_request_id::text,
    'receipt_confirmed_atomic', jsonb_build_object('prepared_total', v_prepared_total)
  );

  v_response := jsonb_build_object('result', to_jsonb(v_request), 'workflow_status', 'issued', 'already_confirmed', false);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'request_stage', p_request_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.confirm_material_request_receipt_atomic_v1(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.confirm_material_request_receipt_atomic_v1(uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.issue_material_request_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_source_warehouse_id uuid,
  p_items jsonb,
  p_ledger_rows jsonb,
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
  v_item_input jsonb;
  v_item public.warehouse_issue_request_items%rowtype;
  v_ledger jsonb;
  v_stock record;
  v_issue_quantity numeric;
  v_ledger_quantity numeric;
  v_next_issued numeric;
  v_total_prepared numeric;
  v_total_issued numeric;
  v_next_status text;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'issue', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Material request was not found' using errcode = 'P0002'; end if;

  if v_request.status in ('issued_by_warehouse', 'issued') then
    v_response := jsonb_build_object(
      'result', jsonb_build_object('success', true, 'already_issued', true,
                                   'request_id', p_request_id, 'status', v_request.status),
      'workflow_status', 'issued'
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'issue', p_request_id, p_idempotency_key, p_request_fingerprint,
      p_actor_profile_id, v_response
    );
  end if;

  if v_request.status not in ('received_confirmed', 'partially_issued') then
    raise exception 'Specialist must accept prepared materials before warehouse issue' using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is not null and v_request.source_warehouse_id <> p_source_warehouse_id then
    raise exception 'Selected warehouse does not match the prepared request warehouse' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id and w.company_id = p_company_id
      and coalesce(w.archived, false) = false and coalesce(w.is_archived, false) = false
  ) then
    raise exception 'Source warehouse was not found in the target company' using errcode = '23503';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'At least one issue item is required' using errcode = '22023';
  end if;

  perform 1 from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  for v_item_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
      and request_id = p_request_id and company_id = p_company_id
    for update;
    if not found then raise exception 'Issue item does not belong to the material request' using errcode = '23503'; end if;

    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);
    if v_issue_quantity <= 0 then raise exception 'Issue quantity must be positive' using errcode = '22023'; end if;
    if coalesce(v_item.prepared_quantity, 0) <= 0 then
      raise exception 'Material must be prepared before issue' using errcode = '23514';
    end if;
    if coalesce(v_item.issued_quantity, 0) + v_issue_quantity > v_item.prepared_quantity + 0.000001 then
      raise exception 'Issued quantity exceeds prepared remainder' using errcode = '23514';
    end if;
    if v_item.planned_product_id is distinct from v_item.actual_product_id
       and coalesce(v_item.substitution_status, 'none') <> 'approved' then
      raise exception 'Material substitution must be approved before issue' using errcode = '23514';
    end if;

    select coalesce(sum(abs((row ->> 'delta_qty_signed')::numeric)), 0)
      into v_ledger_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    where row ->> 'reason_ref_id' = v_item.id::text;
    if abs(v_ledger_quantity - v_issue_quantity) > 0.0001 then
      raise exception 'Ledger payload does not match issued quantity for request item %', v_item.id using errcode = '23514';
    end if;
  end loop;

  for v_stock in
    select
      (row ->> 'warehouse_id')::uuid as warehouse_id,
      (row ->> 'product_id')::uuid as product_id,
      row ->> 'uom' as uom,
      row ->> 'batch_class' as batch_class,
      nullif(row ->> 'batch_id_text', '') as batch_id_text,
      sum(abs((row ->> 'delta_qty_signed')::numeric)) as required_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    group by 1, 2, 3, 4, 5
    order by 1::text, 2::text, 3, 4, 5
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      p_company_id::text || ':' || v_stock.warehouse_id::text || ':' || v_stock.product_id::text || ':' ||
      coalesce(v_stock.uom, '') || ':' || coalesce(v_stock.batch_class, '') || ':' || coalesce(v_stock.batch_id_text, ''), 0
    ));
    select coalesce(sum(l.delta_qty_signed), 0) into v_ledger_quantity
    from public.stock_ledger_entries l
    where l.company_id = p_company_id
      and l.warehouse_id = v_stock.warehouse_id
      and l.product_id = v_stock.product_id
      and l.uom = v_stock.uom
      and l.batch_class = v_stock.batch_class
      and l.batch_id_text is not distinct from v_stock.batch_id_text;
    if v_ledger_quantity + 0.000001 < v_stock.required_quantity then
      raise exception 'Insufficient stock. Available %, required %', v_ledger_quantity, v_stock.required_quantity
        using errcode = '23514';
    end if;
  end loop;

  for v_ledger in select value from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb))
  loop
    insert into public.stock_ledger_entries (
      company_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
      reason_type, reason_ref_id, occurred_at, created_by, notes,
      batch_id_text, batch_class, mass_kg, density_kg_per_l, density_unit,
      density_source, density_verification_status, density_verified_at,
      unit_source, unit_contract_version, operation_line_id
    ) values (
      p_company_id,
      (v_ledger ->> 'product_id')::uuid,
      (v_ledger ->> 'warehouse_id')::uuid,
      'out',
      abs((v_ledger ->> 'quantity')::numeric),
      v_ledger ->> 'uom',
      -abs((v_ledger ->> 'delta_qty_signed')::numeric),
      'warehouse_issue',
      (v_ledger ->> 'reason_ref_id')::uuid,
      coalesce(nullif(v_ledger ->> 'occurred_at', '')::timestamptz, now()),
      auth.uid(),
      nullif(v_ledger ->> 'notes', ''),
      nullif(v_ledger ->> 'batch_id_text', ''),
      v_ledger ->> 'batch_class',
      nullif(v_ledger ->> 'mass_kg', '')::numeric,
      nullif(v_ledger ->> 'density_kg_per_l', '')::numeric,
      nullif(v_ledger ->> 'density_unit', ''),
      nullif(v_ledger ->> 'density_source', ''),
      nullif(v_ledger ->> 'density_verification_status', ''),
      nullif(v_ledger ->> 'density_verified_at', '')::timestamptz,
      nullif(v_ledger ->> 'unit_source', ''),
      nullif(v_ledger ->> 'unit_contract_version', '')::smallint,
      coalesce(v_request.operation_line_id, nullif(v_ledger ->> 'operation_line_id', '')::uuid)
    );
  end loop;

  for v_item_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
    for update;
    v_issue_quantity := (v_item_input ->> 'issued_quantity')::numeric;
    v_next_issued := coalesce(v_item.issued_quantity, 0) + v_issue_quantity;
    update public.warehouse_issue_request_items
    set issued_quantity = round(v_next_issued, 4),
        issued_unit = coalesce(nullif(v_item_input ->> 'issued_unit', ''), unit),
        batch_id = coalesce(nullif(v_item_input ->> 'batch_id', '')::uuid, batch_id),
        expected_consumed_quantity = coalesce(planned_quantity, required_quantity, 0),
        expected_return_quantity = greatest(v_next_issued - coalesce(planned_quantity, required_quantity, 0), 0),
        shortage_quantity = greatest(coalesce(planned_quantity, required_quantity, 0) - v_next_issued, 0),
        reconciliation_status = 'issued'
    where id = v_item.id;
  end loop;

  select coalesce(sum(prepared_quantity), 0), coalesce(sum(issued_quantity), 0)
    into v_total_prepared, v_total_issued
  from public.warehouse_issue_request_items
  where request_id = p_request_id and company_id = p_company_id;
  v_next_status := case when v_total_prepared > 0 and v_total_issued >= v_total_prepared - 0.000001
                        then 'issued_by_warehouse' else 'partially_issued' end;

  update public.warehouse_issue_requests
  set status = v_next_status,
      source_warehouse_id = p_source_warehouse_id,
      issued_at = now(), issued_by_user_id = p_actor_profile_id,
      warehouse_request_status = 'issued', updated_at = now()
  where id = p_request_id
  returning * into v_request;

  update public.operation_materials m
  set issued_quantity = q.issued_quantity,
      updated_by_user_id = auth.uid(), updated_at = now()
  from (
    select i.product_id, sum(coalesce(i.issued_quantity, 0)) as issued_quantity
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id and i.company_id = p_company_id
    group by i.product_id
  ) q
  where m.operation_id = v_request.operation_id
    and m.company_id = p_company_id
    and m.product_id = q.product_id;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'warehouse_issue_request', p_request_id::text, 'issued_atomic',
    jsonb_build_object('status', v_next_status, 'total_prepared', v_total_prepared,
                       'total_issued', v_total_issued, 'ledger_rows', jsonb_array_length(coalesce(p_ledger_rows, '[]'::jsonb)))
  );

  v_response := jsonb_build_object(
    'result', jsonb_build_object('success', true, 'request_id', p_request_id,
                                 'status', v_next_status, 'issued_at', v_request.issued_at,
                                 'total_required', v_total_prepared, 'total_issued', v_total_issued),
    'workflow_status', case when v_next_status = 'partially_issued' then 'partially_issued' else 'issued' end
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'issue', p_request_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.issue_material_request_atomic_v1(uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.issue_material_request_atomic_v1(uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) to authenticated;

create or replace function public.return_material_request_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_accept_return boolean,
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
  v_loss numeric;
  v_consumed numeric;
  v_next_returned numeric;
  v_next_received numeric;
  v_next_loss numeric;
  v_outstanding numeric;
  v_unreconciled_count integer;
  v_response jsonb;
begin
  if p_accept_return then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'warehouse', 'warehouse_operator']::text[]
    );
  else
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
    );
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'return', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Material request was not found' using errcode = 'P0002'; end if;
  if v_request.status not in ('issued', 'issued_by_warehouse', 'partially_issued', 'received_confirmed') then
    raise exception 'Returns are allowed only after issue stage' using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is null then
    raise exception 'Source warehouse is not defined for this request' using errcode = '23514';
  end if;
  if not p_accept_return
     and v_request.assigned_specialist_id is not null
     and v_request.assigned_specialist_id <> p_actor_profile_id then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist']::text[]
    );
  end if;

  perform 1 from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    if not p_accept_return then
      raise exception 'Return items are required' using errcode = '22023';
    end if;
    select coalesce(sum(greatest(coalesce(returned_quantity, 0) - coalesce(return_received_quantity, 0), 0)), 0)
      into v_outstanding
    from public.warehouse_issue_request_items
    where request_id = p_request_id and company_id = p_company_id;
    if v_outstanding > 0.000001 then
      raise exception 'Declared return is not fully accepted by warehouse' using errcode = '23514';
    end if;
  end if;

  for v_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
      and request_id = p_request_id and company_id = p_company_id
    for update;
    if not found then raise exception 'Return item does not belong to the request' using errcode = '23503'; end if;

    v_return := coalesce((v_input ->> 'returned_quantity')::numeric, 0);
    v_loss := coalesce((v_input ->> 'loss_quantity')::numeric, 0);
    v_consumed := coalesce((v_input ->> 'consumed_quantity')::numeric, v_item.consumed_quantity);
    if v_return < 0 or v_loss < 0 or v_consumed < 0 then
      raise exception 'Material fact values must be zero or positive' using errcode = '23514';
    end if;

    if p_accept_return then
      if coalesce(v_item.return_received_quantity, 0) + v_return > coalesce(v_item.returned_quantity, 0) + 0.000001 then
        raise exception 'Warehouse accepted return exceeds declared return' using errcode = '23514';
      end if;
      select coalesce(sum((tx ->> 'quantity_input')::numeric), 0)
        into v_outstanding
      from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) tx
      where tx ->> 'warehouse_issue_request_item_id' = v_item.id::text;
      if abs(v_outstanding - v_return) > 0.0001 then
        raise exception 'Return ledger payload does not match accepted quantity' using errcode = '23514';
      end if;
    else
      if not coalesce(p_close_without_return, false) and v_return <= 0.000001 and v_loss <= 0.000001 then
        raise exception 'Return or loss quantity is required' using errcode = '22023';
      end if;
      if v_consumed + coalesce(v_item.returned_quantity, 0) + v_return + coalesce(v_item.loss_quantity, 0) + v_loss
           > coalesce(v_item.issued_quantity, 0) + 0.000001 then
        raise exception 'Return, loss and consumption exceed issued quantity' using errcode = '23514';
      end if;
      if coalesce(p_close_without_return, false)
         and coalesce(v_item.issued_quantity, 0) - v_consumed - coalesce(v_item.returned_quantity, 0) - coalesce(v_item.loss_quantity, 0) > 0.000001 then
        raise exception 'Return quantity is required before closing return workflow' using errcode = '23514';
      end if;
    end if;
  end loop;

  if p_accept_return then
    for v_tx in select value from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb))
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
        coalesce(nullif(v_tx ->> 'notes', ''), 'Warehouse accepted atomic material return'),
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
  end if;

  for v_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_input ->> 'item_id')::uuid
    for update;
    v_return := coalesce((v_input ->> 'returned_quantity')::numeric, 0);
    v_loss := coalesce((v_input ->> 'loss_quantity')::numeric, 0);
    v_consumed := coalesce((v_input ->> 'consumed_quantity')::numeric, v_item.consumed_quantity);
    v_next_returned := coalesce(v_item.returned_quantity, 0) + case when p_accept_return then 0 else v_return end;
    v_next_received := coalesce(v_item.return_received_quantity, 0) + case when p_accept_return then v_return else 0 end;
    v_next_loss := coalesce(v_item.loss_quantity, 0) + case when p_accept_return then 0 else v_loss end;

    update public.warehouse_issue_request_items
    set returned_quantity = round(v_next_returned, 4),
        return_received_quantity = round(v_next_received, 4),
        consumed_quantity = round(v_consumed, 4),
        loss_quantity = round(v_next_loss, 4),
        shortage_quantity = greatest(coalesce(issued_quantity, 0) - v_consumed - v_next_returned - v_next_loss, 0),
        reconciliation_status = case
          when p_accept_return and v_next_received + 0.000001 >= v_next_returned
               and abs(coalesce(issued_quantity, 0) - v_consumed - v_next_returned - v_next_loss) <= 0.0001
            then 'reconciled'
          when p_accept_return then 'return_declared'
          when v_next_returned > 0.000001 then 'return_declared'
          when v_next_loss > 0.000001 then 'loss_review'
          else 'reconciled'
        end
    where id = v_item.id;
  end loop;

  update public.operation_materials m
  set consumed_quantity = q.consumed_quantity,
      returned_quantity = q.returned_quantity,
      loss_quantity = q.loss_quantity,
      updated_by_user_id = auth.uid(), updated_at = now()
  from (
    select i.product_id,
           sum(coalesce(i.consumed_quantity, 0)) as consumed_quantity,
           sum(coalesce(i.returned_quantity, 0)) as returned_quantity,
           sum(coalesce(i.loss_quantity, 0)) as loss_quantity
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id and i.company_id = p_company_id
    group by i.product_id
  ) q
  where m.operation_id = v_request.operation_id and m.company_id = p_company_id
    and m.product_id = q.product_id;

  if p_accept_return then
    update public.warehouse_issue_request_items
    set reconciliation_status = 'reconciled'
    where request_id = p_request_id and company_id = p_company_id
      and coalesce(return_received_quantity, 0) + 0.000001 >= coalesce(returned_quantity, 0)
      and abs(coalesce(issued_quantity, 0) - coalesce(consumed_quantity, 0)
              - coalesce(returned_quantity, 0) - coalesce(loss_quantity, 0)) <= 0.0001;

    select coalesce(sum(greatest(coalesce(returned_quantity, 0) - coalesce(return_received_quantity, 0), 0)), 0)
      into v_outstanding
    from public.warehouse_issue_request_items
    where request_id = p_request_id and company_id = p_company_id;
    select count(*) into v_unreconciled_count
    from public.warehouse_issue_request_items
    where request_id = p_request_id and company_id = p_company_id
      and coalesce(reconciliation_status, 'pending') <> 'reconciled';
    update public.warehouse_issue_requests
    set warehouse_request_status = case
          when v_outstanding <= 0.000001 and v_unreconciled_count = 0 then 'closed'
          else 'return_received'
        end,
        return_received_at = case when jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)) > 0 then now() else return_received_at end,
        return_closed_at = case when v_outstanding <= 0.000001 and v_unreconciled_count = 0 then now() else null end,
        return_received_by_user_id = p_actor_profile_id,
        updated_at = now()
    where id = p_request_id
    returning * into v_request;
  else
    select count(*) into v_unreconciled_count
    from public.warehouse_issue_request_items
    where request_id = p_request_id and company_id = p_company_id
      and coalesce(reconciliation_status, 'pending') <> 'reconciled';
    update public.warehouse_issue_requests
    set warehouse_request_status = case when v_unreconciled_count = 0 then 'closed' else 'return_expected' end,
        return_expected_at = case when v_unreconciled_count = 0 then return_expected_at else now() end,
        return_closed_at = case when v_unreconciled_count = 0 then now() else return_closed_at end,
        return_requested_by_user_id = p_actor_profile_id, updated_at = now()
    where id = p_request_id
    returning * into v_request;
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'warehouse_issue_request', p_request_id::text,
    case when p_accept_return then 'return_accepted_atomic' else 'return_declared_atomic' end,
    jsonb_build_object('item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
                       'movement_count', jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)),
                       'warehouse_request_status', v_request.warehouse_request_status)
  );

  v_response := jsonb_build_object(
    'success', true,
    'returned_items', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
    'return_movements', jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)),
    'closed_without_return', coalesce(p_close_without_return, false),
    'request_id', p_request_id
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'return', p_request_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.return_material_request_atomic_v1(uuid, uuid, uuid, boolean, boolean, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.return_material_request_atomic_v1(uuid, uuid, uuid, boolean, boolean, jsonb, jsonb, text, text) to authenticated;

create or replace function public.complete_operation_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_actual_area_ha numeric,
  p_line_facts jsonb,
  p_material_facts jsonb,
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
  v_line public.operation_lines%rowtype;
  v_material public.operation_materials%rowtype;
  v_request public.warehouse_issue_requests%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_fact jsonb;
  v_fact_area numeric;
  v_consumed numeric;
  v_returned numeric;
  v_loss numeric;
  v_actual_rate numeric;
  v_planned_area numeric;
  v_actual_area numeric;
  v_season_id uuid;
  v_season_year integer;
  v_material_facts jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'specialist', 'brigadier']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'complete', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;

  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) = 'completed' then
    v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'already_completed', true);
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'complete', p_operation_id, p_idempotency_key, p_request_fingerprint,
      p_actor_profile_id, v_response
    );
  end if;
  if coalesce(v_operation.operation_status, v_operation.status) = 'cancelled' then
    raise exception 'Cancelled operation cannot be completed' using errcode = '23514';
  end if;
  if nullif(btrim(p_comment), '') is null then
    raise exception 'Completion comment is required' using errcode = '22023';
  end if;
  if v_operation.responsible_user_id is not null
     and v_operation.responsible_user_id <> p_actor_profile_id then
    perform public.assert_operation_mutation_actor_v1(
      p_company_id, p_actor_profile_id,
      array['global_admin', 'company_admin', 'agronomist']::text[]
    );
  end if;

  if v_operation.crop_structure_id is not null then
    select c.season_id into v_season_id
    from public.crop_structure c
    where c.id = v_operation.crop_structure_id and c.company_id = p_company_id
    for share;
    if v_season_id is not null then
      select s.year into v_season_year
      from public.seasons s
      where s.id = v_season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
      for share;
      if not found then raise exception 'Operation season is closed or missing' using errcode = '23514'; end if;
    end if;
  end if;

  perform 1 from public.operation_lines l
  where l.operation_id = p_operation_id and l.company_id = p_company_id
  for update;

  for v_line in
    select * from public.operation_lines
    where operation_id = p_operation_id and company_id = p_company_id
    order by created_at
    for update
  loop
    select value into v_fact
    from jsonb_array_elements(coalesce(p_line_facts, '[]'::jsonb))
    where value ->> 'line_id' = v_line.id::text
       or value ->> 'lineId' = v_line.id::text
       or value ->> 'id' = v_line.id::text
    limit 1;
    v_fact_area := case
      when v_fact is not null then coalesce(nullif(v_fact ->> 'actual_area_ha', '')::numeric,
                                             nullif(v_fact ->> 'actualAreaHa', '')::numeric)
      when p_actual_area_ha is not null and (
        select count(*) from public.operation_lines
        where operation_id = p_operation_id and company_id = p_company_id
      ) = 1 then p_actual_area_ha
      else v_line.actual_area_ha
    end;
    if coalesce(v_fact_area, 0) <= 0 then
      raise exception 'Actual area is required for every operation line' using errcode = '23514';
    end if;
    if v_fact_area > v_line.planned_area_ha + 0.000001 then
      raise exception 'Actual line area exceeds planned area' using errcode = '23514';
    end if;
    update public.operation_lines
    set actual_area_ha = round(v_fact_area, 4), completed_by = p_actor_profile_id,
        completed_at = now(), updated_by_user_id = auth.uid()
    where id = v_line.id;
  end loop;

  select coalesce(sum(planned_area_ha), 0), coalesce(sum(actual_area_ha), 0)
    into v_planned_area, v_actual_area
  from public.operation_lines
  where operation_id = p_operation_id and company_id = p_company_id;

  if v_planned_area = 0 then
    v_actual_area := coalesce(p_actual_area_ha, 0);
    v_planned_area := coalesce(v_operation.planned_area_ha, v_actual_area);
  end if;
  if v_actual_area <= 0 then raise exception 'Actual area is required before completion' using errcode = '23514'; end if;
  if v_actual_area > v_planned_area + 0.000001 then
    raise exception 'Completed area exceeds planned area' using errcode = '23514';
  end if;
  if v_actual_area < v_planned_area - 0.000001 then
    raise exception 'Operation area is not fully completed' using errcode = '23514';
  end if;

  perform 1 from public.operation_materials m
  where m.operation_id = p_operation_id and m.company_id = p_company_id
  for update;
  perform 1 from public.warehouse_issue_requests r
  where r.operation_id = p_operation_id and r.company_id = p_company_id
  for update;
  perform 1
  from public.warehouse_issue_request_items i
  join public.warehouse_issue_requests r on r.id = i.request_id
  where r.operation_id = p_operation_id and i.company_id = p_company_id
  for update of i;

  if exists (
    select 1 from public.operation_materials m
    where m.operation_id = p_operation_id and m.company_id = p_company_id
  ) and not exists (
    select 1 from public.warehouse_issue_requests r
    where r.operation_id = p_operation_id and r.company_id = p_company_id
  ) then
    raise exception 'Material request is missing for the material operation' using errcode = '23514';
  end if;

  for v_material in
    select * from public.operation_materials
    where operation_id = p_operation_id and company_id = p_company_id
    order by created_at
    for update
  loop
    select value into v_fact
    from jsonb_array_elements(coalesce(p_material_facts, '[]'::jsonb))
    where value ->> 'material_id' = v_material.id::text
       or value ->> 'materialId' = v_material.id::text
       or value ->> 'operation_material_id' = v_material.id::text
       or value ->> 'operationMaterialId' = v_material.id::text
       or value ->> 'id' = v_material.id::text
       or value ->> 'product_id' = v_material.product_id::text
       or value ->> 'productId' = v_material.product_id::text
    limit 1;
    if v_fact is null then
      raise exception 'Material fact is required for every issued material' using errcode = '23514';
    end if;
    v_consumed := coalesce(nullif(v_fact ->> 'consumed_quantity', '')::numeric,
                           nullif(v_fact ->> 'consumedQuantity', '')::numeric, 0);
    v_returned := coalesce(nullif(v_fact ->> 'returned_quantity', '')::numeric,
                           nullif(v_fact ->> 'returnedQuantity', '')::numeric, 0);
    v_loss := coalesce(nullif(v_fact ->> 'loss_quantity', '')::numeric,
                       nullif(v_fact ->> 'lossQuantity', '')::numeric, 0);
    v_actual_rate := coalesce(nullif(v_fact ->> 'actual_rate', '')::numeric,
                              nullif(v_fact ->> 'actualRate', '')::numeric);
    if v_consumed < 0 or v_returned < 0 or v_loss < 0 or coalesce(v_actual_rate, 0) < 0 then
      raise exception 'Material fact values must be zero or positive' using errcode = '23514';
    end if;
    if abs(coalesce(v_material.issued_quantity, 0) - v_consumed - v_returned - v_loss) > 0.0001 then
      raise exception 'Material reconciliation failed: issued must equal consumed plus returned plus loss' using errcode = '23514';
    end if;

    update public.operation_materials
    set consumed_quantity = round(v_consumed, 4), returned_quantity = round(v_returned, 4),
        loss_quantity = round(v_loss, 4), actual_rate = v_actual_rate,
        updated_by_user_id = auth.uid(), updated_at = now()
    where id = v_material.id;

    select i.* into v_item
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id and i.company_id = p_company_id
      and i.product_id = v_material.product_id
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

    v_material_facts := v_material_facts || jsonb_build_array(jsonb_build_object(
      'product_id', v_material.product_id,
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
    where r.operation_id = p_operation_id and i.company_id = p_company_id
      and coalesce(i.reconciliation_status, 'pending') <> 'reconciled'
  ) then
    raise exception 'Material reconciliation is required before operation close' using errcode = '23514';
  end if;

  update public.warehouse_issue_requests
  set warehouse_request_status = 'closed', return_closed_at = coalesce(return_closed_at, now()), updated_at = now()
  where operation_id = p_operation_id and company_id = p_company_id
    and coalesce(warehouse_request_status, '') <> 'cancelled';

  if coalesce(v_operation.operation_type_slug, v_operation.operation_category_slug, '') = 'harvesting'
     and exists (select 1 from public.tickets t where t.linked_operation_id = p_operation_id)
     and exists (
       select 1 from public.tickets t
       where t.linked_operation_id = p_operation_id
         and coalesce(t.status::text, '') not in ('finalized', 'closed')
     ) then
    raise exception 'Linked weighbridge tickets must be finalized before harvest completion' using errcode = '23514';
  end if;

  update public.operations
  set work_status = 'completed', status = 'completed', operation_status = 'completed',
      specialist_task_status = 'completed', completed_at = now(), specialist_comment = btrim(p_comment),
      planned_area_ha = round(v_planned_area, 4), completed_area_ha = round(v_actual_area, 4),
      remaining_area_ha = 0, progress_percent = 100, last_progress_at = now(), updated_at = now()
  where id = p_operation_id
  returning * into v_operation;

  if v_operation.field_id is not null and v_season_id is not null then
    insert into public.field_history_entries (
      company_id, field_id, season_id, season_year,
      history_value, original_raw_value, source, notes,
      operation_id, actual_completed_area_ha, material_facts, material_reconciliation_status
    ) values (
      p_company_id, v_operation.field_id, v_season_id, coalesce(v_season_year, extract(year from now())::integer),
      'Operation completed: ' || coalesce(v_operation.operation_type, 'field work'),
      coalesce(v_operation.operation_type, 'operation completed'), 'operation_close', btrim(p_comment),
      p_operation_id, round(v_actual_area, 4), v_material_facts,
      case when jsonb_array_length(v_material_facts) > 0 then 'reconciled' else 'not_required' end
    );
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', p_operation_id::text, 'completed_atomic',
    jsonb_build_object('planned_area_ha', v_planned_area, 'actual_area_ha', v_actual_area,
                       'material_count', jsonb_array_length(v_material_facts))
  );

  v_response := jsonb_build_object('operation', to_jsonb(v_operation), 'already_completed', false);
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'complete', p_operation_id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.complete_operation_atomic_v1(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.complete_operation_atomic_v1(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, text) to authenticated;

create or replace function public.ensure_operation_material_request_atomic_v1(
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
  v_replay jsonb;
  v_operation public.operations%rowtype;
  v_request public.warehouse_issue_requests%rowtype;
  v_line public.operation_lines%rowtype;
  v_material_count integer;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'material_request', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.operations
  where id = p_operation_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Operation was not found' using errcode = 'P0002'; end if;
  if coalesce(v_operation.operation_status, v_operation.status, v_operation.work_status) in ('completed', 'cancelled') then
    raise exception 'Material request cannot be created for a completed or cancelled operation' using errcode = '23514';
  end if;

  select * into v_request
  from public.warehouse_issue_requests
  where operation_id = p_operation_id and company_id = p_company_id
  order by created_at desc
  limit 1
  for update;
  if found then
    v_response := jsonb_build_object(
      'operation_id', p_operation_id,
      'material_request', jsonb_build_object(
        'created', false, 'skipped_reason', 'already_exists',
        'request_id', v_request.id, 'request_number', v_request.request_number,
        'request_status', v_request.status
      )
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'material_request', p_operation_id, p_idempotency_key,
      p_request_fingerprint, p_actor_profile_id, v_response
    );
  end if;

  perform 1 from public.operation_materials
  where operation_id = p_operation_id and company_id = p_company_id
  for update;
  select count(*) into v_material_count
  from public.operation_materials
  where operation_id = p_operation_id and company_id = p_company_id;
  if v_material_count = 0 then
    v_response := jsonb_build_object(
      'operation_id', p_operation_id,
      'material_request', jsonb_build_object('created', false, 'skipped_reason', 'no_planned_materials')
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id, 'material_request', p_operation_id, p_idempotency_key,
      p_request_fingerprint, p_actor_profile_id, v_response
    );
  end if;
  if v_operation.responsible_user_id is null then
    raise exception 'Material operation requires a responsible specialist' using errcode = '23514';
  end if;

  select * into v_line
  from public.operation_lines
  where operation_id = p_operation_id and company_id = p_company_id
  order by created_at
  limit 1
  for update;
  if not found then raise exception 'Material operation requires an operation line' using errcode = '23514'; end if;

  insert into public.warehouse_issue_requests (
    company_id, operation_id, field_id, operation_line_id, crop_id, variety_id, reproduction_id,
    recipient_user_id, assigned_specialist_id, planned_datetime, comment, status, warehouse_request_status
  ) values (
    p_company_id, p_operation_id, v_operation.field_id, v_line.id,
    v_line.crop_id, v_line.variety_id, v_line.reproduction_id,
    v_operation.responsible_user_id, v_operation.responsible_user_id,
    v_operation.date::timestamp + time '08:00',
    'Created atomically from existing operation', 'new', 'pending'
  ) returning * into v_request;

  insert into public.warehouse_issue_request_items (
    request_id, company_id, product_id, product_category,
    required_quantity, planned_quantity, issued_quantity, unit, planned_rate_per_ha,
    prepared_quantity, expected_consumed_quantity, expected_return_quantity,
    return_received_quantity, loss_quantity, shortage_quantity,
    reconciliation_status, substitution_status, planned_product_id, actual_product_id,
    prepared_unit, issued_unit, received_unit, package_unit
  )
  select
    v_request.id, p_company_id, m.product_id, m.material_type,
    m.planned_quantity, m.planned_quantity, 0, m.unit, m.planned_rate,
    0, 0, 0, 0, 0, m.planned_quantity,
    'pending', 'none', m.product_id, m.product_id,
    m.unit, m.unit, m.unit, m.unit
  from public.operation_materials m
  where m.operation_id = p_operation_id and m.company_id = p_company_id;

  update public.operations
  set specialist_task_status = 'waiting_materials', updated_at = now()
  where id = p_operation_id;
  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', p_operation_id::text,
    'material_request_created_atomic', jsonb_build_object('request_id', v_request.id, 'item_count', v_material_count)
  );

  v_response := jsonb_build_object(
    'operation_id', p_operation_id,
    'material_request', jsonb_build_object(
      'created', true, 'request_id', v_request.id, 'request_number', v_request.request_number,
      'request_status', v_request.status, 'item_count', v_material_count
    )
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'material_request', p_operation_id, p_idempotency_key,
    p_request_fingerprint, p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.ensure_operation_material_request_atomic_v1(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.ensure_operation_material_request_atomic_v1(uuid, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
