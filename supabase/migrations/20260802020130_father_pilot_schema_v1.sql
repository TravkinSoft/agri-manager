-- TZ-244 Father Pilot V1 consolidated production-safe schema package.

-- Source commit: d3a6a8c5d4f5fbf6139f327dd6bf1c3fb5cab283

-- Existing ERP rows are not backfilled or relabelled by this migration.



-- BEGIN PREREQUISITE: 20260713183038_warehouse_canonical_units_v2.sql / canonical_stock_uom

create or replace function public.canonical_stock_uom(p_uom text)
returns text
language sql
immutable
parallel safe
as $$
  select case lower(trim(coalesce(p_uom, '')))
    when 'kg' then 'kg' when 'кг' then 'kg'
    when 'g' then 'kg' when 'г' then 'kg' when 'gr' then 'kg'
    when 'l' then 'l' when 'л' then 'l' when 'lt' then 'l'
    when 'ml' then 'l' when 'мл' then 'l'
    when 'pcs' then 'pcs' when 'pc' then 'pcs' when 'шт' then 'pcs'
    else null
  end;
$$;

-- END PREREQUISITE: 20260713183038_warehouse_canonical_units_v2.sql / canonical_stock_uom



-- BEGIN SOURCE: 20260719182748_operations_p0_atomicity_v1.sql

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

-- END SOURCE: 20260719182748_operations_p0_atomicity_v1.sql



-- BEGIN SOURCE: 20260720143000_weighbridge_session_finalize_rpc.sql

create or replace function public.finalize_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_role text;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.*
    into v_actor
  from public.profiles p
  where p.id = v_auth_user_id
  limit 1;

  if not found or coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Active actor profile not found';
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = p_ticket_id;

  if not found then
    raise exception 'Ticket not found';
  end if;

  v_role := coalesce(v_actor.role, '');
  if v_role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if v_role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;

  perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
  perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);
  return p_ticket_id;
end;
$$;

revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public;

revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from anon;

grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to authenticated;

grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to service_role;

-- END SOURCE: 20260720143000_weighbridge_session_finalize_rpc.sql



-- BEGIN SOURCE: 20260721105024_warehousekeeper_global_catalog_read_v1.sql

drop policy if exists "Authenticated users can read active global products" on public.products;

create policy "Authenticated users can read active global products"
on public.products
for select
to authenticated
using (
  company_id is null
  and coalesce(is_active, true) = true
  and coalesce(archived, false) = false
);

-- END SOURCE: 20260721105024_warehousekeeper_global_catalog_read_v1.sql



-- BEGIN SOURCE: 20260721112000_warehousekeeper_atomic_receipts_v1.sql

create or replace function public.create_warehouse_receipt_atomic_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_received_at timestamptz,
  p_supplier text,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_ticket public.tickets%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_uom text;
  v_category text;
  v_payload jsonb;
  v_fingerprint text;
  v_ticket_no text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'Active actor profile not found';
  end if;

  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed to create warehouse receipts';
  end if;

  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required';
  end if;
  if coalesce(nullif(trim(p_supplier), ''), '') = '' then
    raise exception 'Supplier is required';
  end if;
  if p_received_at is null then
    raise exception 'Receipt date is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = p_warehouse_id
    and company_id = p_company_id
    and coalesce(archived, false) = false
    and coalesce(is_archived, false) = false;

  if not found then
    raise exception 'Destination warehouse not found in receipt company';
  end if;

  if v_actor.role in ('warehouse', 'warehouse_operator')
     and coalesce(v_warehouse.warehouse_type, '') not in (
       'agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal'
     ) then
    raise exception 'Warehousekeeper can receive only into an agrochemical warehouse';
  end if;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'warehouse_id', p_warehouse_id,
    'received_at', p_received_at,
    'supplier', trim(p_supplier),
    'document_no', nullif(trim(coalesce(p_document_no, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'lines', p_lines
  );
  v_fingerprint := md5(v_payload::text);

  select * into v_ticket
  from public.tickets
  where id = p_idempotency_key
    and company_id = p_company_id;

  if found then
    if coalesce(v_ticket.audit_json ->> 'receipt_fingerprint', '') <> v_fingerprint then
      raise exception 'Idempotency key was already used with another receipt payload';
    end if;
    return jsonb_build_object(
      'receipt_id', v_ticket.id,
      'receipt_no', v_ticket.ticket_no,
      'status', v_ticket.status,
      'idempotent_replay', true
    );
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(v_line ->> 'product_id', '') = '' then
      raise exception 'Receipt line product_id is required';
    end if;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if coalesce(v_quantity, 0) <= 0 then
      raise exception 'Receipt line quantity must be greater than zero';
    end if;

    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null)
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;

    if not found then
      raise exception 'Receipt material is unavailable for this company';
    end if;

    v_category := lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''));
    if v_category not in ('pesticide', 'fertilizer', 'additive') then
      raise exception 'Only pesticides, fertilizers and additives are allowed in warehouse receipts';
    end if;

    v_uom := lower(trim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit, '')));
    if v_uom not in ('kg', 'l', 'pcs') then
      raise exception 'Receipt line has unsupported stock unit';
    end if;
    if v_uom <> lower(trim(coalesce(v_product.base_uom, v_product.unit, ''))) then
      raise exception 'Receipt unit must match the material stock unit';
    end if;
  end loop;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));

  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id,
    warehouse_to_id, responsible_user_id, created_by, weigh_method,
    receipt_mode, supplier_receipt_kind, supplier_document_no,
    manual_correction_reason, notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt',
    'ready_to_close', 'incoming', 'supplier', trim(p_supplier), 'warehouse',
    p_warehouse_id::text, p_warehouse_id, v_actor.id, v_actor.id,
    'manual_override_with_reason', 'direct', 'generic',
    nullif(trim(coalesce(p_document_no, '')), ''), 'Warehouse receipt document',
    nullif(trim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'source', 'warehousekeeper_receipt_v1',
      'receipt_fingerprint', v_fingerprint,
      'receipt_payload', v_payload
    ),
    p_received_at, now()
  ) returning * into v_ticket;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_uom := lower(trim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit)));

    insert into public.ticket_lines (
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      quality_json, mass_kg, unit_source, unit_contract_version, notes
    ) values (
      v_ticket.id, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name, ''), v_product.name),
      v_uom, v_quantity, p_warehouse_id,
      nullif(trim(coalesce(v_line ->> 'lot_number', '')), ''),
      'material', 'material',
      jsonb_strip_nulls(jsonb_build_object(
        'manufactured_at', nullif(v_line ->> 'manufactured_at', ''),
        'expires_at', nullif(v_line ->> 'expires_at', ''),
        'package_count', nullif(v_line ->> 'package_count', '')::numeric,
        'package_size', nullif(v_line ->> 'package_size', '')::numeric
      )),
      case when v_uom = 'kg' then v_quantity else null end,
      'warehouse_receipt:' || v_ticket.id::text, 2,
      nullif(trim(coalesce(v_line ->> 'notes', '')), '')
    );
  end loop;

  perform public.finalize_weighbridge_ticket_v2(v_ticket.id, v_actor.id);

  update public.stock_ledger_entries
  set occurred_at = p_received_at
  where ticket_id = v_ticket.id;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  return jsonb_build_object(
    'receipt_id', v_ticket.id,
    'receipt_no', v_ticket.ticket_no,
    'status', v_ticket.status,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) from public, anon;

grant execute on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) to authenticated;

comment on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) is 'Creates and finalizes an agrochemical warehouse receipt atomically using tickets, ticket_lines and the canonical stock ledger.';

notify pgrst, 'reload schema';

-- END SOURCE: 20260721112000_warehousekeeper_atomic_receipts_v1.sql



-- BEGIN SOURCE: 20260721132434_global_counterparties_v1.sql

create or replace function public.normalize_counterparty_name_v1(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(p_value), '[^[:alnum:]]+', ' ', 'g'),
      '^(тоо|ооо|ао|ип)[[:space:]]+',
      '',
      'i'
    )
  );
$$;

create table if not exists public.global_counterparties (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  normalized_name text generated always as (public.normalize_counterparty_name_v1(legal_name)) stored,
  tax_id text not null,
  country_code text not null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_counterparties_legal_name_check check (btrim(legal_name) <> ''),
  constraint global_counterparties_tax_id_check check (tax_id ~ '^[0-9]+$'),
  constraint global_counterparties_country_check check (country_code in ('KZ', 'RU')),
  constraint global_counterparties_country_tax_unique unique (country_code, tax_id)
);

create index if not exists idx_global_counterparties_search_name
  on public.global_counterparties(normalized_name);

create index if not exists idx_global_counterparties_status
  on public.global_counterparties(archived, is_active, country_code);

alter table public.counterparties
  add column if not exists global_counterparty_id uuid,
  add column if not exists bin_iin text,
  add column if not exists country_code text,
  add column if not exists contact_person text,
  add column if not exists first_used_at timestamptz,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists normalized_name text generated always as (public.normalize_counterparty_name_v1(name)) stored;

alter table public.counterparties
  drop constraint if exists counterparties_global_counterparty_id_fkey,
  add constraint counterparties_global_counterparty_id_fkey
    foreign key (global_counterparty_id)
    references public.global_counterparties(id)
    on delete restrict;

alter table public.counterparties
  drop constraint if exists counterparties_country_check,
  add constraint counterparties_country_check
    check (country_code is null or country_code in ('KZ', 'RU'));

alter table public.counterparties
  drop constraint if exists counterparties_bin_iin_check,
  add constraint counterparties_bin_iin_check
    check (bin_iin is null or bin_iin ~ '^[0-9]+$');

alter table public.counterparties
  drop constraint if exists counterparties_type_check,
  add constraint counterparties_type_check
    check (counterparty_type in ('supplier', 'buyer', 'carrier', 'service', 'both', 'other'));

drop index if exists public.counterparties_company_name_active_uidx;

create unique index if not exists counterparties_company_legacy_name_uidx
  on public.counterparties(company_id, normalized_name)
  where archived = false and bin_iin is null;

create unique index if not exists counterparties_company_global_uidx
  on public.counterparties(company_id, global_counterparty_id)
  where global_counterparty_id is not null;

create unique index if not exists counterparties_company_tax_uidx
  on public.counterparties(company_id, country_code, bin_iin)
  where country_code is not null and bin_iin is not null;

create index if not exists idx_counterparties_company_search
  on public.counterparties(company_id, normalized_name, archived, is_active);

alter table public.tickets
  drop constraint if exists tickets_supplier_id_fkey,
  add constraint tickets_supplier_id_fkey
    foreign key (supplier_id)
    references public.counterparties(id)
    on delete restrict
    not valid;

create table if not exists public.counterparty_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  global_counterparty_id uuid references public.global_counterparties(id) on delete restrict,
  company_counterparty_id uuid references public.counterparties(id) on delete restrict,
  action text not null,
  actor_user_id uuid references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_counterparty_audit_company_created
  on public.counterparty_audit_log(company_id, created_at desc);

create index if not exists idx_counterparty_audit_global_created
  on public.counterparty_audit_log(global_counterparty_id, created_at desc);

create or replace function public.set_counterparty_updated_at_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists global_counterparties_set_updated_at_v1 on public.global_counterparties;

create trigger global_counterparties_set_updated_at_v1
before update on public.global_counterparties
for each row execute function public.set_counterparty_updated_at_v1();

drop trigger if exists counterparties_set_updated_at_v1 on public.counterparties;

create trigger counterparties_set_updated_at_v1
before update on public.counterparties
for each row execute function public.set_counterparty_updated_at_v1();

create or replace function public.audit_counterparty_change_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_action text;
  v_company_id uuid;
  v_global_id uuid;
  v_company_counterparty_id uuid;
  v_details jsonb;
begin
  if tg_table_name = 'global_counterparties' then
    v_global_id := new.id;
    if tg_op = 'INSERT' then
      v_action := 'global_created';
      v_details := jsonb_build_object(
        'legal_name', new.legal_name,
        'tax_id', new.tax_id,
        'country_code', new.country_code
      );
    else
      v_action := case
        when old.archived = false and new.archived = true then 'global_archived'
        when old.archived = true and new.archived = false then 'global_restored'
        else 'global_updated'
      end;
      v_details := jsonb_build_object(
        'before', jsonb_build_object(
          'legal_name', old.legal_name,
          'tax_id', old.tax_id,
          'country_code', old.country_code,
          'is_active', old.is_active,
          'archived', old.archived
        ),
        'after', jsonb_build_object(
          'legal_name', new.legal_name,
          'tax_id', new.tax_id,
          'country_code', new.country_code,
          'is_active', new.is_active,
          'archived', new.archived
        )
      );
    end if;
  else
    v_company_id := new.company_id;
    v_global_id := new.global_counterparty_id;
    v_company_counterparty_id := new.id;
    if tg_op = 'INSERT' then
      v_action := case when new.global_counterparty_id is null
        then 'company_local_created'
        else 'company_global_linked'
      end;
      v_details := jsonb_build_object(
        'name', new.name,
        'tax_id', new.bin_iin,
        'country_code', new.country_code
      );
    else
      v_action := case
        when old.archived = false and new.archived = true then 'company_archived'
        when old.archived = true and new.archived = false then 'company_restored'
        when old.is_active = false and new.is_active = true then 'company_reactivated'
        else 'company_updated'
      end;
      v_details := jsonb_build_object(
        'before', jsonb_build_object(
          'name', old.name,
          'tax_id', old.bin_iin,
          'country_code', old.country_code,
          'is_active', old.is_active,
          'archived', old.archived
        ),
        'after', jsonb_build_object(
          'name', new.name,
          'tax_id', new.bin_iin,
          'country_code', new.country_code,
          'is_active', new.is_active,
          'archived', new.archived
        )
      );
    end if;
  end if;

  insert into public.counterparty_audit_log(
    company_id,
    global_counterparty_id,
    company_counterparty_id,
    action,
    actor_user_id,
    details
  ) values (
    v_company_id,
    v_global_id,
    v_company_counterparty_id,
    v_action,
    auth.uid(),
    v_details
  );
  return new;
end;
$$;

drop trigger if exists global_counterparties_audit_v1 on public.global_counterparties;

create trigger global_counterparties_audit_v1
after insert or update on public.global_counterparties
for each row execute function public.audit_counterparty_change_v1();

drop trigger if exists counterparties_audit_v1 on public.counterparties;

create trigger counterparties_audit_v1
after insert or update on public.counterparties
for each row execute function public.audit_counterparty_change_v1();

alter table public.global_counterparties enable row level security;

alter table public.counterparties enable row level security;

alter table public.counterparty_audit_log enable row level security;

drop policy if exists "Authenticated users can read active global counterparties" on public.global_counterparties;

drop policy if exists "Global admins can insert global counterparties" on public.global_counterparties;

drop policy if exists "Global admins can update global counterparties" on public.global_counterparties;

create policy "Authenticated users can read active global counterparties"
  on public.global_counterparties
  for select
  to authenticated
  using (
    (archived = false and is_active = true)
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

create policy "Global admins can insert global counterparties"
  on public.global_counterparties
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

create policy "Global admins can update global counterparties"
  on public.global_counterparties
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Users can view company counterparties" on public.counterparties;

drop policy if exists "Users can insert company counterparties" on public.counterparties;

drop policy if exists "Users can update company counterparties" on public.counterparties;

create policy "Company users can view company counterparties"
  on public.counterparties
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = counterparties.company_id)
    )
  );

create policy "Company admins can insert company counterparties"
  on public.counterparties
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  );

create policy "Company admins can update company counterparties"
  on public.counterparties
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparties.company_id)
        )
    )
  );

create policy "Admins can read counterparty audit"
  on public.counterparty_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'active'
        and (
          p.role = 'global_admin'
          or (p.role = 'company_admin' and p.company_id = counterparty_audit_log.company_id)
        )
    )
  );

grant select on public.global_counterparties to authenticated;

grant insert, update on public.global_counterparties to authenticated;

revoke delete, truncate, references, trigger on public.global_counterparties from authenticated, anon, public;

grant select on public.counterparties to authenticated;

grant insert, update on public.counterparties to authenticated;

revoke delete, truncate, references, trigger on public.counterparties from authenticated, anon, public;

grant select on public.counterparty_audit_log to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.counterparty_audit_log from authenticated, anon, public;

create or replace function public.import_global_counterparties_v1(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_total integer;
  v_changed integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into v_actor from public.profiles
  where id = auth.uid() and status = 'active';
  if not found or v_actor.role <> 'global_admin' then
    raise exception 'Global admin role is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a JSON array';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then
    raise exception 'Import rows are empty';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
    where nullif(btrim(x.legal_name), '') is null
       or nullif(btrim(x.tax_id), '') is null
       or x.tax_id !~ '^[0-9]+$'
       or x.country_code not in ('KZ', 'RU')
  ) then
    raise exception 'Import contains an invalid legal name, tax ID or country code';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
    group by x.country_code, x.tax_id
    having count(*) > 1
  ) then
    raise exception 'Import contains duplicate country and tax ID pairs';
  end if;

  insert into public.global_counterparties(
    legal_name, tax_id, country_code, is_active, archived
  )
  select btrim(x.legal_name), btrim(x.tax_id), x.country_code, true, false
  from jsonb_to_recordset(p_rows) as x(legal_name text, tax_id text, country_code text)
  on conflict (country_code, tax_id) do update
  set legal_name = excluded.legal_name,
      is_active = true,
      archived = false
  where global_counterparties.legal_name is distinct from excluded.legal_name
     or global_counterparties.is_active is distinct from true
     or global_counterparties.archived is distinct from false;

  get diagnostics v_changed = row_count;
  return jsonb_build_object(
    'processed_rows', v_total,
    'changed_rows', v_changed,
    'idempotent_noop', v_changed = 0
  );
end;
$$;

create or replace function public.link_global_counterparty_to_company_v1(
  p_company_id uuid,
  p_global_counterparty_id uuid
)
returns public.counterparties
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_global public.global_counterparties%rowtype;
  v_company_counterparty public.counterparties%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;

  select * into v_global from public.global_counterparties
  where id = p_global_counterparty_id and archived = false and is_active = true;
  if not found then raise exception 'Global counterparty is unavailable'; end if;

  select * into v_company_counterparty
  from public.counterparties
  where company_id = p_company_id
    and (
      global_counterparty_id = v_global.id
      or (country_code = v_global.country_code and bin_iin = v_global.tax_id)
    )
  order by (global_counterparty_id = v_global.id) desc
  limit 1
  for update;

  if found then
    if v_company_counterparty.global_counterparty_id is not null
       and v_company_counterparty.global_counterparty_id <> v_global.id then
      raise exception 'Company tax identity is linked to another global counterparty';
    end if;
    update public.counterparties
    set global_counterparty_id = v_global.id,
        name = v_global.legal_name,
        counterparty_type = 'supplier',
        is_active = true,
        archived = false
    where id = v_company_counterparty.id
    returning * into v_company_counterparty;
  else
    insert into public.counterparties(
      company_id, global_counterparty_id, name, counterparty_type,
      bin_iin, country_code, is_active, archived, first_used_at, created_by
    ) values (
      p_company_id, v_global.id, v_global.legal_name, 'supplier',
      v_global.tax_id, v_global.country_code, true, false, null, v_actor.id
    ) returning * into v_company_counterparty;
  end if;
  return v_company_counterparty;
end;
$$;

create or replace function public.create_local_counterparty_v1(
  p_company_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_country_code text
)
returns public.counterparties
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_row public.counterparties%rowtype;
  v_normalized_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;
  if nullif(btrim(p_legal_name), '') is null
     or p_tax_id !~ '^[0-9]+$'
     or p_country_code not in ('KZ', 'RU') then
    raise exception 'Legal name, tax ID and country are required';
  end if;
  v_normalized_name := public.normalize_counterparty_name_v1(p_legal_name);

  if exists (
    select 1 from public.global_counterparties
    where country_code = p_country_code and tax_id = p_tax_id
  ) then
    raise exception 'Counterparty already exists in the global catalog';
  end if;
  if exists (
    select 1 from public.global_counterparties
    where normalized_name = v_normalized_name
  ) then
    raise exception 'A similarly named global counterparty exists; verify it before creating a local record';
  end if;
  if exists (
    select 1 from public.counterparties
    where company_id = p_company_id
      and (
        (country_code = p_country_code and bin_iin = p_tax_id)
        or normalized_name = v_normalized_name
      )
  ) then
    raise exception 'Counterparty already exists in the company catalog';
  end if;

  insert into public.counterparties(
    company_id, name, counterparty_type, bin_iin, country_code,
    is_active, archived, first_used_at, created_by
  ) values (
    p_company_id, btrim(p_legal_name), 'supplier', btrim(p_tax_id), p_country_code,
    true, false, null, v_actor.id
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.create_warehouse_receipt_atomic_v2(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_received_at timestamptz,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_ticket public.tickets%rowtype;
  v_supplier public.counterparties%rowtype;
  v_global_supplier public.global_counterparties%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_uom text;
  v_category text;
  v_payload jsonb;
  v_fingerprint text;
  v_ticket_no text;
  v_link_action text := 'existing_company_counterparty';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found then raise exception 'Active actor profile not found'; end if;
  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed to create warehouse receipts';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_supplier_company_counterparty_id is null and p_supplier_global_counterparty_id is null then
    raise exception 'Supplier ID is required';
  end if;
  if p_received_at is null then raise exception 'Receipt date is required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;

  select * into v_warehouse from public.warehouses
  where id = p_warehouse_id
    and company_id = p_company_id
    and coalesce(archived, false) = false
    and coalesce(is_archived, false) = false;
  if not found then raise exception 'Destination warehouse not found in receipt company'; end if;
  if v_actor.role in ('warehouse', 'warehouse_operator')
     and coalesce(v_warehouse.warehouse_type, '') not in (
       'agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal'
     ) then
    raise exception 'Warehousekeeper can receive only into an agrochemical warehouse';
  end if;

  if p_supplier_global_counterparty_id is not null then
    select * into v_global_supplier from public.global_counterparties
    where id = p_supplier_global_counterparty_id
      and archived = false and is_active = true;
    if not found then raise exception 'Global supplier is unavailable'; end if;
  end if;
  if p_supplier_company_counterparty_id is not null then
    select * into v_supplier from public.counterparties
    where id = p_supplier_company_counterparty_id
      and company_id = p_company_id;
    if not found then raise exception 'Company supplier was not found'; end if;
    if v_supplier.archived or not v_supplier.is_active then
      raise exception 'Company supplier is archived';
    end if;
    if p_supplier_global_counterparty_id is not null
       and v_supplier.global_counterparty_id is distinct from p_supplier_global_counterparty_id then
      raise exception 'Supplier IDs do not identify the same counterparty';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'warehouse_id', p_warehouse_id,
    'received_at', p_received_at,
    'supplier_company_counterparty_id', p_supplier_company_counterparty_id,
    'supplier_global_counterparty_id', p_supplier_global_counterparty_id,
    'document_no', nullif(btrim(coalesce(p_document_no, '')), ''),
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'lines', p_lines
  );
  v_fingerprint := md5(v_payload::text);

  select * into v_ticket from public.tickets
  where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if coalesce(v_ticket.audit_json ->> 'receipt_fingerprint', '') <> v_fingerprint then
      raise exception 'Idempotency key was already used with another receipt payload';
    end if;
    return jsonb_build_object(
      'receipt_id', v_ticket.id,
      'receipt_no', v_ticket.ticket_no,
      'status', v_ticket.status,
      'supplier_id', v_ticket.supplier_id,
      'idempotent_replay', true
    );
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(v_line ->> 'product_id', '') = '' then
      raise exception 'Receipt line product_id is required';
    end if;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if coalesce(v_quantity, 0) <= 0 then
      raise exception 'Receipt line quantity must be greater than zero';
    end if;
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null)
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;
    if not found then raise exception 'Receipt material is unavailable for this company'; end if;
    v_category := lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''));
    if v_category not in ('pesticide', 'fertilizer', 'additive') then
      raise exception 'Only pesticides, fertilizers and additives are allowed in warehouse receipts';
    end if;
    v_uom := lower(btrim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit, '')));
    if v_uom not in ('kg', 'l', 'pcs') then
      raise exception 'Receipt line has unsupported stock unit';
    end if;
    if v_uom <> lower(btrim(coalesce(v_product.base_uom, v_product.unit, ''))) then
      raise exception 'Receipt unit must match the material stock unit';
    end if;
  end loop;

  if p_supplier_global_counterparty_id is not null then
    select * into v_supplier from public.counterparties
    where company_id = p_company_id
      and (
        global_counterparty_id = v_global_supplier.id
        or (country_code = v_global_supplier.country_code and bin_iin = v_global_supplier.tax_id)
      )
    order by (global_counterparty_id = v_global_supplier.id) desc
    limit 1
    for update;
    if found then
      if v_supplier.global_counterparty_id is not null
         and v_supplier.global_counterparty_id <> v_global_supplier.id then
        raise exception 'Company tax identity is linked to another global counterparty';
      end if;
      if v_supplier.archived or not v_supplier.is_active then
        v_link_action := 'company_counterparty_reactivated';
      end if;
      update public.counterparties
      set global_counterparty_id = v_global_supplier.id,
          name = v_global_supplier.legal_name,
          bin_iin = v_global_supplier.tax_id,
          country_code = v_global_supplier.country_code,
          counterparty_type = 'supplier',
          is_active = true,
          archived = false,
          first_used_at = coalesce(first_used_at, p_received_at)
      where id = v_supplier.id
      returning * into v_supplier;
    else
      v_link_action := 'company_counterparty_created';
      insert into public.counterparties(
        company_id, global_counterparty_id, name, counterparty_type,
        bin_iin, country_code, is_active, archived, first_used_at, created_by
      ) values (
        p_company_id, v_global_supplier.id, v_global_supplier.legal_name, 'supplier',
        v_global_supplier.tax_id, v_global_supplier.country_code,
        true, false, p_received_at, v_actor.id
      ) returning * into v_supplier;
    end if;
  end if;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, supplier_id, destination_kind, destination_id,
    warehouse_to_id, responsible_user_id, created_by, weigh_method,
    receipt_mode, supplier_receipt_kind, supplier_document_no,
    manual_correction_reason, notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt',
    'ready_to_close', 'incoming', 'supplier', v_supplier.name, v_supplier.id,
    'warehouse', p_warehouse_id::text, p_warehouse_id, v_actor.id, v_actor.id,
    'manual_override_with_reason', 'direct', 'generic',
    nullif(btrim(coalesce(p_document_no, '')), ''), 'Warehouse receipt document',
    nullif(btrim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'source', 'warehousekeeper_receipt_v2',
      'receipt_fingerprint', v_fingerprint,
      'receipt_payload', v_payload,
      'supplier_company_counterparty_id', v_supplier.id,
      'supplier_global_counterparty_id', v_supplier.global_counterparty_id,
      'company_link_action', v_link_action
    ),
    p_received_at, now()
  ) returning * into v_ticket;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_uom := lower(btrim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit)));
    insert into public.ticket_lines (
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      quality_json, mass_kg, unit_source, unit_contract_version, notes
    ) values (
      v_ticket.id, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name, ''), v_product.name),
      v_uom, v_quantity, p_warehouse_id,
      nullif(btrim(coalesce(v_line ->> 'lot_number', '')), ''),
      'material', 'material',
      jsonb_strip_nulls(jsonb_build_object(
        'manufactured_at', nullif(v_line ->> 'manufactured_at', ''),
        'expires_at', nullif(v_line ->> 'expires_at', ''),
        'package_count', nullif(v_line ->> 'package_count', '')::numeric,
        'package_size', nullif(v_line ->> 'package_size', '')::numeric
      )),
      case when v_uom = 'kg' then v_quantity else null end,
      'warehouse_receipt:' || v_ticket.id::text, 2,
      nullif(btrim(coalesce(v_line ->> 'notes', '')), '')
    );
  end loop;

  perform public.finalize_weighbridge_ticket_v2(v_ticket.id, v_actor.id);
  update public.stock_ledger_entries set occurred_at = p_received_at
  where ticket_id = v_ticket.id;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  return jsonb_build_object(
    'receipt_id', v_ticket.id,
    'receipt_no', v_ticket.ticket_no,
    'status', v_ticket.status,
    'supplier_id', v_ticket.supplier_id,
    'supplier_global_counterparty_id', v_supplier.global_counterparty_id,
    'company_link_action', v_link_action,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.import_global_counterparties_v1(jsonb) from public, anon;

grant execute on function public.import_global_counterparties_v1(jsonb) to authenticated;

revoke all on function public.link_global_counterparty_to_company_v1(uuid, uuid) from public, anon;

grant execute on function public.link_global_counterparty_to_company_v1(uuid, uuid) to authenticated;

revoke all on function public.create_local_counterparty_v1(uuid, text, text, text) from public, anon;

grant execute on function public.create_local_counterparty_v1(uuid, text, text, text) to authenticated;

revoke all on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) from public, anon;

grant execute on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

revoke all on function public.audit_counterparty_change_v1() from public, anon, authenticated;

revoke all on function public.set_counterparty_updated_at_v1() from public, anon, authenticated;

comment on table public.global_counterparties is
  'Global legal counterparty identities. Country and tax ID are the canonical unique key.';

comment on column public.counterparties.global_counterparty_id is
  'Optional link to the canonical global identity; local-only counterparties keep this null.';

comment on column public.tickets.source_id is
  'Legacy-readable supplier name snapshot. New supplier receipts also set tickets.supplier_id.';

comment on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) is
  'Creates or reactivates the company supplier link and finalizes a supplier receipt atomically.';

notify pgrst, 'reload schema';

-- END SOURCE: 20260721132434_global_counterparties_v1.sql



-- BEGIN SOURCE: 20260721132844_global_counterparty_security_indexes.sql

create index if not exists idx_counterparties_created_by
  on public.counterparties(created_by)
  where created_by is not null;

create index if not exists idx_counterparty_audit_actor
  on public.counterparty_audit_log(actor_user_id)
  where actor_user_id is not null;

create index if not exists idx_counterparty_audit_company_counterparty
  on public.counterparty_audit_log(company_counterparty_id)
  where company_counterparty_id is not null;

revoke all on function public.normalize_counterparty_name_v1(text) from public, anon;

grant execute on function public.normalize_counterparty_name_v1(text) to authenticated;

notify pgrst, 'reload schema';

-- END SOURCE: 20260721132844_global_counterparty_security_indexes.sql



-- BEGIN SOURCE: 20260721151313_warehouse_v11_inventory_transfers.sql

create table if not exists public.warehouse_transfer_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  transfer_no text not null,
  source_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  destination_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  canonical_product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  uom text not null check (uom in ('kg', 'l', 'pcs')),
  reserved_quantity numeric(18,3) not null default 0 check (reserved_quantity >= 0),
  notes text,
  status text not null default 'completed' check (status = 'completed'),
  payload_fingerprint text not null,
  posted_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint warehouse_transfer_documents_distinct_warehouses
    check (source_warehouse_id <> destination_warehouse_id),
  constraint warehouse_transfer_documents_company_number_unique
    unique (company_id, transfer_no)
);

