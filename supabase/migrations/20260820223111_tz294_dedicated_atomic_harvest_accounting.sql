begin;

-- TZ294 P0: harvest intake must never pass through the generic finalizer.
-- Accepted weight is written to every accounting object before the ticket is
-- marked finalized, so the harvest trace trigger observes a complete state.
create or replace function public.finalize_harvest_intake_for_session_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_moisture_percent numeric default null,
  p_deduction_kg numeric default null,
  p_deduction_percent numeric default null,
  p_deduction_reason text default null,
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
  v_line public.ticket_lines%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_line_id uuid;
  v_batch_id uuid;
  v_lot_id uuid;
  v_ledger_id uuid;
  v_batch_code text;
  v_gross numeric(14,3);
  v_tare numeric(14,3);
  v_physical numeric(14,3);
  v_deduction numeric(14,3);
  v_deduction_percent numeric(8,4);
  v_accepted numeric(14,3);
  v_previous_tare numeric(14,3);
  v_tare_difference_percent numeric(8,2);
  v_line_count integer;
  v_weighing_count integer;
  v_batch_count integer;
  v_ledger_count integer;
  v_lot_link_count integer;
  v_history_count integer;
  v_tare_at timestamptz := now();
  v_expires timestamptz := now() + interval '24 hours';
