-- TZ296: one user-facing harvest lot, exact FIFO batch trace in the ledger.

create or replace view public.v_harvest_lot_stock_v1
with (security_invoker = true)
as
with resolved_ledger as (
  select sle.company_id, resolved.inventory_batch_id, sle.warehouse_id, sle.delta_qty_signed
  from public.stock_ledger_entries sle
  join lateral (
    select ib.id as inventory_batch_id
    from public.inventory_batches ib
    where ib.company_id = sle.company_id
      and exists (
        select 1 from public.harvest_lot_batches linked
        where linked.company_id = ib.company_id and linked.inventory_batch_id = ib.id
      )
      and (
        ib.id = sle.inventory_batch_id
        or (
          sle.inventory_batch_id is null
          and ib.id = case
            when sle.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then sle.batch_id_text::uuid
            else null::uuid
          end
        )
        or (
          sle.inventory_batch_id is null
          and sle.ticket_id is not null
          and ib.source_ticket_id = sle.ticket_id
        )
      )
    order by case
      when ib.id = sle.inventory_batch_id then 0
      when ib.id = case
        when sle.batch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then sle.batch_id_text::uuid
        else null::uuid
      end then 1
      else 2
    end, ib.created_at, ib.id
    limit 1
  ) resolved on true
), ledger_by_batch as (
  select company_id, inventory_batch_id, warehouse_id,
    sum(delta_qty_signed)::numeric(18,3) as current_weight_kg
  from resolved_ledger
  group by company_id, inventory_batch_id, warehouse_id
)
select hl.company_id,
  hl.id as harvest_lot_id,
  lbs.warehouse_id,
  count(distinct coalesce(
    hlb.source_ticket_id,
    ib.source_ticket_id,
    parent_link.source_ticket_id,
    parent_batch.source_ticket_id
  ))::integer as trip_count,
  coalesce(sum(lbs.current_weight_kg), 0)::numeric(18,3) as current_weight_kg,
  coalesce(ib.batch_class, 'commodity') as batch_class,
  coalesce(ib.physical_state, 'SOURCE') as physical_state
from public.harvest_lots hl
join public.harvest_lot_batches hlb on hlb.harvest_lot_id = hl.id
join public.inventory_batches ib
  on ib.id = hlb.inventory_batch_id and ib.company_id = hlb.company_id
left join public.inventory_batches parent_batch
  on parent_batch.id = ib.parent_batch_id and parent_batch.company_id = ib.company_id
left join public.harvest_lot_batches parent_link
  on parent_link.inventory_batch_id = parent_batch.id and parent_link.company_id = parent_batch.company_id
left join ledger_by_batch lbs
  on lbs.company_id = hlb.company_id and lbs.inventory_batch_id = hlb.inventory_batch_id
where hl.status = 'active'
group by hl.company_id, hl.id, lbs.warehouse_id,
  coalesce(ib.batch_class, 'commodity'), coalesce(ib.physical_state, 'SOURCE');

