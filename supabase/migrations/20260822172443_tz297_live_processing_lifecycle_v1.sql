-- TZ297 Owner QA P0 #6: live processing accepts inputs and outputs in parallel.
-- Finish only stops new inputs; hard close remains the accounting boundary.

create or replace function public.tz297_processing_context_lock_key_v1(
  p_company_id uuid,
  p_season_id uuid,
  p_node_warehouse_id uuid,
  p_processing_node_id uuid,
  p_transformation_type text,
  p_harvest_lot_id uuid,
  p_source_physical_state text
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|',
      p_company_id::text,
      coalesce(p_season_id::text, 'none'),
      coalesce(p_node_warehouse_id::text, 'none'),
      coalesce(p_processing_node_id::text, 'none'),
      coalesce(p_transformation_type, 'none'),
      coalesce(p_harvest_lot_id::text, 'none'),
      coalesce(p_source_physical_state, 'SOURCE')
    ),
    0
  );
$$;

revoke all on function public.tz297_processing_context_lock_key_v1(uuid,uuid,uuid,uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.tz297_processing_context_lock_key_v1(uuid,uuid,uuid,uuid,text,uuid,text)
  to service_role;

create or replace function public.attach_processing_input_ticket_live_v1(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_line public.ticket_lines%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_candidate record;
  v_destination_type text;
  v_method text;
  v_transformation_type text;
  v_transformation_id uuid;
  v_existing_transformation_id uuid;
  v_active_ids uuid[] := array[]::uuid[];
  v_pending_ids uuid[] := array[]::uuid[];
  v_pass integer;
  v_line_weight numeric;
  v_moisture numeric;
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found or v_ticket.harvest_lot_id is null then
    return null;
  end if;

  if not v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status <> 'finalized' then
    return null;
  end if;

  select w.place_type into v_destination_type
  from public.warehouses w
  where w.id = v_ticket.warehouse_to_id
    and w.company_id = v_ticket.company_id;

  if coalesce(v_destination_type, '') not in ('YARD', 'DRYER', 'CLEANER') then
    return null;
  end if;

  select i.transformation_id into v_existing_transformation_id
  from public.batch_transformation_inputs i
  where i.company_id = v_ticket.company_id
    and i.source_ticket_id = v_ticket.id
  order by i.created_at, i.id
  limit 1;

  if v_existing_transformation_id is not null then
    update public.tickets
    set linked_processing_id = v_existing_transformation_id
    where id = v_ticket.id
      and linked_processing_id is distinct from v_existing_transformation_id;
    perform public.recompute_grain_processing_shadow_v1(v_existing_transformation_id);
    return v_existing_transformation_id;
  end if;

  select * into v_lot
  from public.harvest_lots
  where id = v_ticket.harvest_lot_id
    and company_id = v_ticket.company_id;
  if not found then
    raise exception 'PROCESSING_INPUT_LOT_NOT_FOUND' using errcode = '23514';
  end if;

  v_method := case v_destination_type
    when 'YARD' then 'NATURAL_DRYING'
    when 'DRYER' then 'MECHANICAL_DRYING'
    else 'CLEANING'
  end;
  v_transformation_type := case when v_method = 'CLEANING' then 'cleaning' else 'drying' end;

  perform pg_catalog.pg_advisory_xact_lock(public.tz297_processing_context_lock_key_v1(
    v_ticket.company_id,
    v_lot.season_id,
    v_ticket.warehouse_to_id,
    v_ticket.processing_node_id,
    v_transformation_type,
    v_ticket.harvest_lot_id,
    coalesce(v_ticket.source_physical_state, 'SOURCE')
  ));

  -- A committed retry remains idempotent even if Finish won immediately after it.
  select i.transformation_id into v_existing_transformation_id
  from public.batch_transformation_inputs i
  where i.company_id = v_ticket.company_id
    and i.source_ticket_id = v_ticket.id
  order by i.created_at, i.id
  limit 1;
  if v_existing_transformation_id is not null then
    update public.tickets set linked_processing_id = v_existing_transformation_id where id = v_ticket.id;
    perform public.recompute_grain_processing_shadow_v1(v_existing_transformation_id);
    return v_existing_transformation_id;
  end if;

  for v_candidate in
    select t.id, t.processing_state
    from public.batch_transformations t
    where t.company_id = v_ticket.company_id
      and t.season_id is not distinct from v_lot.season_id
      and t.node_warehouse_id is not distinct from v_ticket.warehouse_to_id
      and t.processing_node_id is not distinct from v_ticket.processing_node_id
      and t.transformation_type = v_transformation_type
      and t.harvest_lot_id is not distinct from v_ticket.harvest_lot_id
      and coalesce(t.source_physical_state, 'SOURCE') = coalesce(v_ticket.source_physical_state, 'SOURCE')
      and t.processing_state in ('in_processing', 'processing_pending_outputs')
      and t.status <> 'voided'
    order by t.created_at, t.id
    for update
  loop
    if v_candidate.processing_state = 'in_processing' then
      v_active_ids := array_append(v_active_ids, v_candidate.id);
    else
      v_pending_ids := array_append(v_pending_ids, v_candidate.id);
    end if;
  end loop;

  if cardinality(v_active_ids) > 1 or cardinality(v_pending_ids) > 1
     or (cardinality(v_active_ids) > 0 and cardinality(v_pending_ids) > 0) then
    raise exception 'PROCESSING_INPUT_AMBIGUOUS' using errcode = '23514';
  end if;

  if cardinality(v_pending_ids) = 1 then
    raise exception 'PROCESSING_INPUT_FINISHED' using errcode = '23514';
  end if;

  if cardinality(v_active_ids) = 1 then
    v_transformation_id := v_active_ids[1];
  else
    select coalesce(max(t.pass_no), 0) + 1 into v_pass
    from public.batch_transformations t
    where t.company_id = v_ticket.company_id
      and t.node_warehouse_id is not distinct from v_ticket.warehouse_to_id
      and t.processing_node_id is not distinct from v_ticket.processing_node_id
      and t.harvest_lot_id is not distinct from v_ticket.harvest_lot_id
      and t.transformation_type = v_transformation_type
      and coalesce(t.source_physical_state, 'SOURCE') = coalesce(v_ticket.source_physical_state, 'SOURCE');

    insert into public.batch_transformations(
      company_id, season_id, node_warehouse_id, processing_node_id,
      transformation_type, processing_method, status, processing_state,
      shadow_mode, shadow_status, quality_state, identity_key, harvest_lot_id,
      source_physical_state, pass_no, source_ticket_id, started_at, created_by, note
    ) values (
      v_ticket.company_id, v_lot.season_id, v_ticket.warehouse_to_id, v_ticket.processing_node_id,
      v_transformation_type, v_method, 'draft', 'in_processing',
      true, 'ACTIVE', 'READY',
      pg_catalog.concat('grain-lot:', v_ticket.harvest_lot_id, ':', coalesce(v_ticket.source_physical_state, 'SOURCE'), ':', v_pass),
      v_ticket.harvest_lot_id, coalesce(v_ticket.source_physical_state, 'SOURCE'), v_pass,
      v_ticket.id, coalesce(v_ticket.finalized_at, now()), coalesce(v_ticket.closed_by, v_ticket.created_by),
      'TZ297 live processing pass'
    ) returning id into v_transformation_id;
  end if;

  for v_line in
    select * from public.ticket_lines where ticket_id = v_ticket.id order by created_at, id
  loop
    select * into v_batch
    from public.inventory_batches b
    where b.company_id = v_ticket.company_id
      and b.id::text = coalesce(v_line.destination_batch_id::text, nullif(v_line.batch_id, ''))
    limit 1;
    if not found then
      raise exception 'PROCESSING_INPUT_BATCH_NOT_FOUND' using errcode = '23514';
    end if;

    v_line_weight := coalesce(
      v_line.net_line_weight_kg,
      v_line.quantity_kg,
      v_line.mass_kg,
      v_line.quantity
    );
    if coalesce(v_line_weight, 0) <= 0 then
      raise exception 'PROCESSING_INPUT_WEIGHT_INVALID' using errcode = '23514';
    end if;
    v_moisture := coalesce(v_line.moisture_percent, v_batch.moisture_percent);

    insert into public.batch_transformation_inputs(
      company_id, transformation_id, batch_id, warehouse_from_id, input_weight_kg,
      input_quality_json, source_ticket_id, source_ticket_line_id, node_warehouse_id,
      moisture_percent, dry_matter_kg
    ) values (
      v_ticket.company_id, v_transformation_id, v_batch.id, v_ticket.warehouse_to_id,
      round(v_line_weight, 3), jsonb_build_object('moisture_percent', v_moisture),
      v_ticket.id, v_line.id, v_ticket.warehouse_to_id, v_moisture,
      case when v_moisture is null then null else round(v_line_weight * (100 - v_moisture) / 100, 3) end
    ) on conflict (source_ticket_line_id) where source_ticket_line_id is not null do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  if v_inserted = 0 then
    raise exception 'PROCESSING_INPUT_LINES_REQUIRED' using errcode = '23514';
  end if;

  update public.tickets set linked_processing_id = v_transformation_id where id = v_ticket.id;
  insert into public.batch_processing_events(
    company_id, transformation_id, event_type, actor_type, actor_user_id,
    idempotency_key, observed_at, payload
  ) values (
    v_ticket.company_id, v_transformation_id, 'processing_input_attached', 'system',
    coalesce(v_ticket.closed_by, v_ticket.created_by), 'ticket:' || v_ticket.id::text,
    coalesce(v_ticket.finalized_at, now()),
    jsonb_build_object('ticket_id', v_ticket.id, 'input_kg', round(v_ticket.net_weight_kg, 3))
  ) on conflict (company_id, transformation_id, event_type, idempotency_key) do nothing;
  perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  return v_transformation_id;
end;
$$;

revoke all on function public.attach_processing_input_ticket_live_v1(uuid) from public, anon, authenticated;
grant execute on function public.attach_processing_input_ticket_live_v1(uuid) to service_role;

create or replace function public.soft_finish_processing_v1(
  p_transformation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_now timestamptz := now();
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  select * into v_t from public.batch_transformations where id = p_transformation_id;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id, p_actor_user_id, array['global_admin','company_admin','weighman']);
  perform pg_catalog.pg_advisory_xact_lock(public.tz297_processing_context_lock_key_v1(
    v_t.company_id, v_t.season_id, v_t.node_warehouse_id, v_t.processing_node_id,
    v_t.transformation_type, v_t.harvest_lot_id, coalesce(v_t.source_physical_state, 'SOURCE')
  ));
  select * into v_t from public.batch_transformations where id = p_transformation_id for update;
  if v_t.processing_state = 'processing_closed' then
    raise exception 'PROCESSING_ALREADY_CLOSED' using errcode = '23514';
  end if;
  if v_t.processing_state = 'processing_pending_outputs' then
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'transformation_id', v_t.id, 'processing_state', v_t.processing_state);
  end if;

  insert into public.batch_processing_events(
    company_id, transformation_id, event_type, actor_type, actor_user_id,
    idempotency_key, observed_at, payload
  ) values (
    v_t.company_id, v_t.id, 'operator_soft_finish', 'operator', p_actor_user_id,
    p_idempotency_key, v_now,
    jsonb_build_object('from_state', v_t.processing_state, 'to_state', 'processing_pending_outputs')
  ) on conflict (company_id, transformation_id, event_type, idempotency_key) do nothing;

  update public.batch_transformations
  set processing_state = 'processing_pending_outputs',
      finish_requested_at = v_now,
      finish_requested_by = p_actor_user_id,
      finish_signal_source = 'operator',
      status = 'draft',
      updated_at = v_now
  where id = v_t.id;
  perform public.recompute_grain_processing_shadow_v1(v_t.id);
  return jsonb_build_object('ok', true, 'idempotent_replay', false, 'transformation_id', v_t.id, 'processing_state', 'processing_pending_outputs');
end;
$$;

revoke all on function public.soft_finish_processing_v1(uuid,uuid,text) from public, anon;
grant execute on function public.soft_finish_processing_v1(uuid,uuid,text) to authenticated, service_role;

create or replace function public.reopen_processing_before_close_v1(
  p_transformation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_now timestamptz := now();
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  select * into v_t from public.batch_transformations where id = p_transformation_id;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id, p_actor_user_id, array['global_admin','company_admin','weighman']);
  perform pg_catalog.pg_advisory_xact_lock(public.tz297_processing_context_lock_key_v1(
    v_t.company_id, v_t.season_id, v_t.node_warehouse_id, v_t.processing_node_id,
    v_t.transformation_type, v_t.harvest_lot_id, coalesce(v_t.source_physical_state, 'SOURCE')
  ));
  select * into v_t from public.batch_transformations where id = p_transformation_id for update;
  if v_t.processing_state = 'processing_closed' then
    raise exception 'PROCESSING_ALREADY_CLOSED' using errcode = '23514';
  end if;
  if v_t.processing_state = 'in_processing' then
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'transformation_id', v_t.id, 'processing_state', v_t.processing_state);
  end if;

  insert into public.batch_processing_events(
    company_id, transformation_id, event_type, actor_type, actor_user_id,
    idempotency_key, observed_at, payload
  ) values (
    v_t.company_id, v_t.id, 'processing_reopened_before_close', 'operator', p_actor_user_id,
    p_idempotency_key, v_now,
    jsonb_build_object('from_state', v_t.processing_state, 'to_state', 'in_processing')
  ) on conflict (company_id, transformation_id, event_type, idempotency_key) do nothing;

  update public.batch_transformations
  set processing_state = 'in_processing',
      finish_requested_at = null,
      finish_requested_by = null,
      finish_signal_source = null,
      status = 'draft',
      updated_at = v_now
  where id = v_t.id;
  perform public.recompute_grain_processing_shadow_v1(v_t.id);
  return jsonb_build_object('ok', true, 'idempotent_replay', false, 'transformation_id', v_t.id, 'processing_state', 'in_processing');