create table if not exists public.warehouse_inventory_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  inventory_no text not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  snapshot_at timestamptz not null default clock_timestamp(),
  started_at timestamptz not null default clock_timestamp(),
  started_by uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  item_count integer not null default 0 check (item_count >= 0),
  difference_count integer not null default 0 check (difference_count >= 0),
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint warehouse_inventory_documents_company_number_unique
    unique (company_id, inventory_no),
  constraint warehouse_inventory_documents_completion_check check (
    (status = 'in_progress' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and completed_by is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and completed_at is null)
  )
);

create table if not exists public.warehouse_inventory_items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.warehouse_inventory_documents(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  product_type text not null,
  uom text not null check (uom in ('kg', 'l', 'pcs')),
  book_quantity numeric(18,3) not null default 0,
  actual_quantity numeric(18,3),
  difference_quantity numeric(18,3),
  discovered boolean not null default false,
  adjustment_ledger_entry_id uuid references public.stock_ledger_entries(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint warehouse_inventory_items_actual_nonnegative
    check (actual_quantity is null or actual_quantity >= 0),
  constraint warehouse_inventory_items_identity_unique
    unique (inventory_id, product_id, uom)
);

create unique index if not exists warehouse_inventory_one_active_per_warehouse
  on public.warehouse_inventory_documents(warehouse_id)
  where status = 'in_progress';

create index if not exists warehouse_transfer_documents_company_posted_idx
  on public.warehouse_transfer_documents(company_id, posted_at desc);

create index if not exists warehouse_transfer_documents_source_idx
  on public.warehouse_transfer_documents(source_warehouse_id, posted_at desc);

create index if not exists warehouse_transfer_documents_destination_idx
  on public.warehouse_transfer_documents(destination_warehouse_id, posted_at desc);

create index if not exists warehouse_inventory_documents_company_started_idx
  on public.warehouse_inventory_documents(company_id, started_at desc);

create index if not exists warehouse_inventory_items_inventory_idx
  on public.warehouse_inventory_items(inventory_id, product_name_snapshot);

alter table public.warehouse_transfer_documents enable row level security;

alter table public.warehouse_inventory_documents enable row level security;

alter table public.warehouse_inventory_items enable row level security;

drop policy if exists warehouse_transfer_documents_company_read on public.warehouse_transfer_documents;

create policy warehouse_transfer_documents_company_read
  on public.warehouse_transfer_documents for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_transfer_documents.company_id)
    )
  );

drop policy if exists warehouse_inventory_documents_company_read on public.warehouse_inventory_documents;

create policy warehouse_inventory_documents_company_read
  on public.warehouse_inventory_documents for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_inventory_documents.company_id)
    )
  );

drop policy if exists warehouse_inventory_items_company_read on public.warehouse_inventory_items;

create policy warehouse_inventory_items_company_read
  on public.warehouse_inventory_items for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_inventory_items.company_id)
    )
  );

grant select on public.warehouse_transfer_documents to authenticated;

grant select on public.warehouse_inventory_documents to authenticated;

grant select on public.warehouse_inventory_items to authenticated;

revoke insert, update, delete on public.warehouse_transfer_documents from anon, authenticated;

revoke insert, update, delete on public.warehouse_inventory_documents from anon, authenticated;

revoke insert, update, delete on public.warehouse_inventory_items from anon, authenticated;

create or replace function public.warehouse_canonical_product_id_v1(
  p_company_id uuid,
  p_product_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select company_product.id
      from public.products source_product
      join public.products company_product
        on company_product.company_id = p_company_id
       and company_product.master_product_id = coalesce(source_product.master_product_id, source_product.id)
       and coalesce(company_product.archived, false) = false
       and coalesce(company_product.is_active, true) = true
      where source_product.id = p_product_id
      order by company_product.created_at, company_product.id
      limit 1
    ),
    (
      select case
        when source_product.company_id = p_company_id then source_product.id
        else coalesce(source_product.master_product_id, source_product.id)
      end
      from public.products source_product
      where source_product.id = p_product_id
    )
  );
$$;

revoke all on function public.warehouse_canonical_product_id_v1(uuid, uuid) from public, anon, authenticated;

create or replace function public.assert_warehouse_v11_actor_v1(
  p_company_id uuid,
  p_warehouse_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'Active actor profile not found' using errcode = '42501';
  end if;
  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed for warehouse operations' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Actor does not belong to warehouse company' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.company_id = p_company_id
      and coalesce(w.archived, false) = false
      and coalesce(w.is_archived, false) = false
      and coalesce(w.warehouse_type, '') in ('agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal')
  ) then
    raise exception 'Agrochemical warehouse is not available to the actor' using errcode = '42501';
  end if;
  return v_actor.id;
end;
$$;

revoke all on function public.assert_warehouse_v11_actor_v1(uuid, uuid) from public, anon, authenticated;

create or replace function public.warehouse_reserved_quantity_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_uom text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
  from public.warehouse_issue_requests r
  join public.warehouse_issue_request_items i on i.request_id = r.id and i.company_id = r.company_id
  where r.company_id = p_company_id
    and r.source_warehouse_id = p_warehouse_id
    and r.status in ('new', 'active', 'preparing', 'ready', 'received_confirmed')
    and coalesce(r.warehouse_request_status, '') not in ('issued', 'closed', 'return_received', 'cancelled')
    and public.warehouse_canonical_product_id_v1(
      p_company_id,
      coalesce(i.actual_product_id, i.product_id)
    ) = p_product_id
    and public.canonical_stock_uom(coalesce(i.prepared_unit, i.issued_unit, i.unit)) = public.canonical_stock_uom(p_uom);
$$;

revoke all on function public.warehouse_reserved_quantity_v1(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.prevent_warehouse_movement_during_inventory_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason_type <> 'warehouse_inventory_adjustment'
     and exists (
       select 1 from public.warehouse_inventory_documents d
       where d.company_id = new.company_id
         and d.warehouse_id = new.warehouse_id
         and d.status = 'in_progress'
     ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_warehouse_movement_during_inventory_v1 on public.stock_ledger_entries;

create trigger trg_prevent_warehouse_movement_during_inventory_v1
before insert on public.stock_ledger_entries
for each row execute function public.prevent_warehouse_movement_during_inventory_v1();

revoke all on function public.prevent_warehouse_movement_during_inventory_v1() from public, anon, authenticated;

create or replace function public.create_warehouse_transfer_atomic_v1(
  p_company_id uuid,
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_product public.products%rowtype;
  v_existing public.warehouse_transfer_documents%rowtype;
  v_product_id uuid;
  v_uom text;
  v_balance numeric;
  v_reserved numeric;
  v_available numeric;
  v_remaining numeric;
  v_take numeric;
  v_posted_at timestamptz := clock_timestamp();
  v_fingerprint text;
  v_transfer_no text;
  v_bucket record;
  v_ledger_rows integer := 0;
begin
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_source_warehouse_id = p_destination_warehouse_id then
    raise exception 'Нельзя переместить материал в тот же склад';
  end if;
  if p_quantity is null or p_quantity::text !~ '^[0-9]+([.][0-9]+)?$' or p_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля';
  end if;

  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, p_source_warehouse_id);
  perform public.assert_warehouse_v11_actor_v1(p_company_id, p_destination_warehouse_id);
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_source_warehouse_id::text || ':' || p_product_id::text, 0
  ));

  select * into v_product from public.products
  where id = p_product_id
    and (company_id = p_company_id or company_id is null)
    and coalesce(archived, false) = false
    and coalesce(is_active, true) = true;
  if not found then raise exception 'Материал недоступен для этой компании'; end if;
  if lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''))
     not in ('pesticide', 'fertilizer', 'additive') then
    raise exception 'Перемещение доступно только для агрохимических материалов';
  end if;
  v_product_id := public.warehouse_canonical_product_id_v1(p_company_id, p_product_id);
  if v_product_id is null then raise exception 'Не удалось определить материал'; end if;
  select * into v_product from public.products where id = v_product_id;
  v_uom := public.canonical_stock_uom(coalesce(v_product.base_uom, v_product.unit));
  if v_uom not in ('kg', 'l', 'pcs') then
    raise exception 'Для материала не задана единица хранения';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'company_id', p_company_id,
    'source_warehouse_id', p_source_warehouse_id,
    'destination_warehouse_id', p_destination_warehouse_id,
    'product_id', v_product_id,
    'quantity', round(p_quantity, 3),
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text);
  select * into v_existing from public.warehouse_transfer_documents
  where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used with another transfer payload';
    end if;
    return jsonb_build_object(
      'transfer_id', v_existing.id,
      'transfer_no', v_existing.transfer_no,
      'posted_at', v_existing.posted_at,
      'quantity', v_existing.quantity,
      'uom', v_existing.uom,
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1 from public.warehouse_inventory_documents d
    where d.company_id = p_company_id
      and d.warehouse_id in (p_source_warehouse_id, p_destination_warehouse_id)
      and d.status = 'in_progress'
  ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны';
  end if;

  select coalesce(sum(sle.delta_qty_signed), 0) into v_balance
  from public.stock_ledger_entries sle
  where sle.company_id = p_company_id
    and sle.warehouse_id = p_source_warehouse_id
    and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_product_id
    and public.canonical_stock_uom(sle.uom) = v_uom;
  v_reserved := public.warehouse_reserved_quantity_v1(
    p_company_id, p_source_warehouse_id, v_product_id, v_uom
  );
  v_available := greatest(v_balance - v_reserved, 0);
  if p_quantity > v_available + 0.000001 then
    raise exception 'Недостаточно доступного остатка. Доступно: % %', round(v_available, 3), v_uom;
  end if;

  v_transfer_no := 'WT-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.warehouse_transfer_documents(
    id, company_id, transfer_no, source_warehouse_id, destination_warehouse_id,
    canonical_product_id, quantity, uom, reserved_quantity, notes, status,
    payload_fingerprint, posted_at, created_by
  ) values (
    p_idempotency_key, p_company_id, v_transfer_no, p_source_warehouse_id,
    p_destination_warehouse_id, v_product_id, round(p_quantity, 3), v_uom,
    round(v_reserved, 3), nullif(btrim(coalesce(p_notes, '')), ''), 'completed',
    v_fingerprint, v_posted_at, v_actor_id
  );

  v_remaining := round(p_quantity, 3);
  for v_bucket in
    select
      sle.product_id,
      nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') as batch_id_text,
      coalesce(nullif(sle.batch_class, ''), 'material') as batch_class,
      sum(sle.delta_qty_signed)::numeric as quantity,
      min(sle.occurred_at) as first_at
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id
      and sle.warehouse_id = p_source_warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_product_id
      and public.canonical_stock_uom(sle.uom) = v_uom
    group by sle.product_id,
      nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), ''),
      coalesce(nullif(sle.batch_class, ''), 'material')
    having sum(sle.delta_qty_signed) > 0.000001
    order by (nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') is null), min(sle.occurred_at)
  loop
    exit when v_remaining <= 0.000001;
    v_take := least(v_remaining, v_bucket.quantity);
    insert into public.stock_ledger_entries(
      company_id, product_id, warehouse_id, direction, quantity, uom,
      delta_qty_signed, reason_type, reason_ref_id, batch_id_text, batch_class,
      occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values
    (
      p_company_id, v_bucket.product_id, p_source_warehouse_id, 'out', v_take, v_uom,
      -v_take, 'warehouse_transfer', p_idempotency_key, v_bucket.batch_id_text,
      v_bucket.batch_class, v_posted_at, v_actor_id,
      nullif(btrim(coalesce(p_notes, '')), ''), case when v_uom = 'kg' then v_take else null end,
      'warehouse_transfer:' || p_idempotency_key::text, 2
    ),
    (
      p_company_id, v_bucket.product_id, p_destination_warehouse_id, 'in', v_take, v_uom,
      v_take, 'warehouse_transfer', p_idempotency_key, v_bucket.batch_id_text,
      v_bucket.batch_class, v_posted_at, v_actor_id,
      nullif(btrim(coalesce(p_notes, '')), ''), case when v_uom = 'kg' then v_take else null end,
      'warehouse_transfer:' || p_idempotency_key::text, 2
    );
    v_ledger_rows := v_ledger_rows + 2;
    v_remaining := round(v_remaining - v_take, 3);
  end loop;
  if v_remaining > 0.000001 then
    raise exception 'Не удалось распределить перемещение по доступным партиям';
  end if;

  return jsonb_build_object(
    'transfer_id', p_idempotency_key,
    'transfer_no', v_transfer_no,
    'posted_at', v_posted_at,
    'quantity', round(p_quantity, 3),
    'uom', v_uom,
    'reserved_quantity', round(v_reserved, 3),
    'ledger_rows', v_ledger_rows,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_warehouse_transfer_atomic_v1(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) from public, anon;

grant execute on function public.create_warehouse_transfer_atomic_v1(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) to authenticated;

create or replace function public.start_warehouse_inventory_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_notes text,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_snapshot_at timestamptz := clock_timestamp();
  v_inventory_no text;
  v_item_count integer;
begin
  if p_inventory_id is null then raise exception 'Inventory id is required'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, p_warehouse_id);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_warehouse_id::text || ':inventory', 0));

  if exists (
    select 1 from public.warehouse_inventory_documents
    where warehouse_id = p_warehouse_id and status = 'in_progress'
  ) then
    raise exception 'На складе уже проводится инвентаризация';
  end if;

  v_inventory_no := 'INV-' || upper(substr(replace(p_inventory_id::text, '-', ''), 1, 16));
  insert into public.warehouse_inventory_documents(
    id, company_id, inventory_no, warehouse_id, status, snapshot_at,
    started_at, started_by, notes
  ) values (
    p_inventory_id, p_company_id, v_inventory_no, p_warehouse_id, 'in_progress',
    v_snapshot_at, v_snapshot_at, v_actor_id, nullif(btrim(coalesce(p_notes, '')), '')
  );

  insert into public.warehouse_inventory_items(
    inventory_id, company_id, product_id, product_name_snapshot, product_type,
    uom, book_quantity, discovered
  )
  select
    p_inventory_id,
    p_company_id,
    balance.product_id,
    coalesce(nullif(product.trade_name, ''), product.name),
    lower(coalesce(product.product_type, product.type, product.category)),
    balance.uom,
    round(balance.quantity, 3),
    false
  from (
    select
      public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) as product_id,
      public.canonical_stock_uom(sle.uom) as uom,
      sum(sle.delta_qty_signed)::numeric as quantity
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id and sle.warehouse_id = p_warehouse_id
    group by public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id),
      public.canonical_stock_uom(sle.uom)
    having sum(sle.delta_qty_signed) > 0.000001
  ) balance
  join public.products product on product.id = balance.product_id
  where lower(coalesce(product.product_type, product.type, product.category, ''))
    in ('pesticide', 'fertilizer', 'additive');

  get diagnostics v_item_count = row_count;
  update public.warehouse_inventory_documents
  set item_count = v_item_count, updated_at = clock_timestamp()
  where id = p_inventory_id;

  return jsonb_build_object(
    'inventory_id', p_inventory_id,
    'inventory_no', v_inventory_no,
    'status', 'in_progress',
    'snapshot_at', v_snapshot_at,
    'item_count', v_item_count
  );
end;
$$;

create or replace function public.save_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_input jsonb;
  v_item public.warehouse_inventory_items%rowtype;
  v_product public.products%rowtype;
  v_actual numeric;
  v_uom text;
  v_saved integer := 0;
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  perform public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status <> 'in_progress' then
    raise exception 'Завершённую инвентаризацию нельзя редактировать';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Inventory items must be an array';
  end if;

  for v_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_actual := nullif(v_input ->> 'actual_quantity', '')::numeric;
    if v_actual is null or v_actual::text !~ '^[0-9]+([.][0-9]+)?$' or v_actual < 0 then
      raise exception 'Фактическое количество должно быть нулём или положительным числом';
    end if;

    if nullif(v_input ->> 'item_id', '') is not null then
      select * into v_item from public.warehouse_inventory_items
      where id = (v_input ->> 'item_id')::uuid and inventory_id = p_inventory_id
      for update;
      if not found then raise exception 'Строка инвентаризации не найдена'; end if;
      update public.warehouse_inventory_items
      set actual_quantity = round(v_actual, 3),
          difference_quantity = round(v_actual - book_quantity, 3),
          updated_at = clock_timestamp()
      where id = v_item.id;
      v_saved := v_saved + 1;
    else
      select * into v_product from public.products
      where id = (v_input ->> 'product_id')::uuid
        and (company_id = p_company_id or company_id is null)
        and coalesce(archived, false) = false
        and coalesce(is_active, true) = true;
      if not found then raise exception 'Обнаруженный материал недоступен'; end if;
      if lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''))
         not in ('pesticide', 'fertilizer', 'additive') then
        raise exception 'Инвентаризация поддерживает только агрохимические материалы';
      end if;
      v_product.id := public.warehouse_canonical_product_id_v1(p_company_id, v_product.id);
      select * into v_product from public.products where id = v_product.id;
      v_uom := public.canonical_stock_uom(coalesce(v_product.base_uom, v_product.unit));
      if v_uom not in ('kg', 'l', 'pcs') then
        raise exception 'Для материала не задана единица хранения';
      end if;
      insert into public.warehouse_inventory_items(
        inventory_id, company_id, product_id, product_name_snapshot, product_type,
        uom, book_quantity, actual_quantity, difference_quantity, discovered
      ) values (
        p_inventory_id, p_company_id, v_product.id,
        coalesce(nullif(v_product.trade_name, ''), v_product.name),
        lower(coalesce(v_product.product_type, v_product.type, v_product.category)),
        v_uom, 0, round(v_actual, 3), round(v_actual, 3), true
      )
      on conflict (inventory_id, product_id, uom) do update
      set actual_quantity = excluded.actual_quantity,
          difference_quantity = excluded.difference_quantity,
          updated_at = clock_timestamp();
      v_saved := v_saved + 1;
    end if;
  end loop;

  update public.warehouse_inventory_documents d
  set item_count = (select count(*) from public.warehouse_inventory_items i where i.inventory_id = d.id),
      difference_count = (
        select count(*) from public.warehouse_inventory_items i
        where i.inventory_id = d.id and abs(coalesce(i.difference_quantity, 0)) > 0.000001
      ),
      updated_at = clock_timestamp()
  where d.id = p_inventory_id;

  return jsonb_build_object('inventory_id', p_inventory_id, 'saved_items', v_saved);
end;
$$;

create or replace function public.complete_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_actor_id uuid;
  v_item public.warehouse_inventory_items%rowtype;
  v_current numeric;
  v_difference numeric;
  v_ledger_id uuid;
  v_completed_at timestamptz := clock_timestamp();
  v_difference_count integer := 0;
  v_ledger_rows integer := 0;
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status = 'completed' then
    return jsonb_build_object(
      'inventory_id', v_document.id,
      'inventory_no', v_document.inventory_no,
      'status', v_document.status,
      'difference_count', v_document.difference_count,
      'idempotent_replay', true
    );
  end if;
  if v_document.status <> 'in_progress' then raise exception 'Инвентаризация отменена'; end if;
  if exists (
    select 1 from public.warehouse_inventory_items
    where inventory_id = p_inventory_id and actual_quantity is null
  ) then
    raise exception 'Укажите фактическое количество для всех материалов';
  end if;

  for v_item in
    select * from public.warehouse_inventory_items
    where inventory_id = p_inventory_id
    order by product_name_snapshot, id
    for update
  loop
    select coalesce(sum(sle.delta_qty_signed), 0) into v_current
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id
      and sle.warehouse_id = v_document.warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_item.product_id
      and public.canonical_stock_uom(sle.uom) = v_item.uom;
    if abs(v_current - v_item.book_quantity) > 0.000001 then
      raise exception 'Учётный остаток изменился после начала инвентаризации';
    end if;

    v_difference := round(v_item.actual_quantity - v_item.book_quantity, 3);
    update public.warehouse_inventory_items
    set difference_quantity = v_difference, updated_at = v_completed_at
    where id = v_item.id;
    if abs(v_difference) <= 0.000001 then continue; end if;

    v_ledger_id := gen_random_uuid();
    insert into public.stock_ledger_entries(
      id, company_id, product_id, warehouse_id, direction, quantity, uom,
      delta_qty_signed, reason_type, reason_ref_id, batch_class, occurred_at,
      created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      v_ledger_id, p_company_id, v_item.product_id, v_document.warehouse_id,
      case when v_difference > 0 then 'in'::public.ledger_direction else 'out'::public.ledger_direction end,
      abs(v_difference), v_item.uom, v_difference,
      'warehouse_inventory_adjustment', p_inventory_id, 'material', v_completed_at,
      v_actor_id, 'Инвентаризация ' || v_document.inventory_no,
      case when v_item.uom = 'kg' then abs(v_difference) else null end,
      'warehouse_inventory:' || p_inventory_id::text, 2
    );
    update public.warehouse_inventory_items
    set adjustment_ledger_entry_id = v_ledger_id
    where id = v_item.id;
    v_difference_count := v_difference_count + 1;
    v_ledger_rows := v_ledger_rows + 1;
  end loop;

  update public.warehouse_inventory_documents
  set status = 'completed', completed_at = v_completed_at, completed_by = v_actor_id,
      difference_count = v_difference_count, updated_at = v_completed_at
  where id = p_inventory_id
  returning * into v_document;

  return jsonb_build_object(
    'inventory_id', v_document.id,
    'inventory_no', v_document.inventory_no,
    'status', v_document.status,
    'completed_at', v_document.completed_at,
    'difference_count', v_difference_count,
    'ledger_rows', v_ledger_rows,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.cancel_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_actor_id uuid;
  v_cancelled_at timestamptz := clock_timestamp();
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status = 'completed' then raise exception 'Завершённую инвентаризацию нельзя отменить'; end if;
  if v_document.status = 'cancelled' then
    return jsonb_build_object('inventory_id', v_document.id, 'status', 'cancelled', 'idempotent_replay', true);
  end if;
  update public.warehouse_inventory_documents
  set status = 'cancelled', cancelled_at = v_cancelled_at, cancelled_by = v_actor_id,
      updated_at = v_cancelled_at
  where id = p_inventory_id;
  return jsonb_build_object('inventory_id', p_inventory_id, 'status', 'cancelled', 'idempotent_replay', false);
end;
$$;

revoke all on function public.start_warehouse_inventory_v1(uuid, uuid, text, uuid) from public, anon;

revoke all on function public.save_warehouse_inventory_v1(uuid, uuid, jsonb) from public, anon;

revoke all on function public.complete_warehouse_inventory_v1(uuid, uuid) from public, anon;

revoke all on function public.cancel_warehouse_inventory_v1(uuid, uuid) from public, anon;

grant execute on function public.start_warehouse_inventory_v1(uuid, uuid, text, uuid) to authenticated;

grant execute on function public.save_warehouse_inventory_v1(uuid, uuid, jsonb) to authenticated;

grant execute on function public.complete_warehouse_inventory_v1(uuid, uuid) to authenticated;

grant execute on function public.cancel_warehouse_inventory_v1(uuid, uuid) to authenticated;

create or replace function public.create_warehouse_receipt_atomic_v3(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_received_at timestamptz;
begin
  select nullif(t.audit_json #>> '{receipt_payload,received_at}', '')::timestamptz
    into v_received_at
  from public.tickets t
  where t.id = p_idempotency_key and t.company_id = p_company_id;
  v_received_at := coalesce(v_received_at, clock_timestamp());
  return public.create_warehouse_receipt_atomic_v2(
    p_company_id,
    p_warehouse_id,
    v_received_at,
    p_supplier_company_counterparty_id,
    p_supplier_global_counterparty_id,
    p_document_no,
    p_notes,
    p_lines,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon;

grant execute on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

comment on table public.warehouse_transfer_documents is
  'Posted agrochemical warehouse transfers. Quantity remains sourced from stock_ledger_entries.';

comment on table public.warehouse_inventory_documents is
  'Warehouse inventory snapshots with system-managed in_progress/completed/cancelled lifecycle.';

comment on table public.warehouse_inventory_items is
  'Book-versus-actual inventory lines. Completion creates ledger adjustments for non-zero differences.';

notify pgrst, 'reload schema';

-- END SOURCE: 20260721151313_warehouse_v11_inventory_transfers.sql



-- BEGIN SOURCE: 20260721180525_processing_session_finalize_rpc.sql

create or replace function public.finalize_batch_transformation_for_session_v1(
  p_transformation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  return public.finalize_batch_transformation(p_transformation_id, v_auth_user_id);
end;
$$;

revoke all on function public.finalize_batch_transformation_for_session_v1(uuid) from public;

revoke all on function public.finalize_batch_transformation_for_session_v1(uuid) from anon;

grant execute on function public.finalize_batch_transformation_for_session_v1(uuid) to authenticated;

grant execute on function public.finalize_batch_transformation_for_session_v1(uuid) to service_role;

-- END SOURCE: 20260721180525_processing_session_finalize_rpc.sql



-- BEGIN SOURCE: 20260721180750_weighbridge_session_void_rpc.sql

create or replace function public.void_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  return public.void_ticket_with_storno_v2(p_ticket_id, v_auth_user_id, p_reason);
end;
$$;

revoke all on function public.void_weighbridge_ticket_for_session_v1(uuid, text) from public;

revoke all on function public.void_weighbridge_ticket_for_session_v1(uuid, text) from anon;

grant execute on function public.void_weighbridge_ticket_for_session_v1(uuid, text) to authenticated;

grant execute on function public.void_weighbridge_ticket_for_session_v1(uuid, text) to service_role;

-- END SOURCE: 20260721180750_weighbridge_session_void_rpc.sql



-- BEGIN SOURCE: 20260721193142_weighbridge_impurity_removal_v1.sql

create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_line_count integer;
  v_net numeric(14,3);
  v_received numeric(14,3);
  v_removed numeric(14,3);
  v_stock numeric(14,3);
  v_available numeric(14,3);
begin
  select *
    into v_actor
    from public.profiles
   where id = auth.uid()
     and status = 'active';

  if not found then
    raise exception 'Active actor profile not found';
  end if;

  select *
    into v_ticket
    from public.tickets
   where id = p_ticket_id
   for update;

  if not found then
    raise exception 'Ticket not found';
  end if;
  if v_ticket.company_id <> v_actor.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if coalesce(v_actor.role, '') not in ('admin', 'global_admin', 'company_admin', 'director', 'warehouse', 'warehouse_operator', 'weighman') then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;
  if coalesce(v_ticket.is_voided, false) or v_ticket.status = 'voided' then
    raise exception 'Voided ticket cannot be finalized';
  end if;
  if coalesce(v_ticket.is_finalized, false) or v_ticket.status = 'finalized' then
    return p_ticket_id;
  end if;
  if v_ticket.direction <> 'outgoing' or v_ticket.op_type <> 'weighbridge_impurities' then
    raise exception 'Ticket is not a weighbridge impurity removal';
  end if;
  if v_ticket.batch_id is null or v_ticket.warehouse_from_id is null then
    raise exception 'Harvest batch and source warehouse are required';
  end if;
  if v_ticket.vehicle_id is null or v_ticket.driver_id is null then
    raise exception 'Vehicle and driver are required';
  end if;
  if coalesce(v_ticket.audit_json->>'impurity_type', '') not in ('soil_and_trash', 'nonconforming_crop', 'plant_residues', 'other') then
    raise exception 'Impurity type is required';
  end if;

  select count(*)
    into v_line_count
    from public.ticket_lines
   where ticket_id = p_ticket_id;
  if v_line_count <> 1 then
    raise exception 'Impurity removal requires exactly one ticket line';
  end if;

  select *
    into v_line
    from public.ticket_lines
   where ticket_id = p_ticket_id
   order by created_at asc
   limit 1
   for update;

  select *
    into v_batch
    from public.inventory_batches
   where id = v_ticket.batch_id
     and company_id = v_ticket.company_id
     and origin_type = 'harvest'
   for update;

  if not found then
    raise exception 'Harvest batch not found in ticket company';
  end if;
  if coalesce(v_line.batch_id, '') <> v_batch.id::text then
    raise exception 'Ticket line batch does not match selected harvest batch';
  end if;
  if v_line.product_id <> v_batch.product_id
     or coalesce(v_line.crop_id::text, '') <> coalesce(v_batch.crop_id::text, '')
     or coalesce(v_line.variety_id::text, '') <> coalesce(v_batch.variety_id::text, '')
     or coalesce(v_line.reproduction_id::text, '') <> coalesce(v_batch.reproduction_id::text, '') then
    raise exception 'Ticket line identity does not match selected harvest batch';
  end if;
  if not exists (
    select 1
      from public.warehouses w
     where w.id = v_ticket.warehouse_from_id
       and w.company_id = v_ticket.company_id
       and coalesce(w.archived, false) = false
       and coalesce(w.is_archived, false) = false
       and lower(coalesce(w.warehouse_type, '')) in ('grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator')
  ) then
    raise exception 'Selected warehouse is not available for harvest';
  end if;

  if v_ticket.gross_weight_kg is null or v_ticket.tare_weight_kg is null then
    raise exception 'Gross and tare are required before finalization';
  end if;
  v_net := round((v_ticket.gross_weight_kg - v_ticket.tare_weight_kg)::numeric, 3);
  if v_net <= 0 then
    raise exception 'Net weight must be greater than zero';
  end if;

  if exists (
    select 1
      from public.stock_ledger_entries sle
     where sle.ticket_id = p_ticket_id
       and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Ticket already has ledger entries';
  end if;

  select coalesce(sum(t.net_weight_kg), 0)
    into v_received
    from public.tickets t
   where t.company_id = v_ticket.company_id
     and t.batch_id = v_batch.id
     and t.op_type = 'harvest_incoming'
     and t.status = 'finalized'
     and coalesce(t.is_finalized, false) = true
     and coalesce(t.is_voided, false) = false;

  select coalesce(sum(t.net_weight_kg), 0)
    into v_removed
    from public.tickets t
   where t.company_id = v_ticket.company_id
     and t.batch_id = v_batch.id
     and t.op_type = 'weighbridge_impurities'
     and t.status = 'finalized'
     and coalesce(t.is_finalized, false) = true
     and coalesce(t.is_voided, false) = false
     and t.id <> p_ticket_id;

  select coalesce(sum(sbi.quantity), 0)
    into v_stock
    from public.v_stock_balance_identity sbi
   where sbi.company_id = v_ticket.company_id
     and sbi.warehouse_id = v_ticket.warehouse_from_id
     and sbi.product_id = v_batch.product_id
     and coalesce(sbi.variety_id::text, '') = coalesce(v_batch.variety_id::text, '')
     and coalesce(sbi.reproduction_id::text, '') = coalesce(v_batch.reproduction_id::text, '')
     and coalesce(sbi.batch_id, '') = v_batch.id::text
     and coalesce(sbi.batch_class, 'commodity') = coalesce(v_batch.batch_class, 'commodity')
     and sbi.uom = 'kg';

  v_available := greatest(0, least(v_received - v_removed, v_stock));
  if v_net > v_available + 0.0005 then
    raise exception 'IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|%', trim(to_char(v_available, 'FM999999999990.000'));
  end if;

  update public.ticket_lines
     set quantity = v_net,
         net_line_weight_kg = v_net,
         mass_kg = v_net
   where id = v_line.id;

  insert into public.stock_ledger_entries (
    company_id,
    ticket_id,
    product_id,
    variety_id,
    reproduction_id,
    batch_id_text,
    batch_class,
    warehouse_id,
    direction,
    quantity,
    uom,
    delta_qty_signed,
    reason_type,
    reason_ref_id,
    occurred_at,
    created_by,
    notes
  ) values (
    v_ticket.company_id,
    v_ticket.id,
    v_batch.product_id,
    v_batch.variety_id,
    v_batch.reproduction_id,
    v_batch.id::text,
    coalesce(v_batch.batch_class, 'commodity'),
    v_ticket.warehouse_from_id,
    'out',
    v_net,
    'kg',
    -v_net,
    'WEIGHBRIDGE_IMPURITIES',
    v_ticket.id,
    now(),
    v_actor.id,
    v_ticket.notes
  );

  update public.tickets
     set net_weight_kg = v_net,
         is_finalized = true,
         status = 'finalized',
         closed_by = v_actor.id,
         finalized_at = now(),
         audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
           'received_kg_before_removal', v_received,
           'removed_kg_before_removal', v_removed,
           'clean_mass_kg_before_removal', v_available,
           'clean_mass_kg_after_removal', v_available - v_net
         ),
         updated_at = now()
   where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from public;

revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from anon;

grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to authenticated;

grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to service_role;

notify pgrst, 'reload schema';

-- END SOURCE: 20260721193142_weighbridge_impurity_removal_v1.sql



-- BEGIN SOURCE: 20260721201500_weighbridge_admin_storno_session_rpc.sql

create or replace function public.void_finalized_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  return public.void_ticket_with_storno_v2(
    p_ticket_id,
    v_auth_user_id,
    p_reason
  );
end;
$$;

revoke all on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) from public;

revoke all on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) from anon;

grant execute on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) to authenticated;

grant execute on function public.void_finalized_weighbridge_ticket_for_session_v1(uuid, text) to service_role;

-- END SOURCE: 20260721201500_weighbridge_admin_storno_session_rpc.sql



-- BEGIN SOURCE: 20260722100549_weighbridge_v13_inventory_approval.sql

-- One legal identity may act as supplier and buyer without duplicating its tax identity.
alter table public.counterparties
  add column if not exists roles text[] not null default '{}'::text[],
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists short_name text;

alter table public.global_counterparties
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists short_name text;

alter table public.counterparties
  drop constraint if exists counterparties_roles_check,
  add constraint counterparties_roles_check check (
    cardinality(roles) > 0
    and roles <@ array['supplier', 'buyer', 'carrier', 'service', 'other']::text[]
  );

create or replace function public.link_global_counterparty_role_to_company_v2(
  p_company_id uuid,
  p_global_counterparty_id uuid,
  p_role text
)
returns public.counterparties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_global public.global_counterparties%rowtype;
  v_row public.counterparties%rowtype;
  v_roles text[];
begin
  if p_role not in ('supplier', 'buyer') then raise exception 'Unsupported counterparty role'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin access required' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_global from public.global_counterparties
  where id = p_global_counterparty_id and archived = false and is_active = true;
  if not found then raise exception 'Global counterparty is unavailable'; end if;

  select * into v_row from public.counterparties
  where company_id = p_company_id
    and (global_counterparty_id = v_global.id or (country_code = v_global.country_code and bin_iin = v_global.tax_id))
  order by (global_counterparty_id = v_global.id) desc limit 1 for update;
  if found then
    if v_row.global_counterparty_id is not null and v_row.global_counterparty_id <> v_global.id then
      raise exception 'Tax identity is linked to another global counterparty';
    end if;
    v_roles := array(select distinct value from unnest(coalesce(v_row.roles, '{}'::text[]) || p_role) value order by value);
    update public.counterparties set
      global_counterparty_id = v_global.id,
      name = v_global.legal_name,
      bin_iin = v_global.tax_id,
      country_code = v_global.country_code,
      roles = v_roles,
      counterparty_type = case when v_roles @> array['supplier','buyer']::text[] then 'both' else p_role end,
      is_active = true,
      archived = false
    where id = v_row.id returning * into v_row;
  else
    insert into public.counterparties(
      company_id, global_counterparty_id, name, counterparty_type, roles,
      bin_iin, country_code, is_active, archived, created_by
    ) values (
      p_company_id, v_global.id, v_global.legal_name, p_role, array[p_role],
      v_global.tax_id, v_global.country_code, true, false, v_actor.id
    ) returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_local_counterparty_role_v2(
  p_company_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_country_code text,
  p_role text,
  p_aliases text[] default '{}'::text[]
)
returns public.counterparties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_row public.counterparties%rowtype;
  v_roles text[];
begin
  if p_role not in ('supplier', 'buyer') then raise exception 'Unsupported counterparty role'; end if;
  if nullif(btrim(p_legal_name), '') is null or p_tax_id !~ '^[0-9]+$' or p_country_code not in ('KZ','RU') then
    raise exception 'Invalid counterparty identity';
  end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin access required' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_row from public.counterparties
  where company_id = p_company_id and country_code = p_country_code and bin_iin = p_tax_id
  limit 1 for update;
  if found then
    v_roles := array(select distinct value from unnest(coalesce(v_row.roles, '{}'::text[]) || p_role) value order by value);
    update public.counterparties set
      roles = v_roles,
      aliases = array(select distinct value from unnest(coalesce(v_row.aliases, '{}'::text[]) || coalesce(p_aliases, '{}'::text[])) value where btrim(value) <> '' order by value),
      counterparty_type = case when v_roles @> array['supplier','buyer']::text[] then 'both' else p_role end,
      is_active = true,
      archived = false
    where id = v_row.id returning * into v_row;
    return v_row;
  end if;
  insert into public.counterparties(
    company_id, name, counterparty_type, roles, aliases, bin_iin, country_code,
    is_active, archived, created_by
  ) values (
    p_company_id, btrim(p_legal_name), p_role, array[p_role], coalesce(p_aliases, '{}'::text[]),
    p_tax_id, p_country_code, true, false, v_actor.id
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.link_global_counterparty_role_to_company_v2(uuid, uuid, text) from public, anon;

revoke all on function public.create_local_counterparty_role_v2(uuid, text, text, text, text, text[]) from public, anon;

grant execute on function public.link_global_counterparty_role_to_company_v2(uuid, uuid, text) to authenticated;

grant execute on function public.create_local_counterparty_role_v2(uuid, text, text, text, text, text[]) to authenticated;

-- Invoice receipts use one document with line-specific warehouses and catalog stock units.
create or replace function public.create_supplier_invoice_atomic_v1(
  p_company_id uuid,
  p_supplier_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_supplier public.counterparties%rowtype;
  v_existing public.tickets%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_warehouse_id uuid;
  v_quantity numeric;
  v_uom text;
  v_ticket_no text;
  v_line_count integer := 0;
begin
  if p_idempotency_key is null or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'Idempotency key and fingerprint are required';
  end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','warehouse','warehouse_operator','weighman') then
    raise exception 'Actor role is not allowed for supplier invoice' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_supplier from public.counterparties
  where id = p_supplier_id and company_id = p_company_id and is_active = true and archived = false
    and (roles @> array['supplier']::text[] or counterparty_type in ('supplier','both'));
  if not found then raise exception 'Supplier is unavailable'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one invoice line is required';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.reference_vehicles where id = p_vehicle_id and company_id = p_company_id and is_active = true and archived = false
  ) then raise exception 'Vehicle is unavailable'; end if;
  if p_driver_id is not null and not exists (
    select 1 from public.reference_specialists where id = p_driver_id and company_id = p_company_id and status = 'active' and archived = false
  ) then raise exception 'Driver is unavailable'; end if;

  select * into v_existing from public.tickets where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if coalesce(v_existing.audit_json ->> 'request_fingerprint', '') <> p_request_fingerprint then
      raise exception 'Idempotency key was already used with another payload';
    end if;
    return jsonb_build_object('receipt_id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_warehouse_id := nullif(v_line ->> 'warehouse_id', '')::uuid;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if v_warehouse_id is null or coalesce(v_quantity, 0) <= 0 then raise exception 'Each line requires warehouse and positive quantity'; end if;
    if not exists (select 1 from public.warehouses where id = v_warehouse_id and company_id = p_company_id and coalesce(archived,false)=false and coalesce(is_archived,false)=false) then
      raise exception 'Line warehouse is unavailable';
    end if;
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null) and coalesce(archived,false)=false and coalesce(is_active,true)=true;
    if not found then raise exception 'Line product is unavailable'; end if;
    v_uom := lower(btrim(coalesce(v_product.stock_unit, '')));
    if v_uom not in ('kg','l','pcs') then raise exception 'Product stock_unit is required'; end if;
  end loop;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.tickets(
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, supplier_id, destination_kind, responsible_user_id,
    created_by, weigh_method, receipt_mode, supplier_receipt_kind,
    supplier_document_no, manual_correction_reason, vehicle_id, driver_id,
    notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt', 'ready_to_close', 'incoming',
    'supplier', v_supplier.name, v_supplier.id, 'warehouse', v_actor.id,
    v_actor.id, 'manual_override_with_reason', 'direct', 'generic',
    nullif(btrim(coalesce(p_document_no,'')), ''), 'Supplier invoice', p_vehicle_id, p_driver_id,
    nullif(btrim(coalesce(p_notes,'')), ''), jsonb_build_object(
      'source', 'weighbridge_invoice_v1', 'request_fingerprint', p_request_fingerprint,
      'line_count', jsonb_array_length(p_lines)
    ), clock_timestamp(), clock_timestamp()
  );

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_warehouse_id := (v_line ->> 'warehouse_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_uom := lower(btrim(v_product.stock_unit));
    insert into public.ticket_lines(
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      mass_kg, unit_source, unit_contract_version, unit_price, notes
    ) values (
      p_idempotency_key, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name,''), v_product.name),
      v_uom, round(v_quantity,3), v_warehouse_id,
      nullif(btrim(coalesce(v_line ->> 'lot_number','')), ''),
      case when coalesce(v_product.is_seed_material,false) then 'seed' else 'material' end,
      'material', case when v_uom='kg' then round(v_quantity,3) else null end,
      'supplier_invoice:' || p_idempotency_key::text, 2,
      nullif(v_line ->> 'unit_price','')::numeric,
      nullif(btrim(coalesce(v_line ->> 'notes','')), '')
    );
    v_line_count := v_line_count + 1;
  end loop;
  perform public.finalize_weighbridge_ticket_v2(p_idempotency_key, v_actor.id);
  return jsonb_build_object('receipt_id', p_idempotency_key, 'receipt_no', v_ticket_no, 'status', 'finalized', 'line_count', v_line_count, 'idempotent_replay', false);
end;
$$;

revoke all on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) from public, anon;

grant execute on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) to authenticated;

