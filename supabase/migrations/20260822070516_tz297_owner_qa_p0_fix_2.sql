-- TZ297 owner QA P0 fix #2:
-- one stock-availability contract and atomic close for weighed transfers.

create or replace view public.v_weighbridge_open_ticket_reservations_v1
with (security_invoker = true)
as
select
  t.company_id,
  t.id as ticket_id,
  t.warehouse_from_id as warehouse_id,
  case
    when coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then tl.batch_id::uuid
    else null
  end as batch_id,
  sum(coalesce(tl.quantity_kg, tl.net_line_weight_kg, tl.mass_kg, tl.quantity, 0))::numeric(18,6) as reserved_kg
from public.tickets t
join public.ticket_lines tl
  on tl.ticket_id = t.id
 and tl.company_id = t.company_id
where t.processing_allocation_ready
  and not coalesce(t.is_finalized, false)
  and not coalesce(t.is_voided, false)
  and t.status::text not in ('finalized', 'voided')
  and coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
group by t.company_id, t.id, t.warehouse_from_id,
  case
    when coalesce(tl.batch_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then tl.batch_id::uuid
    else null
  end;

revoke all on table public.v_weighbridge_open_ticket_reservations_v1 from public, anon;
grant select on table public.v_weighbridge_open_ticket_reservations_v1 to authenticated, service_role;

create or replace view public.v_effective_stock_balance_identity_v1
with (security_invoker = true)
as
select
  s.*,
  coalesce(a.allocated_kg, 0)::numeric(16,3) as processing_allocated_kg,
  greatest(
    s.quantity - coalesce(a.allocated_kg, 0) - coalesce(r.reserved_kg, 0),
    0
  )::numeric(16,3) as effective_available_kg,
  coalesce(r.reserved_kg, 0)::numeric(16,3) as open_ticket_reserved_kg
from public.v_stock_balance_identity s
left join (
  select company_id, warehouse_id, batch_id, sum(allocated_kg) as allocated_kg
  from public.v_processing_active_allocations_v1
  group by company_id, warehouse_id, batch_id
) a on a.company_id = s.company_id
   and a.warehouse_id = s.warehouse_id
   and a.batch_id::text = s.batch_id::text
left join (
  select company_id, warehouse_id, batch_id, sum(reserved_kg) as reserved_kg
  from public.v_weighbridge_open_ticket_reservations_v1
  group by company_id, warehouse_id, batch_id
) r on r.company_id = s.company_id
   and r.warehouse_id = s.warehouse_id
   and r.batch_id::text = s.batch_id::text;

revoke all on table public.v_effective_stock_balance_identity_v1 from public, anon;
grant select on table public.v_effective_stock_balance_identity_v1 to authenticated, service_role;

create or replace view public.v_weighbridge_harvest_lot_available_v2
with (security_invoker = true)
as
select
  hlb.company_id,
  hlb.harvest_lot_id,
  ib.warehouse_id,
  coalesce(ib.batch_class, 'commodity') as batch_class,
  coalesce(ib.physical_state, 'SOURCE') as physical_state,
  sum(coalesce(e.quantity, 0))::numeric(18,6) as ledger_weight_kg,
  sum(coalesce(e.processing_allocated_kg, 0))::numeric(18,6) as processing_allocated_kg,
  sum(coalesce(e.open_ticket_reserved_kg, 0))::numeric(18,6) as open_ticket_reserved_kg,
  sum(coalesce(e.effective_available_kg, 0))::numeric(18,6) as available_weight_kg,
  count(distinct coalesce(hlb.source_ticket_id, ib.source_ticket_id))::integer as trip_count
from public.harvest_lot_batches hlb
join public.inventory_batches ib
  on ib.id = hlb.inventory_batch_id
 and ib.company_id = hlb.company_id
left join public.v_effective_stock_balance_identity_v1 e
  on e.company_id = ib.company_id
 and e.warehouse_id = ib.warehouse_id
 and e.batch_id::text = ib.id::text
group by hlb.company_id, hlb.harvest_lot_id, ib.warehouse_id,
  coalesce(ib.batch_class, 'commodity'), coalesce(ib.physical_state, 'SOURCE');

revoke all on table public.v_weighbridge_harvest_lot_available_v2 from public, anon;
grant select on table public.v_weighbridge_harvest_lot_available_v2 to authenticated, service_role;

create or replace function private.weighbridge_batch_available_for_ticket_v1(
  p_ticket_id uuid,
  p_batch_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_ledger numeric(18,6);
  v_reserved numeric(18,6);
  v_processing numeric(18,6);
  v_available numeric(18,6);
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then raise exception 'Ticket not found'; end if;
  select * into v_batch from public.inventory_batches where id = p_batch_id;
  if not found or v_batch.company_id is distinct from v_ticket.company_id then
    raise exception 'Transfer source batch not found';
  end if;

  select round(coalesce(sum(sle.delta_qty_signed), 0), 6) into v_ledger
  from public.stock_ledger_entries sle
  where sle.company_id = v_batch.company_id
    and sle.warehouse_id = v_batch.warehouse_id
    and coalesce(
      sle.inventory_batch_id::text,
      nullif(sle.batch_id_text, ''),
      nullif(sle.batch_id, '')
    ) = v_batch.id::text;

  if v_ledger < -0.001 then
    raise exception 'WEIGHBRIDGE_STOCK_INTERNAL_NEGATIVE|%|%', v_ledger, v_batch.id;
  end if;

  select round(coalesce(sum(r.reserved_kg), 0), 6) into v_reserved
  from public.v_weighbridge_open_ticket_reservations_v1 r
  where r.company_id = v_batch.company_id
    and r.warehouse_id = v_batch.warehouse_id
    and r.batch_id = v_batch.id
    and r.ticket_id <> p_ticket_id;

  select round(coalesce(sum(a.allocated_kg), 0), 6) into v_processing
  from public.v_processing_active_allocations_v1 a
  where a.company_id = v_batch.company_id
    and a.warehouse_id = v_batch.warehouse_id
    and a.batch_id = v_batch.id
    and (v_ticket.linked_processing_id is null or a.transformation_id <> v_ticket.linked_processing_id);

  v_available := round(v_ledger - v_reserved - v_processing, 6);
  if v_available < -0.001 then
    raise exception 'WEIGHBRIDGE_STOCK_INTERNAL_NEGATIVE|%|%', v_available, v_batch.id;
  end if;
  return greatest(v_available, 0);
end
$function$;

revoke all on function private.weighbridge_batch_available_for_ticket_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.prepare_grain_lot_ticket_allocations_v1(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_template public.ticket_lines%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_required numeric(18,6);
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_available numeric(18,6);
  v_total_available numeric(18,6) := 0;
  v_batch public.inventory_batches%rowtype;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found
     or v_ticket.harvest_lot_id is null
     or v_ticket.direction::text not in ('transfer', 'outgoing') then
    return;
  end if;
  if v_ticket.processing_allocation_ready then return; end if;

  select * into v_lot
  from public.harvest_lots
  where id = v_ticket.harvest_lot_id
    and company_id = v_ticket.company_id
    and status = 'active';
  if not found then raise exception 'Aggregate harvest lot not found for ticket company'; end if;

  select * into v_template
  from public.ticket_lines
  where ticket_id = p_ticket_id
  order by created_at, id
  limit 1;
  if not found then raise exception 'Ticket line is required for aggregate lot allocation'; end if;
  if (select count(*) from public.ticket_lines where ticket_id = p_ticket_id) <> 1 then
    raise exception 'Aggregate harvest lot operation requires one user stock line';
  end if;
  if coalesce(v_template.crop_id::text, '') <> coalesce(v_lot.crop_id::text, '')
     or coalesce(v_template.variety_id::text, '') <> coalesce(v_lot.variety_id::text, '')
     or coalesce(v_template.reproduction_id::text, '') <> coalesce(v_lot.reproduction_id::text, '')
     or coalesce(v_template.composition_hash, '') <> coalesce(v_lot.composition_hash, '') then
    raise exception 'Ticket identity does not match aggregate harvest lot';
  end if;

  v_required := case
    when coalesce(v_ticket.weigh_method::text, '') = 'manual_override_with_reason'
      then round(coalesce(v_template.quantity_kg, v_template.quantity, v_template.mass_kg, 0), 6)
    else round(coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg,
      coalesce(v_ticket.gross_weight_kg, 0) - coalesce(v_ticket.tare_weight_kg, 0)), 6)
  end;
  if v_required <= 0 then raise exception 'Aggregate lot operation quantity must be greater than zero'; end if;

  delete from public.ticket_lines where ticket_id = p_ticket_id;
  v_remaining := v_required;

  for v_batch in
    select ib.*
    from public.harvest_lot_batches hlb
    join public.inventory_batches ib
      on ib.id = hlb.inventory_batch_id and ib.company_id = hlb.company_id
    left join public.tickets source_ticket
      on source_ticket.id = coalesce(hlb.source_ticket_id, ib.source_ticket_id)
     and source_ticket.company_id = ib.company_id
    where hlb.company_id = v_ticket.company_id
      and hlb.harvest_lot_id = v_ticket.harvest_lot_id
      and ib.warehouse_id = v_ticket.warehouse_from_id
      and coalesce(ib.batch_class, 'commodity') = coalesce(v_template.batch_class, 'commodity')
      and coalesce(ib.physical_state, 'SOURCE') = coalesce(v_ticket.source_physical_state, 'SOURCE')
    order by coalesce(ib.received_at, source_ticket.finalized_at, ib.created_at),
      coalesce(source_ticket.finalized_at, source_ticket.created_at, ib.created_at),
      ib.created_at, ib.id
    for update of ib
  loop
    v_available := private.weighbridge_batch_available_for_ticket_v1(v_ticket.id, v_batch.id);
    v_total_available := round(v_total_available + v_available, 6);
    continue when v_available <= 0.000001;
    exit when v_remaining <= 0.000001;
    v_take := least(v_remaining, v_available);
    insert into public.ticket_lines(
      ticket_id, company_id, product_id, product_type, product_name_snapshot, uom,
      gross_line_weight_kg, tare_line_weight_kg, net_line_weight_kg, quantity,
      moisture_percent, dockage_percent, dirt_tare_percent, class_grade,
      variety_id, reproduction_id, batch_id, lot_id, notes, crop_id,
      warehouse_from_id, warehouse_to_id, quantity_kg, quality_json, line_type,
      variety_name_snapshot, reproduction_name_snapshot, batch_class,
      operation_line_id, mass_kg, unit_source, unit_contract_version,
      composition_snapshot, composition_hash, is_mixed_harvest
    ) values (
      p_ticket_id, v_ticket.company_id, v_batch.product_id, v_template.product_type,
      v_template.product_name_snapshot, 'kg', null, null, v_take, v_take,
      v_template.moisture_percent, v_template.dockage_percent, v_template.dirt_tare_percent,
      v_template.class_grade, v_template.variety_id, v_template.reproduction_id,
      v_batch.id::text, v_ticket.harvest_lot_id::text, v_template.notes, v_template.crop_id,
      v_ticket.warehouse_from_id, v_ticket.warehouse_to_id, v_take,
      v_template.quality_json, v_template.line_type, v_template.variety_name_snapshot,
      v_template.reproduction_name_snapshot, coalesce(v_batch.batch_class, 'commodity'),
      v_template.operation_line_id, v_take, coalesce(v_template.unit_source, 'weighbridge'),
      coalesce(v_template.unit_contract_version, 2), v_template.composition_snapshot,
      v_template.composition_hash, v_template.is_mixed_harvest
    );
    v_remaining := round(v_remaining - v_take, 6);
  end loop;

  if v_remaining > 0.000001 then
    raise exception 'WEIGHBRIDGE_STOCK_INSUFFICIENT|%|%', v_total_available, v_required;
  end if;
  update public.tickets
  set processing_allocation_ready = true, updated_at = now()
  where id = p_ticket_id;
end
$function$;

revoke all on function public.prepare_grain_lot_ticket_allocations_v1(uuid) from public, anon;
grant execute on function public.prepare_grain_lot_ticket_allocations_v1(uuid) to authenticated, service_role;

create or replace function private.reconcile_warehouse_local_batch_balance_v1(p_batch_id uuid)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_batch public.inventory_batches%rowtype;
  v_balance numeric(18,6);
begin
  select * into v_batch from public.inventory_batches where id = p_batch_id for update;
  if not found then raise exception 'Inventory batch not found for reconciliation'; end if;
  select round(coalesce(sum(sle.delta_qty_signed), 0), 6) into v_balance
  from public.stock_ledger_entries sle
  where sle.company_id = v_batch.company_id
    and sle.warehouse_id = v_batch.warehouse_id
    and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = v_batch.id::text;
  if v_balance < -0.001 then
    raise exception 'WEIGHBRIDGE_STOCK_INTERNAL_NEGATIVE|%|%', v_balance, v_batch.id;
  end if;
  update public.inventory_batches
  set current_quantity = greatest(v_balance, 0),
      current_weight_kg = greatest(v_balance, 0),
      mass_kg = greatest(v_balance, 0),
      initial_quantity = case when parent_batch_id is null then initial_quantity else greatest(coalesce(initial_quantity, 0), greatest(v_balance, 0)) end,
      initial_weight_kg = case when parent_batch_id is null then initial_weight_kg else greatest(coalesce(initial_weight_kg, 0), greatest(v_balance, 0)) end,
      updated_at = now()
  where id = v_batch.id;
  return greatest(v_balance, 0);
end
$function$;

revoke all on function private.reconcile_warehouse_local_batch_balance_v1(uuid)
  from public, anon, authenticated;

create or replace function private.finalize_warehouse_local_transfer_v1(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_source public.inventory_batches%rowtype;
  v_source_batch_id uuid;
  v_destination_batch_id uuid;
  v_lot_id uuid;
  v_transfer_lot_id uuid;
  v_line_qty numeric(18,6);
  v_total numeric(18,6) := 0;
  v_available numeric(18,6);
  v_line_count integer := 0;
  v_ledger_count integer;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_ticket.direction::text <> 'transfer' then raise exception 'Ticket is not a warehouse transfer'; end if;
  if v_ticket.is_voided or v_ticket.status::text = 'voided' then raise exception 'Voided ticket cannot be finalized'; end if;
  if v_ticket.is_finalized or v_ticket.status::text = 'finalized' then return v_ticket.id; end if;
  if v_ticket.warehouse_from_id is null or v_ticket.warehouse_to_id is null or v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
    raise exception 'Source and destination warehouses must be different';
  end if;
  if coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg, 0) <= 0 then raise exception 'Net weight must be greater than zero'; end if;
  if exists (select 1 from public.stock_ledger_entries sle where sle.ticket_id = v_ticket.id and not coalesce(sle.is_storno, false)) then
    raise exception 'Ticket already has ledger entries';
  end if;

  perform public.prepare_grain_lot_ticket_allocations_v1(v_ticket.id);
  for v_line in select * from public.ticket_lines where ticket_id = v_ticket.id order by created_at, id
  loop
    v_line_count := v_line_count + 1;
    v_line_qty := round(coalesce(v_line.net_line_weight_kg, v_line.quantity_kg, v_line.quantity, v_line.mass_kg, 0), 6);
    if v_line_qty <= 0 then raise exception 'Transfer line quantity must be greater than zero'; end if;
    if coalesce(v_line.batch_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Transfer line must reference an exact source inventory batch';
    end if;
    v_source_batch_id := v_line.batch_id::uuid;
    select * into v_source from public.inventory_batches b
    where b.id = v_source_batch_id
      and b.company_id = v_ticket.company_id
      and b.warehouse_id = v_ticket.warehouse_from_id
      and b.product_id is not distinct from v_line.product_id
      and b.batch_class = 'commodity'
    for update;
    if not found then raise exception 'Transfer source batch identity does not match source warehouse'; end if;

    v_available := private.weighbridge_batch_available_for_ticket_v1(v_ticket.id, v_source.id);
    if v_available + 0.001 < v_line_qty then
      raise exception 'WEIGHBRIDGE_STOCK_INSUFFICIENT|%|%', v_available, v_line_qty;
    end if;

    v_destination_batch_id := private.ensure_transfer_destination_batch_v1(v_source.id, v_ticket.warehouse_to_id, v_ticket.id, v_line_qty);
    select hlb.harvest_lot_id into v_lot_id from public.harvest_lot_batches hlb where hlb.inventory_batch_id = v_source.id;
    if v_transfer_lot_id is null then v_transfer_lot_id := v_lot_id;
    elsif v_transfer_lot_id is distinct from v_lot_id then raise exception 'A transfer ticket cannot mix aggregate harvest lots'; end if;
    if v_ticket.harvest_lot_id is not null and v_ticket.harvest_lot_id is distinct from v_lot_id then
      raise exception 'Transfer source batch does not belong to the selected aggregate lot';
    end if;

    update public.ticket_lines
    set quantity = v_line_qty, quantity_kg = v_line_qty, mass_kg = v_line_qty,
        net_line_weight_kg = v_line_qty, destination_batch_id = v_destination_batch_id,
        updated_at = now()
    where id = v_line.id;
    update public.inventory_batches
    set moisture_percent = v_line.moisture_percent,
        quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
          'weighbridge_transfer', jsonb_build_object('ticket_id', v_ticket.id, 'moisture_percent', v_line.moisture_percent)
        ),
        updated_at = now()
    where id = v_destination_batch_id;

    insert into public.stock_ledger_entries(
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      batch_id, batch_id_text, batch_class, inventory_batch_id, warehouse_id,
      direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
      occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.crop_id, v_line.variety_id, v_line.reproduction_id,
      v_source.id::text, v_source.id::text, 'commodity', v_source.id, v_ticket.warehouse_from_id,
      'out', v_line_qty, 'kg', -v_line_qty, 'warehouse_transfer_out', v_ticket.id, now(), p_actor_user_id,
      v_ticket.notes, v_line_qty, 'warehouse_local_transfer', 2
    ), (
      v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.crop_id, v_line.variety_id, v_line.reproduction_id,
      v_destination_batch_id::text, v_destination_batch_id::text, 'commodity', v_destination_batch_id, v_ticket.warehouse_to_id,
      'in', v_line_qty, 'kg', v_line_qty, 'warehouse_transfer_in', v_ticket.id, now(), p_actor_user_id,
      v_ticket.notes, v_line_qty, 'warehouse_local_transfer', 2
    );
    perform private.reconcile_warehouse_local_batch_balance_v1(v_source.id);
    perform private.reconcile_warehouse_local_batch_balance_v1(v_destination_batch_id);
    v_total := round(v_total + v_line_qty, 6);
  end loop;

  if v_line_count = 0 then raise exception 'Transfer ticket lines are required'; end if;
  if abs(v_total - coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg)) > 0.001 then
    raise exception 'Transfer line total does not match ticket net';
  end if;
  select count(*) into v_ledger_count from public.stock_ledger_entries
  where ticket_id = v_ticket.id and not coalesce(is_storno, false);
  if v_ledger_count <> v_line_count * 2 then raise exception 'Transfer ledger postcondition failed'; end if;

  update public.tickets
  set harvest_lot_id = coalesce(harvest_lot_id, v_transfer_lot_id), is_finalized = true,
      status = 'finalized', closed_by = p_actor_user_id, finalized_at = now(), updated_at = now()
  where id = v_ticket.id;
  perform public.backfill_ticket_operation_line_links_v1(v_ticket.id);
  return v_ticket.id;
end
$function$;

revoke all on function private.finalize_warehouse_local_transfer_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.close_transfer_ticket_atomic_v2(
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
  v_gross numeric(14,3);
  v_tare numeric(14,3);
  v_net numeric(14,3);
  v_previous_tare numeric(14,3);
  v_difference numeric(8,2);
  v_weighing_count integer;
  v_line_total numeric(18,6);
  v_out_total numeric(18,6);
  v_in_total numeric(18,6);
begin
  select * into v_actor from public.profiles where id = auth.uid() and coalesce(status, 'active') = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','weighman','weighbridge_operator') then
    raise exception 'Weighbridge access denied' using errcode = '42501';
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company' using errcode = '42501';
  end if;
  if v_ticket.direction::text <> 'transfer'
     or coalesce(v_ticket.weigh_method::text, '') = 'manual_override_with_reason'
     or v_ticket.correction_of_ticket_id is not null then
    raise exception 'Atomic transfer close is unavailable for this ticket' using errcode = '22023';
  end if;

  select * into v_session from private.weighbridge_operator_sessions s
  where s.company_id = v_ticket.company_id
    and s.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and s.status = 'active'
  order by s.created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'shift_expired'); end if;
  select * into v_shift from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id and ws.company_id = v_ticket.company_id and ws.status = 'open'
  for update;
  if not found or v_session.expires_at <= now() or v_shift.last_activity_at + interval '24 hours' <= now() then
    return jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if v_ticket.is_voided or v_ticket.status::text = 'voided' then raise exception 'Voided ticket cannot be finalized'; end if;
  if v_ticket.is_finalized or v_ticket.status::text = 'finalized' then
    return jsonb_build_object('ok', true, 'ticket_id', v_ticket.id, 'idempotent_replay', true,
      'physical_net_kg', coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg));
  end if;

  v_gross := round(v_ticket.gross_weight_kg, 3);
  v_tare := round(p_tare_weight_kg, 3);
  if v_gross is null or v_gross <= 0 then raise exception 'Gross weight must be greater than zero'; end if;
  if v_tare is null or v_tare <= 0 then raise exception 'Tare weight must be greater than zero'; end if;
  if v_tare >= v_gross then raise exception 'Tare weight cannot equal or exceed gross weight'; end if;
  v_net := round(v_gross - v_tare, 3);
  if p_moisture_percent is not null and (p_moisture_percent <= 0 or p_moisture_percent >= 100) then
    raise exception 'Moisture must be greater than 0 and less than 100 percent' using errcode = '22023';
  end if;

  if v_ticket.vehicle_id is not null then
    select t.tare_weight_kg into v_previous_tare from public.tickets t
    where t.company_id = v_ticket.company_id and t.vehicle_id = v_ticket.vehicle_id
      and t.id <> v_ticket.id and t.status::text = 'finalized' and coalesce(t.is_finalized, false)
      and not coalesce(t.is_voided, false) and t.tare_weight_kg > 0
    order by t.finalized_at desc nulls last, t.updated_at desc limit 1;
    if v_previous_tare is not null then
      v_difference := round(((v_tare - v_previous_tare) / v_previous_tare) * 100, 2);
      if abs(v_difference) >= 20 and not p_tare_variance_confirmed then
        return jsonb_build_object('ok', false, 'requires_confirmation', true,
          'code', 'tare_variance_confirmation_required', 'previous_tare_kg', v_previous_tare,
          'current_tare_kg', v_tare, 'difference_percent', v_difference);
      end if;
    end if;
  end if;

  insert into public.ticket_weighings(ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment)
  values (v_ticket.id, v_ticket.company_id, 1, v_gross, coalesce(v_ticket.weighing_1_at, v_ticket.created_at),
    'ticket_snapshot', v_actor.id, v_session.person_id, v_shift.id, 'Фактическое взвешивание брутто')
  on conflict (ticket_id, weighing_no) do nothing;
  if not exists (select 1 from public.ticket_weighings where ticket_id = v_ticket.id and weighing_no = 1
    and abs(measured_weight_kg - v_gross) <= 0.001) then
    raise exception 'Gross weighing event does not match ticket gross';
  end if;
  insert into public.ticket_weighings(ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id, weighbridge_shift_id, comment)
  values (v_ticket.id, v_ticket.company_id, 2, v_tare, now(), 'manual', v_actor.id, v_session.person_id,
    v_shift.id, 'Финальное взвешивание тары')
  on conflict (ticket_id, weighing_no) do update set measured_weight_kg=excluded.measured_weight_kg,
    measured_at=excluded.measured_at, device_source=excluded.device_source,
    operator_user_id=excluded.operator_user_id, operator_person_id=excluded.operator_person_id,
    weighbridge_shift_id=excluded.weighbridge_shift_id, comment=excluded.comment;

  update public.tickets set tare_weight_kg=v_tare, net_weight_kg=v_net, physical_net_kg=v_net,
    accepted_weight_kg=v_net, explicit_deductions_kg=0, status='ready_to_close',
    finalized_by_person_id=v_session.person_id, weighing_2_at=now(),
    audit_json=coalesce(audit_json,'{}'::jsonb)||jsonb_build_object('atomic_transfer_close',jsonb_build_object(
      'contract_version','tz297_v2','idempotency_key',nullif(btrim(coalesce(p_idempotency_key,'')),''),
      'physical_net_kg',v_net,'moisture_percent',p_moisture_percent,'operator_person_id',v_session.person_id,
      'shift_id',v_shift.id)), updated_at=now()
  where id=v_ticket.id;
  update public.ticket_lines set quantity=v_net, quantity_kg=v_net, mass_kg=v_net,
    net_line_weight_kg=v_net, moisture_percent=p_moisture_percent,
    quality_json=coalesce(quality_json,'{}'::jsonb)||jsonb_build_object('weighbridge_quality',jsonb_build_object(
      'contract_version','tz297_v2','moisture_percent',p_moisture_percent)), updated_at=now()
  where ticket_id=v_ticket.id;

  perform private.finalize_warehouse_local_transfer_v1(v_ticket.id, v_actor.id);
  update public.tickets set finalized_by_person_id=v_session.person_id where id=v_ticket.id;
  update public.weighbridge_shifts set last_activity_at=now() where id=v_shift.id and status='open';
  update private.weighbridge_operator_sessions set expires_at=now()+interval '24 hours',last_seen_at=now()
  where id=v_session.id and status='active';

  select count(*) into v_weighing_count from public.ticket_weighings where ticket_id=v_ticket.id;
  select round(coalesce(sum(quantity_kg),0),6) into v_line_total from public.ticket_lines where ticket_id=v_ticket.id;
  select round(coalesce(sum(abs(delta_qty_signed)),0),6) into v_out_total from public.stock_ledger_entries
    where ticket_id=v_ticket.id and direction::text='out' and not coalesce(is_storno,false);
  select round(coalesce(sum(abs(delta_qty_signed)),0),6) into v_in_total from public.stock_ledger_entries
    where ticket_id=v_ticket.id and direction::text='in' and not coalesce(is_storno,false);
  if v_weighing_count <> 2 or abs(v_line_total-v_net)>0.001 or abs(v_out_total-v_net)>0.001 or abs(v_in_total-v_net)>0.001 then
    raise exception 'Atomic transfer close postcondition failed';
  end if;
  return jsonb_build_object('ok',true,'ticket_id',v_ticket.id,'idempotent_replay',false,
    'physical_net_kg',v_net,'weighing_count',v_weighing_count,'line_total_kg',v_line_total,
    'out_total_kg',v_out_total,'in_total_kg',v_in_total,'operator_person_id',v_session.person_id,
    'shift_id',v_shift.id);