create or replace function public.prepare_grain_lot_ticket_allocations_v1(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_template public.ticket_lines%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_required numeric(18,6);
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_balance record;
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
    else round(coalesce(v_ticket.net_weight_kg,
      coalesce(v_ticket.gross_weight_kg, 0) - coalesce(v_ticket.tare_weight_kg, 0)), 6)
  end;
  if v_required <= 0 then raise exception 'Aggregate lot operation quantity must be greater than zero'; end if;

  delete from public.ticket_lines where ticket_id = p_ticket_id;
  v_remaining := v_required;

  for v_balance in
    select
      ib.*,
      round(sum(sle.delta_qty_signed), 6) as available_kg,
      coalesce(ib.received_at, source_ticket.finalized_at, ib.created_at) as fifo_received_at,
      coalesce(source_ticket.finalized_at, source_ticket.created_at, ib.created_at) as fifo_ticket_at
    from public.harvest_lot_batches hlb
    join public.inventory_batches ib
      on ib.id = hlb.inventory_batch_id
     and ib.company_id = hlb.company_id
    left join public.tickets source_ticket
      on source_ticket.id = coalesce(hlb.source_ticket_id, ib.source_ticket_id)
     and source_ticket.company_id = ib.company_id
    join public.stock_ledger_entries sle
      on sle.company_id = ib.company_id
     and sle.warehouse_id = v_ticket.warehouse_from_id
     and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = ib.id::text
    where hlb.company_id = v_ticket.company_id
      and hlb.harvest_lot_id = v_ticket.harvest_lot_id
      and ib.warehouse_id = v_ticket.warehouse_from_id
      and coalesce(ib.batch_class, 'commodity') = coalesce(v_template.batch_class, 'commodity')
      and coalesce(ib.physical_state, 'SOURCE') = coalesce(v_ticket.source_physical_state, 'SOURCE')
    group by ib.id, source_ticket.finalized_at, source_ticket.created_at
    having sum(sle.delta_qty_signed) > 0.000001
    order by fifo_received_at, fifo_ticket_at, ib.created_at, ib.id
  loop
    exit when v_remaining <= 0.000001;
    v_take := least(v_remaining, v_balance.available_kg);
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
      p_ticket_id, v_ticket.company_id, v_balance.product_id, v_template.product_type,
      v_template.product_name_snapshot, 'kg', null, null, v_take, v_take,
      v_template.moisture_percent, v_template.dockage_percent, v_template.dirt_tare_percent,
      v_template.class_grade, v_template.variety_id, v_template.reproduction_id,
      v_balance.id::text, v_ticket.harvest_lot_id::text, v_template.notes, v_template.crop_id,
      v_ticket.warehouse_from_id, v_ticket.warehouse_to_id, v_take,
      v_template.quality_json, v_template.line_type, v_template.variety_name_snapshot,
      v_template.reproduction_name_snapshot, coalesce(v_balance.batch_class, 'commodity'),
      v_template.operation_line_id, v_take, coalesce(v_template.unit_source, 'weighbridge'),
      coalesce(v_template.unit_contract_version, 2), v_template.composition_snapshot,
      v_template.composition_hash, v_template.is_mixed_harvest
    );
    v_remaining := round(v_remaining - v_take, 6);
  end loop;

  if v_remaining > 0.000001 then
    raise exception 'Insufficient aggregate lot stock. Missing % kg', v_remaining;
  end if;
  update public.tickets
  set processing_allocation_ready = true, updated_at = now()
  where id = p_ticket_id;
end
$function$;

create or replace function public.finalize_weighbridge_impurity_ticket_for_session_v1(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_line_count integer;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found then raise exception 'Active actor profile not found'; end if;
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if coalesce(v_actor.role, '') <> 'global_admin' and v_ticket.company_id <> v_actor.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if coalesce(v_actor.role, '') not in ('admin','global_admin','company_admin','director','warehouse','warehouse_operator','warehouse_manager','weighman','weighbridge_operator') then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;
  if v_ticket.is_voided or v_ticket.status::text = 'voided' then raise exception 'Voided ticket cannot be finalized'; end if;
  if v_ticket.is_finalized or v_ticket.status::text = 'finalized' then return p_ticket_id; end if;
  if v_ticket.direction::text <> 'outgoing' or v_ticket.op_type <> 'weighbridge_impurities' then
    raise exception 'Ticket is not a weighbridge impurity removal';
  end if;
  if (v_ticket.batch_id is null and v_ticket.harvest_lot_id is null) or v_ticket.warehouse_from_id is null then
    raise exception 'Harvest lot or batch and source warehouse are required';
  end if;
  if v_ticket.vehicle_id is null or v_ticket.driver_id is null then raise exception 'Vehicle and driver are required'; end if;
  if coalesce(v_ticket.audit_json->>'impurity_type', '') not in ('soil_and_trash','nonconforming_crop','plant_residues','other') then
    raise exception 'Impurity type is required';
  end if;
  select count(*) into v_line_count from public.ticket_lines where ticket_id = p_ticket_id;
  if v_line_count <> 1 then raise exception 'Impurity removal requires exactly one user stock line'; end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = v_ticket.warehouse_from_id and w.company_id = v_ticket.company_id
      and not coalesce(w.archived, false) and not coalesce(w.is_archived, false)
      and lower(coalesce(w.warehouse_type, '')) in ('grain','grain_storage','harvest','crop','produce','elevator')
  ) then raise exception 'Selected warehouse is not available for harvest'; end if;

  perform public.prepare_grain_lot_ticket_allocations_v1(p_ticket_id);
  perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
  update public.tickets
  set audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'stock_source', case when harvest_lot_id is null then 'exact_batch' else 'aggregate_harvest_lot_fifo' end
      ),
      updated_at = now()
  where id = p_ticket_id;
  return p_ticket_id;
