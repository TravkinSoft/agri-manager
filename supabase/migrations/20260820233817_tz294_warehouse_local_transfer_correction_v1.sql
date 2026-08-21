begin;

-- A ledger row must point to a physical batch located in the same warehouse.
-- This replaces the two-trigger sequence that could validate NULL first and
-- populate an invalid harvest batch afterwards.
create or replace function public.populate_ledger_inventory_batch_trace_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_allocation public.warehouse_issue_request_item_allocations%rowtype;
  v_batch public.inventory_batches%rowtype;
begin
  if new.inventory_batch_id is null and new.warehouse_issue_allocation_id is not null then
    select * into v_allocation
    from public.warehouse_issue_request_item_allocations a
    where a.id = new.warehouse_issue_allocation_id
      and a.company_id = new.company_id;
    if not found then
      raise exception 'Ledger allocation does not belong to the target company'
        using errcode = '23503';
    end if;
    new.inventory_batch_id := v_allocation.batch_id;
  end if;

  if new.inventory_batch_id is null
     and coalesce(new.batch_id_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_batch
    from public.inventory_batches b
    where b.id = new.batch_id_text::uuid
      and b.company_id = new.company_id;
    if found then new.inventory_batch_id := v_batch.id; end if;
  end if;

  if new.inventory_batch_id is null then return new; end if;

  if v_batch.id is null or v_batch.id is distinct from new.inventory_batch_id then
    select * into v_batch
    from public.inventory_batches b
    where b.id = new.inventory_batch_id
      and b.company_id = new.company_id;
  end if;
  if not found then
    raise exception 'Ledger inventory batch does not belong to the target company'
      using errcode = '23503';
  end if;
  if v_batch.product_id is distinct from new.product_id
     or v_batch.warehouse_id is distinct from new.warehouse_id then
    raise exception 'Ledger product or warehouse does not match the inventory batch'
      using errcode = '23514';
  end if;

  new.crop_id := coalesce(v_batch.crop_id, new.crop_id);
  new.variety_id := coalesce(v_batch.variety_id, new.variety_id);
  new.reproduction_id := coalesce(v_batch.reproduction_id, new.reproduction_id);
  new.batch_class := coalesce(v_batch.batch_class, new.batch_class, 'commodity');
  new.batch_id := v_batch.id::text;
  new.batch_id_text := v_batch.id::text;

  if v_batch.batch_class = 'seed' then
    if v_batch.uom <> 'kg' or new.uom <> 'kg'
       or v_batch.crop_id is null
       or v_batch.variety_id is null
       or v_batch.reproduction_id is null then
      raise exception 'Seed batch must use exact identity and canonical kg'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function public.populate_ledger_inventory_batch_trace_v2()
  from public, anon, authenticated;
drop trigger if exists populate_seed_ledger_batch_trace_v1 on public.stock_ledger_entries;
drop trigger if exists zz_populate_harvest_inventory_batch_ledger_v1 on public.stock_ledger_entries;
drop trigger if exists populate_ledger_inventory_batch_trace_v2 on public.stock_ledger_entries;
create trigger populate_ledger_inventory_batch_trace_v2
before insert or update of ticket_id, inventory_batch_id, warehouse_issue_allocation_id,
  product_id, warehouse_id, uom, batch_class, batch_id, batch_id_text
on public.stock_ledger_entries
for each row execute function public.populate_ledger_inventory_batch_trace_v2();

create or replace function private.ensure_transfer_destination_batch_v1(
  p_source_batch_id uuid,
  p_destination_warehouse_id uuid,
  p_ticket_id uuid,
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
  select * into v_source
  from public.inventory_batches b
  where b.id = p_source_batch_id
  for update;
  if not found then raise exception 'Transfer source batch not found'; end if;
  if v_source.batch_class <> 'commodity' then
    raise exception 'Warehouse-local transfer batches are only available for commodity stock';
  end if;
  if coalesce(p_quantity_kg, 0) <= 0 then
    raise exception 'Transfer destination batch quantity must be positive';
  end if;
  if v_source.warehouse_id is null
     or p_destination_warehouse_id is null
     or v_source.warehouse_id = p_destination_warehouse_id then
    raise exception 'Transfer source and destination warehouses must be different';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_source.company_id::text || ':' || v_source.id::text || ':' || p_destination_warehouse_id::text, 0)
  );
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
    insert into public.inventory_batches (
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
      p_ticket_id, v_source.harvest_year, v_batch_code, v_source.status,
      p_quantity_kg, p_quantity_kg, v_source.moisture_percent, v_source.purity_percent,
      v_source.dockage_percent, v_source.germination_percent, v_source.energy_percent,
      v_source.quality_json, 'commodity', v_source.id, 'transfer', p_ticket_id,
      v_source.treatment_status, p_quantity_kg, p_quantity_kg,
      coalesce(v_source.uom, 'kg'), p_quantity_kg,
      v_source.density_kg_per_l, v_source.density_unit, v_source.density_source,
      v_source.density_verification_status, v_source.density_verified_at,
      'warehouse_local_transfer', 2, v_source.crop_structure_id,
      v_source.harvesting_operation_id, p_destination_warehouse_id, now(),
      'warehouse_transfer', coalesce(v_source.composition_snapshot, '[]'::jsonb),
      v_source.composition_hash, v_source.display_name, v_source.is_mixed_harvest,
      v_source.planting_operation_id, v_source.physical_state
    )
    returning * into v_destination;
  end if;

  select hlb.harvest_lot_id into v_lot_id
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_source.company_id
    and hlb.inventory_batch_id = v_source.id;
  if v_lot_id is null then
    raise exception 'Source batch has no aggregate harvest lot';
  end if;

  insert into public.harvest_lot_batches (
    company_id, harvest_lot_id, inventory_batch_id, source_ticket_id,
    crop_structure_id, assignment_reason
  ) values (
    v_source.company_id, v_lot_id, v_destination.id, p_ticket_id,
    v_source.crop_structure_id, 'warehouse_local_transfer_child'
  )
  on conflict (inventory_batch_id) do update
  set harvest_lot_id = excluded.harvest_lot_id,
      source_ticket_id = coalesce(public.harvest_lot_batches.source_ticket_id, excluded.source_ticket_id),
      crop_structure_id = coalesce(public.harvest_lot_batches.crop_structure_id, excluded.crop_structure_id),
      assignment_reason = 'warehouse_local_transfer_child',
      updated_at = now();

  return v_destination.id;
