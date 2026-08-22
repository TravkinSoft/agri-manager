-- TZ297 QA P0 #4: processing outputs consume transformation WIP, not warehouse stock.

create or replace function public.close_processing_output_ticket_atomic_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_moisture_percent numeric default null,
  p_tare_variance_confirmed boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_actor public.profiles%rowtype;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_ticket public.tickets%rowtype;
  v_transformation public.batch_transformations%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_destination public.warehouses%rowtype;
  v_line public.ticket_lines%rowtype;
  v_source_batch public.inventory_batches%rowtype;
  v_destination_batch public.inventory_batches%rowtype;
  v_role text;
  v_line_type text;
  v_output_type text;
  v_batch_class text;
  v_batch_status text;
  v_physical_state text;
  v_gross numeric(18,3);
  v_tare numeric(18,3);
  v_net numeric(18,3);
  v_previous_tare numeric(18,3);
  v_difference numeric(8,2);
  v_input_kg numeric(18,3);
  v_stock_output_kg numeric(18,3);
  v_approved_loss_kg numeric(18,3);
  v_remaining_before numeric(18,3);
  v_remaining_after numeric(18,3);
  v_weighing_count integer;
  v_line_count integer;
  v_output_count integer;
  v_out_count integer;
  v_in_count integer;
  v_line_total numeric(18,3);
  v_in_total numeric(18,3);
  v_batch_code text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and coalesce(status, 'active') = 'active';

  if not found or v_actor.role not in ('global_admin','company_admin','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company' using errcode = '42501';
  end if;

  v_role := upper(coalesce(v_ticket.processing_output_role, ''));
  if v_ticket.direction::text <> 'transfer'
     or v_ticket.op_type <> 'warehouse_transfer'
     or v_ticket.linked_processing_id is null
     or v_role not in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
     or coalesce(v_ticket.weigh_method::text, '') = 'manual_override_with_reason'
     or v_ticket.correction_of_ticket_id is not null
  then
    raise exception 'Processing output ticket contract is invalid' using errcode = '22023';
  end if;
  if v_ticket.warehouse_from_id is null or v_ticket.warehouse_to_id is null then
    raise exception 'Укажите, куда будет доставлен выход обработки.' using errcode = '22023';
  end if;
  if v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
    raise exception 'Место назначения должно отличаться от источника обработки.' using errcode = '22023';
  end if;

  select * into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = v_ticket.company_id
    and s.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.status = 'active'
  order by s.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  select * into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open'
  for update;

  if not found or v_session.expires_at <= now() or v_shift.last_activity_at + interval '24 hours' <= now() then
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if coalesce(v_ticket.is_voided, false) or v_ticket.status::text = 'voided' then
    raise exception 'Voided ticket cannot be finalized';
  end if;
  if coalesce(v_ticket.is_finalized, false) or v_ticket.status::text = 'finalized' then
    select count(*), round(coalesce(sum(abs(delta_qty_signed)), 0), 3)
    into v_in_count, v_in_total
    from public.stock_ledger_entries
    where ticket_id = v_ticket.id
      and company_id = v_ticket.company_id
      and direction::text = 'in'
      and not coalesce(is_storno, false);

    return jsonb_build_object(
      'ok', true,
      'ticket_id', v_ticket.id,
      'idempotent_replay', true,
      'processing_output', true,
      'physical_net_kg', coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg),
      'ledger_in_count', v_in_count,
      'ledger_in_kg', v_in_total
    );
  end if;

  select * into v_transformation
  from public.batch_transformations
  where id = v_ticket.linked_processing_id
    and company_id = v_ticket.company_id
  for update;

  if not found
     or v_transformation.node_warehouse_id is distinct from v_ticket.warehouse_from_id
     or v_transformation.harvest_lot_id is null
     or v_transformation.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or v_transformation.season_id is null
     or v_transformation.processing_state not in ('in_processing','processing_pending_outputs')
     or v_transformation.status = 'voided'
     or v_transformation.closed_at is not null
  then
    raise exception 'Контекст обработки больше не доступен. Обновите карточку обработки.' using errcode = '40001';
  end if;

  select * into v_lot
  from public.harvest_lots
  where id = v_transformation.harvest_lot_id
    and company_id = v_ticket.company_id
    and season_id = v_transformation.season_id
    and status = 'active'
  for update;

  if not found or not exists (
    select 1 from public.seasons s
    where s.id = v_transformation.season_id
      and s.company_id = v_ticket.company_id
      and not coalesce(s.archived, false)
  ) then
    raise exception 'Сезон или партия обработки больше не активны.' using errcode = '40001';
  end if;

  select * into v_destination
  from public.warehouses
  where id = v_ticket.warehouse_to_id
    and company_id = v_ticket.company_id
    and not coalesce(archived, false)
    and not coalesce(is_archived, false)
  for update;

  if not found then
    raise exception 'Выберите активное место назначения выхода обработки.' using errcode = '22023';
  end if;

  perform 1 from public.batch_transformation_inputs
  where company_id = v_ticket.company_id and transformation_id = v_transformation.id
  for update;
  perform 1 from public.batch_transformation_outputs
  where company_id = v_ticket.company_id and transformation_id = v_transformation.id
  for update;
  perform 1 from public.batch_transformation_losses
  where company_id = v_ticket.company_id and transformation_id = v_transformation.id
  for update;

  select round(coalesce(sum(input_weight_kg), 0), 3)
  into v_input_kg
  from public.batch_transformation_inputs
  where company_id = v_ticket.company_id
    and transformation_id = v_transformation.id;

  select round(coalesce(sum(output_weight_kg) filter (
    where output_type in ('main_product','byproduct','stock_waste')
  ), 0), 3)
  into v_stock_output_kg
  from public.batch_transformation_outputs
  where company_id = v_ticket.company_id
    and transformation_id = v_transformation.id;

  select round(coalesce(sum(qty_kg) filter (
    where loss_type = 'moisture_loss' or (approved_by is not null and approved_at is not null)
  ), 0), 3)
  into v_approved_loss_kg
  from public.batch_transformation_losses
  where company_id = v_ticket.company_id
    and transformation_id = v_transformation.id;

  v_remaining_before := round(greatest(v_input_kg - v_stock_output_kg - v_approved_loss_kg, 0), 3);
  if v_remaining_before <= 0 then
    raise exception 'Нераспределённого остатка обработки больше нет.' using errcode = '22023';
  end if;

  select ib.* into v_source_batch
  from public.batch_transformation_inputs bti
  join public.inventory_batches ib on ib.id = bti.batch_id
  where bti.company_id = v_ticket.company_id
    and bti.transformation_id = v_transformation.id
    and ib.company_id = v_ticket.company_id
  order by bti.created_at, bti.id
  limit 1
  for update of ib;

  if not found or v_source_batch.product_id is null then
    raise exception 'Не удалось определить номенклатуру сырья обработки.' using errcode = '22023';
  end if;

  select * into v_line
  from public.ticket_lines
  where ticket_id = v_ticket.id
    and company_id = v_ticket.company_id
  order by id
  limit 1
  for update;

  if not found or exists (
    select 1 from public.ticket_lines
    where ticket_id = v_ticket.id and company_id = v_ticket.company_id and id <> v_line.id
  ) then
    raise exception 'Processing output ticket must contain exactly one line' using errcode = '22023';
  end if;

  v_gross := round(v_ticket.gross_weight_kg, 3);
  v_tare := round(p_tare_weight_kg, 3);
  if v_gross is null or v_gross <= 0 then raise exception 'Gross weight must be greater than zero'; end if;
  if v_tare is null or v_tare <= 0 then raise exception 'Tare weight must be greater than zero'; end if;
  if v_tare >= v_gross then raise exception 'Tare weight cannot equal or exceed gross weight'; end if;
  if p_moisture_percent is not null and (p_moisture_percent <= 0 or p_moisture_percent >= 100) then
    raise exception 'Moisture must be greater than 0 and less than 100 percent' using errcode = '22023';
  end if;
  v_net := round(v_gross - v_tare, 3);

  if v_net > v_remaining_before + 0.001 then
    raise exception 'PROCESSING_OUTPUT_EXCEEDS_BALANCE|%|%', v_remaining_before, v_net using errcode = '22023';
  end if;

  if v_ticket.vehicle_id is not null then
    select t.tare_weight_kg into v_previous_tare
    from public.tickets t
    where t.company_id = v_ticket.company_id
      and t.vehicle_id = v_ticket.vehicle_id
      and t.id <> v_ticket.id
      and t.status::text = 'finalized'
      and coalesce(t.is_finalized, false)
      and not coalesce(t.is_voided, false)
      and t.tare_weight_kg > 0
    order by t.finalized_at desc nulls last, t.updated_at desc
    limit 1;

    if v_previous_tare is not null then
      v_difference := round(((v_tare - v_previous_tare) / v_previous_tare) * 100, 2);
      if abs(v_difference) >= 20 and not p_tare_variance_confirmed then
        return jsonb_build_object(
          'ok', false,
          'requires_confirmation', true,
          'code', 'tare_variance_confirmation_required',
          'previous_tare_kg', v_previous_tare,
          'current_tare_kg', v_tare,
          'difference_percent', v_difference
        );
      end if;
    end if;
  end if;

  insert into public.ticket_weighings(
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
  ) values (
    v_ticket.id, v_ticket.company_id, 1, v_gross, coalesce(v_ticket.weighing_1_at, v_ticket.created_at),
    'ticket_snapshot', v_actor.id, v_session.person_id, v_shift.id, 'Фактическое взвешивание брутто'
  ) on conflict (ticket_id, weighing_no) do nothing;

  if not exists (
    select 1 from public.ticket_weighings
    where ticket_id = v_ticket.id and weighing_no = 1 and abs(measured_weight_kg - v_gross) <= 0.001
  ) then
    raise exception 'Gross weighing event does not match ticket gross';
  end if;

  insert into public.ticket_weighings(
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
  ) values (
    v_ticket.id, v_ticket.company_id, 2, v_tare, now(), 'manual', v_actor.id,
    v_session.person_id, v_shift.id, 'Финальное взвешивание тары'
  ) on conflict (ticket_id, weighing_no) do update set
    measured_weight_kg = excluded.measured_weight_kg,
    measured_at = excluded.measured_at,
    device_source = excluded.device_source,
    operator_user_id = excluded.operator_user_id,
    operator_person_id = excluded.operator_person_id,
    weighbridge_shift_id = excluded.weighbridge_shift_id,
    comment = excluded.comment;

  v_line_type := case
    when v_role = 'GRAIN' then 'commodity'
    when v_role in ('SCREENINGS','FEED') then 'forage_fraction'
    else 'waste_fraction'
  end;
  v_output_type := case
    when v_role = 'GRAIN' then 'main_product'
    when v_role in ('SCREENINGS','FEED') then 'byproduct'
    else 'stock_waste'
  end;
  v_batch_class := case when v_role = 'GRAIN' then 'commodity' when v_role = 'FEED' then 'feed' else 'waste' end;
  v_batch_status := case when v_role = 'GRAIN' then 'commodity' when v_role = 'FEED' then 'forage' else 'waste' end;
  v_physical_state := case
    when v_role = 'GRAIN' and v_transformation.transformation_type = 'drying' then 'AFTER_DRYING'
    when v_role = 'GRAIN' then 'AFTER_CLEANING'
    when v_role in ('SCREENINGS','FEED') then 'SCREENINGS'
    when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'
    else 'OTHER'
  end;
  v_batch_code := 'PROC-' || left(replace(v_transformation.id::text, '-', ''), 8)
    || '-' || left(replace(v_ticket.id::text, '-', ''), 8) || '-' || v_role;

  if exists (
    select 1 from public.batch_transformation_outputs
    where company_id = v_ticket.company_id and source_ticket_id = v_ticket.id
  ) or exists (
    select 1 from public.stock_ledger_entries
    where company_id = v_ticket.company_id and ticket_id = v_ticket.id and not coalesce(is_storno, false)
  ) then
    raise exception 'Partial processing output accounting state detected';
  end if;

  insert into public.inventory_batches(
    company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
    source_field_id, source_ticket_id, harvest_year, batch_code, status,
    initial_weight_kg, current_weight_kg, moisture_percent, quality_json,
    batch_class, parent_batch_id, source_transformation_id, origin_type, origin_ref_id,
    initial_quantity, current_quantity, uom, mass_kg, unit_source, unit_contract_version,
    crop_structure_id, harvesting_operation_id, warehouse_id, received_at, source_type,
    composition_snapshot, composition_hash, display_name, is_mixed_harvest, physical_state
  ) values (
    v_ticket.company_id, v_transformation.season_id, v_source_batch.product_id,
    coalesce(v_lot.crop_id, v_source_batch.crop_id),
    coalesce(v_lot.variety_id, v_source_batch.variety_id),
    coalesce(v_lot.reproduction_id, v_source_batch.reproduction_id),
    v_source_batch.source_field_id, v_ticket.id, v_source_batch.harvest_year, v_batch_code, v_batch_status,
    v_net, v_net, p_moisture_percent,
    coalesce(v_source_batch.quality_json, '{}'::jsonb) || jsonb_build_object(
      'processing_output', jsonb_build_object(
        'contract_version', 'tz297_wip_source_v1',
        'transformation_id', v_transformation.id,
        'source_ticket_id', v_ticket.id,
        'output_role', v_role,
        'destination_warehouse_id', v_destination.id
      )
    ),
    v_batch_class, v_source_batch.id, v_transformation.id, 'processing', v_transformation.id,
    v_net, v_net, 'kg', v_net, 'processing.output_net_weight', 2,
    v_source_batch.crop_structure_id, v_source_batch.harvesting_operation_id, v_destination.id,
    now(), 'processing_output', coalesce(v_source_batch.composition_snapshot, '[]'::jsonb),
    coalesce(v_source_batch.composition_hash, v_lot.composition_hash),
    coalesce(nullif(v_source_batch.display_name, ''), v_source_batch.batch_code) || ' · ' || v_role,
    coalesce(v_source_batch.is_mixed_harvest, false), v_physical_state
  ) returning * into v_destination_batch;

  insert into public.harvest_lot_batches(
    company_id, harvest_lot_id, inventory_batch_id, source_ticket_id,
    crop_structure_id, assigned_by, assignment_reason
  ) values (
    v_ticket.company_id, v_lot.id, v_destination_batch.id, v_ticket.id,
    v_destination_batch.crop_structure_id, v_actor.id, 'processing_output'
  );

  update public.ticket_lines
  set product_id = v_destination_batch.product_id,
      crop_id = v_destination_batch.crop_id,
      variety_id = v_destination_batch.variety_id,
      reproduction_id = v_destination_batch.reproduction_id,
      batch_id = null,
      lot_id = v_lot.id::text,
      warehouse_from_id = v_transformation.node_warehouse_id,
      warehouse_to_id = v_destination.id,
      quantity = v_net,
      quantity_kg = v_net,
      mass_kg = v_net,
      gross_line_weight_kg = v_gross,
      tare_line_weight_kg = v_tare,
      net_line_weight_kg = v_net,
      moisture_percent = p_moisture_percent,
      batch_class = v_batch_class,
      line_type = v_line_type,
      destination_batch_id = v_destination_batch.id,
      unit_source = 'processing.output_net_weight',
      unit_contract_version = 2,
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'processing_output_role', v_role,
        'processing_transformation_id', v_transformation.id
      ),
      updated_at = now()
  where id = v_line.id;

  insert into public.stock_ledger_entries(
    company_id, ticket_id, processing_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
    batch_id, batch_id_text, batch_class, occurred_at, created_by, notes,
    mass_kg, unit_source, unit_contract_version, inventory_batch_id
  ) values (
    v_ticket.company_id, v_ticket.id, v_transformation.id, v_destination_batch.product_id,
    v_destination_batch.crop_id, v_destination_batch.variety_id, v_destination_batch.reproduction_id,
    v_destination.id, 'in', v_net, 'kg', v_net, 'processing_output_in', v_ticket.id,
    v_destination_batch.id::text, v_destination_batch.id::text, v_batch_class, now(), v_actor.id,
    'Фактический выход обработки: ' || v_role, v_net, 'processing.output_net_weight', 2,
    v_destination_batch.id
  );

  insert into public.batch_transformation_outputs(
    company_id, transformation_id, output_batch_id, warehouse_to_id, line_type,
    output_weight_kg, output_quality_json, batch_class, source_ticket_id,
    moisture_percent, output_role, is_projected_child, physical_state, output_type, activated_at
  ) values (
    v_ticket.company_id, v_transformation.id, v_destination_batch.id, v_destination.id, v_line_type,
    v_net, jsonb_build_object(
      'source', 'weighbridge_processing_output',
      'contract_version', 'tz297_wip_source_v1',
      'ticket_id', v_ticket.id,
      'destination_warehouse_id', v_destination.id
    ), v_batch_class, v_ticket.id, p_moisture_percent, v_role, false, v_physical_state, v_output_type, now()
  );

  update public.tickets
  set batch_id = null,
      harvest_lot_id = v_lot.id,
      season_id = v_transformation.season_id,
      source_kind = 'processing_wip',
      source_id = v_transformation.id::text,
      destination_kind = 'warehouse',
      destination_id = v_destination.id::text,
      tare_weight_kg = v_tare,
      net_weight_kg = v_net,
      physical_net_kg = v_net,
      accepted_weight_kg = v_net,
      explicit_deductions_kg = 0,
      status = 'finalized',
      is_finalized = true,
      closed_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      weighing_2_at = now(),
      finalized_at = now(),
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'processing_output_close', jsonb_build_object(
          'contract_version', 'tz297_wip_source_v1',
          'idempotency_key', nullif(btrim(coalesce(p_idempotency_key, '')), ''),
          'transformation_id', v_transformation.id,
          'remaining_before_kg', v_remaining_before,
          'physical_net_kg', v_net,
          'destination_warehouse_id', v_destination.id,
          'destination_batch_id', v_destination_batch.id,
          'operator_person_id', v_session.person_id,
          'shift_id', v_shift.id
        )
      ),
      updated_at = now()
  where id = v_ticket.id;

  update public.batch_transformations
  set last_output_ticket_id = v_ticket.id,
      last_main_output_ticket_id = case when v_role = 'GRAIN' then v_ticket.id else last_main_output_ticket_id end,
      updated_at = now()
  where id = v_transformation.id;

  update public.weighbridge_shifts
  set last_activity_at = now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = now() + interval '24 hours', last_seen_at = now()
  where id = v_session.id and status = 'active';

  perform public.recompute_grain_processing_shadow_v1(v_transformation.id);
  perform private.reconcile_warehouse_local_batch_balance_v1(v_destination_batch.id);

  select count(*) into v_weighing_count from public.ticket_weighings where ticket_id = v_ticket.id;
  select count(*), round(coalesce(sum(quantity_kg), 0), 3)
  into v_line_count, v_line_total from public.ticket_lines where ticket_id = v_ticket.id;
  select count(*) into v_out_count from public.stock_ledger_entries
  where ticket_id = v_ticket.id and company_id = v_ticket.company_id
    and direction::text = 'out' and not coalesce(is_storno, false);
  select count(*), round(coalesce(sum(abs(delta_qty_signed)), 0), 3)
  into v_in_count, v_in_total from public.stock_ledger_entries
  where ticket_id = v_ticket.id and company_id = v_ticket.company_id
    and direction::text = 'in' and warehouse_id = v_destination.id
    and inventory_batch_id = v_destination_batch.id and not coalesce(is_storno, false);
  select count(*) into v_output_count from public.batch_transformation_outputs
  where company_id = v_ticket.company_id and transformation_id = v_transformation.id
    and source_ticket_id = v_ticket.id and output_batch_id = v_destination_batch.id;

  if v_weighing_count <> 2
     or v_line_count <> 1
     or abs(v_line_total - v_net) > 0.001
     or v_out_count <> 0
     or v_in_count <> 1
     or abs(v_in_total - v_net) > 0.001
     or v_output_count <> 1
  then
    raise exception 'Atomic processing output close postcondition failed';
  end if;

  select round(coalesce(sum(output_weight_kg) filter (
    where output_type in ('main_product','byproduct','stock_waste')
  ), 0), 3)
  into v_stock_output_kg
  from public.batch_transformation_outputs
  where company_id = v_ticket.company_id and transformation_id = v_transformation.id;
  v_remaining_after := round(greatest(v_input_kg - v_stock_output_kg - v_approved_loss_kg, 0), 3);

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'idempotent_replay', false,
    'processing_output', true,
    'processing_id', v_transformation.id,
    'output_role', v_role,
    'physical_net_kg', v_net,
    'weighing_count', v_weighing_count,
    'line_total_kg', v_line_total,
    'ledger_out_count', v_out_count,
    'ledger_in_count', v_in_count,
    'ledger_in_kg', v_in_total,
    'destination_warehouse_id', v_destination.id,
    'destination_batch_id', v_destination_batch.id,
    'remaining_before_kg', v_remaining_before,
    'unallocated_kg', v_remaining_after,
    'operator_person_id', v_session.person_id,
    'shift_id', v_shift.id
  );
end
$function$;

revoke all on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)
  from public, anon;
grant execute on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)
  to authenticated, service_role;