end
$function$;

create or replace function private.assert_harvest_stock_transfer_actor_v1(
  p_company_id uuid,
  p_warehouse_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
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
  if v_actor.role not in ('global_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed for warehouse transfers' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Actor does not belong to warehouse company' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id
      and w.company_id = p_company_id
      and coalesce(w.archived, false) = false
      and coalesce(w.is_archived, false) = false
  ) then
    raise exception 'Warehouse is not available to the actor' using errcode = '42501';
  end if;
  return v_actor.id;
end
$function$;

create or replace function private.ensure_transfer_destination_batch_for_document_v1(
  p_source_batch_id uuid,
  p_destination_warehouse_id uuid,
  p_transfer_document_id uuid,
  p_quantity_kg numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_source public.inventory_batches%rowtype;
  v_destination public.inventory_batches%rowtype;
  v_lot_id uuid;
  v_batch_code text;
begin
  select * into v_source from public.inventory_batches where id = p_source_batch_id for update;
  if not found then raise exception 'Transfer source batch not found'; end if;
  if v_source.batch_class <> 'commodity' then raise exception 'Harvest transfer requires commodity stock'; end if;
  if coalesce(p_quantity_kg, 0) <= 0 then raise exception 'Transfer quantity must be positive'; end if;
  if v_source.warehouse_id is null or p_destination_warehouse_id is null
     or v_source.warehouse_id = p_destination_warehouse_id then
    raise exception 'Transfer source and destination warehouses must differ';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_source.company_id::text || ':' || v_source.id::text || ':' || p_destination_warehouse_id::text, 0
  ));
  select * into v_destination
  from public.inventory_batches b
  where b.company_id = v_source.company_id
    and b.parent_batch_id = v_source.id
    and b.warehouse_id = p_destination_warehouse_id
    and b.product_id is not distinct from v_source.product_id
  order by b.created_at, b.id
  limit 1
  for update;

  if not found then
    v_batch_code := v_source.batch_code || '-W' || left(replace(p_destination_warehouse_id::text, '-', ''), 8);
    insert into public.inventory_batches(
      company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
      source_field_id, source_ticket_id, harvest_year, batch_code, status,
      initial_weight_kg, current_weight_kg, moisture_percent, purity_percent,
      dockage_percent, germination_percent, energy_percent, quality_json,
      batch_class, parent_batch_id, origin_type, origin_ref_id, treatment_status,
      initial_quantity, current_quantity, uom, mass_kg, density_kg_per_l,
      density_unit, density_source, density_verification_status,
      density_verified_at, unit_source, unit_contract_version, crop_structure_id,
      harvesting_operation_id, warehouse_id, received_at, source_type,
      composition_snapshot, composition_hash, display_name, is_mixed_harvest,
      planting_operation_id, physical_state
    ) values (
      v_source.company_id, v_source.season_id, v_source.product_id, v_source.crop_id,
      v_source.variety_id, v_source.reproduction_id, v_source.source_field_id,
      null, v_source.harvest_year, v_batch_code, v_source.status,
      p_quantity_kg, p_quantity_kg, v_source.moisture_percent, v_source.purity_percent,
      v_source.dockage_percent, v_source.germination_percent, v_source.energy_percent,
      v_source.quality_json, 'commodity', v_source.id, 'transfer', p_transfer_document_id,
      v_source.treatment_status, p_quantity_kg, p_quantity_kg, coalesce(v_source.uom, 'kg'),
      p_quantity_kg, v_source.density_kg_per_l, v_source.density_unit,
      v_source.density_source, v_source.density_verification_status,
      v_source.density_verified_at, 'warehouse_local_transfer', 2,
      v_source.crop_structure_id, v_source.harvesting_operation_id,
      p_destination_warehouse_id, now(), 'warehouse_transfer',
      coalesce(v_source.composition_snapshot, '[]'::jsonb), v_source.composition_hash,
      v_source.display_name, v_source.is_mixed_harvest, v_source.planting_operation_id,
      v_source.physical_state
    ) returning * into v_destination;
  end if;

  select hlb.harvest_lot_id into v_lot_id
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_source.company_id and hlb.inventory_batch_id = v_source.id;
  if v_lot_id is null then raise exception 'Source batch has no aggregate harvest lot'; end if;
  insert into public.harvest_lot_batches(
    company_id, harvest_lot_id, inventory_batch_id, source_ticket_id,
    crop_structure_id, assignment_reason
  ) values (
    v_source.company_id, v_lot_id, v_destination.id, null,
    v_source.crop_structure_id, 'warehouse_local_transfer_child'
  ) on conflict (inventory_batch_id) do update
  set harvest_lot_id = excluded.harvest_lot_id,
      crop_structure_id = coalesce(public.harvest_lot_batches.crop_structure_id, excluded.crop_structure_id),
      assignment_reason = 'warehouse_local_transfer_child', updated_at = now();
  return v_destination.id;