end
$function$;

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
    and sle.inventory_batch_id = v_batch.id;
  if v_balance < -0.001 then
    raise exception 'Warehouse-local batch balance would become negative: %', v_balance;
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

create or replace function private.repair_legacy_transfer_batch_trace_v1(p_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_source public.inventory_batches%rowtype;
  v_destination_batch_id uuid;
  v_lot_id uuid;
  v_repaired integer := 0;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found or v_ticket.direction::text <> 'transfer' then return 0; end if;

  for v_entry in
    select sle.*
    from public.stock_ledger_entries sle
    join public.inventory_batches ib on ib.id = sle.inventory_batch_id
    where sle.ticket_id = v_ticket.id
      and sle.company_id = v_ticket.company_id
      and sle.direction::text = 'in'
      and not coalesce(sle.is_storno, false)
      and ib.batch_class = 'commodity'
      and ib.warehouse_id is distinct from sle.warehouse_id
    order by sle.created_at, sle.id
    for update of sle
  loop
    select * into v_source from public.inventory_batches where id = v_entry.inventory_batch_id for update;
    v_destination_batch_id := private.ensure_transfer_destination_batch_v1(
      v_source.id, v_entry.warehouse_id, v_ticket.id, abs(v_entry.delta_qty_signed)
    );
    update public.stock_ledger_entries
    set inventory_batch_id = v_destination_batch_id,
        batch_id = v_destination_batch_id::text,
        batch_id_text = v_destination_batch_id::text
    where id = v_entry.id;
    perform private.reconcile_warehouse_local_batch_balance_v1(v_source.id);
    perform private.reconcile_warehouse_local_batch_balance_v1(v_destination_batch_id);
    select harvest_lot_id into v_lot_id
    from public.harvest_lot_batches where inventory_batch_id = v_source.id;
    v_repaired := v_repaired + 1;
  end loop;

  if v_repaired > 0 then
    update public.tickets
    set harvest_lot_id = coalesce(harvest_lot_id, v_lot_id),
        audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
          'warehouse_local_transfer_repair', jsonb_build_object(
            'contract_version', 'tz294_v1',
            'repaired_at', now(),
            'repaired_destination_entries', v_repaired
          )
        ),
        updated_at = now()
    where id = v_ticket.id;

    update public.tickets c
    set harvest_lot_id = coalesce(c.harvest_lot_id, v_lot_id),
        processing_allocation_ready = false,
        audit_json = coalesce(c.audit_json, '{}'::jsonb) || jsonb_build_object(
          'warehouse_local_transfer_repair', jsonb_build_object(
            'contract_version', 'tz294_v1',
            'source_ticket_id', v_ticket.id,
            'repaired_at', now()
          )
        ),
        updated_at = now()
    where c.correction_of_ticket_id = v_ticket.id
      and not c.is_finalized
      and not c.is_voided
      and c.status::text not in ('finalized', 'voided');
  end if;
  return v_repaired;