-- Inventory approval lifecycle. Counters never receive permission to post ledger adjustments.
alter table public.warehouse_inventory_documents
  add column if not exists assigned_to uuid references public.profiles(id) on delete restrict,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references public.profiles(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejection_comment text;

alter table public.warehouse_inventory_items
  add column if not exists batch_id_text text,
  add column if not exists batch_class text;

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_status_check;

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_completion_check;

alter table public.warehouse_inventory_items
  drop constraint if exists warehouse_inventory_items_identity_unique;

create unique index if not exists warehouse_inventory_items_identity_v2_uidx
  on public.warehouse_inventory_items(
    inventory_id, product_id, uom,
    coalesce(batch_id_text, ''), coalesce(batch_class, 'material')
  );

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_status_check;

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_completion_check;

alter table public.warehouse_inventory_documents add constraint warehouse_inventory_documents_status_check
  check (status in ('in_progress','awaiting_approval','approved','rejected','cancelled'));

alter table public.warehouse_inventory_documents add constraint warehouse_inventory_documents_approval_check check (
  (status in ('in_progress','rejected') and approved_at is null and cancelled_at is null)
  or (status = 'awaiting_approval' and submitted_at is not null and submitted_by is not null and approved_at is null and cancelled_at is null)
  or (status = 'approved' and approved_at is not null and approved_by is not null and completed_at is not null and completed_by is not null and cancelled_at is null)
  or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and approved_at is null)
);

drop index if exists public.warehouse_inventory_one_active_per_warehouse;

create unique index warehouse_inventory_one_active_per_warehouse
  on public.warehouse_inventory_documents(warehouse_id)
  where status in ('in_progress','awaiting_approval','rejected');

create or replace function public.prevent_warehouse_movement_during_inventory_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reason_type <> 'warehouse_inventory_adjustment' and exists (
    select 1 from public.warehouse_inventory_documents d
    where d.company_id = new.company_id and d.warehouse_id = new.warehouse_id
      and d.status in ('in_progress','awaiting_approval','rejected')
  ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.inventory_actor_v2(p_company_id uuid, p_roles text[])
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or not (v_actor.role = any(p_roles)) then raise exception 'Inventory action is forbidden' using errcode='42501'; end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then raise exception 'Cross-company access denied' using errcode='42501'; end if;
  return v_actor;
end;
$$;

revoke all on function public.inventory_actor_v2(uuid,text[]) from public,anon,authenticated;

create or replace function public.start_warehouse_inventory_v2(
  p_company_id uuid, p_warehouse_id uuid, p_assigned_to uuid, p_notes text, p_inventory_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_assignee public.profiles%rowtype; v_warehouse public.warehouses%rowtype; v_at timestamptz:=clock_timestamp(); v_count integer; v_no text;
begin
  v_actor := public.inventory_actor_v2(p_company_id, array['global_admin','company_admin']);
  select * into v_warehouse from public.warehouses where id=p_warehouse_id and company_id=p_company_id and coalesce(archived,false)=false and coalesce(is_archived,false)=false;
  if not found then raise exception 'Warehouse is unavailable'; end if;
  select * into v_assignee from public.profiles where id=p_assigned_to and company_id=p_company_id and status='active';
  if not found then raise exception 'Assigned counter is unavailable'; end if;
  if coalesce(v_warehouse.warehouse_type,'') in ('grain','seed','harvest','crop','elevator') then
    if v_assignee.role <> 'weighman' then raise exception 'Grain warehouse inventory must be assigned to a weighbridge operator'; end if;
  elsif v_assignee.role not in ('warehouse','warehouse_operator') then
    raise exception 'Warehouse inventory must be assigned to a warehousekeeper';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_warehouse_id::text||':inventory',0));
  if exists(select 1 from public.warehouse_inventory_documents where warehouse_id=p_warehouse_id and status in ('in_progress','awaiting_approval','rejected')) then raise exception 'На складе уже проводится инвентаризация'; end if;
  v_no := 'INV-'||upper(substr(replace(p_inventory_id::text,'-',''),1,16));
  insert into public.warehouse_inventory_documents(id,company_id,inventory_no,warehouse_id,status,snapshot_at,started_at,started_by,assigned_to,notes)
  values(p_inventory_id,p_company_id,v_no,p_warehouse_id,'in_progress',v_at,v_at,v_actor.id,p_assigned_to,nullif(btrim(coalesce(p_notes,'')),''));
  insert into public.warehouse_inventory_items(inventory_id,company_id,product_id,product_name_snapshot,product_type,uom,book_quantity,discovered,batch_id_text,batch_class)
  select p_inventory_id,p_company_id,b.product_id,coalesce(nullif(p.trade_name,''),p.name),lower(coalesce(p.product_type,p.type,p.category)),b.uom,round(b.quantity,3),false,b.batch_id_text,b.batch_class
  from (
    select public.warehouse_canonical_product_id_v1(p_company_id,s.product_id) product_id, public.canonical_stock_uom(s.uom) uom,
      nullif(btrim(coalesce(s.batch_id_text,s.batch_id,'')),'') batch_id_text, coalesce(nullif(s.batch_class,''),'material') batch_class,
      sum(s.delta_qty_signed)::numeric quantity
    from public.stock_ledger_entries s where s.company_id=p_company_id and s.warehouse_id=p_warehouse_id
    group by 1,2,3,4 having sum(s.delta_qty_signed)>0.000001
  ) b join public.products p on p.id=b.product_id;
  get diagnostics v_count=row_count;
  update public.warehouse_inventory_documents set item_count=v_count,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'inventory_no',v_no,'status','in_progress','assigned_to',p_assigned_to,'item_count',v_count);
end;
$$;

create or replace function public.save_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_input jsonb; v_item public.warehouse_inventory_items%rowtype; v_actual numeric; v_saved int:=0;
begin
  v_actor := public.inventory_actor_v2(p_company_id,array['global_admin','warehouse','warehouse_operator','weighman']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_actor.role<>'global_admin' and v_actor.id<>v_doc.assigned_to then raise exception 'Only the assigned counter can enter quantities' using errcode='42501'; end if;
  if v_doc.status not in ('in_progress','rejected') then raise exception 'Inventory is not editable'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Inventory items must be an array'; end if;
  for v_input in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_actual:=nullif(v_input->>'actual_quantity','')::numeric;
    if v_actual is null or v_actual<0 then raise exception 'Фактическое количество должно быть нулём или положительным'; end if;
    select * into v_item from public.warehouse_inventory_items where id=(v_input->>'item_id')::uuid and inventory_id=p_inventory_id for update;
    if not found then raise exception 'Строка инвентаризации не найдена'; end if;
    update public.warehouse_inventory_items set actual_quantity=round(v_actual,3),difference_quantity=round(v_actual-book_quantity,3),updated_at=clock_timestamp() where id=v_item.id;
    v_saved:=v_saved+1;
  end loop;
  update public.warehouse_inventory_documents d set status='in_progress',rejected_at=null,rejected_by=null,rejection_comment=null,
    difference_count=(select count(*) from public.warehouse_inventory_items i where i.inventory_id=d.id and abs(coalesce(i.difference_quantity,0))>0.000001),updated_at=clock_timestamp()
  where d.id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'saved_items',v_saved,'status','in_progress');
end;
$$;

create or replace function public.submit_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','warehouse','warehouse_operator','weighman']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_actor.role<>'global_admin' and v_actor.id<>v_doc.assigned_to then raise exception 'Only the assigned counter can submit' using errcode='42501'; end if;
  if v_doc.status not in ('in_progress','rejected') then raise exception 'Inventory cannot be submitted'; end if;
  if exists(select 1 from public.warehouse_inventory_items where inventory_id=p_inventory_id and actual_quantity is null) then raise exception 'Укажите фактическое количество для всех позиций'; end if;
  update public.warehouse_inventory_documents set status='awaiting_approval',submitted_at=v_at,submitted_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','awaiting_approval','ledger_rows',0);
end;
$$;

create or replace function public.approve_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_item public.warehouse_inventory_items%rowtype; v_current numeric; v_diff numeric; v_ledger uuid; v_at timestamptz:=clock_timestamp(); v_rows int:=0;
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_doc.status='approved' then return jsonb_build_object('inventory_id',p_inventory_id,'status','approved','idempotent_replay',true); end if;
  if v_doc.status<>'awaiting_approval' then raise exception 'Inventory is not awaiting approval'; end if;
  if v_actor.id=v_doc.assigned_to then raise exception 'Counter cannot approve own inventory' using errcode='42501'; end if;
  for v_item in select * from public.warehouse_inventory_items where inventory_id=p_inventory_id order by id for update loop
    select coalesce(sum(s.delta_qty_signed),0) into v_current from public.stock_ledger_entries s where s.company_id=p_company_id and s.warehouse_id=v_doc.warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id,s.product_id)=v_item.product_id and public.canonical_stock_uom(s.uom)=v_item.uom
      and nullif(btrim(coalesce(s.batch_id_text,s.batch_id,'')),'') is not distinct from v_item.batch_id_text
      and coalesce(nullif(s.batch_class,''),'material')=coalesce(v_item.batch_class,'material');
    if abs(v_current-v_item.book_quantity)>0.000001 then raise exception 'Учётный остаток изменился после начала инвентаризации'; end if;
    v_diff:=round(v_item.actual_quantity-v_item.book_quantity,3);
    if abs(v_diff)<=0.000001 then continue; end if;
    v_ledger:=gen_random_uuid();
    insert into public.stock_ledger_entries(id,company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,reason_ref_id,batch_id_text,batch_class,occurred_at,created_by,notes,mass_kg,unit_source,unit_contract_version)
    values(v_ledger,p_company_id,v_item.product_id,v_doc.warehouse_id,case when v_diff>0 then 'in'::public.ledger_direction else 'out'::public.ledger_direction end,abs(v_diff),v_item.uom,v_diff,'warehouse_inventory_adjustment',p_inventory_id,v_item.batch_id_text,coalesce(v_item.batch_class,'material'),v_at,v_actor.id,'Инвентаризация '||v_doc.inventory_no,case when v_item.uom='kg' then abs(v_diff) else null end,'warehouse_inventory:'||p_inventory_id::text,2);
    update public.warehouse_inventory_items set adjustment_ledger_entry_id=v_ledger,difference_quantity=v_diff,updated_at=v_at where id=v_item.id;
    v_rows:=v_rows+1;
  end loop;
  update public.warehouse_inventory_documents set status='approved',approved_at=v_at,approved_by=v_actor.id,completed_at=v_at,completed_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','approved','ledger_rows',v_rows,'idempotent_replay',false);
end;
$$;

create or replace function public.reject_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid,p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Комментарий для пересчёта обязателен'; end if;
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found or v_doc.status<>'awaiting_approval' then raise exception 'Inventory is not awaiting approval'; end if;
  if v_actor.id=v_doc.assigned_to then raise exception 'Counter cannot reject own inventory' using errcode='42501'; end if;
  update public.warehouse_inventory_documents set status='rejected',rejected_at=v_at,rejected_by=v_actor.id,rejection_comment=btrim(p_comment),updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','rejected','ledger_rows',0);
end;
$$;

create or replace function public.cancel_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_doc.status='approved' then raise exception 'Approved inventory cannot be cancelled'; end if;
  update public.warehouse_inventory_documents set status='cancelled',cancelled_at=v_at,cancelled_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','cancelled');
end;
$$;

revoke execute on function public.start_warehouse_inventory_v1(uuid,uuid,text,uuid) from authenticated;

revoke execute on function public.save_warehouse_inventory_v1(uuid,uuid,jsonb) from authenticated;

revoke execute on function public.complete_warehouse_inventory_v1(uuid,uuid) from authenticated;

revoke execute on function public.cancel_warehouse_inventory_v1(uuid,uuid) from authenticated;

revoke all on function public.start_warehouse_inventory_v2(uuid,uuid,uuid,text,uuid) from public,anon;

revoke all on function public.save_warehouse_inventory_v2(uuid,uuid,jsonb) from public,anon;

revoke all on function public.submit_warehouse_inventory_v2(uuid,uuid) from public,anon;

revoke all on function public.approve_warehouse_inventory_v2(uuid,uuid) from public,anon;

revoke all on function public.reject_warehouse_inventory_v2(uuid,uuid,text) from public,anon;

revoke all on function public.cancel_warehouse_inventory_v2(uuid,uuid) from public,anon;

grant execute on function public.start_warehouse_inventory_v2(uuid,uuid,uuid,text,uuid) to authenticated;

grant execute on function public.save_warehouse_inventory_v2(uuid,uuid,jsonb) to authenticated;

grant execute on function public.submit_warehouse_inventory_v2(uuid,uuid) to authenticated;

grant execute on function public.approve_warehouse_inventory_v2(uuid,uuid) to authenticated;

grant execute on function public.reject_warehouse_inventory_v2(uuid,uuid,text) to authenticated;

grant execute on function public.cancel_warehouse_inventory_v2(uuid,uuid) to authenticated;

comment on table public.warehouse_inventory_documents is 'System-managed inventory count and company-admin approval lifecycle.';

notify pgrst, 'reload schema';

-- END SOURCE: 20260722100549_weighbridge_v13_inventory_approval.sql



-- BEGIN SOURCE: 20260722103000_company_admin_v1_warehouse_receipt_links.sql

create or replace function public.create_warehouse_receipt_atomic_v4(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_result jsonb;
  v_line jsonb;
  v_master public.products%rowtype;
  v_company_product public.products%rowtype;
  v_actions jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if not found or v_actor.role not in ('global_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Warehousekeeper role is required';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;

  v_result := public.create_warehouse_receipt_atomic_v3(
    p_company_id,
    p_warehouse_id,
    p_supplier_company_counterparty_id,
    p_supplier_global_counterparty_id,
    p_document_no,
    p_notes,
    p_lines,
    p_idempotency_key
  );

  for v_line in
    select distinct on (value ->> 'product_id') value
    from jsonb_array_elements(p_lines)
    where coalesce(value ->> 'product_id', '') <> ''
  loop
    select * into v_master
    from public.products
    where id = (v_line ->> 'product_id')::uuid
      and company_id is null
      and coalesce(product_type, type, category, '') in ('pesticide', 'fertilizer', 'additive')
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;

    if not found then
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_company_id::text || ':' || v_master.id::text, 0)
    );

    select * into v_company_product
    from public.products
    where company_id = p_company_id
      and (
        master_product_id = v_master.id
        or (
          master_product_id is null
          and lower(name) = lower(v_master.name)
          and coalesce(lower(product_form), '') = coalesce(lower(v_master.product_form), '')
        )
      )
    order by (master_product_id = v_master.id) desc, created_at asc
    limit 1
    for update;

    if found then
      if v_company_product.master_product_id is not null
         and v_company_product.master_product_id <> v_master.id then
        raise exception 'Company product identity conflicts with another global product';
      end if;

      if v_company_product.master_product_id = v_master.id
         and coalesce(v_company_product.archived, false) = false
         and coalesce(v_company_product.is_active, true) = true then
        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'master_product_id', v_master.id,
          'company_product_id', v_company_product.id,
          'action', 'existing'
        ));
      else
        update public.products
        set master_product_id = v_master.id,
            archived = false,
            is_active = true,
            updated_at = now()
        where id = v_company_product.id
        returning * into v_company_product;

        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'master_product_id', v_master.id,
          'company_product_id', v_company_product.id,
          'action', 'reactivated'
        ));
      end if;
    else
      insert into public.products (
        name, type, company_id, user_id, unit, description,
        name_ru, name_kz, name_en, crop_id, product_form,
        accounting_mode, base_uom, pack_uom, unit_weight_kg, units_per_pack,
        is_seed_material, master_product_id, active_ingredient,
        pesticide_subcategories, is_active, trade_name, manufacturer,
        formulation, package_size, package_unit, default_unit, notes,
        pesticide_category, fertilizer_type, category, subcategory,
        concentration, composition, category_id, product_type,
        mode_of_action_type, manufacturer_id, formulation_id,
        mode_of_action_type_id, application_rate_text, normalized_name,
        ui_group, stock_unit, default_rate_type, default_rate_unit,
        physical_state, archived
      ) values (
        v_master.name, v_master.type, p_company_id, v_actor.id, v_master.unit, v_master.description,
        v_master.name_ru, v_master.name_kz, v_master.name_en, v_master.crop_id, v_master.product_form,
        v_master.accounting_mode, v_master.base_uom, v_master.pack_uom, v_master.unit_weight_kg, v_master.units_per_pack,
        v_master.is_seed_material, v_master.id, v_master.active_ingredient,
        v_master.pesticide_subcategories, true, v_master.trade_name, v_master.manufacturer,
        v_master.formulation, v_master.package_size, v_master.package_unit, v_master.default_unit, v_master.notes,
        v_master.pesticide_category, v_master.fertilizer_type, v_master.category, v_master.subcategory,
        v_master.concentration, v_master.composition, v_master.category_id, v_master.product_type,
        v_master.mode_of_action_type, v_master.manufacturer_id, v_master.formulation_id,
        v_master.mode_of_action_type_id, v_master.application_rate_text, v_master.normalized_name,
        v_master.ui_group, v_master.stock_unit, v_master.default_rate_type, v_master.default_rate_unit,
        v_master.physical_state, false
      ) returning * into v_company_product;

      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'master_product_id', v_master.id,
        'company_product_id', v_company_product.id,
        'action', 'created'
      ));
    end if;
  end loop;

  update public.tickets
  set audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'company_product_links', v_actions
      ),
      updated_at = now()
  where id = p_idempotency_key and company_id = p_company_id;

  return v_result || jsonb_build_object('company_product_links', v_actions);
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v2(
  uuid, uuid, timestamptz, uuid, uuid, text, text, jsonb, uuid
) from authenticated;

revoke all on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from authenticated;

revoke all on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon;

grant execute on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

comment on function public.create_warehouse_receipt_atomic_v4(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) is
  'Warehousekeeper-only atomic supplier receipt. Finalization and company agrochemical product linkage share one transaction.';

notify pgrst, 'reload schema';

-- END SOURCE: 20260722103000_company_admin_v1_warehouse_receipt_links.sql



-- BEGIN SOURCE: 20260722111820_weighbridge_v13_finalize_mass_alignment_schema_fix.sql

-- Keep canonical warehouse quantity and mass aligned when a single-line
-- weighbridge ticket switches from gross input to its final net quantity.
create or replace function public.finalize_weighbridge_ticket_for_session_v1(
  p_ticket_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_role text;
  v_line_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.*
    into v_actor
  from public.profiles p
  where p.id = v_auth_user_id
  limit 1;

  if not found or coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Active actor profile not found';
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  v_role := coalesce(v_actor.role, '');
  if v_role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if v_role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;

  select count(*)
    into v_line_count
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id;

  if v_line_count = 1
     and coalesce(v_ticket.weigh_method::text, '') <> 'manual_override_with_reason'
     and coalesce(v_ticket.net_weight_kg, 0) > 0
     and exists (
       select 1
       from public.ticket_lines tl
       where tl.ticket_id = p_ticket_id
         and public.canonical_stock_uom(tl.uom) = 'kg'
     ) then
    update public.ticket_lines
    set quantity = v_ticket.net_weight_kg,
        net_line_weight_kg = v_ticket.net_weight_kg,
        mass_kg = v_ticket.net_weight_kg
    where ticket_id = p_ticket_id;
  end if;

  perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
  perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);
  return p_ticket_id;
end;
$$;

revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public;

revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from anon;

grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to authenticated;

grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to service_role;

-- END SOURCE: 20260722111820_weighbridge_v13_finalize_mass_alignment_schema_fix.sql



-- BEGIN SOURCE: 20260722114500_company_admin_reference_write_policies.sql

drop policy if exists "Company members can manage company_people" on public.company_people;

drop policy if exists "Company members can manage reference_specialists" on public.reference_specialists;

drop policy if exists "Company members can manage reference_machines" on public.reference_machines;

drop policy if exists "Company members can manage reference_equipment" on public.reference_equipment;

drop policy if exists "Company members can manage reference_vehicles" on public.reference_vehicles;

create policy "Company admins can manage company_people"
on public.company_people for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = company_people.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = company_people.company_id))
  )
);

create policy "Company admins can manage reference_specialists"
on public.reference_specialists for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_specialists.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_specialists.company_id))
  )
);

create policy "Company admins can manage reference_machines"
on public.reference_machines for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_machines.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_machines.company_id))
  )
);

create policy "Company admins can manage reference_equipment"
on public.reference_equipment for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_equipment.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_equipment.company_id))
  )
);

create policy "Company admins can manage reference_vehicles"
on public.reference_vehicles for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_vehicles.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_vehicles.company_id))
  )
);

notify pgrst, 'reload schema';

-- END SOURCE: 20260722114500_company_admin_reference_write_policies.sql



-- BEGIN SOURCE: 20260723132603_operations_v12_progress_variance.sql

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

-- END SOURCE: 20260723132603_operations_v12_progress_variance.sql



-- BEGIN SOURCE: 20260723180119_operations_v13_final_role_cards.sql

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

-- END SOURCE: 20260723180119_operations_v13_final_role_cards.sql



