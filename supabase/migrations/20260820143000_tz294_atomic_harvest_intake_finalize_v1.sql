begin;

alter table public.tickets
  add column if not exists physical_net_kg numeric(14,3),
  add column if not exists explicit_deductions_kg numeric(14,3),
  add column if not exists accepted_weight_kg numeric(14,3);

comment on column public.tickets.physical_net_kg is
  'TZ294 physical net: gross_weight_kg - tare_weight_kg before explicit deductions.';
comment on column public.tickets.explicit_deductions_kg is
  'TZ294 explicit documented deduction from physical net; never inferred from missing quality data.';
comment on column public.tickets.accepted_weight_kg is
  'TZ294 warehouse/accounting mass: physical_net_kg - explicit_deductions_kg.';

alter table public.tickets
  drop constraint if exists tickets_harvest_intake_weights_v1_check;
alter table public.tickets
  add constraint tickets_harvest_intake_weights_v1_check
  check (
    physical_net_kg is null
    and explicit_deductions_kg is null
    and accepted_weight_kg is null
    or (
      physical_net_kg > 0
      and explicit_deductions_kg >= 0
      and accepted_weight_kg > 0
      and accepted_weight_kg = physical_net_kg - explicit_deductions_kg
    )
  ) not valid;

-- A zero tare is valid at the ticket contract boundary and still remains an
-- explicit second measurement. Gross must remain strictly positive.
alter table public.ticket_weighings
  drop constraint if exists ticket_weighings_measured_weight_kg_check;
alter table public.ticket_weighings
  add constraint ticket_weighings_measured_weight_kg_check
  check (measured_weight_kg >= 0) not valid;

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
      'accepted_weight_kg', coalesce(v_ticket.accepted_weight_kg, v_ticket.net_weight_kg)
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
      -- Keep the legacy net field aligned with accounting mass so every
      -- existing dashboard/read model sees the accepted quantity. The raw
      -- gross-minus-tare fact remains immutable in physical_net_kg.
      net_weight_kg = v_accepted,
      physical_net_kg = v_physical,
      explicit_deductions_kg = v_deduction,
      accepted_weight_kg = v_accepted,
      status = 'ready_to_close',
      finalized_by_person_id = v_session.person_id,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake_finalize', jsonb_build_object(
          'contract_version', 'tz294_v1',
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
    p_ticket_id, v_ticket.company_id, 2, v_tare, now(), 'manual',
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
  set moisture_percent = p_moisture_percent,
      dirt_tare_percent = v_deduction_percent,
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake', jsonb_build_object(
          'contract_version', 'tz294_v1',
          'physical_net_kg', v_physical,
          'explicit_deductions_kg', v_deduction,
          'explicit_deductions_percent', v_deduction_percent,
          'accepted_weight_kg', v_accepted,
          'deduction_reason', nullif(btrim(coalesce(p_deduction_reason, '')), '')
        )
      ),
      updated_at = now()
  where id = v_line.id;

  -- Existing finalizer remains the single source for batch, ledger, lot trigger,
  -- final ticket transition and field-history trigger. Everything is still in
  -- this RPC transaction and is invisible until all postconditions pass.
  perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
  perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);

  update public.ticket_lines
  set quantity = v_accepted,
      mass_kg = v_accepted,
      net_line_weight_kg = v_accepted,
      updated_at = now()
  where id = v_line.id;

  select count(*)::integer, min(ib.id::text)::uuid
  into v_batch_count, v_batch_id
  from public.inventory_batches ib
  where ib.company_id = v_ticket.company_id
    and ib.source_ticket_id = p_ticket_id
    and ib.origin_type = 'harvest';
  if v_batch_count <> 1 then raise exception 'Finalized harvest must have exactly one technical batch'; end if;

  select * into v_batch from public.inventory_batches where id = v_batch_id;

  update public.inventory_batches
  set initial_weight_kg = v_accepted,
      current_weight_kg = v_accepted,
      initial_quantity = v_accepted,
      current_quantity = v_accepted,
      mass_kg = v_accepted,
      moisture_percent = p_moisture_percent,
      updated_at = now()
  where id = v_batch_id;

  update public.stock_ledger_entries
  set quantity = v_accepted,
      delta_qty_signed = v_accepted,
      mass_kg = v_accepted,
      updated_at = now()
  where company_id = v_ticket.company_id
    and ticket_id = p_ticket_id
    and direction::text = 'in'
    and not coalesce(is_storno, false);
  get diagnostics v_ledger_count = row_count;
  if v_ledger_count <> 1 then raise exception 'Finalized harvest must have exactly one active ledger IN'; end if;

  select count(*)::integer into v_weighing_count
  from public.ticket_weighings
  where company_id = v_ticket.company_id and ticket_id = p_ticket_id;
  if v_weighing_count <> 2 then raise exception 'Finalized harvest must have exactly two weighing events'; end if;

  select count(*)::integer into v_lot_link_count
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_ticket.company_id
    and hlb.inventory_batch_id = v_batch_id
    and hlb.source_ticket_id = p_ticket_id;
  if v_lot_link_count <> 1 then raise exception 'Finalized harvest must have exactly one aggregate lot link'; end if;

  update public.tickets
  set net_weight_kg = v_accepted,
      physical_net_kg = v_physical,
      explicit_deductions_kg = v_deduction,
      accepted_weight_kg = v_accepted,
      finalized_by_person_id = v_session.person_id,
      updated_at = now()
  where id = p_ticket_id;

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
    'batch_id', v_batch_id,
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