end
$function$;

revoke all on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text) from public, anon;
grant execute on function public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text)
  to authenticated, service_role;

alter table public.tickets
  drop constraint if exists tickets_processing_output_role_v1_check;
alter table public.tickets
  add constraint tickets_processing_output_role_v1_check
  check (
    processing_output_role is null
    or processing_output_role in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
  );

create or replace function public.tz297_classify_processing_output_fraction_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_role text;
  v_line_type text;
  v_output_type text;
  v_batch_class text;
  v_physical_state text;
begin
  v_role := upper(coalesce(new.processing_output_role, ''));
  if not coalesce(new.is_finalized, false)
     or new.linked_processing_id is null
     or v_role not in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
  then
    return new;
  end if;

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
  v_batch_class := case
    when v_role = 'GRAIN' then 'commodity'
    when v_role = 'FEED' then 'feed'
    else 'waste'
  end;
  v_physical_state := case
    when v_role in ('SCREENINGS','FEED') then 'SCREENINGS'
    when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'
    when v_role in ('WASTE','OTHER') then 'OTHER'
    else null
  end;

  update public.batch_transformation_outputs o
  set line_type = v_line_type,
      output_type = v_output_type,
      batch_class = v_batch_class,
      output_role = v_role,
      physical_state = coalesce(v_physical_state, o.physical_state),
      output_quality_json = coalesce(o.output_quality_json, '{}'::jsonb)
        || jsonb_build_object('processing_fraction_role', v_role)
  where o.company_id = new.company_id
    and o.transformation_id = new.linked_processing_id
    and o.source_ticket_id = new.id;

  update public.inventory_batches b
  set batch_class = v_batch_class,
      status = case when v_batch_class = 'waste' then 'waste' else 'commodity' end,
      physical_state = coalesce(v_physical_state, b.physical_state),
      quality_json = coalesce(b.quality_json, '{}'::jsonb)
        || jsonb_build_object('processing_fraction_role', v_role),
      updated_at = now()
  from public.batch_transformation_outputs o
  where o.company_id = new.company_id
    and o.transformation_id = new.linked_processing_id
    and o.source_ticket_id = new.id
    and b.id = o.output_batch_id
    and b.company_id = o.company_id;

  perform public.recompute_grain_processing_shadow_v1(new.linked_processing_id);
  return new;