-- BEGIN SOURCE: 20260727224833_work_audit_integrity_v1.sql

alter table public.crop_structure
  add column if not exists identity_review_required boolean not null default false,
  add column if not exists identity_review_reason text;

create table if not exists public.user_notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email_enabled boolean not null default true,
  operation_updates_enabled boolean not null default true,
  warehouse_updates_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, company_id)
);

alter table public.user_notification_preferences enable row level security;

drop policy if exists user_notification_preferences_select_own on public.user_notification_preferences;

create policy user_notification_preferences_select_own
on public.user_notification_preferences
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_insert_own on public.user_notification_preferences;

create policy user_notification_preferences_insert_own
on public.user_notification_preferences
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_update_own on public.user_notification_preferences;

create policy user_notification_preferences_update_own
on public.user_notification_preferences
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

drop policy if exists user_notification_preferences_delete_own on public.user_notification_preferences;

create policy user_notification_preferences_delete_own
on public.user_notification_preferences
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = company_id
      )
  )
);

revoke all on table public.user_notification_preferences from public, anon;

grant select, insert, update, delete on table public.user_notification_preferences to authenticated;

alter table public.warehouse_issue_requests
  drop constraint if exists warehouse_issue_requests_status_check;

alter table public.warehouse_issue_requests
  add constraint warehouse_issue_requests_status_check check (
    status in (
      'new',
      'active',
      'preparing',
      'ready',
      'partially_issued',
      'issued_by_warehouse',
      'issued',
      'received_confirmed',
      'closed',
      'cancelled'
    )
  );

create or replace function public.sync_warehouse_request_closed_status_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.warehouse_request_status = 'closed' then
    new.status := 'closed';
    new.return_closed_at := coalesce(new.return_closed_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.sync_warehouse_request_closed_status_v1() from public, anon, authenticated;

drop trigger if exists sync_warehouse_request_closed_status_v1 on public.warehouse_issue_requests;

create trigger sync_warehouse_request_closed_status_v1
before insert or update of warehouse_request_status
on public.warehouse_issue_requests
for each row
execute function public.sync_warehouse_request_closed_status_v1();

create or replace function public.enrich_field_history_material_facts_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact jsonb;
  v_enriched jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_product_name text;
  v_request_id uuid;
  v_request_number text;
  v_unit text;
  v_completion_date timestamptz;
begin
  if new.operation_id is null
     or jsonb_typeof(coalesce(new.material_facts, '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  select coalesce(o.completed_at, o.date::timestamptz)
  into v_completion_date
  from public.operations o
  where o.id = new.operation_id
    and o.company_id = new.company_id;

  for v_fact in
    select value
    from jsonb_array_elements(coalesce(new.material_facts, '[]'::jsonb))
  loop
    v_product_id := nullif(v_fact ->> 'product_id', '')::uuid;
    v_product_name := null;
    v_request_id := null;
    v_request_number := null;
    v_unit := null;

    if v_product_id is not null then
      select coalesce(nullif(btrim(p.trade_name), ''), nullif(btrim(p.name), ''), 'Материал')
      into v_product_name
      from public.products p
      where p.id = v_product_id;

      select r.id,
             r.request_number,
             coalesce(nullif(btrim(i.issued_unit), ''), nullif(btrim(i.prepared_unit), ''), i.unit),
             coalesce(r.return_closed_at, v_completion_date)
      into v_request_id, v_request_number, v_unit, v_completion_date
      from public.warehouse_issue_requests r
      join public.warehouse_issue_request_items i on i.request_id = r.id
      where r.company_id = new.company_id
        and r.operation_id = new.operation_id
        and coalesce(i.actual_product_id, i.product_id) = v_product_id
        and i.reconciliation_status = 'reconciled'
      order by r.return_closed_at desc nulls last, r.created_at desc
      limit 1;
    end if;

    v_enriched := v_enriched || jsonb_build_array(
      v_fact || jsonb_build_object(
        'product_name', coalesce(nullif(v_fact ->> 'product_name', ''), v_product_name),
        'unit', coalesce(nullif(v_fact ->> 'unit', ''), v_unit),
        'request_id', coalesce(nullif(v_fact ->> 'request_id', '')::uuid, v_request_id),
        'request_number', coalesce(nullif(v_fact ->> 'request_number', ''), v_request_number),
        'completion_date', coalesce(nullif(v_fact ->> 'completion_date', '')::timestamptz, v_completion_date)
      )
    );
  end loop;

  new.material_facts := v_enriched;
  return new;
end;
$$;

revoke all on function public.enrich_field_history_material_facts_v1() from public, anon, authenticated;

drop trigger if exists enrich_field_history_material_facts_v1 on public.field_history_entries;

create trigger enrich_field_history_material_facts_v1
before insert or update of material_facts, operation_id
on public.field_history_entries
for each row
execute function public.enrich_field_history_material_facts_v1();

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
  v_product_id uuid;
  v_unit text;
  v_on_hand numeric;
  v_reserved numeric;
  v_available numeric;
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
  if (
    select count(*)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Prepared item ids must be unique'
      using errcode = '23514';
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

  perform pg_advisory_xact_lock(keys.lock_key)
  from (
    select distinct hashtextextended(
      concat_ws(
        ':',
        p_company_id::text,
        p_source_warehouse_id::text,
        coalesce(i.actual_product_id, i.product_id)::text,
        lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
      ),
      0
    ) as lock_key
    from public.warehouse_issue_request_items i
    join jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      on x ->> 'item_id' = i.id::text
    where i.request_id = p_request_id
      and i.company_id = p_company_id
    order by lock_key
  ) keys;

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

    v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);
    v_unit := case lower(btrim(coalesce(v_item.prepared_unit, v_item.unit, '')))
      when 'kg' then 'kg' when 'кг' then 'kg'
      when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
      when 't' then 't' when 'т' then 't'
      when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
      else lower(btrim(coalesce(v_item.prepared_unit, v_item.unit, '')))
    end;

    select coalesce(sum(b.quantity), 0)
    into v_on_hand
    from public.v_stock_balance_identity b
    where b.company_id = p_company_id
      and b.warehouse_id = p_source_warehouse_id
      and b.product_id = v_product_id
      and (
        case lower(btrim(coalesce(b.uom, '')))
          when 'kg' then 'kg' when 'кг' then 'kg'
          when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
          when 't' then 't' when 'т' then 't'
          when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
          else lower(btrim(coalesce(b.uom, '')))
        end
      ) = v_unit;

    select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
    into v_reserved
    from public.warehouse_issue_requests r
    join public.warehouse_issue_request_items i on i.request_id = r.id
    where r.company_id = p_company_id
      and i.company_id = p_company_id
      and r.id <> p_request_id
      and r.source_warehouse_id = p_source_warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_product_id
      and coalesce(
        r.warehouse_request_status,
        case r.status
          when 'new' then 'pending'
          when 'active' then 'pending'
          when 'preparing' then 'collecting'
          when 'ready' then 'ready_for_pickup'
          else r.status
        end
      ) in ('pending', 'collecting', 'ready_for_pickup')
      and (
        case lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
          when 'kg' then 'kg' when 'кг' then 'kg'
          when 'l' then 'l' when 'л' then 'l' when 'liter' then 'l' when 'litre' then 'l'
          when 't' then 't' when 'т' then 't'
          when 'pcs' then 'pcs' when 'шт' then 'pcs' when 'шт.' then 'pcs'
          else lower(btrim(coalesce(i.prepared_unit, i.unit, '')))
        end
      ) = v_unit;

    v_available := v_on_hand - v_reserved;
    if v_prepared > v_available + 0.000001 then
      raise exception 'Insufficient available stock after reservations: on hand %, reserved %, available %, requested % %',
        round(v_on_hand, 4),
        round(v_reserved, 4),
        round(v_available, 4),
        round(v_prepared, 4),
        v_unit
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
      'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)),
      'reservation_checked', true
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

-- END SOURCE: 20260727224833_work_audit_integrity_v1.sql



-- BEGIN SOURCE: __TZ199_SCHEMA__

create table if not exists public.glbd_product_sources (
  id uuid primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  source_type text not null,
  source_url text not null,
  source_title text not null,
  claim_fields text[] not null,
  checked_on date not null,
  confidence numeric(5,4) not null,
  verification_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_sources_product_pair unique (id, product_id),
  constraint glbd_product_sources_type_check check (
    source_type in ('official_label', 'official_registry', 'manufacturer_site', 'official_distributor')
  ),
  constraint glbd_product_sources_url_check check (source_url ~ '^https://'),
  constraint glbd_product_sources_title_check check (btrim(source_title) <> ''),
  constraint glbd_product_sources_claims_check check (cardinality(claim_fields) > 0),
  constraint glbd_product_sources_confidence_check check (confidence between 0 and 1),
  constraint glbd_product_sources_verification_check check (
    verification_status in ('verified', 'conflict', 'expired', 'blocked')
  )
);

create unique index if not exists ux_glbd_product_sources_identity
  on public.glbd_product_sources (product_id, lower(source_url), source_type);

create index if not exists ix_glbd_product_sources_product
  on public.glbd_product_sources (product_id);

create table if not exists public.glbd_product_registrations (
  id uuid primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  country_code text not null,
  registration_number text not null,
  registration_status text not null,
  valid_from date,
  valid_until date,
  registrant text,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_registrations_source_fk
    foreign key (source_id, product_id)
    references public.glbd_product_sources(id, product_id)
    on delete restrict,
  constraint glbd_product_registrations_country_check check (country_code ~ '^[A-Z]{2}$'),
  constraint glbd_product_registrations_number_check check (btrim(registration_number) <> ''),
  constraint glbd_product_registrations_status_check check (
    registration_status in ('active', 'expired', 'suspended', 'cancelled', 'unknown')
  ),
  constraint glbd_product_registrations_dates_check check (
    valid_from is null or valid_until is null or valid_from <= valid_until
  ),
  constraint glbd_product_registrations_product_country_number_unique
    unique (product_id, country_code, registration_number)
);

create index if not exists ix_glbd_product_registrations_product
  on public.glbd_product_registrations (product_id);

create index if not exists ix_glbd_product_registrations_source
  on public.glbd_product_registrations (source_id, product_id);

create table if not exists public.glbd_product_usage_rules (
  id uuid primary key,
  rule_key text not null unique,
  product_id uuid not null references public.products(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid references public.varieties(id) on delete restrict,
  target_type text not null,
  disease_id uuid references public.diseases(id) on delete restrict,
  pest_id uuid references public.pests(id) on delete restrict,
  weed_id uuid references public.weeds(id) on delete restrict,
  target_text text,
  rate_min numeric not null,
  rate_max numeric not null,
  rate_unit text not null,
  working_fluid_min numeric,
  working_fluid_max numeric,
  working_fluid_unit text,
  application_method text not null,
  crop_stage text,
  target_stage text,
  timing_condition text,
  max_treatments integer,
  harvest_interval_days integer,
  reentry_hours integer,
  restrictions text,
  notes text,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_usage_rules_source_fk
    foreign key (source_id, product_id)
    references public.glbd_product_sources(id, product_id)
    on delete restrict,
  constraint glbd_product_usage_rules_target_type_check check (
    target_type in ('disease', 'pest', 'weed', 'desiccation', 'growth_regulation', 'other')
  ),
  constraint glbd_product_usage_rules_target_check check (
    (target_type = 'disease' and disease_id is not null and pest_id is null and weed_id is null)
    or (target_type = 'pest' and disease_id is null and pest_id is not null and weed_id is null)
    or (target_type = 'weed' and disease_id is null and pest_id is null and weed_id is not null)
    or (target_type in ('desiccation', 'growth_regulation', 'other')
        and disease_id is null and pest_id is null and weed_id is null and nullif(btrim(target_text), '') is not null)
  ),
  constraint glbd_product_usage_rules_rate_check check (
    rate_min >= 0 and rate_max >= rate_min and btrim(rate_unit) <> ''
  ),
  constraint glbd_product_usage_rules_working_fluid_check check (
    (working_fluid_min is null and working_fluid_max is null and working_fluid_unit is null)
    or (
      working_fluid_min is not null and working_fluid_max is not null
      and working_fluid_min >= 0 and working_fluid_max >= working_fluid_min
      and nullif(btrim(working_fluid_unit), '') is not null
    )
  ),
  constraint glbd_product_usage_rules_counts_check check (
    (max_treatments is null or max_treatments > 0)
    and (harvest_interval_days is null or harvest_interval_days >= 0)
    and (reentry_hours is null or reentry_hours >= 0)
  ),
  constraint glbd_product_usage_rules_no_placeholders_check check (
    concat_ws(' ', target_text, application_method, crop_stage, target_stage, timing_condition, restrictions, notes)
      !~* '(не указано|проверить)'
  )
);

create index if not exists ix_glbd_product_usage_rules_product
  on public.glbd_product_usage_rules (product_id);

create index if not exists ix_glbd_product_usage_rules_crop_target
  on public.glbd_product_usage_rules (crop_id, target_type);

create index if not exists ix_glbd_product_usage_rules_variety
  on public.glbd_product_usage_rules (variety_id);

create index if not exists ix_glbd_product_usage_rules_disease
  on public.glbd_product_usage_rules (disease_id);

create index if not exists ix_glbd_product_usage_rules_pest
  on public.glbd_product_usage_rules (pest_id);

create index if not exists ix_glbd_product_usage_rules_weed
  on public.glbd_product_usage_rules (weed_id);

create index if not exists ix_glbd_product_usage_rules_source
  on public.glbd_product_usage_rules (source_id, product_id);

create table if not exists public.glbd_product_assistant_safety (
  product_id uuid primary key references public.products(id) on delete cascade,
  read_allowed boolean not null default false,
  recommendation_allowed boolean not null default false,
  missing_critical_fields text[] not null default '{}',
  blocked_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_assistant_safety_recommendation_check check (
    not recommendation_allowed
    or (read_allowed and cardinality(missing_critical_fields) = 0 and blocked_reason is null and verified_at is not null)
  ),
  constraint glbd_product_assistant_safety_block_check check (
    read_allowed or nullif(btrim(blocked_reason), '') is not null
  )
);

drop trigger if exists trg_glbd_product_sources_updated_at on public.glbd_product_sources;

create trigger trg_glbd_product_sources_updated_at
before update on public.glbd_product_sources
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_registrations_updated_at on public.glbd_product_registrations;

create trigger trg_glbd_product_registrations_updated_at
before update on public.glbd_product_registrations
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_usage_rules_updated_at on public.glbd_product_usage_rules;

create trigger trg_glbd_product_usage_rules_updated_at
before update on public.glbd_product_usage_rules
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_glbd_product_assistant_safety_updated_at on public.glbd_product_assistant_safety;

create trigger trg_glbd_product_assistant_safety_updated_at
before update on public.glbd_product_assistant_safety
for each row execute function public.update_updated_at_column();

alter table public.glbd_product_sources enable row level security;

alter table public.glbd_product_registrations enable row level security;

alter table public.glbd_product_usage_rules enable row level security;

alter table public.glbd_product_assistant_safety enable row level security;

revoke all on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety from anon, authenticated;

grant select on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety to authenticated;

grant all on table public.glbd_product_sources, public.glbd_product_registrations,
  public.glbd_product_usage_rules, public.glbd_product_assistant_safety to service_role;

drop policy if exists glbd_product_sources_authenticated_read on public.glbd_product_sources;

create policy glbd_product_sources_authenticated_read
on public.glbd_product_sources for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_sources.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_registrations_authenticated_read on public.glbd_product_registrations;

create policy glbd_product_registrations_authenticated_read
on public.glbd_product_registrations for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_registrations.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_usage_rules_authenticated_read on public.glbd_product_usage_rules;

create policy glbd_product_usage_rules_authenticated_read
on public.glbd_product_usage_rules for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_usage_rules.product_id and p.company_id is null
  )
);

drop policy if exists glbd_product_assistant_safety_authenticated_read on public.glbd_product_assistant_safety;

create policy glbd_product_assistant_safety_authenticated_read
on public.glbd_product_assistant_safety for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.products p
    where p.id = glbd_product_assistant_safety.product_id and p.company_id is null
  )
);

-- END SOURCE: __TZ199_SCHEMA__



-- BEGIN SOURCE: __TZ224_SCHEMA__

-- TZ-224 QA-only migration
-- Target project ref: gsglkmudcwkdetqtocae
-- Production project ref bhsemlvmkikpntabctml must never receive this SQL.
-- Importing pesticide cards is outside this migration.

-- Technical import audit is intentionally separate from company-scoped ERP imports.
create table public.glbd_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_package text not null,
  source_file_name text not null,
  source_version text,
  source_sha256 text not null,
  status text not null default 'prepared',
  expected_products integer,
  expected_component_rows integer,
  expected_aliases integer,
  expected_usage_rules integer,
  manifest jsonb not null default '{}'::jsonb,
  rollback_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_import_batches_status_check
    check (status in ('prepared', 'dry_run_pass', 'applied', 'failed', 'rolled_back')),
  constraint glbd_import_batches_counts_check
    check (
      (expected_products is null or expected_products >= 0)
      and (expected_component_rows is null or expected_component_rows >= 0)
      and (expected_aliases is null or expected_aliases >= 0)
      and (expected_usage_rules is null or expected_usage_rules >= 0)
    )
);

create unique index ux_glbd_import_batches_source
  on public.glbd_import_batches (source_sha256, coalesce(source_version, ''));

create trigger trg_glbd_import_batches_updated_at
  before update on public.glbd_import_batches
  for each row execute function public.update_updated_at_column();

alter table public.glbd_import_batches enable row level security;

create table public.glbd_import_batch_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null
    references public.glbd_import_batches(id) on delete cascade,
  entity_type text not null,
  source_record_id text not null,
  product_id uuid,
  status text not null default 'parsed',
  source_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint glbd_import_batch_rows_status_check
    check (status in (
      'parsed', 'inserted', 'updated', 'unchanged',
      'unresolved_reference', 'skipped_conflict', 'failed'
    ))
);

create unique index ux_glbd_import_batch_rows_source
  on public.glbd_import_batch_rows (import_batch_id, entity_type, source_record_id);

create index ix_glbd_import_batch_rows_product
  on public.glbd_import_batch_rows (product_id);

alter table public.glbd_import_batch_rows enable row level security;

-- The review layer stores package identity signals, never canonical product identity.
create table public.glbd_product_identity_review_groups (
  id uuid primary key default gen_random_uuid(),
  identity_group_key text not null,
  normalized_trade_name text not null,
  normalized_active_ingredient text,
  pesticide_category text,
  candidate_product_ids uuid[] not null,
  identity_status text not null default 'unreviewed',
  identity_reason text,
  review_required boolean not null default true,
  review_notes text,
  source_checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glbd_product_identity_review_groups_key_check
    check (btrim(identity_group_key) <> ''),
  constraint glbd_product_identity_review_groups_candidates_check
    check (cardinality(candidate_product_ids) >= 2),
  constraint glbd_product_identity_review_groups_status_check
    check (identity_status in (
      'unreviewed', 'canonical', 'keep_separate',
      'possible_duplicate', 'conflict', 'archived'
    ))
);

create unique index ux_glbd_product_identity_review_groups_key
  on public.glbd_product_identity_review_groups (identity_group_key);

create index ix_glbd_product_identity_review_groups_candidate_ids
  on public.glbd_product_identity_review_groups using gin (candidate_product_ids);

create index ix_glbd_product_identity_review_groups_review
  on public.glbd_product_identity_review_groups (identity_status, review_required);

create trigger trg_glbd_product_identity_review_groups_updated_at
  before update on public.glbd_product_identity_review_groups
  for each row execute function public.update_updated_at_column();

alter table public.glbd_product_identity_review_groups enable row level security;

-- Preserve package-level raw product provenance without replacing canonical fields.
alter table public.products
  add column agro_composition_raw jsonb not null default '[]'::jsonb,
  add column agro_source_urls_raw jsonb not null default '[]'::jsonb,
  add column agro_knowledge_source_version text,
  add column agro_knowledge_source_checksum text,
  add column glbd_import_batch_id uuid
    references public.glbd_import_batches(id) on delete set null;

alter table public.products alter column active_ingredient drop default;

alter table public.products
  drop constraint products_agrochem_active_ingredient_required;

alter table public.products
  add constraint products_agrochem_active_ingredient_required
  check (
    type not in ('pesticide', 'fertilizer')
    or active_ingredient is null
    or btrim(active_ingredient) <> ''
  ) not valid;

alter table public.products
  validate constraint products_agrochem_active_ingredient_required;

alter table public.products
  drop constraint products_pesticide_category_check_v2;

alter table public.products
  add constraint products_pesticide_category_check_v2
  check (
    type <> 'pesticide'
    or pesticide_category is null
    or pesticide_category in (
      'herbicide', 'fungicide', 'insecticide', 'acaricide',
      'insectoacaricide', 'seed_treatment', 'desiccant',
      'growth_regulator', 'rodenticide', 'molluscicide',
      'biological', 'other', 'adjuvant', 'surfactant',
      'water_conditioner', 'pH_regulator',
      'drift_reduction_agent', 'anti_foam'
    )
  ) not valid;

alter table public.products
  validate constraint products_pesticide_category_check_v2;

-- product_id is the canonical identity. Similar text is only a review signal.
drop index public.ux_products_global_pesticide_trade_ai_active;

create index idx_products_global_pesticide_trade_ai_active
  on public.products (
    lower(coalesce(trade_name, name)),
    lower(active_ingredient),
    coalesce(pesticide_category, '')
  )
  where company_id is null and type = 'pesticide' and archived = false;

-- Aliases remain unique per product, while cross-product ambiguity is searchable.
create index idx_global_product_aliases_normalized_lookup
  on public.global_product_aliases (lower(normalized_alias));

-- Extend the existing enum without rewriting legacy rows.
alter type public.glbd_role_in_product add value if not exists 'active_ingredient';

alter type public.glbd_role_in_product add value if not exists 'antidote';

alter type public.glbd_role_in_product add value if not exists 'carrier';

alter type public.glbd_role_in_product add value if not exists 'other';

alter type public.glbd_role_in_product add value if not exists 'unresolved';

alter table public.glbd_product_components
  add column original_name text,
  add column normalized_name text,
  add column display_name_ru_source text,
  add column concentration_unit_original text,
  add column source_payload jsonb not null default '{}'::jsonb,
  add column import_batch_id uuid
    references public.glbd_import_batches(id) on delete set null;

alter table public.glbd_product_components
  alter column component_id drop not null;

alter table public.glbd_product_components
  add constraint glbd_product_components_identity_contract
  check (
    component_id is not null
    or (
      role_in_product::text = 'unresolved'
      and nullif(btrim(original_name), '') is not null
    )
  ) not valid;

alter table public.glbd_product_components
  validate constraint glbd_product_components_identity_contract;

create unique index ux_glbd_product_components_unresolved_raw
  on public.glbd_product_components (
    product_id,
    lower(coalesce(normalized_name, original_name)),
    role_in_product,
    sort_order
  )
  where component_id is null
    and review_status not in ('archived', 'rejected');

create or replace function public.glbd_validate_product_component()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  resolved_type public.glbd_component_type;
  resolved_active boolean;
  resolved_archived_at timestamptz;
  role_value text := new.role_in_product::text;
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.company_id is null
  ) then
    raise exception 'glbd_product_components accepts global products only: %', new.product_id;
  end if;

  if new.component_id is null then
    if role_value <> 'unresolved'
       or nullif(btrim(new.original_name), '') is null
       or new.review_status in ('approved', 'archived') then
      raise exception 'Unresolved component requires raw name and review status';
    end if;
    return new;
  end if;

  select c.component_type, c.is_active, c.archived_at
    into resolved_type, resolved_active, resolved_archived_at
  from public.glbd_components c
  where c.id = new.component_id;

  if resolved_type is null or not resolved_active or resolved_archived_at is not null then
    raise exception 'Component % is missing, inactive, or archived', new.component_id;
  end if;

  if not (
    (resolved_type = 'active_ingredient' and role_value in ('active', 'active_ingredient', 'unresolved'))
    or (resolved_type = 'safener' and role_value in ('safener', 'antidote', 'unresolved'))
    or (resolved_type = 'synergist' and role_value in ('synergist', 'unresolved'))
    or (resolved_type = 'biological_component' and role_value in ('biological_agent', 'unresolved'))
    or (resolved_type = 'formulation_component' and role_value in (
      'formulation_component', 'carrier', 'other', 'unresolved'
    ))
    or (
      resolved_type = 'unknown_component'
      and role_value in ('active', 'unresolved')
      and new.review_status in ('draft', 'needs_source', 'needs_owner_review')
    )
  ) then
    raise exception 'Role % is incompatible with component type %', new.role_in_product, resolved_type;
  end if;

  if role_value = 'unresolved'
     and nullif(btrim(new.original_name), '') is null then
    raise exception 'Unresolved role requires original component name';
  end if;

  if resolved_type = 'unknown_component'
     and new.review_status in ('approved', 'archived') then
    raise exception 'Unknown components cannot be approved or archived through product links';
  end if;

  return new;
end;
$function$;

-- Source provenance can be retained even when a URL or verification is absent.
alter table public.glbd_product_sources
  add column source_scope text,
  add column source_record_id text,
  add column source_name_raw text,
  add column source_text_raw text,
  add column original_source_text text,
  add column source_metadata_raw jsonb not null default '{}'::jsonb,
  add column import_batch_id uuid
    references public.glbd_import_batches(id) on delete set null;

alter table public.glbd_product_sources
  alter column source_url drop not null,
  alter column source_title drop not null,
  alter column claim_fields drop not null,
  alter column checked_on drop not null,
  alter column confidence drop not null;

alter table public.glbd_product_sources
  drop constraint glbd_product_sources_claims_check,
  drop constraint glbd_product_sources_confidence_check,
  drop constraint glbd_product_sources_title_check,
  drop constraint glbd_product_sources_type_check,
  drop constraint glbd_product_sources_url_check,
  drop constraint glbd_product_sources_verification_check;

alter table public.glbd_product_sources
  add constraint glbd_product_sources_claims_check
    check (claim_fields is null or cardinality(claim_fields) > 0) not valid,
  add constraint glbd_product_sources_confidence_check
    check (confidence is null or confidence between 0 and 1) not valid,
  add constraint glbd_product_sources_title_check
    check (source_title is null or btrim(source_title) <> '') not valid,
  add constraint glbd_product_sources_type_check
    check (source_type in (
      'official_label', 'official_registry', 'manufacturer_site',
      'official_distributor', 'package_source', 'other'
    )) not valid,
  add constraint glbd_product_sources_url_check
    check (source_url is null or source_url ~ '^https://') not valid,
  add constraint glbd_product_sources_verification_check
    check (verification_status in (
      'verified', 'conflict', 'expired', 'blocked', 'unreviewed'
    )) not valid;

alter table public.glbd_product_sources
  validate constraint glbd_product_sources_claims_check,
  validate constraint glbd_product_sources_confidence_check,
  validate constraint glbd_product_sources_title_check,
  validate constraint glbd_product_sources_type_check,
  validate constraint glbd_product_sources_url_check,
  validate constraint glbd_product_sources_verification_check;

create unique index ux_glbd_product_sources_record_identity
  on public.glbd_product_sources (product_id, source_type, source_record_id)
  where source_record_id is not null;

-- Usage rules retain canonical links when known and complete raw source values always.
alter table public.glbd_product_usage_rules
  add column import_batch_id uuid
    references public.glbd_import_batches(id) on delete set null,
  add column source_usage_rule_id text,
  add column source_rule_id text,
  add column crop_name_raw text,
  add column crop_group_raw text,
  add column crop_name_original text,
  add column crop_match_status text,
  add column target_names_raw jsonb not null default '[]'::jsonb,
  add column target_text_original text,
  add column target_match_status text,
  add column original_rate_value_text text,
  add column original_rate_unit_text text,
  add column original_rate_text text,
  add column rate_parse_status text not null default 'unparsed',
  add column calculation_status text not null default 'requires_review',
  add column application_timing text,
  add column reentry_interval_days integer,
  add column reentry_interval_days_mechanized integer,
  add column reentry_interval_days_manual integer,
  add column restrictions_raw jsonb not null default '[]'::jsonb,
  add column usage_summary text,
  add column source_url_raw text,
  add column source_name_raw text,
  add column source_text_raw text,
  add column original_source_text text,
  add column source_confidence_raw numeric,
  add column source_review_status text,
  add column qa_flags_raw jsonb not null default '[]'::jsonb,
  add column source_payload jsonb not null default '{}'::jsonb;

alter table public.glbd_product_usage_rules
  alter column crop_id drop not null,
  alter column rate_min drop not null,
  alter column rate_max drop not null,
  alter column rate_unit drop not null,
  alter column application_method drop not null,
  alter column source_id drop not null;

alter table public.glbd_product_usage_rules
  add constraint glbd_product_usage_rules_crop_match_status_check
    check (
      crop_match_status is null
      or crop_match_status in ('exact', 'confirmed_alias', 'ambiguous', 'not_found')
    ) not valid,
  add constraint glbd_product_usage_rules_target_match_status_check
    check (
      target_match_status is null
      or target_match_status in ('exact', 'confirmed_alias', 'ambiguous', 'not_found')
    ) not valid,
  add constraint glbd_product_usage_rules_rate_parse_status_check
    check (rate_parse_status in ('parsed', 'unparsed', 'ambiguous', 'not_applicable')) not valid,
  add constraint glbd_product_usage_rules_calculation_status_check
    check (calculation_status in (
      'calculation_ready', 'informational_only', 'requires_review'
    )) not valid,
  add constraint glbd_product_usage_rules_source_review_status_check
    check (
      source_review_status is null
      or source_review_status in ('verified', 'unreviewed', 'conflict', 'blocked')
    ) not valid;

alter table public.glbd_product_usage_rules
  validate constraint glbd_product_usage_rules_crop_match_status_check,
  validate constraint glbd_product_usage_rules_target_match_status_check,
  validate constraint glbd_product_usage_rules_rate_parse_status_check,
  validate constraint glbd_product_usage_rules_calculation_status_check,
  validate constraint glbd_product_usage_rules_source_review_status_check;

alter table public.glbd_product_usage_rules
  drop constraint glbd_product_usage_rules_target_type_check,
  drop constraint glbd_product_usage_rules_target_check,
  drop constraint glbd_product_usage_rules_rate_check;

alter table public.glbd_product_usage_rules
  add constraint glbd_product_usage_rules_target_type_check
  check (target_type in (
    'disease', 'pest', 'weed', 'desiccation', 'growth_regulation',
    'crop_regulation', 'seed_protection', 'other'
  )) not valid;

alter table public.glbd_product_usage_rules
  add constraint glbd_product_usage_rules_target_check
  check (
    (
      target_type = 'disease'
      and pest_id is null and weed_id is null
      and (
        disease_id is not null
        or jsonb_array_length(target_names_raw) > 0
        or nullif(btrim(target_text_original), '') is not null
      )
    )
    or (
      target_type = 'pest'
      and disease_id is null and weed_id is null
      and (
        pest_id is not null
        or jsonb_array_length(target_names_raw) > 0
        or nullif(btrim(target_text_original), '') is not null
      )
    )
    or (
      target_type = 'weed'
      and disease_id is null and pest_id is null
      and (
        weed_id is not null
        or jsonb_array_length(target_names_raw) > 0
        or nullif(btrim(target_text_original), '') is not null
      )
    )
    or (
      target_type in (
        'desiccation', 'growth_regulation', 'crop_regulation',
        'seed_protection', 'other'
      )
      and disease_id is null and pest_id is null and weed_id is null
      and (
        jsonb_array_length(target_names_raw) > 0
        or nullif(btrim(target_text_original), '') is not null
        or nullif(btrim(target_text), '') is not null
      )
    )
  ) not valid;

