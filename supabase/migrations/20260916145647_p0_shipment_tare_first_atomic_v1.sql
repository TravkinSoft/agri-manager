-- P0 shipment contract:
--   1) the empty vehicle is weighed first (tare);
--   2) the loaded vehicle is weighed second (gross);
--   3) actual net, the exact stock line and the ledger debit commit atomically.

create or replace function public.close_shipment_ticket_atomic_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_gross_weight_kg numeric,
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
  v_gross numeric(14,3);
  v_tare numeric(14,3);
  v_net numeric(14,3);
  v_line_count integer;
  v_weighing_count integer;
  v_line_total numeric(18,6);
  v_out_total numeric(18,6);
begin
  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and coalesce(status, 'active') = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin', 'weighman') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company' using errcode = '42501';
  end if;
  if v_ticket.op_type <> 'shipment_outbound'
     or v_ticket.direction::text <> 'outgoing'
     or coalesce(v_ticket.weigh_method::text, '') = 'manual_override_with_reason'
     or v_ticket.correction_of_ticket_id is not null then
    raise exception 'Atomic shipment close is unavailable for this ticket' using errcode = '22023';
  end if;

  select * into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = v_ticket.company_id
    and s.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.status = 'active'
  order by s.created_at desc
  limit 1
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'shift_expired'); end if;

  select * into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open'
  for update;
  if not found or v_session.expires_at <= now() or v_shift.last_activity_at + interval '24 hours' <= now() then
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
      'gross_weight_kg', v_ticket.gross_weight_kg,
      'tare_weight_kg', v_ticket.tare_weight_kg,
      'physical_net_kg', coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg)
    );
  end if;

  v_tare := round(v_ticket.tare_weight_kg, 3);
  v_gross := round(p_gross_weight_kg, 3);
  if v_tare is null or v_tare <= 0 then raise exception 'Tare weight must be greater than zero'; end if;
  if v_gross is null or v_gross <= 0 then raise exception 'Gross weight must be greater than zero'; end if;
  if v_gross <= v_tare then raise exception 'Gross weight must be greater than tare weight'; end if;
  v_net := round(v_gross - v_tare, 3);

  select count(*) into v_line_count
  from public.ticket_lines
  where ticket_id = v_ticket.id;
  if v_line_count <> 1 then
    raise exception 'Shipment ticket must contain exactly one stock identity';
  end if;

  if not exists (
    select 1
    from public.ticket_weighings tw
    where tw.ticket_id = v_ticket.id
      and tw.weighing_no = 1
      and abs(tw.measured_weight_kg - v_tare) <= 0.001
  ) then
    raise exception 'First shipment weighing must match ticket tare';
  end if;

  insert into public.ticket_weighings(
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment
  ) values (
    v_ticket.id, v_ticket.company_id, 2, v_gross, now(),
    'manual', v_actor.id, v_session.person_id, v_shift.id,
    'Второе взвешивание отгрузки: брутто загруженной машины'
  )
  on conflict (ticket_id, weighing_no) do update set
    measured_weight_kg = excluded.measured_weight_kg,
    measured_at = excluded.measured_at,
    device_source = excluded.device_source,
    operator_user_id = excluded.operator_user_id,
    operator_person_id = excluded.operator_person_id,
    weighbridge_shift_id = excluded.weighbridge_shift_id,
    comment = excluded.comment;

  update public.tickets
  set gross_weight_kg = v_gross,
      net_weight_kg = v_net,
      physical_net_kg = v_net,
      accepted_weight_kg = v_net,
      explicit_deductions_kg = 0,
      status = 'ready_to_close',
      finalized_by_person_id = v_session.person_id,
      weighing_2_at = now(),
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'atomic_shipment_close', jsonb_build_object(
          'contract_version', 'p0_shipment_tare_first_v1',
          'idempotency_key', nullif(btrim(coalesce(p_idempotency_key, '')), ''),
          'gross_weight_kg', v_gross,
          'tare_weight_kg', v_tare,
          'physical_net_kg', v_net,
          'operator_person_id', v_session.person_id,
          'shift_id', v_shift.id
        )
      ),
      updated_at = now()
  where id = v_ticket.id;

  update public.ticket_lines
  set quantity = v_net,
      quantity_kg = v_net,
      mass_kg = v_net,
      net_line_weight_kg = v_net,
      updated_at = now()
  where ticket_id = v_ticket.id;

  perform public.finalize_weighbridge_ticket_for_session_v1(v_ticket.id);
  update public.tickets
  set finalized_by_person_id = v_session.person_id
  where id = v_ticket.id;
  update public.weighbridge_shifts
  set last_activity_at = now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = now() + interval '24 hours',
      last_seen_at = now()
  where id = v_session.id and status = 'active';

  select count(*) into v_weighing_count
  from public.ticket_weighings
  where ticket_id = v_ticket.id;
  select round(coalesce(sum(quantity_kg), 0), 6) into v_line_total
  from public.ticket_lines
  where ticket_id = v_ticket.id;
  select round(coalesce(sum(abs(delta_qty_signed)), 0), 6) into v_out_total
  from public.stock_ledger_entries
  where ticket_id = v_ticket.id
    and direction::text = 'out'
    and not coalesce(is_storno, false);

  if v_weighing_count <> 2
     or abs(v_line_total - v_net) > 0.001
     or abs(v_out_total - v_net) > 0.001
     or not exists (
       select 1 from public.tickets t
       where t.id = v_ticket.id
         and t.status::text = 'finalized'
         and coalesce(t.is_finalized, false)
         and not coalesce(t.is_voided, false)
     ) then
    raise exception 'Atomic shipment close postcondition failed';
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'idempotent_replay', false,
    'gross_weight_kg', v_gross,
    'tare_weight_kg', v_tare,
    'physical_net_kg', v_net,
    'weighing_count', v_weighing_count,
    'line_total_kg', v_line_total,
    'out_total_kg', v_out_total,
    'operator_person_id', v_session.person_id,
    'shift_id', v_shift.id
  );
end
$function$;

revoke all on function public.close_shipment_ticket_atomic_v1(uuid, text, numeric, text)
  from public, anon;
grant execute on function public.close_shipment_ticket_atomic_v1(uuid, text, numeric, text)
  to authenticated, service_role;

comment on function public.close_shipment_ticket_atomic_v1(uuid, text, numeric, text)
  is 'Closes one tare-first outbound shipment and commits actual net plus exact stock debit atomically.';
