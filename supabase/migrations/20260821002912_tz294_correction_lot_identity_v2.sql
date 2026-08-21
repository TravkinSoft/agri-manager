begin;

create or replace function private.sync_transfer_correction_lineage_v2(
  p_correction_ticket_id uuid,
  p_sync_line_quantity boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_new public.tickets%rowtype;
  v_old public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_source_entry public.stock_ledger_entries%rowtype;
  v_destination_entry public.stock_ledger_entries%rowtype;
  v_source public.inventory_batches%rowtype;
  v_destination public.inventory_batches%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_lot_ids uuid[];
  v_source_count integer;
  v_destination_count integer;
  v_line_count integer;
  v_changed boolean := false;
  v_quantity numeric(18,6);
begin
  select * into v_new
  from public.tickets
  where id = p_correction_ticket_id
  for update;
  if not found then raise exception 'Correction ticket not found'; end if;
  if v_new.correction_of_ticket_id is null then raise exception 'Ticket is not a correction'; end if;

  select * into v_old
  from public.tickets
  where id = v_new.correction_of_ticket_id
  for update;
  if not found then raise exception 'Original ticket not found'; end if;
  if v_new.company_id is distinct from v_old.company_id
     or v_new.direction::text <> 'transfer'
     or v_old.direction::text <> 'transfer'
     or v_new.warehouse_from_id is distinct from v_old.warehouse_from_id
     or v_new.warehouse_to_id is distinct from v_old.warehouse_to_id then
    raise exception 'Correction transfer context does not match original ticket';
  end if;

  select count(*) into v_source_count
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_old.id
    and sle.company_id = v_old.company_id
    and sle.direction::text = 'out'
    and sle.warehouse_id = v_old.warehouse_from_id
    and not coalesce(sle.is_storno, false)
    and not exists (
      select 1 from public.stock_ledger_entries sx where sx.storno_of_entry_id = sle.id
    );
  if v_source_count <> 1 then
    raise exception 'Correction source batch lineage is ambiguous';
  end if;
  select sle.* into v_source_entry
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_old.id
    and sle.company_id = v_old.company_id
    and sle.direction::text = 'out'
    and sle.warehouse_id = v_old.warehouse_from_id
    and not coalesce(sle.is_storno, false)
    and not exists (
      select 1 from public.stock_ledger_entries sx where sx.storno_of_entry_id = sle.id
    )
  order by sle.created_at, sle.id
  limit 1
  for update;

  select count(*) into v_destination_count
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_old.id
    and sle.company_id = v_old.company_id
    and sle.direction::text = 'in'
    and sle.warehouse_id = v_old.warehouse_to_id
    and not coalesce(sle.is_storno, false)
    and not exists (
      select 1 from public.stock_ledger_entries sx where sx.storno_of_entry_id = sle.id
    );
  if v_destination_count <> 1 then
    raise exception 'Correction destination batch lineage is ambiguous';
  end if;
  select sle.* into v_destination_entry
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_old.id
    and sle.company_id = v_old.company_id
    and sle.direction::text = 'in'
    and sle.warehouse_id = v_old.warehouse_to_id
    and not coalesce(sle.is_storno, false)
    and not exists (
      select 1 from public.stock_ledger_entries sx where sx.storno_of_entry_id = sle.id
    )
  order by sle.created_at, sle.id
  limit 1
  for update;

  if v_source_entry.inventory_batch_id is null or v_destination_entry.inventory_batch_id is null then
    raise exception 'Correction physical batch lineage is incomplete';
  end if;

  select * into v_source
  from public.inventory_batches
  where id = v_source_entry.inventory_batch_id
  for update;
  select * into v_destination
  from public.inventory_batches
  where id = v_destination_entry.inventory_batch_id
  for update;
  if v_source.id is null or v_destination.id is null then
    raise exception 'Correction physical batch lineage is incomplete';
  end if;
  if v_source.company_id is distinct from v_old.company_id
     or v_destination.company_id is distinct from v_old.company_id
     or v_source.warehouse_id is distinct from v_old.warehouse_from_id
     or v_destination.warehouse_id is distinct from v_old.warehouse_to_id
     or v_source.product_id is distinct from v_destination.product_id
     or v_source.crop_id is distinct from v_destination.crop_id
     or v_source.variety_id is distinct from v_destination.variety_id
     or v_source.reproduction_id is distinct from v_destination.reproduction_id
     or coalesce(v_source.composition_hash, '') <> coalesce(v_destination.composition_hash, '')
     or v_destination.parent_batch_id is distinct from v_source.id then
    raise exception 'Correction physical batch identity is incompatible';
  end if;

  select array_agg(distinct source_link.harvest_lot_id)
  into v_lot_ids
  from public.harvest_lot_batches source_link
  join public.harvest_lot_batches destination_link
    on destination_link.company_id = source_link.company_id
   and destination_link.harvest_lot_id = source_link.harvest_lot_id
  where source_link.company_id = v_old.company_id
    and source_link.inventory_batch_id = v_source.id
    and destination_link.inventory_batch_id = v_destination.id;
  if coalesce(array_length(v_lot_ids, 1), 0) <> 1 then
    raise exception 'Correction aggregate lot lineage is ambiguous';
  end if;

  select * into v_lot
  from public.harvest_lots
  where id = v_lot_ids[1]
    and company_id = v_old.company_id
    and status = 'active'
  for update;
  if not found then raise exception 'Correction aggregate lot is unavailable'; end if;
  if v_old.harvest_lot_id is not null and v_old.harvest_lot_id is distinct from v_lot.id then
    raise exception 'Original ticket aggregate lot conflicts with physical batches';
  end if;
  if v_new.harvest_lot_id is not null and v_new.harvest_lot_id is distinct from v_lot.id then
    raise exception 'Correction ticket aggregate lot conflicts with physical batches';
  end if;
  if v_source.crop_id is distinct from v_lot.crop_id
     or v_source.variety_id is distinct from v_lot.variety_id
     or v_source.reproduction_id is distinct from v_lot.reproduction_id
     or coalesce(v_source.composition_hash, '') <> coalesce(v_lot.composition_hash, '') then
    raise exception 'Correction batch identity does not match aggregate harvest lot';
  end if;

  select count(*) into v_line_count
  from public.ticket_lines
  where ticket_id = v_new.id and company_id = v_new.company_id;
  if v_line_count <> 1 then
    raise exception 'Correction line identity is ambiguous';
  end if;
  select * into v_line
  from public.ticket_lines
  where ticket_id = v_new.id and company_id = v_new.company_id
  order by created_at, id
  limit 1
  for update;

  v_quantity := case
    when p_sync_line_quantity and coalesce(v_new.net_weight_kg, 0) > 0
      then round(v_new.net_weight_kg, 6)
    else round(coalesce(v_line.quantity_kg, v_line.quantity, v_line.mass_kg, v_line.net_line_weight_kg, 0), 6)
  end;
  if v_quantity <= 0 then raise exception 'Correction line quantity must be greater than zero'; end if;

  v_changed :=
    v_line.product_id is distinct from v_source.product_id
    or v_line.crop_id is distinct from v_source.crop_id
    or v_line.variety_id is distinct from v_source.variety_id
    or v_line.reproduction_id is distinct from v_source.reproduction_id
    or v_line.batch_id is distinct from v_source.id::text
    or v_line.destination_batch_id is distinct from v_destination.id
    or v_line.lot_id is distinct from v_source.id::text
    or v_line.quantity is distinct from v_quantity
    or v_line.quantity_kg is distinct from v_quantity
    or v_line.mass_kg is distinct from v_quantity
    or v_line.net_line_weight_kg is distinct from v_quantity;

  update public.tickets
  set harvest_lot_id = v_lot.id,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'correction_lineage_v2', jsonb_build_object(
          'aggregate_lot_id', v_lot.id,
          'source_batch_id', v_source.id,
          'destination_batch_id', v_destination.id,
          'resolved_at', now()
        )
      ),
      updated_at = now()
  where id = v_old.id and harvest_lot_id is null;

  update public.tickets
  set harvest_lot_id = v_lot.id,
      source_physical_state = coalesce(v_source.physical_state, 'SOURCE'),
      processing_allocation_ready = false,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'correction_lineage_v2', jsonb_build_object(
          'aggregate_lot_id', v_lot.id,
          'source_batch_id', v_source.id,
          'destination_batch_id', v_destination.id,
          'line_quantity_kg', v_quantity,
          'resolved_at', now()
        )
      ),
      updated_at = now()
  where id = v_new.id;

  update public.ticket_lines
  set product_id = v_source.product_id,
      crop_id = v_source.crop_id,
      variety_id = v_source.variety_id,
      reproduction_id = v_source.reproduction_id,
      batch_id = v_source.id::text,
      destination_batch_id = v_destination.id,
      lot_id = v_source.id::text,
      batch_class = 'commodity',
      warehouse_from_id = v_old.warehouse_from_id,
      warehouse_to_id = v_old.warehouse_to_id,
      gross_line_weight_kg = case when p_sync_line_quantity then v_new.gross_weight_kg else gross_line_weight_kg end,
      tare_line_weight_kg = case when p_sync_line_quantity then v_new.tare_weight_kg else tare_line_weight_kg end,
      quantity = v_quantity,
      quantity_kg = v_quantity,
      mass_kg = v_quantity,
      net_line_weight_kg = v_quantity,
      composition_snapshot = coalesce(v_source.composition_snapshot, '[]'::jsonb),
      composition_hash = v_source.composition_hash,
      unit_source = coalesce(unit_source, 'weighbridge_correction'),
      unit_contract_version = greatest(coalesce(unit_contract_version, 1), 2),
      updated_at = now()
  where id = v_line.id;

  if v_changed then
    insert into public.audit_log(
      company_id, who, entity_type, entity_id, action, old_values, new_values, reason
    ) values (
      v_new.company_id, v_new.created_by, 'weighbridge_ticket', v_new.id::text,
      'correction_lineage_backfilled',
      jsonb_build_object(
        'quantity', v_line.quantity,
        'quantity_kg', v_line.quantity_kg,
        'mass_kg', v_line.mass_kg,
        'net_line_weight_kg', v_line.net_line_weight_kg,
        'crop_id', v_line.crop_id,
        'batch_id', v_line.batch_id,
        'destination_batch_id', v_line.destination_batch_id
      ),
      jsonb_build_object(
        'quantity', v_quantity,
        'quantity_kg', v_quantity,
        'mass_kg', v_quantity,
        'net_line_weight_kg', v_quantity,
        'crop_id', v_source.crop_id,
        'batch_id', v_source.id,
        'destination_batch_id', v_destination.id,
        'harvest_lot_id', v_lot.id
      ),
      'TZ294 correction lot identity v2'
    );
  end if;

  return jsonb_build_object(
    'source_batch_id', v_source.id,
    'destination_batch_id', v_destination.id,
    'aggregate_lot_id', v_lot.id,
    'line_quantity_kg', v_quantity,
    'changed', v_changed
  );