alter table public.glbd_product_usage_rules
  add constraint glbd_product_usage_rules_rate_check
  check (
    (
      (rate_min is null and rate_max is null)
      or (
        rate_min is not null and rate_max is not null
        and rate_min >= 0 and rate_max >= rate_min
      )
    )
    and (rate_unit is null or btrim(rate_unit) <> '')
    and (
      rate_min is not null
      or nullif(btrim(original_rate_text), '') is not null
      or nullif(btrim(original_rate_value_text), '') is not null
    )
    and (
      calculation_status <> 'calculation_ready'
      or (
        rate_min is not null
        and rate_max is not null
        and nullif(btrim(rate_unit), '') is not null
      )
    )
  ) not valid;

alter table public.glbd_product_usage_rules
  validate constraint glbd_product_usage_rules_target_type_check,
  validate constraint glbd_product_usage_rules_target_check,
  validate constraint glbd_product_usage_rules_rate_check;

create unique index ux_glbd_product_usage_rules_source_identity
  on public.glbd_product_usage_rules (source_usage_rule_id)
  where source_usage_rule_id is not null;

-- Extend the existing safety layer without enabling recommendations.
alter table public.glbd_product_assistant_safety
  add column identity_status text not null default 'unreviewed',
  add column component_status text not null default 'requires_review',
  add column usage_rule_status text not null default 'requires_review',
  add column source_status text not null default 'requires_review',
  add column calculation_status text not null default 'requires_review',
  add column review_required boolean not null default true,
  add column blocking_reasons text[] not null default '{}'::text[],
  add column warnings text[] not null default '{}'::text[];

alter table public.glbd_product_assistant_safety
  add constraint glbd_product_assistant_safety_identity_status_check
    check (identity_status in (
      'unreviewed', 'canonical', 'keep_separate',
      'possible_duplicate', 'conflict', 'archived'
    )) not valid,
  add constraint glbd_product_assistant_safety_component_status_check
    check (component_status in (
      'complete', 'missing_active_ingredient',
      'component_unresolved', 'requires_review'
    )) not valid,
  add constraint glbd_product_assistant_safety_usage_status_check
    check (usage_rule_status in ('complete', 'partial', 'missing', 'requires_review')) not valid,
  add constraint glbd_product_assistant_safety_source_status_check
    check (source_status in ('verified', 'partial', 'missing', 'conflict', 'requires_review')) not valid,
  add constraint glbd_product_assistant_safety_calculation_status_check
    check (calculation_status in (
      'calculation_ready', 'informational_only', 'requires_review'
    )) not valid,
  add constraint glbd_product_assistant_safety_recommendation_v1_check
    check (
      not recommendation_allowed
      or (
        identity_status in ('canonical', 'keep_separate')
        and component_status = 'complete'
        and usage_rule_status = 'complete'
        and source_status = 'verified'
        and calculation_status = 'calculation_ready'
        and not review_required
        and cardinality(blocking_reasons) = 0
      )
    ) not valid;

alter table public.glbd_product_assistant_safety
  validate constraint glbd_product_assistant_safety_identity_status_check,
  validate constraint glbd_product_assistant_safety_component_status_check,
  validate constraint glbd_product_assistant_safety_usage_status_check,
  validate constraint glbd_product_assistant_safety_source_status_check,
  validate constraint glbd_product_assistant_safety_calculation_status_check,
  validate constraint glbd_product_assistant_safety_recommendation_v1_check;

comment on table public.glbd_product_identity_review_groups is
  'TZ-224 review signals only. Similar identity never merges or replaces products.id.';

comment on column public.glbd_product_usage_rules.rate_unit is
  'Normalized rate unit. Nullable when source unit is not recognized; original_rate_unit_text preserves source.';

comment on column public.glbd_product_components.original_name is
  'Original package component text; required whenever role_in_product is unresolved and component_id is null.';

-- END SOURCE: __TZ224_SCHEMA__



-- BEGIN SOURCE: __TZ224_INDEXES__

-- TZ-224 QA-only follow-up: cover the four new import-batch foreign keys.
-- Target project ref: gsglkmudcwkdetqtocae

create index ix_products_glbd_import_batch
  on public.products (glbd_import_batch_id)
  where glbd_import_batch_id is not null;

create index ix_glbd_product_components_import_batch
  on public.glbd_product_components (import_batch_id)
  where import_batch_id is not null;

create index ix_glbd_product_sources_import_batch
  on public.glbd_product_sources (import_batch_id)
  where import_batch_id is not null;

create index ix_glbd_product_usage_rules_import_batch
  on public.glbd_product_usage_rules (import_batch_id)
  where import_batch_id is not null;

-- END SOURCE: __TZ224_INDEXES__



-- BEGIN SOURCE: 20260729112433_crop_identity_reference_visibility_v1.sql

-- TZ-236: make canonical global crop identity references visible to authenticated
-- company users without granting catalog writes to operational roles.

drop policy if exists "Users can read varieties" on public.varieties;

drop policy if exists "Users can view company varieties" on public.varieties;

drop policy if exists "Users can manage own varieties" on public.varieties;

drop policy if exists "Users can insert company varieties" on public.varieties;

drop policy if exists "Users can update company varieties" on public.varieties;

drop policy if exists "Users can delete company varieties" on public.varieties;

create policy "Authenticated users can read visible varieties"
  on public.varieties
  for select
  to authenticated
  using (
    company_id is null
    or company_id = public.get_user_company_id()
  );

create policy "Crop planners can insert company varieties"
  on public.varieties
  for insert
  to authenticated
  with check (
    company_id = public.get_user_company_id()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can update company varieties"
  on public.varieties
  for update
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  )
  with check (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can delete company varieties"
  on public.varieties
  for delete
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Global admins can manage global varieties"
  on public.varieties
  for all
  to authenticated
  using (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  );

drop policy if exists "Users can read seed reproductions" on public.seed_reproductions;

drop policy if exists "Users can view company seed reproductions" on public.seed_reproductions;

drop policy if exists "Users can manage own seed reproductions" on public.seed_reproductions;

drop policy if exists "Users can insert company seed reproductions" on public.seed_reproductions;

drop policy if exists "Users can update company seed reproductions" on public.seed_reproductions;

drop policy if exists "Users can delete company seed reproductions" on public.seed_reproductions;

create policy "Authenticated users can read visible seed reproductions"
  on public.seed_reproductions
  for select
  to authenticated
  using (
    company_id is null
    or company_id = public.get_user_company_id()
  );

create policy "Crop planners can insert company seed reproductions"
  on public.seed_reproductions
  for insert
  to authenticated
  with check (
    company_id = public.get_user_company_id()
    and (user_id is null or user_id = auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can update company seed reproductions"
  on public.seed_reproductions
  for update
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  )
  with check (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Crop planners can delete company seed reproductions"
  on public.seed_reproductions
  for delete
  to authenticated
  using (
    company_id = public.get_user_company_id()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('admin', 'company_admin', 'agronomist')
    )
  );

create policy "Global admins can manage global seed reproductions"
  on public.seed_reproductions
  for all
  to authenticated
  using (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  )
  with check (
    company_id is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role = 'global_admin'
    )
  );

grant select on public.varieties, public.seed_reproductions to authenticated;

-- END SOURCE: 20260729112433_crop_identity_reference_visibility_v1.sql



-- BEGIN SOURCE: 20260729112440_harvest_traceability_v1.sql

-- TZ-236: preserve crop-structure provenance from a finalized harvest ticket
-- through its batch, warehouse ledger entry, field history, and audit trail.

alter table public.inventory_batches
  add column if not exists crop_structure_id uuid references public.crop_structure(id) on delete restrict,
  add column if not exists harvesting_operation_id uuid references public.operations(id) on delete set null,
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete restrict,
  add column if not exists received_at timestamptz,
  add column if not exists source_type text;

create index if not exists idx_inventory_batches_harvest_trace_v1
  on public.inventory_batches(company_id, crop_structure_id, source_ticket_id)
  where origin_type = 'harvest';

create unique index if not exists uq_inventory_batches_harvest_ticket_product_v1
  on public.inventory_batches(source_ticket_id, product_id, batch_class)
  where origin_type = 'harvest' and source_ticket_id is not null;

alter table public.field_history_entries
  add column if not exists crop_structure_id uuid references public.crop_structure(id) on delete restrict,
  add column if not exists harvest_ticket_id uuid references public.tickets(id) on delete restrict,
  add column if not exists harvest_batch_id uuid references public.inventory_batches(id) on delete restrict;

create unique index if not exists uq_field_history_harvest_ticket_v1
  on public.field_history_entries(harvest_ticket_id)
  where source = 'weighbridge_harvest' and harvest_ticket_id is not null;

create or replace function public.populate_harvest_batch_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
begin
  if new.origin_type <> 'harvest' or new.source_ticket_id is null then
    return new;
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = new.source_ticket_id
    and t.company_id = new.company_id
    and t.op_type = 'harvest_incoming';

  if not found then
    raise exception 'Harvest batch source ticket is missing or belongs to another company';
  end if;

  if v_ticket.crop_structure_allocation_id is null
     or v_ticket.field_id is null
     or v_ticket.season_id is null
     or v_ticket.warehouse_to_id is null then
    raise exception 'Harvest ticket trace is incomplete';
  end if;

  new.crop_structure_id := v_ticket.crop_structure_allocation_id;
  new.harvesting_operation_id := v_ticket.linked_operation_id;
  new.warehouse_id := v_ticket.warehouse_to_id;
  new.received_at := coalesce(v_ticket.finalized_at, now());
  new.source_type := 'weighbridge_ticket';
  return new;
end;
$$;

revoke all on function public.populate_harvest_batch_trace_v1() from public, anon, authenticated;

drop trigger if exists populate_harvest_batch_trace_v1 on public.inventory_batches;

create trigger populate_harvest_batch_trace_v1
before insert or update of source_ticket_id, origin_type
on public.inventory_batches
for each row
execute function public.populate_harvest_batch_trace_v1();

create or replace function public.populate_harvest_ledger_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_operation_line_id uuid;
begin
  if new.ticket_id is null or new.direction::text <> 'in' then
    return new;
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = new.ticket_id
    and t.company_id = new.company_id
    and t.op_type = 'harvest_incoming';

  if not found then
    return new;
  end if;

  select ib.*
    into v_batch
  from public.inventory_batches ib
  where ib.company_id = new.company_id
    and ib.source_ticket_id = new.ticket_id
    and ib.product_id = new.product_id
    and ib.variety_id is not distinct from new.variety_id
    and ib.reproduction_id is not distinct from new.reproduction_id
  order by ib.created_at, ib.id
  limit 1;

  if not found then
    raise exception 'Harvest ledger posting requires its canonical harvest batch';
  end if;

  select tl.operation_line_id
    into v_operation_line_id
  from public.ticket_lines tl
  where tl.ticket_id = new.ticket_id
    and tl.product_id = new.product_id
    and tl.variety_id is not distinct from new.variety_id
    and tl.reproduction_id is not distinct from new.reproduction_id
  order by tl.created_at, tl.id
  limit 1;

  new.batch_id := v_batch.id::text;
  new.batch_id_text := v_batch.id::text;
  new.batch_class := coalesce(new.batch_class, v_batch.batch_class, 'commodity');
  new.operation_line_id := coalesce(new.operation_line_id, v_operation_line_id);
  return new;
end;
$$;

revoke all on function public.populate_harvest_ledger_trace_v1() from public, anon, authenticated;

drop trigger if exists populate_harvest_ledger_trace_v1 on public.stock_ledger_entries;

create trigger populate_harvest_ledger_trace_v1
before insert
on public.stock_ledger_entries
for each row
execute function public.populate_harvest_ledger_trace_v1();

create or replace function public.record_finalized_harvest_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_crop_name text;
  v_season_year integer;
begin
  if new.op_type <> 'harvest_incoming'
     or not new.is_finalized
     or new.status::text <> 'finalized'
     or (old.is_finalized and old.status::text = 'finalized') then
    return new;
  end if;

  select cs.*
    into v_structure
  from public.crop_structure cs
  where cs.id = new.crop_structure_allocation_id
    and cs.company_id = new.company_id
    and cs.field_id = new.field_id
    and cs.season_id = new.season_id
    and coalesce(cs.archived, false) = false;

  if not found
     or v_structure.crop_id is null
     or v_structure.variety_id is null
     or v_structure.reproduction_id is null then
    raise exception 'Finalized harvest ticket requires complete crop structure identity';
  end if;

  select ib.*
    into v_batch
  from public.inventory_batches ib
  where ib.company_id = new.company_id
    and ib.source_ticket_id = new.id
    and ib.origin_type = 'harvest'
  order by ib.created_at, ib.id
  limit 1;

  if not found then
    raise exception 'Finalized harvest ticket requires a harvest batch';
  end if;

  if not exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.company_id = new.company_id
      and sle.ticket_id = new.id
      and sle.direction::text = 'in'
      and sle.batch_id = v_batch.id::text
      and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Finalized harvest ticket requires one linked ledger IN posting';
  end if;

  select coalesce(c.name_ru, c.name)
    into v_crop_name
  from public.crops c
  where c.id = v_structure.crop_id;

  select s.year
    into v_season_year
  from public.seasons s
  where s.id = new.season_id
    and s.company_id = new.company_id;

  insert into public.field_history_entries (
    company_id,
    field_id,
    season_id,
    season_year,
    crop_id,
    history_value,
    token,
    original_raw_value,
    source,
    notes,
    operation_id,
    crop_structure_id,
    harvest_ticket_id,
    harvest_batch_id
  )
  values (
    new.company_id,
    new.field_id,
    new.season_id,
    v_season_year,
    v_structure.crop_id,
    coalesce(v_crop_name, 'Урожай'),
    'weighbridge:' || new.id::text,
    coalesce(new.notes, ''),
    'weighbridge_harvest',
    'Урожай принят по талону ' || new.ticket_no,
    new.linked_operation_id,
    v_structure.id,
    new.id,
    v_batch.id
  )
  on conflict (harvest_ticket_id)
    where source = 'weighbridge_harvest' and harvest_ticket_id is not null
  do nothing;

  insert into public.audit_log (
    company_id,
    who,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    new.company_id,
    new.closed_by,
    'weighbridge_ticket',
    new.id,
    'harvest_finalized',
    jsonb_build_object(
      'ticket_id', new.id,
      'batch_id', v_batch.id,
      'crop_structure_id', v_structure.id,
      'operation_id', new.linked_operation_id,
      'warehouse_id', new.warehouse_to_id,
      'net_weight_kg', new.net_weight_kg
    )
  );

  return new;
end;
$$;

revoke all on function public.record_finalized_harvest_trace_v1() from public, anon, authenticated;

drop trigger if exists record_finalized_harvest_trace_v1 on public.tickets;

create trigger record_finalized_harvest_trace_v1
after update of is_finalized, status
on public.tickets
for each row
execute function public.record_finalized_harvest_trace_v1();

create or replace function public.set_harvest_ticket_weights_for_session_v1(
  p_ticket_id uuid,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_gross numeric;
  v_tare numeric;
  v_net numeric;
  v_status text;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.*
    into v_actor
  from public.profiles p
  where p.id = v_auth_user_id
    and coalesce(p.status, 'active') = 'active';

  if not found or v_actor.role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to update weighbridge tickets';
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if v_ticket.op_type <> 'harvest_incoming' then
    raise exception 'Only harvest tickets are supported';
  end if;
  if v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status::text in ('finalized', 'voided') then
    raise exception 'Finalized/voided ticket is read-only';
  end if;

  v_gross := coalesce((p_patch ->> 'gross_weight_kg')::numeric, v_ticket.gross_weight_kg);
  v_tare := coalesce((p_patch ->> 'tare_weight_kg')::numeric, v_ticket.tare_weight_kg);
  if v_gross is null or v_tare is null then
    raise exception 'Gross and tare are required';
  end if;
  if v_gross <= 0 then
    raise exception 'Gross weight must be greater than zero';
  end if;
  if v_tare < 0 then
    raise exception 'Tare weight must be non-negative';
  end if;
  if v_tare >= v_gross then
    raise exception 'Tare weight must be lower than gross weight';
  end if;
  v_net := v_gross - v_tare;

  select tl.*
    into v_line
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id
    and tl.company_id = v_ticket.company_id
    and public.canonical_stock_uom(tl.uom) = 'kg'
  order by tl.created_at, tl.id
  limit 1;

  if not found or (
    select count(*)
    from public.ticket_lines tl
    where tl.ticket_id = p_ticket_id
  ) <> 1 then
    raise exception 'Harvest ticket must contain exactly one kilogram line before closing';
  end if;

  v_status := coalesce(nullif(trim(p_patch ->> 'status'), ''), v_ticket.status::text);
  if v_status not in ('draft', 'active', 'ready_to_close') then
    raise exception 'Invalid status for harvest ticket update';
  end if;

  update public.ticket_lines
  set
    quantity = v_net,
    mass_kg = v_net,
    net_line_weight_kg = v_net
  where id = v_line.id;

  update public.tickets
  set
    gross_weight_kg = v_gross,
    tare_weight_kg = v_tare,
    net_weight_kg = v_net,
    notes = case when p_patch ? 'notes' then nullif(trim(p_patch ->> 'notes'), '') else notes end,
    status = v_status::public.ticket_status,
    updated_at = now()
  where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

revoke all on function public.set_harvest_ticket_weights_for_session_v1(uuid, jsonb) from public, anon;

grant execute on function public.set_harvest_ticket_weights_for_session_v1(uuid, jsonb) to authenticated, service_role;

-- END SOURCE: 20260729112440_harvest_traceability_v1.sql



-- BEGIN SOURCE: 20260729143000_glbd_global_admin_human_card_read.sql

-- TZ-237: Global Admin may review canonical GLBD component links that are not
-- yet recommendation-ready. This is SELECT-only and does not broaden company
-- user access or grant any catalog mutation.

alter table public.glbd_components enable row level security;

alter table public.glbd_product_components enable row level security;

drop policy if exists "glbd_components_global_admin_read_review" on public.glbd_components;

create policy "glbd_components_global_admin_read_review"
  on public.glbd_components
  for select
  to authenticated
  using (
    archived_at is null
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'global_admin'
        and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "glbd_product_components_global_admin_read_review" on public.glbd_product_components;

create policy "glbd_product_components_global_admin_read_review"
  on public.glbd_product_components
  for select
  to authenticated
  using (
    review_status not in ('archived', 'rejected')
    and exists (
      select 1
      from public.products product
      where product.id = glbd_product_components.product_id
        and product.company_id is null
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'global_admin'
        and coalesce(p.status, 'active') = 'active'
    )
  );

comment on policy "glbd_components_global_admin_read_review" on public.glbd_components
  is 'TZ-237 SELECT-only review access for active Global Admin profiles.';

comment on policy "glbd_product_components_global_admin_read_review" on public.glbd_product_components
  is 'TZ-237 SELECT-only review access for active Global Admin profiles.';

-- END SOURCE: 20260729143000_glbd_global_admin_human_card_read.sql



-- BEGIN SOURCE: 20260730105407_package_aware_warehouse_issue_v1.sql

-- TZ-238: package-aware warehouse preparation, stable human identifiers and QA markers.

alter table public.inventory_batches
  add column if not exists package_size numeric(14,4),
  add column if not exists package_unit text;

alter table public.inventory_batches
  drop constraint if exists inventory_batches_package_size_check;

alter table public.inventory_batches
  add constraint inventory_batches_package_size_check
  check (package_size is null or package_size > 0);

alter table public.warehouse_issue_request_items
  add column if not exists issue_mode text,
  add column if not exists package_source text,
  add column if not exists package_reason text;

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_issue_mode_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_issue_mode_check
  check (issue_mode is null or issue_mode in ('whole_package', 'measured', 'mixed'));

create table if not exists public.warehouse_issue_request_item_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null references public.warehouse_issue_requests(id) on delete cascade,
  request_item_id uuid not null references public.warehouse_issue_request_items(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  batch_id uuid references public.inventory_batches(id) on delete set null,
  batch_id_text text,
  batch_class text not null,
  batch_label text not null,
  issue_mode text not null,
  package_source text not null,
  package_size numeric(14,4),
  package_count integer,
  package_unit text,
  manual_package_reason text,
  prepared_quantity numeric(14,4) not null,
  issued_quantity numeric(14,4) not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_issue_allocations_mode_check
    check (issue_mode in ('whole_package', 'measured')),
  constraint warehouse_issue_allocations_source_check
    check (package_source in ('batch', 'product', 'manual', 'measured')),
  constraint warehouse_issue_allocations_quantity_check
    check (
      prepared_quantity > 0
      and issued_quantity >= 0
      and issued_quantity <= prepared_quantity
    ),
  constraint warehouse_issue_allocations_package_check
    check (
      (
        issue_mode = 'measured'
        and package_source = 'measured'
        and package_size is null
        and package_count is null
      )
      or (
        issue_mode = 'whole_package'
        and package_size > 0
        and package_count > 0
        and package_unit is not null
        and (
          package_source <> 'manual'
          or nullif(btrim(manual_package_reason), '') is not null
        )
      )
    )
);

create unique index if not exists warehouse_issue_allocations_identity_uidx
  on public.warehouse_issue_request_item_allocations (
    request_item_id,
    batch_class,
    coalesce(batch_id_text, '__unassigned__')
  );

create index if not exists warehouse_issue_allocations_request_idx
  on public.warehouse_issue_request_item_allocations(company_id, request_id);

create index if not exists warehouse_issue_allocations_stock_idx
  on public.warehouse_issue_request_item_allocations(
    company_id, warehouse_id, request_item_id, batch_class, batch_id_text
  );

drop trigger if exists warehouse_issue_allocations_updated_at
  on public.warehouse_issue_request_item_allocations;

create trigger warehouse_issue_allocations_updated_at
before update on public.warehouse_issue_request_item_allocations
for each row execute function public.set_updated_at_timestamp();

alter table public.warehouse_issue_request_item_allocations enable row level security;

drop policy if exists warehouse_issue_allocations_select on public.warehouse_issue_request_item_allocations;

create policy warehouse_issue_allocations_select
  on public.warehouse_issue_request_item_allocations
  for select
  to authenticated
  using (company_id = public.get_user_company_id());

revoke all on table public.warehouse_issue_request_item_allocations from public, anon, authenticated;

grant select on table public.warehouse_issue_request_item_allocations to authenticated;

alter table public.stock_ledger_entries
  add column if not exists warehouse_issue_allocation_id uuid
  references public.warehouse_issue_request_item_allocations(id) on delete set null;

create index if not exists stock_ledger_entries_warehouse_issue_allocation_idx
  on public.stock_ledger_entries(warehouse_issue_allocation_id)
  where warehouse_issue_allocation_id is not null;

alter table public.fields
  add column if not exists field_code text,
  add column if not exists is_test_data boolean not null default false,
  add column if not exists test_run_code text;

alter table public.operations
  add column if not exists operation_number text,
  add column if not exists is_test_data boolean not null default false,
  add column if not exists test_run_code text;

create unique index if not exists fields_company_field_code_uidx
  on public.fields(company_id, field_code)
  where field_code is not null;

create unique index if not exists operations_company_operation_number_uidx
  on public.operations(company_id, operation_number)
  where operation_number is not null;

create or replace function public.assign_field_code_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if nullif(btrim(new.field_code), '') is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(new.company_id::text || ':field_code', 0)
  );
  select coalesce(max(substring(field_code from '([0-9]+)$')::integer), 0) + 1
  into v_next
  from public.fields
  where company_id = new.company_id
    and field_code ~ '^FLD-[0-9]+$';
  new.field_code := 'FLD-' || lpad(v_next::text, 3, '0');
  return new;
end;
$$;

revoke all on function public.assign_field_code_v1() from public, anon, authenticated;

drop trigger if exists assign_field_code_v1 on public.fields;

create trigger assign_field_code_v1
before insert on public.fields
for each row execute function public.assign_field_code_v1();

create or replace function public.assign_operation_number_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_next integer;
begin
  if nullif(btrim(new.operation_number), '') is not null then
    return new;
  end if;
  v_year := extract(year from new.date)::integer;
  perform pg_advisory_xact_lock(
    hashtextextended(new.company_id::text || ':operation_number:' || v_year::text, 0)
  );
  select coalesce(max(substring(operation_number from '([0-9]+)$')::integer), 0) + 1
  into v_next
  from public.operations
  where company_id = new.company_id
    and operation_number like 'OP-' || v_year::text || '-%';
  new.operation_number :=
    'OP-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
  return new;
end;
$$;

revoke all on function public.assign_operation_number_v1() from public, anon, authenticated;

drop trigger if exists assign_operation_number_v1 on public.operations;

create trigger assign_operation_number_v1
before insert on public.operations
for each row execute function public.assign_operation_number_v1();

create or replace function public.normalize_material_issue_uom_v1(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_unit, '')))
    when 'кг' then 'kg'
    when 'г' then 'g'
    when 'л' then 'l'
    when 'liter' then 'l'
    when 'litre' then 'l'
    when 'мл' then 'ml'
    when 'т' then 't'
    when 'шт' then 'pcs'
    when 'шт.' then 'pcs'
    when 'pc' then 'pcs'
    else lower(btrim(coalesce(p_unit, '')))
  end;
$$;

revoke all on function public.normalize_material_issue_uom_v1(text)
  from public, anon, authenticated;