end
$function$;

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
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_ticket.direction::text <> 'transfer' then raise exception 'Ticket is not a warehouse transfer'; end if;
  if v_ticket.is_voided or v_ticket.status::text = 'voided' then raise exception 'Voided ticket cannot be finalized'; end if;
  if v_ticket.is_finalized or v_ticket.status::text = 'finalized' then return v_ticket.id; end if;
  if v_ticket.warehouse_from_id is null or v_ticket.warehouse_to_id is null
     or v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
    raise exception 'Source and destination warehouses must be different';
  end if;
  if coalesce(v_ticket.net_weight_kg, 0) <= 0 then raise exception 'Net weight must be greater than zero'; end if;
  if exists (
    select 1 from public.stock_ledger_entries sle
    where sle.ticket_id = v_ticket.id and not coalesce(sle.is_storno, false)
  ) then
    raise exception 'Ticket already has ledger entries';
  end if;

  perform public.prepare_grain_lot_ticket_allocations_v1(v_ticket.id);

  for v_line in
    select * from public.ticket_lines where ticket_id = v_ticket.id order by created_at, id
  loop
    v_line_count := v_line_count + 1;
    v_line_qty := round(coalesce(v_line.quantity_kg, v_line.quantity, v_line.mass_kg, v_line.net_line_weight_kg, 0), 6);
    if v_line_qty <= 0 then raise exception 'Transfer line quantity must be greater than zero'; end if;
    if coalesce(v_line.batch_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Transfer line must reference an exact source inventory batch';
    end if;
    v_source_batch_id := v_line.batch_id::uuid;
    select * into v_source
    from public.inventory_batches b
    where b.id = v_source_batch_id
      and b.company_id = v_ticket.company_id
      and b.warehouse_id = v_ticket.warehouse_from_id
      and b.product_id is not distinct from v_line.product_id
      and b.batch_class = 'commodity'
    for update;
    if not found then raise exception 'Transfer source batch identity does not match source warehouse'; end if;

    select round(coalesce(sum(sle.delta_qty_signed), 0), 6) into v_available
    from public.stock_ledger_entries sle
    where sle.company_id = v_ticket.company_id
      and sle.warehouse_id = v_ticket.warehouse_from_id
      and sle.inventory_batch_id = v_source.id;
    if v_available + 0.001 < v_line_qty then
      raise exception 'Insufficient warehouse-local batch stock. Available %, required %', v_available, v_line_qty;
    end if;

    v_destination_batch_id := private.ensure_transfer_destination_batch_v1(
      v_source.id, v_ticket.warehouse_to_id, v_ticket.id, v_line_qty
    );
    select hlb.harvest_lot_id into v_lot_id
    from public.harvest_lot_batches hlb where hlb.inventory_batch_id = v_source.id;
    if v_transfer_lot_id is null then
      v_transfer_lot_id := v_lot_id;
    elsif v_transfer_lot_id is distinct from v_lot_id then
      raise exception 'A transfer ticket cannot mix aggregate harvest lots';
    end if;
    if v_ticket.harvest_lot_id is not null and v_ticket.harvest_lot_id is distinct from v_lot_id then
      raise exception 'Transfer source batch does not belong to the selected aggregate lot';
    end if;

    insert into public.stock_ledger_entries (
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      batch_id, batch_id_text, batch_class, inventory_batch_id, warehouse_id,
      direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
      occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.crop_id,
      v_line.variety_id, v_line.reproduction_id, v_source.id::text,
      v_source.id::text, 'commodity', v_source.id, v_ticket.warehouse_from_id,
      'out', v_line_qty, 'kg', -v_line_qty, 'warehouse_transfer_out',
      v_ticket.id, now(), p_actor_user_id, v_ticket.notes, v_line_qty,
      'warehouse_local_transfer', 2
    ), (
      v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.crop_id,
      v_line.variety_id, v_line.reproduction_id, v_destination_batch_id::text,
      v_destination_batch_id::text, 'commodity', v_destination_batch_id,
      v_ticket.warehouse_to_id, 'in', v_line_qty, 'kg', v_line_qty,
      'warehouse_transfer_in', v_ticket.id, now(), p_actor_user_id,
      v_ticket.notes, v_line_qty, 'warehouse_local_transfer', 2
    );

    perform private.reconcile_warehouse_local_batch_balance_v1(v_source.id);
    perform private.reconcile_warehouse_local_batch_balance_v1(v_destination_batch_id);
    v_total := v_total + v_line_qty;
  end loop;

  if v_line_count = 0 then raise exception 'Transfer ticket lines are required'; end if;
  if abs(v_total - v_ticket.net_weight_kg) > 0.001 then
    raise exception 'Transfer line total % does not match ticket net %', v_total, v_ticket.net_weight_kg;
  end if;
  if not exists (
    select 1 from public.stock_ledger_entries sle
    join public.inventory_batches ib on ib.id = sle.inventory_batch_id
    where sle.ticket_id = v_ticket.id
      and sle.direction::text = 'in'
      and ib.warehouse_id = v_ticket.warehouse_to_id
      and exists (
        select 1 from public.harvest_lot_batches hlb
        where hlb.inventory_batch_id = ib.id and hlb.harvest_lot_id = v_transfer_lot_id
      )
  ) then
    raise exception 'Destination batch aggregate-lot trace postcondition failed';
  end if;

  update public.tickets
  set harvest_lot_id = coalesce(harvest_lot_id, v_transfer_lot_id),
      is_finalized = true,
      status = 'finalized',
      closed_by = p_actor_user_id,
      finalized_at = now(),
      updated_at = now()
  where id = v_ticket.id;
  perform public.backfill_ticket_operation_line_links_v1(v_ticket.id);
  return v_ticket.id;
end
$function$;

create or replace function public.finalize_weighbridge_ticket_for_session_v1(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_role text;
  v_line_count integer;
begin
  if v_auth_user_id is null then raise exception 'Authenticated session is required'; end if;
  select * into v_actor from public.profiles where id = v_auth_user_id limit 1;
  if not found or coalesce(v_actor.status, 'active') <> 'active' then raise exception 'Active actor profile not found'; end if;
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  v_role := coalesce(v_actor.role, '');
  if v_role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if v_role not in ('global_admin','admin','company_admin','director','warehouse',
    'warehouse_operator','warehouse_manager','weighman','weighbridge_operator') then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;

  select count(*) into v_line_count from public.ticket_lines where ticket_id = p_ticket_id;
  if v_line_count = 1
     and coalesce(v_ticket.weigh_method::text, '') <> 'manual_override_with_reason'
     and coalesce(v_ticket.net_weight_kg, 0) > 0
     and exists (select 1 from public.ticket_lines where ticket_id = p_ticket_id and public.canonical_stock_uom(uom) = 'kg') then
    update public.ticket_lines
    set quantity = v_ticket.net_weight_kg,
        quantity_kg = v_ticket.net_weight_kg,
        net_line_weight_kg = v_ticket.net_weight_kg,
        mass_kg = v_ticket.net_weight_kg,
        updated_at = now()
    where ticket_id = p_ticket_id;
  end if;

  if v_ticket.direction::text = 'transfer' then
    perform private.finalize_warehouse_local_transfer_v1(p_ticket_id, v_actor.id);
  else
    perform public.prepare_grain_lot_ticket_allocations_v1(p_ticket_id);
    perform public.finalize_weighbridge_ticket_v2(p_ticket_id, v_actor.id);
    perform public.backfill_ticket_operation_line_links_v1(p_ticket_id);
  end if;
  return p_ticket_id;
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
  if abs(coalesce((
    select sum(sle.delta_qty_signed)
    from public.stock_ledger_entries sle
    where sle.ticket_id in (v_old.id, v_new.id)
  ), 0)) > 0.001 then
    raise exception 'Transfer correction changed total company stock';
  end if;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_new.company_id, v_actor.id, 'weighbridge_ticket', v_old.id::text,
    'ticket_replaced',
    jsonb_build_object('ticket_id', v_old.id, 'ticket_no', v_old.ticket_no, 'net_weight_kg', v_old.net_weight_kg),
    jsonb_build_object('ticket_id', v_new.id, 'ticket_no', v_new.ticket_no,
      'net_weight_kg', v_new.net_weight_kg, 'operator_person_id', p_operator_person_id,
      'shift_id', p_shift_id, 'accounting_contract', 'warehouse_local_transfer_v1'),
    v_new.correction_reason
  );
  return v_new.id;
end
$function$;

revoke all on function private.ensure_transfer_destination_batch_v1(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function private.reconcile_warehouse_local_batch_balance_v1(uuid) from public, anon, authenticated;
revoke all on function private.repair_legacy_transfer_batch_trace_v1(uuid) from public, anon, authenticated;
revoke all on function private.finalize_warehouse_local_transfer_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_weighbridge_ticket_for_session_v1(uuid) from public, anon;
revoke all on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.finalize_weighbridge_ticket_for_session_v1(uuid) to authenticated, service_role;
grant execute on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid) to authenticated;

-- Deterministically repair any legacy commodity transfer whose destination IN
-- still points at a batch belonging to the source warehouse. Ticket weights,
-- status and ledger amounts are not changed.
do $repair$
declare
  v_ticket_id uuid;
begin
  for v_ticket_id in
    select distinct sle.ticket_id
    from public.stock_ledger_entries sle
    join public.tickets t on t.id = sle.ticket_id and t.company_id = sle.company_id
    join public.tickets c on c.correction_of_ticket_id = t.id
      and not c.is_finalized
      and not c.is_voided
      and c.status::text not in ('finalized', 'voided')
    join public.inventory_batches ib on ib.id = sle.inventory_batch_id
    where t.direction::text = 'transfer'
      and sle.direction::text = 'in'
      and not coalesce(sle.is_storno, false)
      and ib.batch_class = 'commodity'
      and ib.warehouse_id is distinct from sle.warehouse_id
    order by sle.ticket_id
  loop
    perform private.repair_legacy_transfer_batch_trace_v1(v_ticket_id);
  end loop;
end
$repair$;

notify pgrst, 'reload schema';

commit;