end;
$$;

revoke all on function public.reopen_processing_before_close_v1(uuid,uuid,text) from public, anon;
grant execute on function public.reopen_processing_before_close_v1(uuid,uuid,text) to authenticated, service_role;

create or replace function public.approve_processing_loss_v1(
  p_transformation_id uuid,
  p_loss_type text,
  p_qty_kg numeric,
  p_reason text,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_loss_id uuid;
  v_reason text;
begin
  select * into v_t from public.batch_transformations where id = p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id, p_actor_user_id, array['global_admin','company_admin','director']);
  if v_t.processing_state = 'processing_closed' then raise exception 'PROCESSING_ALREADY_CLOSED' using errcode = '23514'; end if;
  if p_loss_type not in ('dust','spillage','sampling','other') or coalesce(p_qty_kg, 0) <= 0 then
    raise exception 'PROCESSING_LOSS_DETAILS_REQUIRED' using errcode = '22023';
  end if;
  if p_loss_type = 'other' and nullif(btrim(p_reason), '') is null then
    raise exception 'PROCESSING_OTHER_LOSS_REASON_REQUIRED' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason), ''), case p_loss_type
    when 'dust' then 'Пыль'
    when 'spillage' then 'Просыпь'
    when 'sampling' then 'Отбор проб'
    else null
  end);

  insert into public.batch_transformation_losses(
    company_id, transformation_id, loss_type, qty_kg, reason,
    approved_by, approved_at, idempotency_key
  ) values (
    v_t.company_id, v_t.id, p_loss_type, round(p_qty_kg, 3), v_reason,
    p_actor_user_id, now(), p_idempotency_key
  ) on conflict (company_id, transformation_id, idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
  returning id into v_loss_id;

  insert into public.batch_processing_events(
    company_id, transformation_id, event_type, actor_type, actor_user_id,
    idempotency_key, payload
  ) values (
    v_t.company_id, v_t.id, 'process_loss_approved', 'user', p_actor_user_id,
    p_idempotency_key,
    jsonb_build_object('loss_id', v_loss_id, 'loss_type', p_loss_type, 'qty_kg', round(p_qty_kg, 3), 'reason', v_reason)
  ) on conflict (company_id, transformation_id, event_type, idempotency_key) do nothing;
  return jsonb_build_object('ok', true, 'loss_id', v_loss_id);
end;
$$;

revoke all on function public.approve_processing_loss_v1(uuid,text,numeric,text,uuid,text) from public, anon;
grant execute on function public.approve_processing_loss_v1(uuid,text,numeric,text,uuid,text) to authenticated, service_role;

create or replace function public.tg_sync_grain_movement_shadow_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input_transformation_id uuid;
begin
  if new.source_kind = 'processing_wip'
     and new.linked_processing_id is not null
     and new.processing_output_role in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
     and new.is_finalized
     and not new.is_voided
     and new.status = 'finalized'
  then
    return new;
  end if;

  if new.harvest_lot_id is not null
     and (
       old.is_finalized is distinct from new.is_finalized
       or old.status is distinct from new.status
       or old.is_voided is distinct from new.is_voided
     )
  then
    if new.is_finalized and not new.is_voided and new.status = 'finalized' then
      v_input_transformation_id := public.attach_processing_input_ticket_live_v1(new.id);
      if v_input_transformation_id is not null then
        return new;
      end if;
    end if;
    perform public.sync_grain_movement_shadow_v1(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.tg_sync_grain_movement_shadow_v1() from public, anon, authenticated;