create or replace function public.prepare_package_aware_material_request_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_request_id uuid,
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
  v_allocation jsonb;
  v_product_id uuid;
  v_unit text;
  v_prepared numeric;
  v_allocation_quantity numeric;
  v_on_hand numeric;
  v_reserved numeric;
  v_available numeric;
  v_batch_id_text text;
  v_batch_id uuid;
  v_batch_class text;
  v_issue_mode text;
  v_package_source text;
  v_package_size numeric;
  v_package_count numeric;
  v_package_unit text;
  v_manual_reason text;
  v_batch_package_size numeric;
  v_batch_package_unit text;
  v_product_package_size numeric;
  v_product_package_unit text;
  v_allocation_count integer;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  if p_source_warehouse_id is null then
    raise exception 'Source warehouse is required' using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'request_stage_package_v1',
    p_idempotency_key,
    p_request_fingerprint
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
    where w.id = p_source_warehouse_id
      and w.company_id = p_company_id
      and not coalesce(w.archived, false)
      and not coalesce(w.is_archived, false)
  ) then
    raise exception 'Source warehouse does not belong to the target company'
      using errcode = '23503';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Prepared allocations are required' using errcode = '22023';
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
    raise exception 'Allocation is required for every request item'
      using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Each request item must be submitted once'
      using errcode = '23505';
  end if;

  delete from public.warehouse_issue_request_item_allocations
  where request_id = p_request_id and company_id = p_company_id;

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

    v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);
    v_unit := public.normalize_material_issue_uom_v1(
      coalesce(v_item.prepared_unit, v_item.unit)
    );
    v_prepared := 0;
    v_allocation_count := jsonb_array_length(coalesce(v_input -> 'allocations', '[]'::jsonb));
    if v_allocation_count = 0 then
      raise exception 'At least one explicit stock allocation is required'
        using errcode = '22023';
    end if;
    if v_allocation_count <> (
      select count(distinct concat_ws(
        ':',
        nullif(value ->> 'batch_class', ''),
        coalesce(nullif(value ->> 'batch_id_text', ''), '__unassigned__')
      ))
      from jsonb_array_elements(coalesce(v_input -> 'allocations', '[]'::jsonb))
    ) then
      raise exception 'The same stock batch cannot be selected twice'
        using errcode = '23505';
    end if;

    select coalesce(sum(b.quantity), 0)
    into v_on_hand
    from public.v_stock_balance_identity b
    where b.company_id = p_company_id
      and b.warehouse_id = p_source_warehouse_id
      and b.product_id = v_product_id
      and public.normalize_material_issue_uom_v1(b.uom) = v_unit;

    select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
    into v_reserved
    from public.warehouse_issue_requests r
    join public.warehouse_issue_request_items i on i.request_id = r.id
    where r.company_id = p_company_id
      and i.company_id = p_company_id
      and r.id <> p_request_id
      and r.source_warehouse_id = p_source_warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_product_id
      and coalesce(r.warehouse_request_status, '') in (
        'pending', 'collecting', 'ready_for_pickup'
      )
      and public.normalize_material_issue_uom_v1(
        coalesce(i.prepared_unit, i.unit)
      ) = v_unit;
    v_available := v_on_hand - v_reserved;

    for v_allocation in
      select value
      from jsonb_array_elements(coalesce(v_input -> 'allocations', '[]'::jsonb))
    loop
      v_allocation_quantity := coalesce((v_allocation ->> 'quantity')::numeric, 0);
      v_batch_id_text := nullif(v_allocation ->> 'batch_id_text', '');
      v_batch_id := nullif(v_allocation ->> 'batch_id', '')::uuid;
      v_batch_class := nullif(btrim(v_allocation ->> 'batch_class'), '');
      v_issue_mode := v_allocation ->> 'issue_mode';
      v_manual_reason := nullif(btrim(v_allocation ->> 'manual_package_reason'), '');
      if v_allocation_quantity <= 0 then
        raise exception 'Allocation quantity must be positive' using errcode = '23514';
      end if;
      if v_issue_mode not in ('whole_package', 'measured') then
        raise exception 'Unknown material issue mode' using errcode = '23514';
      end if;
      if v_batch_class is null then
        raise exception 'Stock batch class is required' using errcode = '23514';
      end if;
      if v_batch_id is not null
         and v_batch_id_text is distinct from v_batch_id::text then
        raise exception 'Batch identity does not match the selected inventory batch'
          using errcode = '23514';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(
        concat_ws(
          ':',
          p_company_id::text,
          p_source_warehouse_id::text,
          v_product_id::text,
          v_unit,
          v_batch_class,
          coalesce(v_batch_id_text, '__unassigned__')
        ),
        0
      ));

      select coalesce(sum(b.quantity), 0)
      into v_on_hand
      from public.v_stock_balance_identity b
      where b.company_id = p_company_id
        and b.warehouse_id = p_source_warehouse_id
        and b.product_id = v_product_id
        and public.normalize_material_issue_uom_v1(b.uom) = v_unit
        and b.batch_class = v_batch_class
        and b.batch_id is not distinct from v_batch_id_text;

      select coalesce(sum(greatest(a.prepared_quantity - a.issued_quantity, 0)), 0)
      into v_reserved
      from public.warehouse_issue_request_item_allocations a
      join public.warehouse_issue_requests r on r.id = a.request_id
      join public.warehouse_issue_request_items i on i.id = a.request_item_id
      where a.company_id = p_company_id
        and a.request_id <> p_request_id
        and a.warehouse_id = p_source_warehouse_id
        and coalesce(i.actual_product_id, i.product_id) = v_product_id
        and public.normalize_material_issue_uom_v1(
          coalesce(i.prepared_unit, i.unit)
        ) = v_unit
        and a.batch_class = v_batch_class
        and a.batch_id_text is not distinct from v_batch_id_text
        and coalesce(r.warehouse_request_status, '') in (
          'pending', 'collecting', 'ready_for_pickup'
        );
      if v_allocation_quantity > v_on_hand - v_reserved + 0.000001 then
        raise exception 'Insufficient stock in selected batch. Available %, required %',
          round(v_on_hand - v_reserved, 4),
          round(v_allocation_quantity, 4)
          using errcode = '23514';
      end if;

      v_package_source := 'measured';
      v_package_size := null;
      v_package_count := null;
      v_package_unit := null;
      if v_issue_mode = 'whole_package' then
        v_batch_package_size := null;
        v_batch_package_unit := null;
        if v_batch_id is not null then
          select b.package_size, b.package_unit
          into v_batch_package_size, v_batch_package_unit
          from public.inventory_batches b
          where b.id = v_batch_id
            and b.company_id = p_company_id
            and b.product_id = v_product_id;
        end if;
        select p.package_size, p.package_unit
        into v_product_package_size, v_product_package_unit
        from public.products p
        where p.id = v_product_id;

        if v_batch_package_size is not null then
          v_package_source := 'batch';
          v_package_size := v_batch_package_size;
          v_package_unit := v_batch_package_unit;
        elsif v_product_package_size is not null then
          v_package_source := 'product';
          v_package_size := v_product_package_size;
          v_package_unit := v_product_package_unit;
        else
          v_package_source := 'manual';
          v_package_size := nullif(v_allocation ->> 'package_size', '')::numeric;
          v_package_unit := nullif(v_allocation ->> 'package_unit', '');
          if v_manual_reason is null then
            raise exception 'Manual package size requires an explanation'
              using errcode = '23514';
          end if;
        end if;
        v_package_count := nullif(v_allocation ->> 'package_count', '')::numeric;
        if v_package_size is null or v_package_size <= 0 then
          raise exception 'Package size must be positive' using errcode = '23514';
        end if;
        if v_package_count is null
           or v_package_count <= 0
           or v_package_count <> trunc(v_package_count) then
          raise exception 'Package count must be a positive integer'
            using errcode = '23514';
        end if;
        if public.normalize_material_issue_uom_v1(v_package_unit) <> v_unit then
          raise exception 'Package unit does not match request unit'
            using errcode = '23514';
        end if;
        if abs(v_allocation_quantity - v_package_size * v_package_count) > 0.0001 then
          raise exception 'Prepared quantity must equal package size multiplied by package count'
            using errcode = '23514';
        end if;
      end if;

      insert into public.warehouse_issue_request_item_allocations (
        company_id,
        request_id,
        request_item_id,
        warehouse_id,
        batch_id,
        batch_id_text,
        batch_class,
        batch_label,
        issue_mode,
        package_source,
        package_size,
        package_count,
        package_unit,
        manual_package_reason,
        prepared_quantity,
        created_by_profile_id
      ) values (
        p_company_id,
        p_request_id,
        v_item.id,
        p_source_warehouse_id,
        v_batch_id,
        v_batch_id_text,
        v_batch_class,
        coalesce(nullif(btrim(v_allocation ->> 'batch_label'), ''), 'Партия не указана'),
        v_issue_mode,
        v_package_source,
        v_package_size,
        v_package_count::integer,
        v_package_unit,
        v_manual_reason,
        round(v_allocation_quantity, 4),
        p_actor_profile_id
      );
      v_prepared := v_prepared + v_allocation_quantity;
    end loop;

    if v_prepared > v_available + 0.000001 then
      raise exception 'Insufficient available stock after reservations: available %, required %',
        round(v_available, 4),
        round(v_prepared, 4)
        using errcode = '23514';
    end if;
    if v_prepared + 0.000001
       < coalesce(v_item.planned_quantity, v_item.required_quantity, 0) then
      raise exception 'Prepared quantity cannot be lower than the operation plan'
        using errcode = '23514';
    end if;

    update public.warehouse_issue_request_items i
    set
      prepared_quantity = round(v_prepared, 4),
      prepared_unit = i.unit,
      expected_consumed_quantity = coalesce(i.planned_quantity, i.required_quantity, 0),
      expected_return_quantity = greatest(
        round(v_prepared, 4) - coalesce(i.planned_quantity, i.required_quantity, 0),
        0
      ),
      package_size = case when v_allocation_count = 1 then (
        select a.package_size
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_count = case when v_allocation_count = 1 then (
        select a.package_count
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_unit = case when v_allocation_count = 1 then (
        select a.package_unit
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      issue_mode = case
        when (
          select count(distinct a.issue_mode)
          from public.warehouse_issue_request_item_allocations a
          where a.request_item_id = i.id
        ) > 1 then 'mixed'
        else (
          select min(a.issue_mode)
          from public.warehouse_issue_request_item_allocations a
          where a.request_item_id = i.id
        )
      end,
      package_source = case when v_allocation_count = 1 then (
        select a.package_source
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      package_reason = case when v_allocation_count = 1 then (
        select a.manual_package_reason
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      batch_id = case when v_allocation_count = 1 then (
        select a.batch_id
        from public.warehouse_issue_request_item_allocations a
        where a.request_item_id = i.id
      ) else null end,
      shortage_quantity = greatest(
        coalesce(i.planned_quantity, i.required_quantity, 0) - round(v_prepared, 4),
        0
      ),
      reconciliation_status = 'prepared'
    where i.id = v_item.id;
  end loop;

  update public.warehouse_issue_requests
  set
    status = 'ready',
    warehouse_request_status = 'ready_for_pickup',
    source_warehouse_id = p_source_warehouse_id,
    prepared_at = coalesce(prepared_at, now()),
    ready_at = now(),
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, new_values
  ) values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'request_ready_package_aware_v1',
    jsonb_build_object(
      'source_warehouse_id', p_source_warehouse_id,
      'allocation_count', (
        select count(*)
        from public.warehouse_issue_request_item_allocations
        where request_id = p_request_id
      ),
      'reservation_checked', true
    )
  );

  v_response := jsonb_build_object(
    'request', to_jsonb(v_request),
    'workflow_status', 'ready'
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'request_stage_package_v1',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;

grant execute on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

create or replace function public.issue_package_aware_material_request_atomic_v1(
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
  v_allocation public.warehouse_issue_request_item_allocations%rowtype;
  v_ledger jsonb;
  v_stock record;
  v_issue_quantity numeric;
  v_ledger_quantity numeric;
  v_reserved numeric;
  v_next_issued numeric;
  v_total_prepared numeric;
  v_total_issued numeric;
  v_next_status text;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id,
    'issue_package_v1',
    p_idempotency_key,
    p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_request
  from public.warehouse_issue_requests
  where id = p_request_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Material request was not found' using errcode = 'P0002';
  end if;
  if v_request.status in ('issued_by_warehouse', 'issued') then
    v_response := jsonb_build_object(
      'result', jsonb_build_object(
        'success', true,
        'already_issued', true,
        'request_id', p_request_id,
        'status', v_request.status
      ),
      'workflow_status', 'issued'
    );
    return public.operation_mutation_receipt_finish_v1(
      p_company_id,
      'issue_package_v1',
      p_request_id,
      p_idempotency_key,
      p_request_fingerprint,
      p_actor_profile_id,
      v_response
    );
  end if;
  if v_request.status not in ('received_confirmed', 'partially_issued') then
    raise exception 'Specialist must accept prepared materials before warehouse issue'
      using errcode = '23514';
  end if;
  if v_request.source_warehouse_id is distinct from p_source_warehouse_id then
    raise exception 'Selected warehouse does not match the prepared request warehouse'
      using errcode = '23514';
  end if;

  perform 1
  from public.warehouse_issue_request_items i
  where i.request_id = p_request_id and i.company_id = p_company_id
  for update;
  perform 1
  from public.warehouse_issue_request_item_allocations a
  where a.request_id = p_request_id and a.company_id = p_company_id
  for update;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'At least one issue item is required' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) <> (
    select count(distinct value ->> 'item_id')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  ) then
    raise exception 'Each issue item must be submitted once'
      using errcode = '23505';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    left join public.warehouse_issue_request_item_allocations a
      on a.id = nullif(row ->> 'allocation_id', '')::uuid
     and a.request_id = p_request_id
     and a.company_id = p_company_id
    left join public.warehouse_issue_request_items i
      on i.id = a.request_item_id
    where a.id is null
       or row ->> 'reason_ref_id' is distinct from a.request_item_id::text
       or row ->> 'warehouse_id' is distinct from a.warehouse_id::text
       or row ->> 'product_id' is distinct from coalesce(i.actual_product_id, i.product_id)::text
       or row ->> 'batch_class' is distinct from a.batch_class
       or public.normalize_material_issue_uom_v1(row ->> 'uom')
          is distinct from public.normalize_material_issue_uom_v1(
            coalesce(i.prepared_unit, i.unit)
          )
       or nullif(row ->> 'batch_id_text', '')
          is distinct from a.batch_id_text
  ) then
    raise exception 'Ledger payload contains an unknown or mismatched prepared allocation'
      using errcode = '23514';
  end if;

  for v_item_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id
    for update;
    if not found then
      raise exception 'Issue item does not belong to the request'
        using errcode = '23503';
    end if;
    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);
    if v_issue_quantity <= 0 then
      raise exception 'Issue quantity must be positive' using errcode = '22023';
    end if;
    if coalesce(v_item.issued_quantity, 0) + v_issue_quantity
       > coalesce(v_item.prepared_quantity, 0) + 0.000001 then
      raise exception 'Issued quantity exceeds prepared remainder'
        using errcode = '23514';
    end if;
    select coalesce(sum(a.prepared_quantity - a.issued_quantity), 0)
    into v_ledger_quantity
    from public.warehouse_issue_request_item_allocations a
    where a.request_item_id = v_item.id;
    if abs(v_ledger_quantity - v_issue_quantity) > 0.0001 then
      raise exception 'Issue must use the prepared allocation remainder'
        using errcode = '23514';
    end if;
    select coalesce(sum(abs((row ->> 'delta_qty_signed')::numeric)), 0)
    into v_ledger_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    where row ->> 'reason_ref_id' = v_item.id::text;
    if abs(v_ledger_quantity - v_issue_quantity) > 0.0001 then
      raise exception 'Ledger payload does not match issued quantity'
        using errcode = '23514';
    end if;
  end loop;

  for v_allocation in
    select *
    from public.warehouse_issue_request_item_allocations
    where request_id = p_request_id
      and company_id = p_company_id
      and prepared_quantity > issued_quantity + 0.000001
    order by created_at, id
  loop
    select coalesce(sum(abs((row ->> 'delta_qty_signed')::numeric)), 0)
    into v_ledger_quantity
    from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb)) row
    where row ->> 'allocation_id' = v_allocation.id::text;
    if abs(
      v_ledger_quantity
      - (v_allocation.prepared_quantity - v_allocation.issued_quantity)
    ) > 0.0001 then
      raise exception 'Ledger payload does not match prepared batch allocation'
        using errcode = '23514';
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
      concat_ws(
        ':',
        p_company_id::text,
        v_stock.warehouse_id::text,
        v_stock.product_id::text,
        v_stock.uom,
        v_stock.batch_class,
        coalesce(v_stock.batch_id_text, '__unassigned__')
      ),
      0
    ));
    select coalesce(sum(l.delta_qty_signed), 0)
    into v_ledger_quantity
    from public.stock_ledger_entries l
    where l.company_id = p_company_id
      and l.warehouse_id = v_stock.warehouse_id
      and l.product_id = v_stock.product_id
      and l.uom = v_stock.uom
      and l.batch_class = v_stock.batch_class
      and l.batch_id_text is not distinct from v_stock.batch_id_text;
    select coalesce(sum(greatest(a.prepared_quantity - a.issued_quantity, 0)), 0)
    into v_reserved
    from public.warehouse_issue_request_item_allocations a
    join public.warehouse_issue_requests r on r.id = a.request_id
    join public.warehouse_issue_request_items i on i.id = a.request_item_id
    where a.company_id = p_company_id
      and a.request_id <> p_request_id
      and a.warehouse_id = v_stock.warehouse_id
      and coalesce(i.actual_product_id, i.product_id) = v_stock.product_id
      and public.normalize_material_issue_uom_v1(
        coalesce(i.prepared_unit, i.unit)
      ) = public.normalize_material_issue_uom_v1(v_stock.uom)
      and a.batch_class = v_stock.batch_class
      and a.batch_id_text is not distinct from v_stock.batch_id_text
      and coalesce(r.warehouse_request_status, '') in (
        'pending', 'collecting', 'ready_for_pickup'
      );
    if v_ledger_quantity - v_reserved + 0.000001 < v_stock.required_quantity then
      raise exception 'Insufficient stock. Available %, required %',
        greatest(v_ledger_quantity - v_reserved, 0),
        v_stock.required_quantity
        using errcode = '23514';
    end if;
  end loop;

  for v_ledger in
    select value from jsonb_array_elements(coalesce(p_ledger_rows, '[]'::jsonb))
  loop
    insert into public.stock_ledger_entries (
      company_id,
      product_id,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes,
      batch_id_text,
      batch_class,
      mass_kg,
      density_kg_per_l,
      density_unit,
      density_source,
      density_verification_status,
      density_verified_at,
      unit_source,
      unit_contract_version,
      operation_line_id,
      warehouse_issue_allocation_id
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
      coalesce(
        v_request.operation_line_id,
        nullif(v_ledger ->> 'operation_line_id', '')::uuid
      ),
      (v_ledger ->> 'allocation_id')::uuid
    );
    update public.warehouse_issue_request_item_allocations
    set
      issued_quantity = round(
        issued_quantity + abs((v_ledger ->> 'delta_qty_signed')::numeric),
        4
      ),
      updated_at = now()
    where id = (v_ledger ->> 'allocation_id')::uuid
      and request_id = p_request_id
      and company_id = p_company_id;
  end loop;

  for v_item_input in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_item
    from public.warehouse_issue_request_items
    where id = (v_item_input ->> 'item_id')::uuid
    for update;
    v_issue_quantity := (v_item_input ->> 'issued_quantity')::numeric;
    v_next_issued := coalesce(v_item.issued_quantity, 0) + v_issue_quantity;
    update public.warehouse_issue_request_items
    set
      issued_quantity = round(v_next_issued, 4),
      issued_unit = unit,
      expected_consumed_quantity = coalesce(planned_quantity, required_quantity, 0),
      expected_return_quantity = greatest(
        v_next_issued - coalesce(planned_quantity, required_quantity, 0),
        0
      ),
      shortage_quantity = greatest(
        coalesce(planned_quantity, required_quantity, 0) - v_next_issued,
        0
      ),
      reconciliation_status = 'issued'
    where id = v_item.id;
  end loop;

  select coalesce(sum(prepared_quantity), 0), coalesce(sum(issued_quantity), 0)
  into v_total_prepared, v_total_issued
  from public.warehouse_issue_request_items
  where request_id = p_request_id and company_id = p_company_id;
  v_next_status := case
    when v_total_prepared > 0
      and v_total_issued >= v_total_prepared - 0.000001
      then 'issued_by_warehouse'
    else 'partially_issued'
  end;

  update public.warehouse_issue_requests
  set
    status = v_next_status,
    source_warehouse_id = p_source_warehouse_id,
    issued_at = now(),
    issued_by_user_id = p_actor_profile_id,
    warehouse_request_status = 'issued',
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  update public.operation_materials m
  set
    issued_quantity = q.issued_quantity,
    updated_by_user_id = auth.uid(),
    updated_at = now()
  from (
    select i.product_id, sum(coalesce(i.issued_quantity, 0)) as issued_quantity
    from public.warehouse_issue_request_items i
    where i.request_id = p_request_id and i.company_id = p_company_id
    group by i.product_id
  ) q
  where m.operation_id = v_request.operation_id
    and m.company_id = p_company_id
    and m.product_id = q.product_id;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, new_values
  ) values (
    p_company_id,
    p_actor_profile_id,
    'warehouse_issue_request',
    p_request_id::text,
    'issued_package_aware_v1',
    jsonb_build_object(
      'status', v_next_status,
      'total_prepared', v_total_prepared,
      'total_issued', v_total_issued,
      'ledger_rows', jsonb_array_length(coalesce(p_ledger_rows, '[]'::jsonb))
    )
  );

  v_response := jsonb_build_object(
    'result', jsonb_build_object(
      'success', true,
      'request_id', p_request_id,
      'status', v_next_status,
      'issued_at', v_request.issued_at,
      'total_prepared', v_total_prepared,
      'total_issued', v_total_issued
    ),
    'workflow_status',
    case when v_next_status = 'partially_issued' then 'partially_issued' else 'issued' end
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id,
    'issue_package_v1',
    p_request_id,
    p_idempotency_key,
    p_request_fingerprint,
    p_actor_profile_id,
    v_response
  );
end;
$$;

revoke all on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

-- END SOURCE: 20260730105407_package_aware_warehouse_issue_v1.sql



-- BEGIN SOURCE: 20260730111532_package_aware_receipt_action_contract_v1.sql

-- Keep the package-aware RPCs compatible with the canonical
-- operation_mutation_receipts_action_check contract.
do $migration$
declare
  v_signature text;
  v_definition text;
begin
  v_signature :=
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)';
  select pg_get_functiondef(to_regprocedure(v_signature))
  into v_definition;
  if v_definition is null then
    raise exception 'Package-aware prepare RPC is missing';
  end if;
  if position('request_stage_package_v1' in v_definition) > 0 then
    execute replace(
      v_definition,
      quote_literal('request_stage_package_v1'),
      quote_literal('request_stage')
    );
  end if;

  v_signature :=
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)';
  select pg_get_functiondef(to_regprocedure(v_signature))
  into v_definition;
  if v_definition is null then
    raise exception 'Package-aware issue RPC is missing';
  end if;
  if position('issue_package_v1' in v_definition) > 0 then
    execute replace(
      v_definition,
      quote_literal('issue_package_v1'),
      quote_literal('issue')
    );
  end if;
end;
$migration$;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if position('request_stage_package_v1' in v_prepare_definition) > 0
     or position('issue_package_v1' in v_issue_definition) > 0 then
    raise exception 'Package-aware receipt actions were not canonicalized';
  end if;
  if position(quote_literal('request_stage') in v_prepare_definition) = 0
     or position(quote_literal('issue') in v_issue_definition) = 0 then
    raise exception 'Canonical receipt actions are missing';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260730111532_package_aware_receipt_action_contract_v1.sql



-- BEGIN SOURCE: 20260730121441_field_history_company_rls_v1.sql

alter table public.field_history enable row level security;

drop policy if exists "Allow public delete access to field_history"
  on public.field_history;

drop policy if exists "Allow public insert access to field_history"
  on public.field_history;

drop policy if exists "Allow public read access to field_history"
  on public.field_history;

drop policy if exists "Allow public update access to field_history"
  on public.field_history;

drop policy if exists field_history_company_select_v1
  on public.field_history;

drop policy if exists field_history_company_insert_v1
  on public.field_history;

drop policy if exists field_history_company_update_v1
  on public.field_history;

revoke all privileges on table public.field_history
  from public, anon, authenticated;

grant select, insert, update on table public.field_history
  to authenticated;

create policy field_history_company_select_v1
on public.field_history
for select
to authenticated
using (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

create policy field_history_company_insert_v1
on public.field_history
for insert
to authenticated
with check (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

create policy field_history_company_update_v1
on public.field_history
for update
to authenticated
using (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
)
with check (
  exists (
    select 1
    from public.fields
    where fields.id = field_history.field_id
      and fields.company_id = public.get_user_company_id()
  )
);

do $postcheck$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'field_history'
      and 'public' = any(roles)
  ) then
    raise exception 'field_history still has a public RLS policy';
  end if;

  if has_table_privilege('anon', 'public.field_history', 'SELECT')
     or has_table_privilege('anon', 'public.field_history', 'INSERT')
     or has_table_privilege('anon', 'public.field_history', 'UPDATE')
     or has_table_privilege('anon', 'public.field_history', 'DELETE') then
    raise exception 'anon still has field_history CRUD privileges';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.field_history',
    'SELECT'
  )
     or not has_table_privilege(
       'authenticated',
       'public.field_history',
       'INSERT'
     )
     or not has_table_privilege(
       'authenticated',
       'public.field_history',
       'UPDATE'
     )
     or has_table_privilege(
       'authenticated',
       'public.field_history',
       'DELETE'
     ) then
    raise exception 'authenticated field_history privileges are incorrect';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260730121441_field_history_company_rls_v1.sql



-- BEGIN SOURCE: 20260730140942_simplify_warehouse_issue_quantities_v1.sql

-- TZ-239: expose quantity-only warehouse preparation and issue RPCs.
--
-- Legacy package columns and RPCs remain in place for rollback compatibility,
-- but authenticated callers can only execute the quantity-only entrypoints.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Legacy warehouse prepare RPC is missing';
  end if;
  if position(
    'Prepared quantity cannot be lower than the operation plan'
    in v_prepare_definition
  ) = 0 then
    raise exception 'Expected lower-plan guard was not found in warehouse prepare RPC';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_package_aware_material_request_atomic_v1',
    'prepare_material_request_atomic_v1'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'v_issue_mode := v_allocation ->> ''issue_mode'';',
    'v_issue_mode := ''measured'';'
  );
  v_prepare_definition := regexp_replace(
    v_prepare_definition,
    E'\\s*if v_prepared \\+ 0\\.000001\\s*' ||
      E'< coalesce\\(v_item\\.planned_quantity, v_item\\.required_quantity, 0\\) then\\s*' ||
      E'raise exception ''Prepared quantity cannot be lower than the operation plan''\\s*' ||
      E'using errcode = ''23514'';\\s*end if;',
    E'\n',
    'n'
  );
  if position(
    'Prepared quantity cannot be lower than the operation plan'
    in v_prepare_definition
  ) > 0 then
    raise exception 'Lower-plan guard could not be removed from warehouse prepare RPC';
  end if;
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_package_aware_v1',
    'request_ready_quantity_v1'
  );
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_package_aware_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Legacy warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_package_aware_material_request_atomic_v1',
    'issue_material_request_atomic_v2'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_package_aware_v1',
    'issued_quantity_v1'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.issue_package_aware_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;

grant execute on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_prepare_definition is null or v_issue_definition is null then
    raise exception 'Quantity-only warehouse RPCs were not created';
  end if;
  if position('v_issue_mode := v_allocation ->> ''issue_mode'';' in v_prepare_definition) > 0
     or position('Prepared quantity cannot be lower than the operation plan' in v_prepare_definition) > 0 then
    raise exception 'Quantity-only prepare RPC still depends on package mode or plan floor';
  end if;
  if position('v_issue_mode := ''measured'';' in v_prepare_definition) = 0 then
    raise exception 'Legacy allocation compatibility mode is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_package_aware_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_package_aware_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Legacy package-aware RPC remains callable by authenticated';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260730140942_simplify_warehouse_issue_quantities_v1.sql



-- BEGIN SOURCE: 20260730153500_warehouse_issue_product_identity_v1.sql

-- TZ-239: keep quantity-only warehouse issue compatible with catalog identity.
--
-- Company catalog rows may point at a global master product while existing
-- stock ledger rows still use that master ID. Resolve the request item to the
-- master inside the same transaction before reservation and issue.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Quantity-only warehouse prepare RPC is missing';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_material_request_atomic_v1',
    'prepare_material_request_atomic_v2'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'v_product_id := coalesce(v_item.actual_product_id, v_item.product_id);',
    $replacement$v_product_id := coalesce(
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );
    update public.warehouse_issue_request_items
    set actual_product_id = v_product_id
    where id = v_item.id
      and actual_product_id is distinct from v_product_id;
    v_item.actual_product_id := v_product_id;$replacement$
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_quantity_v1',
    'request_ready_identity_v1'
  );
  if position('v_item.actual_product_id := v_product_id;' in v_prepare_definition) = 0 then
    raise exception 'Catalog identity assignment could not be installed';
  end if;
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Quantity-only warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v2',
    'issue_material_request_atomic_v3'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_quantity_v1',
    'issued_identity_quantity_v1'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_material_request_atomic_v1(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.issue_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;

grant execute on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_prepare_definition is null or v_issue_definition is null then
    raise exception 'Identity-safe warehouse RPCs were not created';
  end if;
  if position('v_item.actual_product_id := v_product_id;' in v_prepare_definition) = 0 then
    raise exception 'Identity-safe prepare RPC is incomplete';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_material_request_atomic_v1(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v2(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded quantity RPCs remain callable by authenticated';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260730153500_warehouse_issue_product_identity_v1.sql



-- BEGIN SOURCE: 20260731013506_warehouse_issue_actual_product_identity_v2.sql

-- TZ-239: canonicalize a preselected company product before stock allocation.
--
-- A request item can already contain its company catalog product in
-- actual_product_id. Existing stock may use that row's global master product.
-- Resolve both actual_product_id and product_id to the master atomically.

do $migration$
declare
  v_prepare_definition text;
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v2(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;
  if v_prepare_definition is null then
    raise exception 'Identity-aware warehouse prepare RPC is missing';
  end if;

  v_prepare_definition := replace(
    v_prepare_definition,
    'prepare_material_request_atomic_v2',
    'prepare_material_request_atomic_v3'
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    $old$v_product_id := coalesce(
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );$old$,
    $new$v_product_id := coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.actual_product_id
      ),
      v_item.actual_product_id,
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.product_id
      ),
      v_item.product_id
    );$new$
  );
  v_prepare_definition := replace(
    v_prepare_definition,
    'request_ready_identity_v1',
    'request_ready_actual_identity_v2'
  );
  if position(
    'p.id = v_item.actual_product_id' in v_prepare_definition
  ) = 0 then
    raise exception 'Actual product identity resolution could not be installed';
  end if;
  execute v_prepare_definition;

  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Identity-aware warehouse issue RPC is missing';
  end if;
  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v3',
    'issue_material_request_atomic_v4'
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_identity_quantity_v1',
    'issued_actual_identity_quantity_v2'
  );
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.prepare_material_request_atomic_v2(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.issue_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.prepare_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, text, text
) from public, anon;

grant execute on function public.prepare_material_request_atomic_v3(
  uuid, uuid, uuid, uuid, jsonb, text, text
) to authenticated;

revoke all on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_prepare_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.prepare_material_request_atomic_v3(' ||
    'uuid,uuid,uuid,uuid,jsonb,text,text)'
  ))
  into v_prepare_definition;

  if v_prepare_definition is null or position(
    'p.id = v_item.actual_product_id' in v_prepare_definition
  ) = 0 then
    raise exception 'Actual product identity-safe prepare RPC is incomplete';
  end if;
  if to_regprocedure(
    'public.issue_material_request_atomic_v4(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ) is null then
    raise exception 'Actual product identity-safe issue RPC is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.prepare_material_request_atomic_v2(' ||
      'uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v3(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded identity RPCs remain callable';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260731013506_warehouse_issue_actual_product_identity_v2.sql



-- BEGIN SOURCE: 20260731015717_warehouse_issue_equivalent_product_identity_v3.sql

-- TZ-239: treat a company product and its global master as one identity.
--
-- The substitution guard remains active for genuinely different products.
-- This migration only creates a new callable issue RPC version.

do $migration$
declare
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v4(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;
  if v_issue_definition is null then
    raise exception 'Actual identity-aware warehouse issue RPC is missing';
  end if;

  v_issue_definition := replace(
    v_issue_definition,
    'issue_material_request_atomic_v4',
    'issue_material_request_atomic_v5'
  );
  v_issue_definition := replace(
    v_issue_definition,
    $anchor$    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);$anchor$,
    $equivalent$    if coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.planned_product_id
      ),
      v_item.planned_product_id
    ) is distinct from coalesce(
      (
        select p.master_product_id
        from public.products p
        where p.id = v_item.actual_product_id
      ),
      v_item.actual_product_id
    ) and coalesce(v_item.substitution_status, 'none') <> 'approved' then
      raise exception 'Material substitution must be approved before issue'
        using errcode = '23514';
    end if;
    v_issue_quantity := coalesce((v_item_input ->> 'issued_quantity')::numeric, 0);$equivalent$
  );
  v_issue_definition := replace(
    v_issue_definition,
    'issued_actual_identity_quantity_v2',
    'issued_equivalent_identity_quantity_v3'
  );
  if position('p.id = v_item.planned_product_id' in v_issue_definition) = 0
     or position('substitution_status' in v_issue_definition) = 0 then
    raise exception 'Equivalent product identity guard could not be installed';
  end if;
  execute v_issue_definition;
end;
$migration$;

