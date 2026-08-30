-- TZ312: the physical warehouse object is the canonical processing context.
-- Legacy cycles may have null season_id/processing_node_id, while current tickets
-- carry the lot season and use warehouses.place_type. Reuse the one open
-- lot/state/method cycle enforced by uq_batch_transformations_open_lot_pass_v1
-- instead of attempting a duplicate. The advisory-lock identity is aligned to
-- the same context for input/finish/reopen callers. No legacy rows are rewritten.

do $$
begin
  if to_regprocedure('public.attach_processing_input_ticket_live_v1(uuid)') is null then
    raise exception 'TZ312_REQUIRED_FUNCTION_MISSING';
  end if;

  if to_regprocedure('public.tz297_processing_context_lock_key_v1(uuid,uuid,uuid,uuid,text,uuid,text)') is null then
    raise exception 'TZ312_REQUIRED_LOCK_FUNCTION_MISSING';
  end if;

  if exists (
    select 1
    from public.batch_transformations t
    where t.shadow_mode
      and t.status = 'draft'
      and t.harvest_lot_id is not null
    group by
      t.company_id,
      t.node_warehouse_id,
      t.harvest_lot_id,
      t.source_physical_state,
      t.processing_method
    having count(*) > 1
  ) then
    raise exception 'TZ312_OPEN_PROCESSING_IDENTITY_DUPLICATES';
  end if;
end;
$$;

create unique index if not exists uq_batch_transformations_open_lot_pass_v1
  on public.batch_transformations(
    company_id,
    node_warehouse_id,
    harvest_lot_id,
    source_physical_state,
    processing_method
  )
  where shadow_mode
    and status = 'draft'
    and harvest_lot_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.uq_batch_transformations_open_lot_pass_v1')
      and i.indrelid = 'public.batch_transformations'::regclass
      and i.indisunique
      and i.indnkeyatts = 5
      and array(
        select pg_catalog.pg_get_indexdef(i.indexrelid, n, true)
        from pg_catalog.generate_series(1, i.indnkeyatts) n
        order by n
      ) = array[
        'company_id',
        'node_warehouse_id',
        'harvest_lot_id',
        'source_physical_state',
        'processing_method'
      ]::text[]
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%shadow_mode%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%status%draft%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%harvest_lot_id%is not null%'
  ) then
    raise exception 'TZ312_OPEN_PROCESSING_INDEX_CONTRACT_MISMATCH';
  end if;
end;
$$;

-- Keep the historical signature because every lifecycle caller already uses it,
-- but intentionally exclude season_id and processing_node_id from the hash.
-- Those columns and transformation_type are outside the physical open-cycle
-- index (processing_method is implied by the destination warehouse type here),
-- so input, soft-finish and reopen serialize on one warehouse/lot/state context.
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
      coalesce(p_node_warehouse_id::text, 'none'),
      coalesce(p_harvest_lot_id::text, 'none'),
      coalesce(p_source_physical_state, 'SOURCE')
    ),
    0
  );
$$;

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

  -- The lock helper deliberately ignores season_id and processing_node_id so all
  -- lifecycle callers serialize on the physical open-cycle identity.
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
    select t.id, t.processing_state, t.season_id, t.transformation_type
    from public.batch_transformations t
    where t.company_id = v_ticket.company_id
      and t.node_warehouse_id is not distinct from v_ticket.warehouse_to_id
      and t.processing_method = v_method
      and t.harvest_lot_id is not distinct from v_ticket.harvest_lot_id
      and coalesce(t.source_physical_state, 'SOURCE') = coalesce(v_ticket.source_physical_state, 'SOURCE')
      and t.shadow_mode
      and t.status = 'draft'
      and t.processing_state in ('in_processing', 'processing_pending_outputs')
    order by t.created_at, t.id
    for update
  loop
    -- The unique index is intentionally broader than season metadata. Detect a
    -- legacy/corrupt collision explicitly, but never attach a current ticket to
    -- a cycle that downstream output cannot close for this lot season.
    if v_candidate.season_id is distinct from v_lot.season_id
       or v_candidate.transformation_type is distinct from v_transformation_type then
      raise exception 'PROCESSING_INPUT_CONTEXT_INVALID' using errcode = '23514';
    end if;

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
      and t.harvest_lot_id is not distinct from v_ticket.harvest_lot_id
      and t.transformation_type = v_transformation_type
      and t.processing_method = v_method
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

notify pgrst, 'reload schema';