end
$function$;

create or replace function public.start_weighbridge_ticket_correction_v1(
  p_ticket_id uuid,
  p_reason text,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_old public.tickets%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_new_no text;
  v_existing_id uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Причина исправления обязательна.';
  end if;
  select t.* into v_old from public.tickets t where t.id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  v_actor := private.assert_weighbridge_ticket_correction_actor_v1(v_old.company_id, p_operator_person_id, p_shift_id);
  if not v_old.is_finalized or v_old.is_voided or v_old.status::text <> 'finalized' then
    raise exception 'Исправить можно только действующий завершённый талон.';
  end if;
  if private.weighbridge_ticket_has_downstream_dependencies_v1(p_ticket_id) then
    raise exception 'Этот приход уже использован в последующих движениях. Простое исправление невозможно.';
  end if;

  select t.id into v_existing_id
  from public.tickets t
  where t.correction_of_ticket_id = p_ticket_id
    and coalesce(t.is_voided, false) = false
  order by t.created_at desc
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_old.direction::text = 'transfer' then
    perform private.repair_legacy_transfer_batch_trace_v1(v_old.id);
    select * into v_old from public.tickets where id = v_old.id for update;
  end if;

  v_new_no := v_old.ticket_no || '-R' || upper(substr(replace(v_new_id::text, '-', ''), 1, 6));
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id, field_id,
    warehouse_from_id, warehouse_to_id, processing_point_from_id, processing_point_to_id,
    supplier_id, buyer_id, vehicle_id, driver_id, responsible_user_id, created_by,
    gross_weight_kg, tare_weight_kg, net_weight_kg, weigh_method,
    linked_operation_id, linked_request_id, linked_processing_id, notes, shift_id,
    processing_node_id, source_type, destination_type, harvest_year, weight_source,
    manual_correction_reason, stored_tare_used, quality_json, local_sync_status,
    requires_review, review_reason, audit_json, crop_structure_allocation_id,
    supplier_document_no, receipt_mode, supplier_receipt_kind, field_operation_type,
    season_id, shipment_purpose, destination_text, external_document_no,
    field_material_category, disposal_category, created_by_person_id,
    correction_of_ticket_id, correction_reason, correction_started_at,
    harvest_lot_id, source_physical_state, processing_allocation_ready
  ) values (
    v_new_id, v_old.company_id, v_new_no, v_old.ticket_type, v_old.op_type, 'active', v_old.direction,
    v_old.source_kind, v_old.source_id, v_old.destination_kind, v_old.destination_id, v_old.field_id,
    v_old.warehouse_from_id, v_old.warehouse_to_id, v_old.processing_point_from_id, v_old.processing_point_to_id,
    v_old.supplier_id, v_old.buyer_id, v_old.vehicle_id, v_old.driver_id, v_old.responsible_user_id, v_actor.id,
    v_old.gross_weight_kg, v_old.tare_weight_kg, v_old.net_weight_kg, v_old.weigh_method,
    v_old.linked_operation_id, v_old.linked_request_id, v_old.linked_processing_id, v_old.notes, coalesce(p_shift_id, v_old.shift_id),
    v_old.processing_node_id, v_old.source_type, v_old.destination_type, v_old.harvest_year, v_old.weight_source,
    trim(p_reason), v_old.stored_tare_used, v_old.quality_json, v_old.local_sync_status,
    v_old.requires_review, v_old.review_reason,
    coalesce(v_old.audit_json, '{}'::jsonb) || jsonb_build_object('correction_of_ticket_id', v_old.id, 'correction_started_by', v_actor.id),
    v_old.crop_structure_allocation_id, v_old.supplier_document_no, v_old.receipt_mode,
    v_old.supplier_receipt_kind, v_old.field_operation_type, v_old.season_id,
    v_old.shipment_purpose, v_old.destination_text, v_old.external_document_no,
    v_old.field_material_category, v_old.disposal_category, p_operator_person_id,
    v_old.id, trim(p_reason), now(), v_old.harvest_lot_id,
    v_old.source_physical_state, false
  );

  insert into public.ticket_lines (
    ticket_id, company_id, product_id, product_type, product_name_snapshot, uom,
    gross_line_weight_kg, tare_line_weight_kg, net_line_weight_kg, quantity,
    moisture_percent, dockage_percent, dirt_tare_percent, class_grade,
    variety_id, reproduction_id, batch_id, destination_batch_id, lot_id,
    packaging_type, returned_container_qty, disposable_container_qty, notes,
    crop_id, warehouse_from_id, warehouse_to_id, quantity_kg, quality_json,
    line_type, variety_name_snapshot, reproduction_name_snapshot, batch_class,
    operation_line_id, unit_price, amount, mass_kg, density_kg_per_l,
    density_unit, density_source, density_verification_status, density_verified_at,
    unit_source, unit_contract_version, composition_snapshot, composition_hash,
    is_mixed_harvest
  )
  select
    v_new_id, tl.company_id, tl.product_id, tl.product_type, tl.product_name_snapshot, tl.uom,
    tl.gross_line_weight_kg, tl.tare_line_weight_kg, tl.net_line_weight_kg, tl.quantity,
    tl.moisture_percent, tl.dockage_percent, tl.dirt_tare_percent, tl.class_grade,
    tl.variety_id, tl.reproduction_id, tl.batch_id, tl.destination_batch_id, tl.lot_id,
    tl.packaging_type, tl.returned_container_qty, tl.disposable_container_qty, tl.notes,
    tl.crop_id, tl.warehouse_from_id, tl.warehouse_to_id, tl.quantity_kg, tl.quality_json,
    tl.line_type, tl.variety_name_snapshot, tl.reproduction_name_snapshot, tl.batch_class,
    tl.operation_line_id, tl.unit_price, tl.amount, tl.mass_kg, tl.density_kg_per_l,
    tl.density_unit, tl.density_source, tl.density_verification_status, tl.density_verified_at,
    tl.unit_source, tl.unit_contract_version, tl.composition_snapshot, tl.composition_hash,
    tl.is_mixed_harvest
  from public.ticket_lines tl
  where tl.ticket_id = v_old.id;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, comment, operator_person_id, weighbridge_shift_id
  )
  select v_new_id, tw.company_id, tw.weighing_no, tw.measured_weight_kg, now(),
    'manual', v_actor.id, 'Скопировано для исправления талона ' || v_old.ticket_no,
    p_operator_person_id, coalesce(p_shift_id, tw.weighbridge_shift_id)
  from public.ticket_weighings tw
  where tw.ticket_id = v_old.id;

  if v_old.direction::text = 'transfer' then
    perform private.sync_transfer_correction_lineage_v2(v_new_id, true);
  end if;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, old_values, new_values, reason)
  values (
    v_old.company_id, v_actor.id, 'weighbridge_ticket', v_new_id::text,
    'ticket_correction_started', jsonb_build_object('ticket_id', v_old.id, 'ticket_no', v_old.ticket_no),
    jsonb_build_object('ticket_id', v_new_id, 'ticket_no', v_new_no, 'operator_person_id', p_operator_person_id,
      'shift_id', p_shift_id, 'correction_contract', 'lot_identity_v2'),
    trim(p_reason)
  );
  return v_new_id;