revoke all on function public.issue_material_request_atomic_v4(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon, authenticated;

revoke all on function public.issue_material_request_atomic_v5(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) from public, anon;

grant execute on function public.issue_material_request_atomic_v5(
  uuid, uuid, uuid, uuid, jsonb, jsonb, text, text
) to authenticated;

do $postcheck$
declare
  v_issue_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.issue_material_request_atomic_v5(' ||
    'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)'
  ))
  into v_issue_definition;

  if v_issue_definition is null or position(
    'p.id = v_item.planned_product_id' in v_issue_definition
  ) = 0 then
    raise exception 'Equivalent product identity-safe issue RPC is incomplete';
  end if;
  if position('substitution_status' in v_issue_definition) = 0 then
    raise exception 'Material substitution guard was removed';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.issue_material_request_atomic_v4(' ||
      'uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Superseded issue RPC remains callable';
  end if;
end;
$postcheck$;

-- END SOURCE: 20260731015717_warehouse_issue_equivalent_product_identity_v3.sql



-- BEGIN SOURCE: 20260731144242_crop_structure_fallow_operations_v1.sql

-- TZ-240: represent fallow land explicitly without inventing a crop row.
ALTER TABLE public.crop_structure
  ADD COLUMN IF NOT EXISTS land_use_type text NOT NULL DEFAULT 'crop';

ALTER TABLE public.crop_structure
  DROP CONSTRAINT IF EXISTS crop_structure_land_use_type_check;

ALTER TABLE public.crop_structure
  ADD CONSTRAINT crop_structure_land_use_type_check
  CHECK (land_use_type IN ('crop', 'fallow'));

ALTER TABLE public.crop_structure
  DROP CONSTRAINT IF EXISTS crop_structure_land_use_identity_check;

ALTER TABLE public.crop_structure
  ADD CONSTRAINT crop_structure_land_use_identity_check
  CHECK (
    (land_use_type = 'crop' AND crop_id IS NOT NULL)
    OR
    (
      land_use_type = 'fallow'
      AND crop_id IS NULL
      AND variety_id IS NULL
      AND reproduction_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_crop_structure_company_season_land_use
  ON public.crop_structure (company_id, season_id, land_use_type)
  WHERE archived = false;

COMMENT ON COLUMN public.crop_structure.land_use_type IS
  'Canonical land use: crop has crop identity; fallow has no crop, variety, or reproduction.';

-- Keep the operation target deterministic without changing the atomic create RPC.
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS target_scope text
  GENERATED ALWAYS AS (
    CASE
      WHEN crop_structure_id IS NULL THEN 'field'
      ELSE 'structure_line'
    END
  ) STORED;

COMMENT ON COLUMN public.operations.target_scope IS
  'Derived operation scope: whole field or one crop structure line.';

-- END SOURCE: 20260731144242_crop_structure_fallow_operations_v1.sql



-- BEGIN SOURCE: 20260731151000_operation_snow_retention_v1.sql

-- TZ-240: restore the canonical crop-independent snow-retention work type.
INSERT INTO public.operation_types (
  slug,
  category_slug,
  name_ru,
  name_en,
  requires_field,
  requires_machine,
  requires_product,
  affects_inventory,
  affects_field_history,
  is_active
)
VALUES (
  'snow_retention',
  'soil_preparation',
  'Снегозадержание',
  'Snow retention',
  true,
  true,
  false,
  false,
  true,
  true
)
ON CONFLICT (slug) DO UPDATE
SET
  category_slug = EXCLUDED.category_slug,
  name_ru = EXCLUDED.name_ru,
  name_en = EXCLUDED.name_en,
  requires_field = EXCLUDED.requires_field,
  requires_machine = EXCLUDED.requires_machine,
  requires_product = EXCLUDED.requires_product,
  affects_inventory = EXCLUDED.affects_inventory,
  affects_field_history = EXCLUDED.affects_field_history,
  is_active = EXCLUDED.is_active,
  updated_at = now()
WHERE (
  operation_types.category_slug,
  operation_types.name_ru,
  operation_types.name_en,
  operation_types.requires_field,
  operation_types.requires_machine,
  operation_types.requires_product,
  operation_types.affects_inventory,
  operation_types.affects_field_history,
  operation_types.is_active
) IS DISTINCT FROM (
  EXCLUDED.category_slug,
  EXCLUDED.name_ru,
  EXCLUDED.name_en,
  EXCLUDED.requires_field,
  EXCLUDED.requires_machine,
  EXCLUDED.requires_product,
  EXCLUDED.affects_inventory,
  EXCLUDED.affects_field_history,
  EXCLUDED.is_active
);

-- END SOURCE: 20260731151000_operation_snow_retention_v1.sql



-- BEGIN SOURCE: 20260731164000_operation_whole_field_history_v1.sql

-- Record crop-independent whole-field operations in field history.
-- The atomic completion RPC resolves season through crop_structure_id, which is
-- intentionally null for target_scope = field. The operation contract already
-- stores the exact season_id in operation_config.

create or replace function public.record_whole_field_operation_history_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id uuid;
  v_season_year integer;
begin
  if new.crop_structure_id is not null
     or coalesce(new.operation_type_slug, new.operation_category_slug, '') not in ('plowing', 'snow_retention')
     or coalesce(new.operation_status, new.status, new.work_status, '') <> 'completed'
     or coalesce(old.operation_status, old.status, old.work_status, '') = 'completed' then
    return new;
  end if;

  select s.id, s.year
    into v_season_id, v_season_year
  from public.seasons s
  where s.company_id = new.company_id
    and s.id::text = nullif(new.operation_config ->> 'season_id', '')
    and coalesce(s.archived, false) = false
  limit 1;

  if v_season_id is null then
    return new;
  end if;

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
  )
  select
    new.company_id,
    new.field_id,
    v_season_id,
    v_season_year,
    'Operation completed: ' || coalesce(nullif(new.operation_type, ''), 'field work'),
    coalesce(nullif(new.operation_type, ''), 'operation completed'),
    'operation_close',
    new.specialist_comment,
    new.id,
    round(coalesce(new.completed_area_ha, new.planned_area_ha, 0), 4),
    '[]'::jsonb,
    'not_required'
  where not exists (
    select 1
    from public.field_history_entries h
    where h.company_id = new.company_id
      and h.operation_id = new.id
  );

  return new;
end;
$$;

drop trigger if exists operations_whole_field_history_v1 on public.operations;

create trigger operations_whole_field_history_v1
after update of operation_status, status, work_status on public.operations
for each row
execute function public.record_whole_field_operation_history_v1();

revoke all on function public.record_whole_field_operation_history_v1() from public, anon;

-- END SOURCE: 20260731164000_operation_whole_field_history_v1.sql



-- BEGIN SOURCE: 20260801143322_grain_mix_v1.sql

-- TZ-242: one crop-structure allocation with an ordered seed composition.
-- This migration is intentionally additive except for widening product_id on
-- seed planning rows; physical warehouse postings still require a real product.

alter table public.crop_structure
  drop constraint if exists crop_structure_land_use_type_check;

alter table public.crop_structure
  add constraint crop_structure_land_use_type_check
  check (land_use_type in ('crop', 'crop_mix', 'fallow'));

alter table public.crop_structure
  drop constraint if exists crop_structure_land_use_identity_check;

alter table public.crop_structure
  add constraint crop_structure_land_use_identity_check
  check (
    (land_use_type = 'crop' and crop_id is not null)
    or (
      land_use_type in ('crop_mix', 'fallow')
      and crop_id is null
      and variety_id is null
      and reproduction_id is null
    )
  );

create table if not exists public.crop_structure_mix_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  crop_structure_id uuid not null references public.crop_structure(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid not null references public.varieties(id) on delete restrict,
  reproduction_id uuid not null references public.seed_reproductions(id) on delete restrict,
  seed_rate_kg_ha numeric(14,4) not null check (seed_rate_kg_ha > 0),
  sort_order smallint not null check (sort_order between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_structure_mix_components_identity_key
    unique (crop_structure_id, crop_id, variety_id, reproduction_id),
  constraint crop_structure_mix_components_sort_key
    unique (crop_structure_id, sort_order)
);

create index if not exists idx_crop_structure_mix_components_company_structure
  on public.crop_structure_mix_components(company_id, crop_structure_id, sort_order);

create index if not exists idx_crop_structure_mix_components_crop
  on public.crop_structure_mix_components(crop_id, variety_id, reproduction_id);

create or replace function public.validate_crop_structure_mix_component_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_variety_crop_id uuid;
begin
  select cs.* into v_structure
  from public.crop_structure cs
  where cs.id = new.crop_structure_id
  for share;

  if not found or v_structure.company_id is distinct from new.company_id then
    raise exception 'Crop mix component must belong to the same company as its structure row'
      using errcode = '23503';
  end if;
  if v_structure.land_use_type <> 'crop_mix' then
    raise exception 'Crop mix components require land_use_type crop_mix'
      using errcode = '23514';
  end if;

  select v.crop_id into v_variety_crop_id
  from public.varieties v
  where v.id = new.variety_id
    and coalesce(v.archived, false) = false
    and coalesce(v.is_active, true) = true
    and (v.company_id is null or v.company_id = new.company_id);
  if not found or v_variety_crop_id <> new.crop_id then
    raise exception 'Crop mix variety does not belong to its crop'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.crops c
    where c.id = new.crop_id
      and coalesce(c.archived, false) = false
      and coalesce(c.is_active, true) = true
      and (c.company_id is null or c.company_id = new.company_id)
  ) then
    raise exception 'Crop mix crop is not available to the company'
      using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.seed_reproductions sr
    where sr.id = new.reproduction_id
      and coalesce(sr.archived, false) = false
      and coalesce(sr.is_active, true) = true
      and (sr.company_id is null or sr.company_id = new.company_id)
  ) then
    raise exception 'Crop mix reproduction is not available to the company'
      using errcode = '23503';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.validate_crop_structure_mix_component_v1() from public, anon, authenticated;

drop trigger if exists validate_crop_structure_mix_component_v1 on public.crop_structure_mix_components;

create trigger validate_crop_structure_mix_component_v1
before insert or update on public.crop_structure_mix_components
for each row execute function public.validate_crop_structure_mix_component_v1();

alter table public.crop_structure_mix_components enable row level security;

drop policy if exists crop_structure_mix_components_select on public.crop_structure_mix_components;

create policy crop_structure_mix_components_select
on public.crop_structure_mix_components for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'global_admin' and p.status = 'active'
  )
);

drop policy if exists crop_structure_mix_components_insert on public.crop_structure_mix_components;

create policy crop_structure_mix_components_insert
on public.crop_structure_mix_components for insert to authenticated
with check (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_update on public.crop_structure_mix_components;

create policy crop_structure_mix_components_update
on public.crop_structure_mix_components for update to authenticated
using (company_id = public.get_user_company_id())
with check (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_delete on public.crop_structure_mix_components;

create policy crop_structure_mix_components_delete
on public.crop_structure_mix_components for delete to authenticated
using (
  company_id = public.get_user_company_id()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

revoke all on table public.crop_structure_mix_components from public, anon, authenticated;

grant select, insert, update, delete on table public.crop_structure_mix_components to authenticated;

alter table public.operation_materials
  add column if not exists crop_id uuid references public.crops(id) on delete restrict,
  add column if not exists variety_id uuid references public.varieties(id) on delete restrict,
  add column if not exists reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  add column if not exists source_mix_component_id uuid references public.crop_structure_mix_components(id) on delete restrict;

alter table public.operation_materials alter column product_id drop not null;

alter table public.operation_materials
  drop constraint if exists operation_materials_product_or_seed_identity_check;

alter table public.operation_materials
  add constraint operation_materials_product_or_seed_identity_check
  check (
    product_id is not null
    or (
      material_type = 'seed'
      and crop_id is not null
      and variety_id is not null
      and reproduction_id is not null
      and source_mix_component_id is not null
    )
  );

create unique index if not exists uq_operation_materials_mix_component_v1
  on public.operation_materials(operation_id, source_mix_component_id)
  where source_mix_component_id is not null;

alter table public.warehouse_issue_request_items
  add column if not exists crop_id uuid references public.crops(id) on delete restrict,
  add column if not exists variety_id uuid references public.varieties(id) on delete restrict,
  add column if not exists reproduction_id uuid references public.seed_reproductions(id) on delete restrict,
  add column if not exists material_kind text,
  add column if not exists source_mix_component_id uuid references public.crop_structure_mix_components(id) on delete restrict;

alter table public.warehouse_issue_request_items alter column product_id drop not null;

alter table public.warehouse_issue_request_items
  drop constraint if exists warehouse_issue_request_items_product_or_seed_identity_check;

alter table public.warehouse_issue_request_items
  add constraint warehouse_issue_request_items_product_or_seed_identity_check
  check (
    product_id is not null
    or (
      material_kind = 'seed'
      and crop_id is not null
      and variety_id is not null
      and reproduction_id is not null
      and source_mix_component_id is not null
    )
  );

create unique index if not exists uq_warehouse_request_items_mix_component_v1
  on public.warehouse_issue_request_items(request_id, source_mix_component_id)
  where source_mix_component_id is not null;

create or replace function public.validate_crop_mix_request_item_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_component public.crop_structure_mix_components%rowtype;
begin
  if new.source_mix_component_id is null then
    return new;
  end if;

  select mc.* into v_component
  from public.crop_structure_mix_components mc
  where mc.id = new.source_mix_component_id
  for share;

  if not found
     or v_component.company_id is distinct from new.company_id
     or v_component.crop_id is distinct from new.crop_id
     or v_component.variety_id is distinct from new.variety_id
     or v_component.reproduction_id is distinct from new.reproduction_id then
    raise exception 'Warehouse request item must match its crop mix component identity'
      using errcode = '23514';
  end if;

  if new.product_id is not null and not exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and (p.company_id = new.company_id or p.company_id is null)
      and coalesce(p.archived, false) = false
      and coalesce(p.is_active, true) = true
      and (p.type = 'seed' or p.is_seed_material)
      and p.crop_id = new.crop_id
      and p.variety_id = new.variety_id
      and p.seed_reproduction_id = new.reproduction_id
  ) then
    raise exception 'Warehouse product must exactly match crop, variety and reproduction'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crop_mix_request_item_identity_v1() from public, anon, authenticated;

drop trigger if exists validate_crop_mix_request_item_identity_v1 on public.warehouse_issue_request_items;

create trigger validate_crop_mix_request_item_identity_v1
before insert or update of product_id, crop_id, variety_id, reproduction_id, source_mix_component_id
on public.warehouse_issue_request_items
for each row execute function public.validate_crop_mix_request_item_identity_v1();

alter table public.products
  add column if not exists is_derived_inventory boolean not null default false,
  add column if not exists derived_identity_key text;

create unique index if not exists uq_products_company_derived_identity_v1
  on public.products(company_id, derived_identity_key)
  where is_derived_inventory and company_id is not null and derived_identity_key is not null;

alter table public.inventory_batches
  add column if not exists composition_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists composition_hash text,
  add column if not exists display_name text,
  add column if not exists is_mixed_harvest boolean not null default false,
  add column if not exists planting_operation_id uuid references public.operations(id) on delete set null;

alter table public.ticket_lines
  add column if not exists composition_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists composition_hash text,
  add column if not exists is_mixed_harvest boolean not null default false;

create or replace function public.save_crop_structure_field_v5(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_actor_auth_user_id uuid,
  p_field_id uuid,
  p_season_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_field public.fields%rowtype;
  v_row jsonb;
  v_component jsonb;
  v_existing public.crop_structure%rowtype;
  v_row_id uuid;
  v_land_use_type text;
  v_area numeric;
  v_total_area numeric;
  v_component_count integer;
  v_current_component_count integer;
  v_structure_changed boolean;
  v_components_changed boolean;
  v_result jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows must be an array with at most 100 items' using errcode = '22023';
  end if;

  select f.* into v_field
  from public.fields f
  where f.id = p_field_id and f.company_id = p_company_id and coalesce(f.archived, false) = false
  for update;
  if not found then
    raise exception 'Field is not available' using errcode = '23503';
  end if;

  perform 1 from public.seasons s
  where s.id = p_season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
  for share;
  if not found then
    raise exception 'Closed season is read-only' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) a
    where nullif(a ->> 'id', '') is not null
    group by a ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate crop structure row id is not allowed' using errcode = '23505';
  end if;

  select coalesce(sum((r ->> 'area')::numeric), 0) into v_total_area
  from jsonb_array_elements(p_rows) r;
  if v_total_area > v_field.area + 0.0001 then
    raise exception 'Total crop structure area exceeds field area' using errcode = '23514';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_land_use_type := lower(coalesce(nullif(v_row ->> 'land_use_type', ''), 'crop'));
    v_area := nullif(v_row ->> 'area', '')::numeric;
    if v_land_use_type not in ('crop', 'crop_mix', 'fallow') then
      raise exception 'Unsupported land_use_type' using errcode = '22023';
    end if;
    if v_area is null or v_area <= 0 then
      raise exception 'Crop structure area must be positive' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop' then
      if nullif(v_row ->> 'crop_id', '') is null
         or nullif(v_row ->> 'variety_id', '') is null
         or nullif(v_row ->> 'reproduction_id', '') is null then
        raise exception 'Crop row requires crop, variety and reproduction' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.varieties v
        where v.id = (v_row ->> 'variety_id')::uuid
          and v.crop_id = (v_row ->> 'crop_id')::uuid
          and coalesce(v.archived, false) = false
          and coalesce(v.is_active, true) = true
          and (v.company_id is null or v.company_id = p_company_id)
      ) then
        raise exception 'Selected variety does not belong to the crop' using errcode = '23514';
      end if;
    elsif nullif(v_row ->> 'crop_id', '') is not null
       or nullif(v_row ->> 'variety_id', '') is not null
       or nullif(v_row ->> 'reproduction_id', '') is not null then
      raise exception 'Crop mix and fallow roots cannot contain crop identity' using errcode = '23514';
    end if;

    v_component_count := jsonb_array_length(coalesce(v_row -> 'mix_components', '[]'::jsonb));
    if v_land_use_type = 'crop_mix' and (v_component_count < 2 or v_component_count > 10) then
      raise exception 'Crop mix requires between 2 and 10 components' using errcode = '23514';
    end if;
    if v_land_use_type <> 'crop_mix' and v_component_count <> 0 then
      raise exception 'Only crop_mix rows may contain mix components' using errcode = '23514';
    end if;

    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      where nullif(c ->> 'crop_id', '') is null
         or nullif(c ->> 'variety_id', '') is null
         or nullif(c ->> 'reproduction_id', '') is null
         or coalesce(nullif(c ->> 'seed_rate_kg_ha', '')::numeric, 0) <= 0
    ) then
      raise exception 'Every crop mix component requires crop, variety, reproduction and positive rate'
        using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      left join public.varieties v on v.id = (c ->> 'variety_id')::uuid
      where v.id is null
         or v.crop_id <> (c ->> 'crop_id')::uuid
         or coalesce(v.archived, false)
         or not coalesce(v.is_active, true)
         or (v.company_id is not null and v.company_id <> p_company_id)
    ) then
      raise exception 'Crop mix variety does not belong to its crop' using errcode = '23514';
    end if;
    if v_land_use_type = 'crop_mix' and exists (
      select 1
      from jsonb_array_elements(v_row -> 'mix_components') c
      group by c ->> 'crop_id', c ->> 'variety_id', c ->> 'reproduction_id'
      having count(*) > 1
    ) then
      raise exception 'Exact duplicate crop mix component is not allowed' using errcode = '23505';
    end if;

    v_row_id := coalesce(nullif(v_row ->> 'id', '')::uuid, gen_random_uuid());
    select cs.* into v_existing
    from public.crop_structure cs
    where cs.id = v_row_id
    for update;

    if found and (
      v_existing.company_id is distinct from p_company_id
      or v_existing.field_id <> p_field_id
      or v_existing.season_id <> p_season_id
    ) then
      raise exception 'Crop structure row belongs to another scope' using errcode = '42501';
    end if;

    v_structure_changed := found and (
      v_existing.land_use_type is distinct from v_land_use_type
      or v_existing.crop_id is distinct from nullif(v_row ->> 'crop_id', '')::uuid
      or v_existing.variety_id is distinct from nullif(v_row ->> 'variety_id', '')::uuid
      or v_existing.reproduction_id is distinct from nullif(v_row ->> 'reproduction_id', '')::uuid
      or v_existing.area is distinct from v_area
    );
    select count(*) into v_current_component_count
    from public.crop_structure_mix_components mc
    where mc.crop_structure_id = v_row_id;
    v_components_changed := v_current_component_count <> v_component_count;
    if not v_components_changed and v_land_use_type = 'crop_mix' then
      v_components_changed := exists (
        select 1
        from jsonb_array_elements(v_row -> 'mix_components') with ordinality c(value, ordinality)
        where not exists (
          select 1 from public.crop_structure_mix_components mc
          where mc.crop_structure_id = v_row_id
            and mc.crop_id = (c.value ->> 'crop_id')::uuid
            and mc.variety_id = (c.value ->> 'variety_id')::uuid
            and mc.reproduction_id = (c.value ->> 'reproduction_id')::uuid
            and mc.seed_rate_kg_ha = (c.value ->> 'seed_rate_kg_ha')::numeric
            and mc.sort_order = c.ordinality
        )
      );
    end if;

    if found and (v_structure_changed or v_components_changed) and exists (
      select 1 from public.operations o
      where o.company_id = p_company_id and o.crop_structure_id = v_row_id and coalesce(o.archived, false) = false
    ) then
      raise exception 'Crop mix composition is locked after operation creation' using errcode = '23514';
    end if;

    insert into public.crop_structure (
      id, company_id, user_id, field_id, season_id, land_use_type,
      crop_id, variety_id, reproduction_id, notes, area, status, archived,
      irrigation_type, row_spacing_m, seed_spacing_cm, updated_at
    ) values (
      v_row_id, p_company_id, p_actor_auth_user_id, p_field_id, p_season_id, v_land_use_type,
      nullif(v_row ->> 'crop_id', '')::uuid,
      nullif(v_row ->> 'variety_id', '')::uuid,
      nullif(v_row ->> 'reproduction_id', '')::uuid,
      nullif(v_row ->> 'notes', ''), v_area, 'planned', false,
      coalesce(nullif(v_row ->> 'irrigation_type', ''), 'unknown'),
      nullif(v_row ->> 'row_spacing_m', '')::numeric,
      nullif(v_row ->> 'seed_spacing_cm', '')::numeric,
      now()
    )
    on conflict (id) do update set
      land_use_type = excluded.land_use_type,
      crop_id = excluded.crop_id,
      variety_id = excluded.variety_id,
      reproduction_id = excluded.reproduction_id,
      notes = excluded.notes,
      area = excluded.area,
      irrigation_type = excluded.irrigation_type,
      row_spacing_m = excluded.row_spacing_m,
      seed_spacing_cm = excluded.seed_spacing_cm,
      updated_at = now();

    if v_components_changed then
      delete from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_row_id and mc.company_id = p_company_id;
      if v_land_use_type = 'crop_mix' then
        for v_component in
          select value || jsonb_build_object('sort_order', ordinality)
          from jsonb_array_elements(v_row -> 'mix_components') with ordinality
        loop
          insert into public.crop_structure_mix_components (
            company_id, crop_structure_id, crop_id, variety_id, reproduction_id,
            seed_rate_kg_ha, sort_order
          ) values (
            p_company_id, v_row_id,
            (v_component ->> 'crop_id')::uuid,
            (v_component ->> 'variety_id')::uuid,
            (v_component ->> 'reproduction_id')::uuid,
            (v_component ->> 'seed_rate_kg_ha')::numeric,
            (v_component ->> 'sort_order')::smallint
          );
        end loop;
      end if;
    end if;
  end loop;

  if exists (
    select 1 from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
      and not exists (
        select 1 from jsonb_array_elements(p_rows) r
        where nullif(r ->> 'id', '')::uuid = cs.id
      )
      and (
        exists (select 1 from public.operations o where o.crop_structure_id = cs.id and coalesce(o.archived, false) = false)
        or exists (select 1 from public.field_material_consumptions fmc where fmc.crop_structure_row_id = cs.id)
      )
  ) then
    raise exception 'Crop structure row with operations or materials cannot be deleted' using errcode = '23514';
  end if;

  delete from public.crop_structure cs
  where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
    and coalesce(cs.archived, false) = false
    and not exists (
      select 1 from jsonb_array_elements(p_rows) r
      where nullif(r ->> 'id', '')::uuid = cs.id
    );

  select coalesce(jsonb_agg(row_payload order by row_payload ->> 'id'), '[]'::jsonb)
    into v_result
  from (
    select to_jsonb(cs) || jsonb_build_object(
      'mix_components', coalesce((
        select jsonb_agg(to_jsonb(mc) order by mc.sort_order)
        from public.crop_structure_mix_components mc
        where mc.crop_structure_id = cs.id
      ), '[]'::jsonb)
    ) as row_payload
    from public.crop_structure cs
    where cs.company_id = p_company_id and cs.field_id = p_field_id and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
  ) rows;

  return jsonb_build_object('companyId', p_company_id, 'fieldId', p_field_id, 'seasonId', p_season_id, 'rows', v_result);
end;
$$;

revoke all on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;