begin
  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.status, 'active') = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if v_ticket.op_type <> 'harvest_incoming' then
    raise exception 'Atomic harvest intake finalize is only available for harvest tickets' using errcode = '22023';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company' using errcode = '42501';
  end if;

  select s.* into v_session
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

  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open'
  for update;
  if not found
     or v_session.expires_at <= now()
     or v_shift.last_activity_at + interval '24 hours' <= now() then
    if found then
      update public.weighbridge_shifts
      set status = 'closed',
          closed_at = last_activity_at + interval '24 hours',
          closed_by = null,
          closed_by_person_id = operator_person_id,
          close_reason = 'inactivity_24h'
      where id = v_shift.id and status = 'open';
    end if;
    update private.weighbridge_operator_sessions
    set status = 'expired', revoked_at = now()
    where id = v_session.id;
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  if v_ticket.is_voided or v_ticket.status::text = 'voided' then
    raise exception 'Voided ticket cannot be finalized';
  end if;
  if v_ticket.is_finalized or v_ticket.status::text = 'finalized' then
    return jsonb_build_object(
      'ok', true,
      'ticket_id', v_ticket.id,
      'idempotent_replay', true,
      'physical_net_kg', coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg),
      'explicit_deductions_kg', coalesce(v_ticket.explicit_deductions_kg, 0),
      'accepted_weight_kg', coalesce(v_ticket.accepted_weight_kg, v_ticket.net_weight_kg),
      'batch_id', v_ticket.batch_id,
      'harvest_lot_id', v_ticket.harvest_lot_id
    );
  end if;

  select count(*)::integer, min(tl.id::text)::uuid
  into v_line_count, v_line_id
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id and tl.company_id = v_ticket.company_id;
  if v_line_count <> 1 then
    raise exception 'Harvest ticket must contain exactly one line';
  end if;
  select * into v_line from public.ticket_lines where id = v_line_id for update;
  if public.canonical_stock_uom(v_line.uom) <> 'kg' then
    raise exception 'Harvest intake must use kilogram stock unit';
  end if;

  select count(*)::integer into v_batch_count
  from public.inventory_batches ib
  where ib.company_id = v_ticket.company_id
    and ib.source_ticket_id = p_ticket_id
    and ib.origin_type = 'harvest';
  select count(*)::integer into v_ledger_count
  from public.stock_ledger_entries sle
  where sle.company_id = v_ticket.company_id
    and sle.ticket_id = p_ticket_id
    and not coalesce(sle.is_storno, false);
  select count(*)::integer into v_lot_link_count
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_ticket.company_id
    and hlb.source_ticket_id = p_ticket_id;
  if v_batch_count <> 0 or v_ledger_count <> 0 or v_lot_link_count <> 0
     or v_line.batch_id is not null then
    raise exception 'Atomic harvest finalize requires clean pre-finalize accounting state';
  end if;

  v_gross := v_ticket.gross_weight_kg;
  v_tare := round(p_tare_weight_kg, 3);
  if v_gross is null or v_gross <= 0 then raise exception 'Gross weight must be greater than zero'; end if;
  if v_tare is null or v_tare < 0 then raise exception 'Tare weight must be non-negative'; end if;
  if v_tare >= v_gross then raise exception 'Tare weight cannot equal or exceed gross weight'; end if;
  v_physical := round(v_gross - v_tare, 3);

  if p_deduction_kg is not null and p_deduction_percent is not null then
    raise exception 'Specify deduction either in kg or percent, not both' using errcode = '22023';
  end if;
  if p_deduction_percent is not null then
    if p_deduction_percent < 0 or p_deduction_percent >= 100 then
      raise exception 'Deduction percent must be from 0 to less than 100';
    end if;
    v_deduction := round(v_physical * p_deduction_percent / 100, 3);
  else
    v_deduction := round(coalesce(p_deduction_kg, 0), 3);
  end if;
  if v_deduction < 0 or v_deduction >= v_physical then
    raise exception 'Explicit deduction must be non-negative and less than physical net';
  end if;
  if v_deduction > 0 and nullif(btrim(coalesce(p_deduction_reason, '')), '') is null then
    raise exception 'Deduction reason is required';
  end if;
  v_deduction_percent := case when v_physical > 0 then round(v_deduction / v_physical * 100, 4) else 0 end;
  v_accepted := round(v_physical - v_deduction, 3);
  if v_accepted <= 0 then raise exception 'Accepted weight must be greater than zero'; end if;
  if p_moisture_percent is not null
     and (p_moisture_percent < 0 or p_moisture_percent > 100) then
    raise exception 'Moisture must be from 0 to 100 percent';
  end if;

  perform public.validate_stock_quantity_contract(
    v_line.product_id, v_accepted, 'kg', 'commodity', v_accepted,
    null, null, null, null, null
  );

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
      v_tare_difference_percent := round(((v_tare - v_previous_tare) / v_previous_tare) * 100, 2);
      if abs(v_tare_difference_percent) >= 20 and not p_tare_variance_confirmed then
        return jsonb_build_object(
          'ok', false,
          'requires_confirmation', true,
          'code', 'tare_variance_confirmation_required',
          'previous_tare_kg', v_previous_tare,
          'current_tare_kg', v_tare,
          'difference_percent', v_tare_difference_percent
        );
      end if;
    end if;
  end if;

  if not exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id
      and tw.company_id = v_ticket.company_id
      and tw.weighing_no = 1
      and abs(tw.measured_weight_kg - v_gross) <= 0.001
  ) then
    raise exception 'Gross weighing event is missing or does not match ticket gross';
  end if;

  update public.tickets
  set tare_weight_kg = v_tare,
      net_weight_kg = v_accepted,
      physical_net_kg = v_physical,
      explicit_deductions_kg = v_deduction,
      accepted_weight_kg = v_accepted,
      status = 'ready_to_close',
      finalized_by_person_id = v_session.person_id,
      weighing_2_at = v_tare_at,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake_finalize', jsonb_build_object(
          'contract_version', 'tz294_atomic_v2',
          'idempotency_key', nullif(btrim(coalesce(p_idempotency_key, '')), ''),
          'physical_net_kg', v_physical,
          'explicit_deductions_kg', v_deduction,
          'accepted_weight_kg', v_accepted,
          'deduction_reason', nullif(btrim(coalesce(p_deduction_reason, '')), ''),
          'operator_person_id', v_session.person_id,
          'shift_id', v_shift.id,
          'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false)
        )
      ),
      updated_at = now()
  where id = p_ticket_id;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
  ) values (
    p_ticket_id, v_ticket.company_id, 2, v_tare, v_tare_at, 'manual',
    v_actor.id, v_session.person_id, v_shift.id,
    case when coalesce(p_tare_variance_confirmed, false)
      then 'Необычная тара подтверждена оператором'
      else 'Финальное взвешивание тары'
    end
  ) on conflict (ticket_id, weighing_no) do update set
    measured_weight_kg = excluded.measured_weight_kg,
    measured_at = excluded.measured_at,
    device_source = excluded.device_source,
    operator_user_id = excluded.operator_user_id,
    operator_person_id = excluded.operator_person_id,
    weighbridge_shift_id = excluded.weighbridge_shift_id,
    comment = excluded.comment;

  update public.ticket_lines
  set quantity = v_accepted,
      quantity_kg = v_accepted,
      mass_kg = v_accepted,
      net_line_weight_kg = v_accepted,
      moisture_percent = p_moisture_percent,
      dirt_tare_percent = v_deduction_percent,
      batch_class = 'commodity',
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake', jsonb_build_object(
          'contract_version', 'tz294_atomic_v2',
          'physical_net_kg', v_physical,
          'explicit_deductions_kg', v_deduction,
          'explicit_deductions_percent', v_deduction_percent,
          'accepted_weight_kg', v_accepted,
          'deduction_reason', nullif(btrim(coalesce(p_deduction_reason, '')), '')
        )
      ),
      updated_at = now()
  where id = v_line.id;

  v_batch_code := coalesce(
    nullif(trim(v_line.lot_id), ''),
    'HAR-' || to_char(v_ticket.created_at, 'YYYYMMDDHH24MISS') || '-' || left(v_line.id::text, 8)
  );
  insert into public.inventory_batches (
    company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
    source_field_id, source_ticket_id, batch_code, status, batch_class,
    origin_type, origin_ref_id, initial_weight_kg, current_weight_kg,
    moisture_percent, treatment_status, initial_quantity, current_quantity,
    uom, mass_kg, unit_source, unit_contract_version, warehouse_id, received_at
  ) values (
    v_ticket.company_id, v_ticket.season_id, v_line.product_id, v_line.crop_id,
    v_line.variety_id, v_line.reproduction_id, v_ticket.field_id, v_ticket.id,
    v_batch_code, 'commodity', 'commodity', 'harvest', v_ticket.id,
    v_accepted, v_accepted, p_moisture_percent, 'not_applicable',
    v_accepted, v_accepted, 'kg', v_accepted, 'weighbridge_atomic_harvest', 2,
    v_ticket.warehouse_to_id, v_tare_at
  ) returning id into v_batch_id;

  v_lot_id := public.ensure_harvest_lot_for_batch_v1(v_batch_id);
  if v_lot_id is null then
    raise exception 'Harvest aggregate lot was not created';
  end if;

  update public.ticket_lines
  set batch_id = v_batch_id::text,
      lot_id = v_batch_code,
      batch_class = 'commodity',
      updated_at = now()
  where id = v_line.id;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    batch_id, batch_id_text, batch_class, inventory_batch_id, warehouse_id,
    direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
    occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
  ) values (
    v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.crop_id,
    v_line.variety_id, v_line.reproduction_id, v_batch_id::text,
    v_batch_id::text, 'commodity', v_batch_id, v_ticket.warehouse_to_id,
    'in', v_accepted, 'kg', v_accepted, 'harvest_incoming_in', v_ticket.id,
    v_tare_at, v_actor.id, v_ticket.notes, v_accepted,
    'weighbridge_atomic_harvest', 2
  ) returning id into v_ledger_id;

  perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);

  update public.tickets
  set batch_id = v_batch_id,
      lot_id = v_batch_code,
      harvest_lot_id = v_lot_id,
      net_weight_kg = v_accepted,
      physical_net_kg = v_physical,
      explicit_deductions_kg = v_deduction,
      accepted_weight_kg = v_accepted,
      is_finalized = true,
      status = 'finalized',
      closed_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      finalized_at = v_tare_at,
      updated_at = now()
  where id = p_ticket_id;

  select count(*)::integer into v_weighing_count
  from public.ticket_weighings
  where company_id = v_ticket.company_id and ticket_id = p_ticket_id;
  if v_weighing_count <> 2 or not exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id and tw.weighing_no = 2
      and abs(tw.measured_weight_kg - v_tare) <= 0.001
  ) then
    raise exception 'Finalized harvest must have exactly two matching weighing events';
  end if;

  select count(*)::integer into v_batch_count
  from public.inventory_batches ib
  where ib.company_id = v_ticket.company_id
    and ib.source_ticket_id = p_ticket_id
    and ib.origin_type = 'harvest'
    and abs(ib.initial_weight_kg - v_accepted) <= 0.001
    and abs(ib.current_weight_kg - v_accepted) <= 0.001
    and abs(ib.initial_quantity - v_accepted) <= 0.001
    and abs(ib.current_quantity - v_accepted) <= 0.001
    and abs(ib.mass_kg - v_accepted) <= 0.001;
  if v_batch_count <> 1 then raise exception 'Harvest batch accounting postcondition failed'; end if;

  select count(*)::integer into v_ledger_count
  from public.stock_ledger_entries sle
  where sle.company_id = v_ticket.company_id
    and sle.ticket_id = p_ticket_id
    and sle.direction::text = 'in'
    and not coalesce(sle.is_storno, false)
    and sle.id = v_ledger_id
    and sle.inventory_batch_id = v_batch_id
    and abs(sle.quantity - v_accepted) <= 0.001
    and abs(sle.delta_qty_signed - v_accepted) <= 0.001
    and abs(sle.mass_kg - v_accepted) <= 0.001;
  if v_ledger_count <> 1 then raise exception 'Harvest ledger accounting postcondition failed'; end if;

  select count(*)::integer into v_lot_link_count
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_ticket.company_id
    and hlb.harvest_lot_id = v_lot_id
    and hlb.inventory_batch_id = v_batch_id
    and hlb.source_ticket_id = p_ticket_id;
  if v_lot_link_count <> 1 then raise exception 'Harvest lot link postcondition failed'; end if;

  if not exists (
    select 1 from public.ticket_lines tl
    where tl.id = v_line.id
      and abs(tl.quantity - v_accepted) <= 0.001
      and abs(tl.quantity_kg - v_accepted) <= 0.001
      and abs(tl.mass_kg - v_accepted) <= 0.001
      and abs(tl.net_line_weight_kg - v_accepted) <= 0.001
      and tl.batch_id = v_batch_id::text
  ) then
    raise exception 'Harvest ticket line accounting postcondition failed';
  end if;

  select count(*)::integer into v_history_count
  from public.field_history_entries fhe
  where fhe.company_id = v_ticket.company_id
    and fhe.harvest_ticket_id = p_ticket_id
    and fhe.source = 'weighbridge_harvest';
  if v_history_count <> 1 then raise exception 'Harvest field trace postcondition failed'; end if;

  select * into v_batch from public.inventory_batches where id = v_batch_id;
  update public.weighbridge_shifts
  set last_activity_at = now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = v_expires, last_seen_at = now()
  where id = v_session.id and status = 'active';

  return jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'idempotent_replay', false,
    'physical_net_kg', v_physical,
    'explicit_deductions_kg', v_deduction,
    'explicit_deductions_percent', v_deduction_percent,
    'accepted_weight_kg', v_accepted,
    'batch_id', v_batch.id,
    'harvest_lot_id', v_lot_id,
    'ledger_id', v_ledger_id,
    'weighing_count', v_weighing_count,
    'ledger_count', v_ledger_count,
    'lot_link_count', v_lot_link_count,
    'operator_person_id', v_session.person_id,
    'shift_id', v_shift.id
  );
end
$function$;

revoke all on function public.finalize_harvest_intake_for_session_v1(
  uuid, text, numeric, numeric, numeric, numeric, text, boolean, text
) from public, anon;
grant execute on function public.finalize_harvest_intake_for_session_v1(
  uuid, text, numeric, numeric, numeric, numeric, text, boolean, text
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