end
$function$;

revoke all on function public.tz297_classify_processing_output_fraction_v2()
  from public, anon, authenticated;
grant execute on function public.tz297_classify_processing_output_fraction_v2() to service_role;

drop trigger if exists zz_tz297_classify_processing_output_fraction_v2 on public.tickets;
create trigger zz_tz297_classify_processing_output_fraction_v2
after update of is_finalized, status on public.tickets
for each row
when (new.is_finalized and not old.is_finalized)
execute function public.tz297_classify_processing_output_fraction_v2();

create or replace function public.tz297_sync_processing_input_destination_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not coalesce(new.is_finalized, false) or new.direction::text <> 'transfer' then return new; end if;
  update public.batch_transformation_inputs i
  set batch_id = tl.destination_batch_id,
      warehouse_from_id = new.warehouse_to_id,
      node_warehouse_id = new.warehouse_to_id,
      input_weight_kg = coalesce(tl.net_line_weight_kg, tl.quantity_kg, tl.mass_kg, tl.quantity),
      moisture_percent = tl.moisture_percent,
      dry_matter_kg = case when tl.moisture_percent is null then null else
        round(coalesce(tl.net_line_weight_kg, tl.quantity_kg, tl.mass_kg, tl.quantity) * (100 - tl.moisture_percent) / 100, 3) end
  from public.ticket_lines tl
  where i.company_id = new.company_id
    and i.source_ticket_id = new.id
    and i.source_ticket_line_id = tl.id
    and tl.ticket_id = new.id
    and tl.destination_batch_id is not null;
  return new;
end
$function$;

revoke all on function public.tz297_sync_processing_input_destination_v1() from public, anon, authenticated;
drop trigger if exists zz_tz297_sync_processing_input_destination_v1 on public.tickets;
create trigger zz_tz297_sync_processing_input_destination_v1
after update of is_finalized, status on public.tickets
for each row
when (new.is_finalized and not old.is_finalized)
execute function public.tz297_sync_processing_input_destination_v1();