end
$function$;

create or replace function private.reconcile_harvest_lot_batch_balance_v1(p_batch_id uuid)
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
    and (
      sle.inventory_batch_id = v_batch.id
      or (
        sle.inventory_batch_id is null
        and coalesce(nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = v_batch.id::text
      )
      or (
        sle.inventory_batch_id is null
        and sle.ticket_id is not null
        and v_batch.source_ticket_id = sle.ticket_id
      )
    );
  if v_balance < -0.001 then
    raise exception 'Harvest lot batch balance would become negative: %', v_balance;
  end if;

  update public.inventory_batches
  set current_quantity = greatest(v_balance, 0),
      current_weight_kg = greatest(v_balance, 0),
      mass_kg = greatest(v_balance, 0),
      initial_quantity = case when parent_batch_id is null then initial_quantity
        else greatest(coalesce(initial_quantity, 0), greatest(v_balance, 0)) end,
      initial_weight_kg = case when parent_batch_id is null then initial_weight_kg
        else greatest(coalesce(initial_weight_kg, 0), greatest(v_balance, 0)) end,
      updated_at = now()
  where id = v_batch.id;
  return greatest(v_balance, 0);
end
$function$;

create or replace function public.create_harvest_lot_transfer_atomic_v1(
  p_company_id uuid,
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_product_id uuid,
  p_harvest_lot_id uuid,
  p_source_physical_state text,
  p_quantity numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid;
  v_lot public.harvest_lots%rowtype;
  v_existing public.warehouse_transfer_documents%rowtype;
  v_bucket record;
  v_destination_batch_id uuid;
  v_available numeric(18,6);
  v_remaining numeric(18,6);
  v_take numeric(18,6);
  v_posted_at timestamptz := clock_timestamp();
  v_fingerprint text;
  v_transfer_no text;
  v_ledger_rows integer := 0;
  v_allocations integer := 0;
begin
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_source_warehouse_id = p_destination_warehouse_id then raise exception 'Source and destination warehouses must differ'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantity must be positive'; end if;
  v_actor_id := private.assert_harvest_stock_transfer_actor_v1(p_company_id, p_source_warehouse_id);
  perform private.assert_harvest_stock_transfer_actor_v1(p_company_id, p_destination_warehouse_id);
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_harvest_lot_id::text || ':' || p_source_warehouse_id::text, 0
  ));

  select * into v_lot from public.harvest_lots
  where id = p_harvest_lot_id and company_id = p_company_id and status = 'active';
  if not found then raise exception 'Aggregate harvest lot not found'; end if;
  if not exists (
    select 1 from public.harvest_lot_batches hlb
    join public.inventory_batches ib on ib.id = hlb.inventory_batch_id
    where hlb.company_id = p_company_id and hlb.harvest_lot_id = p_harvest_lot_id
      and ib.product_id = p_product_id
  ) then raise exception 'Product does not belong to aggregate harvest lot'; end if;

  v_fingerprint := md5(jsonb_build_object(
    'company_id', p_company_id, 'source_warehouse_id', p_source_warehouse_id,
    'destination_warehouse_id', p_destination_warehouse_id, 'product_id', p_product_id,
    'harvest_lot_id', p_harvest_lot_id, 'source_physical_state', coalesce(p_source_physical_state, 'SOURCE'),
    'quantity', round(p_quantity, 3), 'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text);
  select * into v_existing from public.warehouse_transfer_documents
  where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then raise exception 'Idempotency key payload mismatch'; end if;
    return jsonb_build_object('transfer_id', v_existing.id, 'transfer_no', v_existing.transfer_no,
      'posted_at', v_existing.posted_at, 'quantity', v_existing.quantity, 'uom', v_existing.uom,
      'idempotent_replay', true);
  end if;

  select round(coalesce(sum(sle.delta_qty_signed), 0), 6) into v_available
  from public.harvest_lot_batches hlb
  join public.inventory_batches ib on ib.id = hlb.inventory_batch_id and ib.company_id = hlb.company_id
  join public.stock_ledger_entries sle
    on sle.company_id = ib.company_id and sle.warehouse_id = p_source_warehouse_id
   and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = ib.id::text
  where hlb.company_id = p_company_id and hlb.harvest_lot_id = p_harvest_lot_id
    and ib.warehouse_id = p_source_warehouse_id
    and coalesce(ib.physical_state, 'SOURCE') = coalesce(p_source_physical_state, 'SOURCE');
  if v_available + 0.000001 < p_quantity then
    raise exception 'Insufficient aggregate harvest lot stock. Available %, required %', v_available, p_quantity;
  end if;

  v_transfer_no := 'WT-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.warehouse_transfer_documents(
    id, company_id, transfer_no, source_warehouse_id, destination_warehouse_id,
    canonical_product_id, quantity, uom, reserved_quantity, notes, status,
    payload_fingerprint, posted_at, created_by
  ) values (
    p_idempotency_key, p_company_id, v_transfer_no, p_source_warehouse_id,
    p_destination_warehouse_id, p_product_id, round(p_quantity, 3), 'kg', 0,
    nullif(btrim(coalesce(p_notes, '')), ''), 'completed', v_fingerprint, v_posted_at, v_actor_id
  );

  v_remaining := round(p_quantity, 6);
  for v_bucket in
    select ib.*, round(sum(sle.delta_qty_signed), 6) as available_kg,
      coalesce(ib.received_at, source_ticket.finalized_at, ib.created_at) as fifo_received_at,
      coalesce(source_ticket.finalized_at, source_ticket.created_at, ib.created_at) as fifo_ticket_at
    from public.harvest_lot_batches hlb
    join public.inventory_batches ib on ib.id = hlb.inventory_batch_id and ib.company_id = hlb.company_id
    left join public.tickets source_ticket on source_ticket.id = coalesce(hlb.source_ticket_id, ib.source_ticket_id)
    join public.stock_ledger_entries sle
      on sle.company_id = ib.company_id and sle.warehouse_id = p_source_warehouse_id
     and coalesce(sle.inventory_batch_id::text, nullif(sle.batch_id_text, ''), nullif(sle.batch_id, '')) = ib.id::text
    where hlb.company_id = p_company_id and hlb.harvest_lot_id = p_harvest_lot_id
      and ib.warehouse_id = p_source_warehouse_id
      and coalesce(ib.physical_state, 'SOURCE') = coalesce(p_source_physical_state, 'SOURCE')
    group by ib.id, source_ticket.finalized_at, source_ticket.created_at
    having sum(sle.delta_qty_signed) > 0.000001
    order by fifo_received_at, fifo_ticket_at, ib.created_at, ib.id
  loop
    exit when v_remaining <= 0.000001;
    v_take := least(v_remaining, v_bucket.available_kg);
    v_destination_batch_id := private.ensure_transfer_destination_batch_for_document_v1(
      v_bucket.id, p_destination_warehouse_id, p_idempotency_key, v_take
    );
    insert into public.stock_ledger_entries(
      company_id, product_id, crop_id, variety_id, reproduction_id, warehouse_id,
      direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
      batch_id, batch_id_text, batch_class, inventory_batch_id, occurred_at,
      created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      p_company_id, v_bucket.product_id, v_bucket.crop_id, v_bucket.variety_id, v_bucket.reproduction_id,
      p_source_warehouse_id, 'out', v_take, 'kg', -v_take, 'warehouse_transfer', p_idempotency_key,
      v_bucket.id::text, v_bucket.id::text, coalesce(v_bucket.batch_class, 'commodity'), v_bucket.id,
      v_posted_at, v_actor_id, p_notes, v_take, 'aggregate_harvest_lot_fifo', 2
    ), (
      p_company_id, v_bucket.product_id, v_bucket.crop_id, v_bucket.variety_id, v_bucket.reproduction_id,
      p_destination_warehouse_id, 'in', v_take, 'kg', v_take, 'warehouse_transfer', p_idempotency_key,
      v_destination_batch_id::text, v_destination_batch_id::text, coalesce(v_bucket.batch_class, 'commodity'),
      v_destination_batch_id, v_posted_at, v_actor_id, p_notes, v_take, 'aggregate_harvest_lot_fifo', 2
    );
    perform private.reconcile_harvest_lot_batch_balance_v1(v_bucket.id);
    perform private.reconcile_harvest_lot_batch_balance_v1(v_destination_batch_id);
    v_remaining := round(v_remaining - v_take, 6);
    v_ledger_rows := v_ledger_rows + 2;
    v_allocations := v_allocations + 1;
  end loop;
  if v_remaining > 0.000001 then raise exception 'FIFO allocation did not cover requested quantity'; end if;
  return jsonb_build_object('transfer_id', p_idempotency_key, 'transfer_no', v_transfer_no,
    'posted_at', v_posted_at, 'quantity', round(p_quantity, 3), 'uom', 'kg',
    'harvest_lot_id', p_harvest_lot_id, 'allocations', v_allocations,
    'ledger_rows', v_ledger_rows, 'idempotent_replay', false);
end
$function$;

revoke all on function public.prepare_grain_lot_ticket_allocations_v1(uuid) from public, anon;
grant execute on function public.prepare_grain_lot_ticket_allocations_v1(uuid) to authenticated, service_role;
revoke all on function private.assert_harvest_stock_transfer_actor_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) from public, anon;
grant execute on function public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid) to authenticated, service_role;
revoke all on function private.ensure_transfer_destination_batch_for_document_v1(uuid,uuid,uuid,numeric) from public, anon, authenticated;
revoke all on function private.reconcile_harvest_lot_batch_balance_v1(uuid) from public, anon, authenticated;
revoke all on function public.create_harvest_lot_transfer_atomic_v1(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid) from public, anon;
grant execute on function public.create_harvest_lot_transfer_atomic_v1(uuid,uuid,uuid,uuid,uuid,text,numeric,text,uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