grant execute on function public.save_crop_structure_field_v5(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.create_crop_mix_operation_plan_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation jsonb,
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
  v_structure public.crop_structure%rowtype;
  v_operation public.operations%rowtype;
  v_line public.operation_lines%rowtype;
  v_request public.warehouse_issue_requests%rowtype;
  v_component public.crop_structure_mix_components%rowtype;
  v_product_id uuid;
  v_material_rows jsonb;
  v_request_rows jsonb;
  v_response jsonb;
  v_component_count integer;
  v_config jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  if nullif(p_idempotency_key, '') is null or nullif(p_request_fingerprint, '') is null then
    raise exception 'Idempotency key and fingerprint are required' using errcode = '23514';
  end if;

  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'create', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_existing from public.operations
  where company_id = p_company_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if coalesce(v_existing.request_fingerprint, '') <> p_request_fingerprint then
      raise exception 'Idempotency-Key was already used with a different payload' using errcode = '23505';
    end if;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
      into v_material_rows from public.operation_materials m where m.operation_id = v_existing.id;
    select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
      into v_request_rows
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = v_existing.id;
    return jsonb_build_object(
      'operation', to_jsonb(v_existing), 'operation_materials', v_material_rows,
      'request_items', v_request_rows, 'idempotent_replay', true
    );
  end if;

  select cs.* into v_structure
  from public.crop_structure cs
  where cs.id = nullif(p_operation ->> 'crop_structure_id', '')::uuid
    and cs.company_id = p_company_id
    and cs.field_id = nullif(p_operation ->> 'field_id', '')::uuid
    and cs.land_use_type = 'crop_mix'
    and coalesce(cs.archived, false) = false
  for share;
  if not found then
    raise exception 'Active crop_mix structure row was not found' using errcode = '23503';
  end if;
  perform 1 from public.seasons s
  where s.id = v_structure.season_id and s.company_id = p_company_id and coalesce(s.archived, false) = false
  for share;
  if not found then raise exception 'Operation season is closed' using errcode = '23514'; end if;

  select count(*) into v_component_count
  from public.crop_structure_mix_components mc
  where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id;
  if v_component_count < 2 or v_component_count > 10 then
    raise exception 'Crop mix requires between 2 and 10 components' using errcode = '23514';
  end if;
  if coalesce(nullif(p_operation ->> 'planned_area_ha', '')::numeric, v_structure.area) > v_structure.area + 0.0001 then
    raise exception 'Planned area exceeds crop mix area' using errcode = '23514';
  end if;
  if nullif(p_operation ->> 'responsible_user_id', '') is null then
    raise exception 'Responsible specialist is required' using errcode = '23514';
  end if;

  v_config := coalesce(p_operation -> 'operation_config', '{}'::jsonb) || jsonb_build_object(
    'crop_mix', true,
    'land_use_type', 'crop_mix',
    'composition_snapshot', (
      select jsonb_agg(jsonb_build_object(
        'component_id', mc.id,
        'crop_id', mc.crop_id,
        'variety_id', mc.variety_id,
        'reproduction_id', mc.reproduction_id,
        'seed_rate_kg_ha', mc.seed_rate_kg_ha,
        'planned_quantity_kg', v_structure.area * mc.seed_rate_kg_ha,
        'sort_order', mc.sort_order
      ) order by mc.sort_order)
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_structure.id
    )
  );

  insert into public.operations (
    company_id, field_id, crop_structure_id, operation_type, date, notes,
    user_id, status, work_status, responsible_user_id,
    operation_category_slug, operation_type_slug, machine_id, equipment_id, transport_id,
    operation_target, operation_config, idempotency_key, request_fingerprint,
    operation_status, specialist_task_status, planned_area_ha, completed_area_ha,
    remaining_area_ha, progress_percent
  ) values (
    p_company_id, v_structure.field_id, v_structure.id,
    'Посев зерносмеси',
    (p_operation ->> 'date')::date,
    nullif(p_operation ->> 'notes', ''), auth.uid(), 'planned', 'active',
    (p_operation ->> 'responsible_user_id')::uuid,
    coalesce(nullif(p_operation ->> 'operation_category_slug', ''), 'planting'),
    coalesce(nullif(p_operation ->> 'operation_type_slug', ''), 'planting'),
    nullif(p_operation ->> 'machine_id', '')::uuid,
    nullif(p_operation ->> 'equipment_id', '')::uuid,
    nullif(p_operation ->> 'transport_id', '')::uuid,
    nullif(p_operation ->> 'operation_target', ''), v_config,
    p_idempotency_key, p_request_fingerprint,
    'planned', 'waiting_materials', v_structure.area, 0, v_structure.area, 0
  ) returning * into v_operation;

  insert into public.operation_lines (
    company_id, operation_id, field_id, crop_id, variety_id, reproduction_id,
    planned_area_ha, actual_area_ha, notes, created_by_user_id, updated_by_user_id
  ) values (
    p_company_id, v_operation.id, v_structure.field_id, null, null, null,
    v_structure.area, null, 'Crop mix root: area counted once', auth.uid(), auth.uid()
  ) returning * into v_line;

  insert into public.warehouse_issue_requests (
    company_id, operation_id, field_id, operation_line_id,
    recipient_user_id, assigned_specialist_id, planned_datetime,
    comment, status, warehouse_request_status
  ) values (
    p_company_id, v_operation.id, v_structure.field_id, v_line.id,
    v_operation.responsible_user_id, v_operation.responsible_user_id,
    v_operation.date::timestamp + time '08:00',
    'Посев зерносмеси: одна заявка, отдельная строка на компонент',
    'new', 'pending'
  ) returning * into v_request;

  for v_component in
    select * from public.crop_structure_mix_components mc
    where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id
    order by mc.sort_order
  loop
    v_product_id := null;
    select p.id into v_product_id
    from public.products p
    where (p.company_id = p_company_id or p.company_id is null)
      and coalesce(p.archived, false) = false and coalesce(p.is_active, true) = true
      and (p.type = 'seed' or p.is_seed_material)
      and p.crop_id = v_component.crop_id
      and p.variety_id = v_component.variety_id
      and p.seed_reproduction_id = v_component.reproduction_id
    order by (p.company_id = p_company_id) desc, p.created_at, p.id
    limit 1;

    insert into public.operation_materials (
      company_id, operation_id, operation_line_id, product_id,
      material_type, unit, planned_rate, planned_quantity, issued_quantity,
      notes, created_by_user_id, updated_by_user_id,
      crop_id, variety_id, reproduction_id, source_mix_component_id
    ) values (
      p_company_id, v_operation.id, v_line.id, v_product_id,
      'seed', 'kg', v_component.seed_rate_kg_ha,
      v_structure.area * v_component.seed_rate_kg_ha, 0,
      case when v_product_id is null then 'seed_stock_deficit:product_not_received' else 'crop_mix_component' end,
      auth.uid(), auth.uid(),
      v_component.crop_id, v_component.variety_id, v_component.reproduction_id, v_component.id
    );

    insert into public.warehouse_issue_request_items (
      request_id, company_id, product_id, product_category,
      required_quantity, planned_quantity, issued_quantity, unit, planned_rate_per_ha,
      prepared_quantity, expected_consumed_quantity, expected_return_quantity,
      return_received_quantity, loss_quantity, shortage_quantity,
      reconciliation_status, substitution_status, planned_product_id, actual_product_id,
      prepared_unit, issued_unit, received_unit, package_unit,
      crop_id, variety_id, reproduction_id, material_kind, source_mix_component_id
    ) values (
      v_request.id, p_company_id, v_product_id, 'seed',
      v_structure.area * v_component.seed_rate_kg_ha,
      v_structure.area * v_component.seed_rate_kg_ha, 0, 'kg', v_component.seed_rate_kg_ha,
      0, 0, 0, 0, 0, v_structure.area * v_component.seed_rate_kg_ha,
      case when v_product_id is null then 'blocked' else 'pending' end,
      'none', v_product_id, v_product_id,
      'kg', 'kg', 'kg', 'kg',
      v_component.crop_id, v_component.variety_id, v_component.reproduction_id,
      'seed', v_component.id
    );
  end loop;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    p_company_id, p_actor_profile_id, 'operation', v_operation.id::text,
    'crop_mix_created_atomic',
    jsonb_build_object('component_count', v_component_count, 'request_id', v_request.id, 'area_ha', v_structure.area)
  );

  select coalesce(jsonb_agg(to_jsonb(m) order by mc.sort_order), '[]'::jsonb)
    into v_material_rows
  from public.operation_materials m
  join public.crop_structure_mix_components mc on mc.id = m.source_mix_component_id
  where m.operation_id = v_operation.id;
  select coalesce(jsonb_agg(to_jsonb(i) order by mc.sort_order), '[]'::jsonb)
    into v_request_rows
  from public.warehouse_issue_request_items i
  join public.crop_structure_mix_components mc on mc.id = i.source_mix_component_id
  where i.request_id = v_request.id;

  v_response := jsonb_build_object(
    'operation', to_jsonb(v_operation),
    'operation_line', to_jsonb(v_line),
    'operation_materials', v_material_rows,
    'material_request', jsonb_build_object(
      'created', true, 'request_id', v_request.id, 'request_number', v_request.request_number,
      'request_status', v_request.status, 'item_count', v_component_count
    ),
    'request_items', v_request_rows
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'create', v_operation.id, p_idempotency_key, p_request_fingerprint,
    p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.create_crop_mix_operation_plan_atomic_v1(uuid, uuid, jsonb, text, text) from public, anon;

grant execute on function public.create_crop_mix_operation_plan_atomic_v1(uuid, uuid, jsonb, text, text) to authenticated;

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
  v_is_crop_mix boolean := false;
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

  select * into v_operation from public.operations
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

  select exists (
    select 1 from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id and cs.land_use_type = 'crop_mix'
  ) into v_is_crop_mix;

  if p_transition = 'accept' then
    update public.operations
    set status = 'accepted', operation_status = 'accepted', specialist_task_status = 'accepted',
        accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
    update public.warehouse_issue_requests
    set status = case when status = 'new' then 'active' else status end,
        warehouse_request_status = coalesce(warehouse_request_status, 'pending'), updated_at = now()
    where operation_id = p_operation_id and company_id = p_company_id
      and status not in ('cancelled', 'issued', 'issued_by_warehouse');
  else
    if v_is_crop_mix
       and coalesce(v_operation.operation_category_slug, '') = 'planting'
       and exists (
      select 1
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_operation.crop_structure_id
        and mc.company_id = p_company_id
        and not exists (
          select 1
          from public.warehouse_issue_requests r
          join public.warehouse_issue_request_items i
            on i.request_id = r.id and i.company_id = r.company_id
          where r.operation_id = p_operation_id
            and r.company_id = p_company_id
            and i.source_mix_component_id = mc.id
            and i.product_id is not null
            and coalesce(i.issued_quantity, 0) + 0.0001 >= i.required_quantity
            and coalesce(i.reconciliation_status, '') <> 'blocked'
        )
    ) then
      raise exception 'Все компоненты зерносмеси должны быть полностью выданы до начала посева'
        using errcode = '23514';
    end if;
    if not v_is_crop_mix and exists (
      select 1 from public.warehouse_issue_requests r
      where r.operation_id = p_operation_id and r.company_id = p_company_id
        and coalesce(r.status, '') not in ('issued', 'issued_by_warehouse', 'partially_issued')
    ) then
      raise exception 'Materials must be issued before operation start' using errcode = '23514';
    end if;
    update public.operations
    set status = 'in_progress', work_status = 'in_progress', operation_status = 'in_progress',
        specialist_task_status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
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

create or replace function public.ensure_crop_mix_inventory_product_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_crop_structure_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_structure public.crop_structure%rowtype;
  v_component_count integer;
  v_identity_key text;
  v_display_name text;
  v_snapshot jsonb;
  v_product public.products%rowtype;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'weighbridge_operator', 'weighman']::text[]
  );

  select p.* into v_actor from public.profiles p
  where p.id = p_actor_profile_id
    and p.status = 'active';
  if not found or (
    v_actor.role <> 'global_admin'
    and (v_actor.company_id is distinct from p_company_id
      or v_actor.role not in ('company_admin', 'agronomist', 'weighbridge_operator', 'weighman'))
  ) then
    raise exception 'Actor cannot create crop mix inventory identity' using errcode = '42501';
  end if;

  select cs.* into v_structure from public.crop_structure cs
  where cs.id = p_crop_structure_id and cs.company_id = p_company_id
    and cs.land_use_type = 'crop_mix' and coalesce(cs.archived, false) = false
  for share;
  if not found then raise exception 'Crop mix structure was not found' using errcode = '23503'; end if;

  select count(*),
         md5(string_agg(mc.crop_id::text || ':' || mc.variety_id::text || ':' || mc.reproduction_id::text || ':' || mc.seed_rate_kg_ha::text, '|' order by mc.sort_order)),
         'Зерносмесь: ' || string_agg(coalesce(c.name_ru, c.name), ' + ' order by mc.sort_order),
         jsonb_agg(jsonb_build_object(
           'component_id', mc.id, 'crop_id', mc.crop_id, 'crop_name', coalesce(c.name_ru, c.name),
           'variety_id', mc.variety_id, 'variety_name', coalesce(v.name_ru, v.name),
           'reproduction_id', mc.reproduction_id,
           'reproduction_name', coalesce(sr.name_ru, sr.name, sr.code),
           'seed_rate_kg_ha', mc.seed_rate_kg_ha, 'sort_order', mc.sort_order
         ) order by mc.sort_order)
    into v_component_count, v_identity_key, v_display_name, v_snapshot
  from public.crop_structure_mix_components mc
  join public.crops c on c.id = mc.crop_id
  join public.varieties v on v.id = mc.variety_id
  join public.seed_reproductions sr on sr.id = mc.reproduction_id
  where mc.crop_structure_id = v_structure.id and mc.company_id = p_company_id;
  if v_component_count < 2 then raise exception 'Crop mix composition is incomplete' using errcode = '23514'; end if;

  insert into public.products (
    name, name_ru, type, user_id, company_id, unit, base_uom,
    accounting_mode, is_seed_material, is_active, archived,
    is_derived_inventory, derived_identity_key, description
  ) values (
    v_display_name, v_display_name, 'produce', p_actor_profile_id, p_company_id,
    'kg', 'kg', 'bulk_mass', false, true, false,
    true, v_identity_key, 'Складская идентичность смешанного урожая; состав хранится в партии.'
  )
  on conflict (company_id, derived_identity_key)
    where is_derived_inventory and company_id is not null and derived_identity_key is not null
  do update set name = excluded.name, name_ru = excluded.name_ru, is_active = true, archived = false, updated_at = now()
  returning * into v_product;

  return jsonb_build_object(
    'product_id', v_product.id, 'display_name', v_display_name,
    'composition_hash', v_identity_key, 'composition_snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.ensure_crop_mix_inventory_product_v1(uuid, uuid, uuid) from public, anon;

grant execute on function public.ensure_crop_mix_inventory_product_v1(uuid, uuid, uuid) to authenticated;

create or replace function public.populate_crop_mix_harvest_snapshot_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_snapshot jsonb;
  v_hash text;
  v_name text;
  v_planting_operation_id uuid;
begin
  if new.origin_type <> 'harvest' or new.source_ticket_id is null then return new; end if;
  select cs.* into v_structure
  from public.tickets t
  join public.crop_structure cs on cs.id = t.crop_structure_allocation_id and cs.company_id = t.company_id
  where t.id = new.source_ticket_id and t.company_id = new.company_id;
  if not found or v_structure.land_use_type <> 'crop_mix' then return new; end if;

  select jsonb_agg(jsonb_build_object(
           'component_id', mc.id, 'crop_id', mc.crop_id, 'crop_name', coalesce(c.name_ru, c.name),
           'variety_id', mc.variety_id, 'variety_name', coalesce(v.name_ru, v.name),
           'reproduction_id', mc.reproduction_id,
           'reproduction_name', coalesce(sr.name_ru, sr.name, sr.code),
           'seed_rate_kg_ha', mc.seed_rate_kg_ha, 'sort_order', mc.sort_order
         ) order by mc.sort_order),
         md5(string_agg(mc.crop_id::text || ':' || mc.variety_id::text || ':' || mc.reproduction_id::text || ':' || mc.seed_rate_kg_ha::text, '|' order by mc.sort_order)),
         'Зерносмесь: ' || string_agg(coalesce(c.name_ru, c.name), ' + ' order by mc.sort_order)
    into v_snapshot, v_hash, v_name
  from public.crop_structure_mix_components mc
  join public.crops c on c.id = mc.crop_id
  join public.varieties v on v.id = mc.variety_id
  join public.seed_reproductions sr on sr.id = mc.reproduction_id
  where mc.crop_structure_id = v_structure.id;

  select o.id into v_planting_operation_id
  from public.operations o
  where o.company_id = new.company_id and o.crop_structure_id = v_structure.id
    and (o.operation_category_slug = 'planting' or o.operation_type_slug = 'planting')
    and coalesce(o.archived, false) = false
  order by o.created_at desc, o.id desc limit 1;

  new.crop_id := null;
  new.variety_id := null;
  new.reproduction_id := null;
  new.composition_snapshot := coalesce(v_snapshot, '[]'::jsonb);
  new.composition_hash := v_hash;
  new.display_name := v_name;
  new.is_mixed_harvest := true;
  new.planting_operation_id := v_planting_operation_id;
  return new;
end;
$$;

revoke all on function public.populate_crop_mix_harvest_snapshot_v1() from public, anon, authenticated;

drop trigger if exists populate_crop_mix_harvest_snapshot_v1 on public.inventory_batches;

create trigger populate_crop_mix_harvest_snapshot_v1
before insert or update of source_ticket_id, origin_type
on public.inventory_batches for each row
execute function public.populate_crop_mix_harvest_snapshot_v1();

create or replace function public.record_finalized_harvest_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_history_name text;
  v_season_year integer;
begin
  if new.op_type <> 'harvest_incoming'
     or not new.is_finalized
     or new.status::text <> 'finalized'
     or (old.is_finalized and old.status::text = 'finalized') then return new; end if;

  select cs.* into v_structure from public.crop_structure cs
  where cs.id = new.crop_structure_allocation_id and cs.company_id = new.company_id
    and cs.field_id = new.field_id and cs.season_id = new.season_id
    and coalesce(cs.archived, false) = false;
  if not found then raise exception 'Finalized harvest ticket requires crop structure identity'; end if;
  if v_structure.land_use_type = 'crop' and (
    v_structure.crop_id is null or v_structure.variety_id is null or v_structure.reproduction_id is null
  ) then raise exception 'Finalized harvest ticket requires complete crop structure identity'; end if;
  if v_structure.land_use_type not in ('crop', 'crop_mix') then
    raise exception 'Harvest is not allowed for this land use type';
  end if;

  select ib.* into v_batch from public.inventory_batches ib
  where ib.company_id = new.company_id and ib.source_ticket_id = new.id and ib.origin_type = 'harvest'
  order by ib.created_at, ib.id limit 1;
  if not found then raise exception 'Finalized harvest ticket requires a harvest batch'; end if;
  if v_structure.land_use_type = 'crop_mix' and (
    not v_batch.is_mixed_harvest or jsonb_array_length(v_batch.composition_snapshot) < 2
  ) then raise exception 'Mixed harvest batch requires composition snapshot'; end if;
  if not exists (
    select 1 from public.stock_ledger_entries sle
    where sle.company_id = new.company_id and sle.ticket_id = new.id
      and sle.direction::text = 'in' and sle.batch_id = v_batch.id::text
      and coalesce(sle.is_storno, false) = false
  ) then raise exception 'Finalized harvest ticket requires one linked ledger IN posting'; end if;

  if v_structure.land_use_type = 'crop_mix' then
    v_history_name := coalesce(v_batch.display_name, 'Зерносмесь');
  else
    select coalesce(c.name_ru, c.name) into v_history_name from public.crops c where c.id = v_structure.crop_id;
  end if;
  select s.year into v_season_year from public.seasons s
  where s.id = new.season_id and s.company_id = new.company_id;

  insert into public.field_history_entries (
    company_id, field_id, season_id, season_year, crop_id,
    history_value, token, original_raw_value, source, notes,
    operation_id, crop_structure_id, harvest_ticket_id, harvest_batch_id, material_facts
  ) values (
    new.company_id, new.field_id, new.season_id, v_season_year, v_structure.crop_id,
    coalesce(v_history_name, 'Урожай'), 'weighbridge:' || new.id::text,
    coalesce(new.notes, ''), 'weighbridge_harvest',
    'Урожай принят по талону ' || new.ticket_no,
    new.linked_operation_id, v_structure.id, new.id, v_batch.id,
    case when v_batch.is_mixed_harvest then v_batch.composition_snapshot else '[]'::jsonb end
  ) on conflict (harvest_ticket_id)
    where source = 'weighbridge_harvest' and harvest_ticket_id is not null
  do nothing;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    new.company_id, new.closed_by, 'weighbridge_ticket', new.id, 'harvest_finalized',
    jsonb_build_object(
      'ticket_id', new.id, 'batch_id', v_batch.id, 'crop_structure_id', v_structure.id,
      'operation_id', new.linked_operation_id, 'warehouse_id', new.warehouse_to_id,
      'net_weight_kg', new.net_weight_kg, 'is_mixed_harvest', v_batch.is_mixed_harvest,
      'composition_hash', v_batch.composition_hash
    )
  );
  return new;
end;
$$;

revoke all on function public.record_finalized_harvest_trace_v1() from public, anon, authenticated;

comment on table public.crop_structure_mix_components is
  'TZ-242 ordered components of one crop_mix allocation; area remains on crop_structure.';

comment on column public.warehouse_issue_request_items.product_id is
  'Physical product when resolved; crop_mix seed planning may remain identity-only until matching stock exists.';

comment on column public.inventory_batches.composition_snapshot is
  'Immutable agronomic identity snapshot for mixed harvest batches.';

-- END SOURCE: 20260801143322_grain_mix_v1.sql



-- BEGIN SOURCE: 20260801143550_grain_mix_privilege_hardening_v1.sql

-- TZ-242: keep the new RLS table read/write only through row-level policies.
revoke all on table public.crop_structure_mix_components from public, anon, authenticated;

grant select, insert, update, delete on table public.crop_structure_mix_components to authenticated;

-- END SOURCE: 20260801143550_grain_mix_privilege_hardening_v1.sql



-- BEGIN SOURCE: 20260801194459_crop_mix_seed_product_reconciliation_v1.sql

create or replace function public.reconcile_crop_mix_seed_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null
     or not (new.type = 'seed' or coalesce(new.is_seed_material, false))
     or new.crop_id is null
     or new.variety_id is null
     or new.seed_reproduction_id is null
     or coalesce(new.archived, false)
     or not coalesce(new.is_active, true) then
    return new;
  end if;

  update public.operation_materials material
  set product_id = new.id,
      notes = case
        when material.notes = 'seed_stock_deficit:product_not_received' then 'crop_mix_component'
        else material.notes
      end,
      updated_at = now()
  where material.company_id = new.company_id
    and material.product_id is null
    and material.material_type = 'seed'
    and material.source_mix_component_id is not null
    and material.crop_id = new.crop_id
    and material.variety_id = new.variety_id
    and material.reproduction_id = new.seed_reproduction_id;

  update public.warehouse_issue_request_items item
  set product_id = new.id,
      planned_product_id = new.id,
      actual_product_id = new.id,
      reconciliation_status = case
        when coalesce(item.issued_quantity, 0) > 0 then item.reconciliation_status
        else 'pending'
      end
  where item.company_id = new.company_id
    and item.product_id is null
    and item.material_kind = 'seed'
    and item.source_mix_component_id is not null
    and item.crop_id = new.crop_id
    and item.variety_id = new.variety_id
    and item.reproduction_id = new.seed_reproduction_id;

  return new;
end;
$$;

revoke all on function public.reconcile_crop_mix_seed_product_v1()
  from public, anon, authenticated;

drop trigger if exists reconcile_crop_mix_seed_product_v1 on public.products;

create trigger reconcile_crop_mix_seed_product_v1
after insert or update of company_id, type, is_seed_material, crop_id, variety_id,
  seed_reproduction_id, archived, is_active
on public.products
for each row
execute function public.reconcile_crop_mix_seed_product_v1();

notify pgrst, 'reload schema';

-- END SOURCE: 20260801194459_crop_mix_seed_product_reconciliation_v1.sql



-- BEGIN SOURCE: 20260801200610_crop_structure_area_trigger_search_path_fix_v1.sql

create or replace function public.validate_crop_structure_area()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field_area decimal(10, 2);
begin
  select field_row.area
  into field_area
  from public.fields field_row
  where field_row.id = new.field_id;

  if new.area > field_area then
    raise exception 'Crop area (% ha) cannot exceed field area (% ha)', new.area, field_area;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crop_structure_area()
  from public, anon, authenticated;

-- END SOURCE: 20260801200610_crop_structure_area_trigger_search_path_fix_v1.sql



-- BEGIN SOURCE: 20260801201000_crop_mix_seed_product_reconciliation_schema_fix_v1.sql

create or replace function public.reconcile_crop_mix_seed_product_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null
     or not (new.type = 'seed' or coalesce(new.is_seed_material, false))
     or new.crop_id is null
     or new.variety_id is null
     or new.seed_reproduction_id is null
     or coalesce(new.archived, false)
     or not coalesce(new.is_active, true) then
    return new;
  end if;

  update public.operation_materials material
  set product_id = new.id,
      notes = case
        when material.notes = 'seed_stock_deficit:product_not_received' then 'crop_mix_component'
        else material.notes
      end,
      updated_at = now()
  where material.company_id = new.company_id
    and material.product_id is null
    and material.material_type = 'seed'
    and material.source_mix_component_id is not null
    and material.crop_id = new.crop_id
    and material.variety_id = new.variety_id
    and material.reproduction_id = new.seed_reproduction_id;

  update public.warehouse_issue_request_items item
  set product_id = new.id,
      planned_product_id = new.id,
      actual_product_id = new.id,
      reconciliation_status = case
        when coalesce(item.issued_quantity, 0) > 0 then item.reconciliation_status
        else 'pending'
      end
  where item.company_id = new.company_id
    and item.product_id is null
    and item.material_kind = 'seed'
    and item.source_mix_component_id is not null
    and item.crop_id = new.crop_id
    and item.variety_id = new.variety_id
    and item.reproduction_id = new.seed_reproduction_id;

  return new;
end;
$$;

revoke all on function public.reconcile_crop_mix_seed_product_v1()
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- END SOURCE: 20260801201000_crop_mix_seed_product_reconciliation_schema_fix_v1.sql



-- BEGIN SOURCE: 20260801202000_crop_mix_completion_reconciliation_v1.sql

-- Grain mix planting uses the warehouse issue workflow for every seed component.
-- Keep the legacy weighbridge issue contract unchanged for ordinary seed operations.

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
  v_seed_item_count integer;
  v_seed_issued numeric;
  v_seed_consumed numeric;
  v_seed_returned numeric;
  v_seed_return_received numeric;
  v_seed_loss numeric;
  v_seed_reconciled boolean;
  v_is_crop_mix boolean;
  v_material_rows jsonb := '[]'::jsonb;
begin
  select o.* into v_operation
  from public.operations o
  where o.id = p_operation_id
    and o.company_id = p_company_id
  for update of o;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id
      and cs.land_use_type = 'crop_mix'
      and coalesce(cs.archived, false) = false
  ) into v_is_crop_mix;

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
        'fertilizer', 'pesticide', 'adjuvant', 'ph_corrector', 'defoamer',
        'biological', 'organic', 'other'
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
      if v_is_crop_mix then
        select count(*)::integer,
               coalesce(sum(coalesce(i.issued_quantity, 0)), 0),
               coalesce(sum(coalesce(i.consumed_quantity, 0)), 0),
               coalesce(sum(coalesce(i.returned_quantity, 0)), 0),
               coalesce(sum(coalesce(i.return_received_quantity, 0)), 0),
               coalesce(sum(coalesce(i.loss_quantity, 0)), 0),
               coalesce(bool_and(coalesce(i.reconciliation_status, 'pending') = 'reconciled'), false)
          into v_seed_item_count, v_seed_issued, v_seed_consumed,
               v_seed_returned, v_seed_return_received, v_seed_loss, v_seed_reconciled
        from public.warehouse_issue_request_items i
        join public.warehouse_issue_requests r
          on r.id = i.request_id and r.company_id = i.company_id
        where r.operation_id = p_operation_id
          and r.company_id = p_company_id
          and i.company_id = p_company_id
          and i.product_id = v_material.product_id
          and i.source_mix_component_id is not null
          and coalesce(r.warehouse_request_status, '') <> 'cancelled';

        if v_seed_item_count <> 1 then
          raise exception 'Every grain mix component requires exactly one warehouse request item'
            using errcode = '23514';
        end if;
        if v_seed_issued <= 0.000001
           or abs(v_seed_issued - v_seed_consumed - v_seed_returned - v_seed_loss) > 0.0001
           or v_seed_return_received + 0.000001 < v_seed_returned
           or not v_seed_reconciled then
          raise exception 'Every grain mix seed component must be reconciled before operation close'
            using errcode = '23514';
        end if;

        v_actual_rate := case
          when coalesce(v_operation.completed_area_ha, 0) > 0
            then round(v_seed_consumed / v_operation.completed_area_ha, 4)
          else null
        end;
        update public.operation_materials
        set issued_quantity = round(v_seed_issued, 4),
            consumed_quantity = round(v_seed_consumed, 4),
            returned_quantity = round(v_seed_returned, 4),
            loss_quantity = round(v_seed_loss, 4),
            actual_rate = v_actual_rate,
            updated_by_user_id = auth.uid(),
            updated_at = now()
        where id = v_material.id;

        v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
          'material_id', v_material.id,
          'product_id', v_material.product_id,
          'source', 'warehouse',
          'source_mix_component', true,
          'planned_quantity', coalesce(v_material.planned_quantity, 0),
          'issued_quantity', v_seed_issued,
          'consumed_quantity', v_seed_consumed,
          'returned_quantity', v_seed_returned,
          'loss_quantity', v_seed_loss,
          'actual_rate', v_actual_rate
        ));
        continue;
      end if;

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

comment on function public.operation_completion_dependencies_v12(uuid, uuid, uuid, jsonb)
  is 'Validates crop-mix seed completion from exact reconciled warehouse component rows; preserves weighbridge seed issue for ordinary planting.';

-- END SOURCE: 20260801202000_crop_mix_completion_reconciliation_v1.sql



-- BEGIN SOURCE: 20260801202500_crop_mix_progress_reconciliation_guard_v1.sql

-- Reporting additional completed area must not reopen a fully reconciled grain-mix seed row.

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
    p_company_id, 'progress_v12', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_response := public.save_operation_progress_atomic_v1(
    p_company_id, p_actor_profile_id, p_operation_id, p_completed_area_ha,
    true, p_stop_reason, p_comment, p_weather_note,
    p_idempotency_key || ':v12-core', p_request_fingerprint
  );

  update public.warehouse_issue_request_items i
  set reconciliation_status = 'reconciled',
      shortage_quantity = 0
  from public.warehouse_issue_requests r,
       public.operations o,
       public.crop_structure cs
  where r.id = i.request_id
    and r.operation_id = p_operation_id
    and r.company_id = p_company_id
    and i.company_id = p_company_id
    and o.id = p_operation_id
    and o.company_id = p_company_id
    and cs.id = o.crop_structure_id
    and cs.company_id = p_company_id
    and cs.land_use_type = 'crop_mix'
    and i.source_mix_component_id is not null
    and i.consumed_quantity is not null
    and abs(
      coalesce(i.issued_quantity, 0)
      - coalesce(i.consumed_quantity, 0)
      - coalesce(i.returned_quantity, 0)
      - coalesce(i.loss_quantity, 0)
    ) <= 0.0001
    and coalesce(i.return_received_quantity, 0) + 0.000001 >= coalesce(i.returned_quantity, 0);

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
    p_company_id, 'progress_v12', p_operation_id, p_idempotency_key,
    p_request_fingerprint, p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
) from public, anon;

grant execute on function public.save_operation_progress_atomic_v12(
  uuid, uuid, uuid, numeric, text, text, text, text, text
) to authenticated;

comment on function public.save_operation_progress_atomic_v12(uuid, uuid, uuid, numeric, text, text, text, text, text)
  is 'Persists operation progress and preserves fully reconciled crop-mix seed component rows.';

-- END SOURCE: 20260801202500_crop_mix_progress_reconciliation_guard_v1.sql



-- BEGIN SOURCE: 20260801203000_crop_mix_harvest_transition_v1.sql

-- Seed readiness belongs to crop-mix planting only; harvesting has no seed issue dependency.

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
  v_is_crop_mix boolean := false;
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

  select * into v_operation from public.operations
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

  select exists (
    select 1 from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id and cs.land_use_type = 'crop_mix'
  ) into v_is_crop_mix;

  if p_transition = 'accept' then
    update public.operations
    set status = 'accepted', operation_status = 'accepted', specialist_task_status = 'accepted',
        accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
    update public.warehouse_issue_requests
    set status = case when status = 'new' then 'active' else status end,
        warehouse_request_status = coalesce(warehouse_request_status, 'pending'), updated_at = now()
    where operation_id = p_operation_id and company_id = p_company_id
      and status not in ('cancelled', 'issued', 'issued_by_warehouse');
  else
    if v_is_crop_mix
       and coalesce(v_operation.operation_category_slug, '') = 'planting'
       and exists (
      select 1
      from public.crop_structure_mix_components mc
      where mc.crop_structure_id = v_operation.crop_structure_id
        and mc.company_id = p_company_id
        and not exists (
          select 1
          from public.warehouse_issue_requests r
          join public.warehouse_issue_request_items i
            on i.request_id = r.id and i.company_id = r.company_id
          where r.operation_id = p_operation_id
            and r.company_id = p_company_id
            and i.source_mix_component_id = mc.id
            and i.product_id is not null
            and coalesce(i.issued_quantity, 0) + 0.0001 >= i.required_quantity
            and coalesce(i.reconciliation_status, '') <> 'blocked'
        )
    ) then
      raise exception 'Все компоненты зерносмеси должны быть полностью выданы до начала посева'
        using errcode = '23514';
    end if;
    if not v_is_crop_mix and exists (
      select 1 from public.warehouse_issue_requests r
      where r.operation_id = p_operation_id and r.company_id = p_company_id
        and coalesce(r.status, '') not in ('issued', 'issued_by_warehouse', 'partially_issued')
    ) then
      raise exception 'Materials must be issued before operation start' using errcode = '23514';
    end if;
    update public.operations
    set status = 'in_progress', work_status = 'in_progress', operation_status = 'in_progress',
        specialist_task_status = 'in_progress', started_at = coalesce(started_at, now()), updated_at = now()
    where id = p_operation_id returning * into v_operation;
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

revoke all on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  from public, anon;

grant execute on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  to authenticated;

comment on function public.transition_operation_atomic_v1(uuid, uuid, uuid, text, text, text)
  is 'Transitions operations atomically; crop-mix seed readiness is enforced only for planting.';

-- END SOURCE: 20260801203000_crop_mix_harvest_transition_v1.sql



-- BEGIN SOURCE: 20260801203500_crop_mix_harvest_line_validation_v1.sql

-- A mixed harvest has no single crop, variety or reproduction at the ticket-line root.
-- The exception is allowed only for a verified crop_mix allocation and derived inventory identity.

create or replace function public.validate_harvest_ticket_line_required_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
  v_is_crop_mix boolean := false;
begin
  select t.* into v_ticket
  from public.tickets t
  where t.id = new.ticket_id;

  if v_ticket.direction::text = 'incoming'
     and lower(coalesce(v_ticket.op_type, '')) = 'harvest_incoming' then
    select exists (
      select 1
      from public.crop_structure cs
      where cs.id = v_ticket.crop_structure_allocation_id
        and cs.company_id = v_ticket.company_id
        and cs.field_id = v_ticket.field_id
        and cs.land_use_type = 'crop_mix'
        and coalesce(cs.archived, false) = false
    ) into v_is_crop_mix;

    if v_is_crop_mix then
      if new.crop_id is not null
         or new.variety_id is not null
         or new.reproduction_id is not null
         or not coalesce(new.is_mixed_harvest, false)
         or jsonb_array_length(coalesce(new.composition_snapshot, '[]'::jsonb)) < 2
         or nullif(btrim(new.composition_hash), '') is null
         or not exists (
           select 1
           from public.products p
           where p.id = new.product_id
             and p.company_id = v_ticket.company_id
             and coalesce(p.is_derived_inventory, false) = true
             and p.derived_identity_key = new.composition_hash
             and coalesce(p.archived, false) = false
         ) then
        raise exception 'Mixed harvest line requires verified composition and derived inventory identity';
      end if;
    else
      if new.variety_id is null then
        raise exception 'variety_id is required for harvest incoming ticket lines';
      end if;
      if new.reproduction_id is null then
        raise exception 'reproduction_id is required for harvest incoming ticket lines';
      end if;
    end if;

    if coalesce(new.quantity, 0) <= 0 then
      raise exception 'quantity must be > 0 for harvest incoming ticket lines';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_harvest_ticket_line_required_fields()
  from public, anon, authenticated;

comment on function public.validate_harvest_ticket_line_required_fields()
  is 'Requires single-crop harvest identity or a verified crop-mix composition snapshot and derived product.';

-- END SOURCE: 20260801203500_crop_mix_harvest_line_validation_v1.sql



-- BEGIN SOURCE: 20260801204000_weighbridge_finalize_authenticated_guard_v1.sql

-- Runtime uses the authenticated user JWT. Keep the legacy finalizer private and expose
-- a guarded entrypoint that binds the actor, company and ticket before finalization.

create or replace function public.finalize_weighbridge_ticket_authenticated_v1(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select t.company_id into v_company_id
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  perform public.assert_operation_mutation_actor_v1(
    v_company_id,
    p_actor_user_id,
    array[
      'global_admin', 'admin', 'company_admin', 'director',
      'warehouse', 'warehouse_operator', 'warehouse_manager',
      'weighman', 'weighbridge_operator'
    ]::text[]
  );

  return public.finalize_weighbridge_ticket_v2(p_ticket_id, p_actor_user_id);
end;
$$;

revoke all on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  from public, anon;

grant execute on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  to authenticated;

comment on function public.finalize_weighbridge_ticket_authenticated_v1(uuid, uuid)
  is 'JWT-bound authenticated entrypoint for the private atomic weighbridge ticket finalizer.';

-- END SOURCE: 20260801204000_weighbridge_finalize_authenticated_guard_v1.sql



-- BEGIN SOURCE: 20260801204500_grain_mix_index_rls_optimization_v1.sql

-- TZ-242 follow-up: cover crop-mix foreign keys and avoid per-row auth lookups.

create index if not exists idx_crop_structure_mix_components_variety_v1
  on public.crop_structure_mix_components(variety_id);

create index if not exists idx_crop_structure_mix_components_reproduction_v1
  on public.crop_structure_mix_components(reproduction_id);

create index if not exists idx_operation_materials_mix_component_fk_v1
  on public.operation_materials(source_mix_component_id)
  where source_mix_component_id is not null;

create index if not exists idx_warehouse_request_items_mix_component_fk_v1
  on public.warehouse_issue_request_items(source_mix_component_id)
  where source_mix_component_id is not null;

drop policy if exists crop_structure_mix_components_select on public.crop_structure_mix_components;

create policy crop_structure_mix_components_select
on public.crop_structure_mix_components for select to authenticated
using (
  company_id = (select public.get_user_company_id())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'global_admin' and p.status = 'active'
  )
);

drop policy if exists crop_structure_mix_components_insert on public.crop_structure_mix_components;

create policy crop_structure_mix_components_insert
on public.crop_structure_mix_components for insert to authenticated
with check (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_update on public.crop_structure_mix_components;

create policy crop_structure_mix_components_update
on public.crop_structure_mix_components for update to authenticated
using (company_id = (select public.get_user_company_id()))
with check (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_delete on public.crop_structure_mix_components;

create policy crop_structure_mix_components_delete
on public.crop_structure_mix_components for delete to authenticated
using (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

-- END SOURCE: 20260801204500_grain_mix_index_rls_optimization_v1.sql