end
$function$;

create or replace function public.finalize_weighbridge_ticket_correction_v1(
  p_ticket_id uuid,
  p_operator_person_id uuid default null,
  p_shift_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor public.profiles%rowtype;
  v_new public.tickets%rowtype;
  v_old public.tickets%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_lineage jsonb;
begin
  select * into v_new from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_new.correction_of_ticket_id is null then raise exception 'Ticket is not a correction'; end if;
  select * into v_old from public.tickets where id = v_new.correction_of_ticket_id for update;
  if not found then raise exception 'Original ticket not found'; end if;

  v_actor := private.assert_weighbridge_ticket_correction_actor_v1(
    v_new.company_id, p_operator_person_id, p_shift_id
  );

  if v_new.is_finalized and v_new.status::text = 'finalized'
     and v_old.is_voided and v_old.status::text = 'voided'
     and v_old.replacement_ticket_id = v_new.id then
    return v_new.id;
  end if;
  if v_new.is_finalized or v_new.is_voided or v_new.status::text in ('finalized', 'voided') then
    raise exception 'Correction ticket is not open';
  end if;
  if not v_old.is_finalized or v_old.is_voided or v_old.status::text <> 'finalized' then
    raise exception 'Original ticket is no longer correctable';
  end if;
  if private.weighbridge_ticket_has_downstream_dependencies_v1(v_old.id) then
    raise exception 'Этот приход уже использован в последующих движениях. Простое исправление невозможно.';
  end if;

  if v_old.direction::text = 'transfer' then
    perform private.repair_legacy_transfer_batch_trace_v1(v_old.id);
    select * into v_old from public.tickets where id = v_old.id for update;
    v_lineage := private.sync_transfer_correction_lineage_v2(v_new.id, true);
    select * into v_new from public.tickets where id = v_new.id for update;
  end if;

  for v_entry in
    select sle.*
    from public.stock_ledger_entries sle
    where sle.ticket_id = v_old.id
      and not coalesce(sle.is_storno, false)
      and not exists (
        select 1 from public.stock_ledger_entries x where x.storno_of_entry_id = sle.id
      )
    order by sle.created_at, sle.id
    for update
  loop
    insert into public.stock_ledger_entries (
      company_id, ticket_id, processing_id, product_id, warehouse_id, direction,
      quantity, uom, delta_qty_signed, reason_type, reason_ref_id, batch_id,
      occurred_at, created_by, is_storno, storno_of_entry_id, notes,
      variety_id, reproduction_id, batch_id_text, batch_class, operation_line_id,
      mass_kg, density_kg_per_l, density_unit, density_source,
      density_verification_status, density_verified_at, unit_source,
      unit_contract_version, warehouse_issue_allocation_id, crop_id, inventory_batch_id
    ) values (
      v_entry.company_id, v_entry.ticket_id, v_entry.processing_id, v_entry.product_id,
      v_entry.warehouse_id,
      case when v_entry.direction::text = 'in'
        then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
      v_entry.quantity, v_entry.uom, -v_entry.delta_qty_signed,
      'storno_' || v_entry.reason_type, v_entry.reason_ref_id, v_entry.batch_id,
      now(), v_actor.id, true, v_entry.id,
      'Исправление талона: ' || v_new.correction_reason,
      v_entry.variety_id, v_entry.reproduction_id, v_entry.batch_id_text,
      v_entry.batch_class, v_entry.operation_line_id, v_entry.mass_kg,
      v_entry.density_kg_per_l, v_entry.density_unit, v_entry.density_source,
      v_entry.density_verification_status, v_entry.density_verified_at,
      v_entry.unit_source, v_entry.unit_contract_version,
      v_entry.warehouse_issue_allocation_id, v_entry.crop_id, v_entry.inventory_batch_id
    );
    if v_entry.inventory_batch_id is not null then
      perform private.reconcile_warehouse_local_batch_balance_v1(v_entry.inventory_batch_id);
    end if;
  end loop;

  update public.tickets
  set is_voided = true,
      status = 'voided',
      voided_by = v_actor.id,
      voided_at = now(),
      void_reason = 'Аннулирован — исправление: ' || v_new.correction_reason,
      replacement_ticket_id = v_new.id,
      correction_completed_at = now(),
      updated_at = now()
  where id = v_old.id;

  update public.tickets
  set harvest_lot_id = coalesce(harvest_lot_id, v_old.harvest_lot_id),
      processing_allocation_ready = false,
      updated_at = now()
  where id = v_new.id;

  perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);

  update public.tickets
  set correction_completed_at = now(),
      finalized_by_person_id = coalesce(p_operator_person_id, finalized_by_person_id),
      updated_at = now()
  where id = v_new.id;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    join public.inventory_batches ib on ib.id = sle.inventory_batch_id
    where sle.ticket_id in (v_old.id, v_new.id)
      and ib.warehouse_id is distinct from sle.warehouse_id
  ) then
    raise exception 'Correction warehouse-local batch postcondition failed';
  end if;
  if exists (
    select 1
    from public.stock_ledger_entries sle
    left join public.harvest_lot_batches hlb
      on hlb.company_id = sle.company_id
     and hlb.inventory_batch_id = sle.inventory_batch_id
     and hlb.harvest_lot_id = v_new.harvest_lot_id
    where sle.ticket_id in (v_old.id, v_new.id)
      and sle.inventory_batch_id is not null
      and hlb.id is null
  ) then
    raise exception 'Correction aggregate lot trace postcondition failed';
  end if;
  if abs(coalesce((
    select sum(sle.delta_qty_signed)
    from public.stock_ledger_entries sle
    where sle.ticket_id in (v_old.id, v_new.id)
  ), 0)) > 0.001 then
    raise exception 'Transfer correction changed total company stock';
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_new.company_id, v_actor.id, 'weighbridge_ticket', v_old.id::text,
    'ticket_replaced',
    jsonb_build_object('ticket_id', v_old.id, 'ticket_no', v_old.ticket_no, 'net_weight_kg', v_old.net_weight_kg),
    jsonb_build_object('ticket_id', v_new.id, 'ticket_no', v_new.ticket_no,
      'net_weight_kg', v_new.net_weight_kg, 'operator_person_id', p_operator_person_id,
      'shift_id', p_shift_id, 'accounting_contract', 'warehouse_local_transfer_v2',
      'lineage', v_lineage),
    v_new.correction_reason
  );
  return v_new.id;
end
$function$;

revoke all on function private.sync_transfer_correction_lineage_v2(uuid, boolean) from public, anon, authenticated;
revoke all on function public.start_weighbridge_ticket_correction_v1(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_weighbridge_ticket_correction_v1(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) to authenticated;

-- Open correction tickets are metadata-only backfilled. Original ticket mass,
-- ledger rows and warehouse balances remain unchanged.
do $repair$
declare
  v_correction_id uuid;
begin
  for v_correction_id in
    select c.id
    from public.tickets c
    join public.tickets o on o.id = c.correction_of_ticket_id
    where o.direction::text = 'transfer'
      and not c.is_finalized
      and not c.is_voided
      and c.status::text not in ('finalized', 'voided')
    order by c.id
  loop
    perform private.sync_transfer_correction_lineage_v2(v_correction_id, true);
  end loop;
end
$repair$;

notify pgrst, 'reload schema';

commit;
