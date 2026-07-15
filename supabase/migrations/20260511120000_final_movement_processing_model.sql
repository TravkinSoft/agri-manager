begin;

-- Final movement model: shipment, field material categories, and processing lineage.

alter table public.tickets
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists buyer_id uuid,
  add column if not exists shipment_purpose text,
  add column if not exists destination_text text,
  add column if not exists external_document_no text,
  add column if not exists field_material_category text,
  add column if not exists disposal_category text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_field_material_category_check'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_field_material_category_check
      check (
        field_material_category is null
        or field_material_category in (
          'seed_planting_material',
          'fertilizer',
          'crop_protection',
          'organic',
          'fuel',
          'other'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_disposal_category_check'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_disposal_category_check
      check (
        disposal_category is null
        or disposal_category in ('utilization', 'spoilage', 'shortage', 'waste', 'other_removal')
      );
  end if;
end $$;

create index if not exists idx_tickets_company_buyer
  on public.tickets(company_id, buyer_id);

create index if not exists idx_tickets_company_field_material_category
  on public.tickets(company_id, field_material_category);

alter table public.inventory_batches
  add column if not exists parent_batch_id uuid references public.inventory_batches(id) on delete set null,
  add column if not exists source_transformation_id uuid,
  add column if not exists origin_type text,
  add column if not exists origin_ref_id uuid,
  add column if not exists supplier_lot text,
  add column if not exists treatment_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_batches_treatment_status_check'
      and conrelid = 'public.inventory_batches'::regclass
  ) then
    alter table public.inventory_batches
      add constraint inventory_batches_treatment_status_check
      check (
        treatment_status is null
        or treatment_status in ('untreated', 'treated', 'in_treatment', 'not_applicable')
      );
  end if;
end $$;

create index if not exists idx_inventory_batches_parent
  on public.inventory_batches(company_id, parent_batch_id);

create index if not exists idx_inventory_batches_transformation
  on public.inventory_batches(company_id, source_transformation_id);

alter table public.batch_transformations
  add column if not exists source_ticket_id uuid references public.tickets(id) on delete set null;

alter table public.batch_transformation_outputs
  add column if not exists batch_class text;

do $$
begin
  alter table public.batch_transformations
    drop constraint if exists batch_transformations_transformation_type_check;

  alter table public.batch_transformations
    add constraint batch_transformations_transformation_type_check
    check (
      transformation_type in (
        'drying',
        'cleaning',
        'sorting',
        'calibration',
        'seed_treatment',
        'seed_selection',
        'packaging',
        'aeration',
        'conditioning',
        'reclassification',
        'potato_sorting',
        'other'
      )
    );

  alter table public.batch_transformation_outputs
    drop constraint if exists batch_transformation_outputs_line_type_check;

  alter table public.batch_transformation_outputs
    add constraint batch_transformation_outputs_line_type_check
    check (
      line_type in (
        'cleaned_seed',
        'commodity',
        'forage_fraction',
        'waste_fraction',
        'soil',
        'shrink_loss',
        'process_loss',
        'treated_seed',
        'calibrated_fraction',
        'packaged',
        'reclassified',
        'potato_marketable',
        'potato_seed',
        'potato_small',
        'potato_rotten',
        'potato_soil',
        'other'
      )
    );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'batch_transformation_outputs_batch_class_check'
      and conrelid = 'public.batch_transformation_outputs'::regclass
  ) then
    alter table public.batch_transformation_outputs
      add constraint batch_transformation_outputs_batch_class_check
      check (
        batch_class is null
        or batch_class in ('commodity', 'seed', 'feed', 'waste', 'processing', 'rejected')
      );
  end if;
end $$;

create index if not exists idx_batch_transformations_company_status
  on public.batch_transformations(company_id, status, created_at desc);

create index if not exists idx_batch_transformation_inputs_identity
  on public.batch_transformation_inputs(company_id, warehouse_from_id, batch_id);

create index if not exists idx_batch_transformation_outputs_identity
  on public.batch_transformation_outputs(company_id, warehouse_to_id, output_batch_id);

create or replace function public.finalize_weighbridge_ticket_v2(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_actor public.profiles%rowtype;
  v_net numeric(14,3);
  v_qty numeric(14,3);
  v_available numeric;
  v_reason text;
  v_wh uuid;
  v_batch_id uuid;
  v_batch_code text;
  v_batch_class text;
  v_area_ha numeric;
  v_season_id uuid;
  v_structure public.crop_structure%rowtype;
begin
  select *
    into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.is_voided or v_ticket.status = 'voided' then
    raise exception 'Voided ticket cannot be finalized';
  end if;

  if v_ticket.is_finalized or v_ticket.status = 'finalized' then
    return p_ticket_id;
  end if;

  select *
    into v_actor
  from public.profiles
  where id = p_actor_user_id;

  if not found or v_actor.company_id <> v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if coalesce(v_actor.role, '') not in ('admin', 'company_admin', 'warehouse', 'weighman') then
    raise exception 'Actor role is not allowed to finalize weighbridge tickets';
  end if;

  if v_ticket.weigh_method = 'manual_override_with_reason' then
    v_net := coalesce(v_ticket.gross_weight_kg, 0);
  else
    if v_ticket.gross_weight_kg is null or v_ticket.tare_weight_kg is null then
      raise exception 'Gross and tare are required before finalization';
    end if;
    v_net := coalesce(v_ticket.gross_weight_kg, 0) - coalesce(v_ticket.tare_weight_kg, 0);
  end if;

  if v_net <= 0 then
    raise exception 'Net weight must be greater than zero';
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
      and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Ticket already has ledger entries';
  end if;

  if not exists (select 1 from public.ticket_lines tl where tl.ticket_id = p_ticket_id) then
    raise exception 'Ticket lines are required';
  end if;

  if v_ticket.op_type = 'issue_to_field' then
    if v_ticket.field_id is null or v_ticket.warehouse_from_id is null or v_ticket.crop_structure_allocation_id is null then
      raise exception 'Field issue requires field, source warehouse and crop structure allocation';
    end if;
    if coalesce(v_ticket.field_material_category, '') not in ('seed_planting_material','fertilizer','crop_protection','organic','fuel','other') then
      raise exception 'Field material category is required';
    end if;

    select *
      into v_structure
    from public.crop_structure cs
    where cs.company_id = v_ticket.company_id
      and cs.field_id = v_ticket.field_id
      and cs.id = v_ticket.crop_structure_allocation_id
      and coalesce(cs.archived, false) = false
    order by cs.created_at desc
    limit 1;

    if not found then
      raise exception 'Selected crop structure allocation is invalid';
    end if;

    v_area_ha := nullif(coalesce(v_structure.area, 0), 0);
    v_season_id := v_structure.season_id;
  end if;

  for v_line in
    select *
    from public.ticket_lines
    where ticket_id = p_ticket_id
    order by created_at asc
  loop
    v_qty := case
      when v_ticket.weigh_method = 'manual_override_with_reason' then coalesce(v_line.quantity, 0)
      else v_net
    end;

    if v_qty <= 0 then
      raise exception 'Ticket line quantity must be greater than zero';
    end if;

    update public.ticket_lines
    set
      quantity = v_qty,
      net_line_weight_kg = v_qty
    where id = v_line.id;

    v_line.quantity := v_qty;
    v_line.net_line_weight_kg := v_qty;
    v_batch_class := coalesce(v_line.batch_class, 'commodity');

    if v_ticket.op_type = 'harvest_incoming' then
      v_batch_class := 'commodity';
    elsif v_ticket.op_type = 'supplier_receipt' and coalesce(v_ticket.supplier_receipt_kind, '') = 'agro_identity' then
      v_batch_class := 'seed';
    elsif v_ticket.op_type = 'disposal' then
      v_batch_class := coalesce(v_line.batch_class, 'waste');
    end if;

    if v_ticket.op_type in ('harvest_incoming', 'supplier_receipt') then
      v_batch_code := coalesce(
        nullif(trim(v_line.lot_id), ''),
        case
          when v_ticket.op_type = 'supplier_receipt' then 'SUP'
          else 'HAR'
        end || '-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || left(v_line.id::text, 8)
      );

      select ib.id
        into v_batch_id
      from public.inventory_batches ib
      where ib.company_id = v_ticket.company_id
        and ib.batch_code = v_batch_code
      limit 1;

      if v_batch_id is null then
        insert into public.inventory_batches (
          company_id,
          season_id,
          product_id,
          crop_id,
          variety_id,
          reproduction_id,
          source_field_id,
          source_ticket_id,
          batch_code,
          status,
          batch_class,
          origin_type,
          origin_ref_id,
          supplier_lot,
          initial_weight_kg,
          current_weight_kg,
          treatment_status
        )
        values (
          v_ticket.company_id,
          v_ticket.season_id,
          v_line.product_id,
          v_line.crop_id,
          v_line.variety_id,
          v_line.reproduction_id,
          v_ticket.field_id,
          v_ticket.id,
          v_batch_code,
          case when v_batch_class = 'seed' then 'ready_for_seeding' else 'commodity' end,
          v_batch_class,
          case when v_ticket.op_type = 'supplier_receipt' then 'supplier' else 'harvest' end,
          v_ticket.id,
          case when v_ticket.op_type = 'supplier_receipt' then v_batch_code else null end,
          v_qty,
          v_qty,
          case when v_batch_class = 'seed' then 'untreated' else 'not_applicable' end
        )
        returning id into v_batch_id;
      end if;

      update public.ticket_lines
      set
        batch_id = v_batch_id,
        lot_id = v_batch_code,
        batch_class = v_batch_class
      where id = v_line.id;

      update public.tickets
      set
        batch_id = coalesce(batch_id, v_batch_id),
        lot_id = coalesce(lot_id, v_batch_code)
      where id = v_ticket.id;

      v_line.batch_id := v_batch_id;
      v_line.lot_id := v_batch_code;
      v_line.batch_class := v_batch_class;
    end if;

    if v_ticket.direction in ('outgoing', 'transfer') then
      v_wh := v_ticket.warehouse_from_id;
      if v_wh is null then
        raise exception 'Source warehouse is required';
      end if;

      select coalesce(sum(sbi.quantity), 0)
        into v_available
      from public.v_stock_balance_identity sbi
      where sbi.company_id = v_ticket.company_id
        and sbi.warehouse_id = v_wh
        and sbi.product_id = v_line.product_id
        and coalesce(sbi.variety_id::text, '') = coalesce(v_line.variety_id::text, '')
        and coalesce(sbi.reproduction_id::text, '') = coalesce(v_line.reproduction_id::text, '')
        and coalesce(sbi.batch_id, '') = coalesce(coalesce(v_line.batch_id::text, v_line.lot_id), '')
        and coalesce(sbi.batch_class, 'commodity') = coalesce(v_line.batch_class, 'commodity');

      if coalesce(v_available, 0) < v_qty then
        raise exception 'Insufficient exact stock identity. Available %, required %', coalesce(v_available, 0), v_qty;
      end if;
    end if;

    if v_ticket.op_type = 'issue_to_field'
       and v_ticket.field_material_category = 'seed_planting_material' then
      if coalesce(v_structure.crop_id::text, '') <> coalesce(v_line.crop_id::text, '')
         or coalesce(v_structure.variety_id::text, '') <> coalesce(v_line.variety_id::text, '')
         or coalesce(v_structure.reproduction_id::text, '') <> coalesce(v_line.reproduction_id::text, '') then
        raise exception 'Seed material does not match selected crop structure allocation';
      end if;
    end if;

    if v_ticket.direction = 'incoming' then
      v_wh := v_ticket.warehouse_to_id;
      if v_wh is null then
        raise exception 'Destination warehouse is required';
      end if;
      v_reason := v_ticket.op_type || '_in';

      insert into public.stock_ledger_entries (
        company_id,
        ticket_id,
        product_id,
        variety_id,
        reproduction_id,
        batch_id_text,
        batch_class,
        warehouse_id,
        direction,
        quantity,
        uom,
        delta_qty_signed,
        reason_type,
        reason_ref_id,
        occurred_at,
        created_by,
        notes
      )
      values (
        v_ticket.company_id,
        v_ticket.id,
        v_line.product_id,
        v_line.variety_id,
        v_line.reproduction_id,
        coalesce(v_line.batch_id::text, v_line.lot_id),
        v_batch_class,
        v_wh,
        'in',
        v_qty,
        coalesce(v_line.uom, 'kg'),
        abs(v_qty),
        v_reason,
        v_ticket.id,
        now(),
        p_actor_user_id,
        v_ticket.notes
      );
    elsif v_ticket.direction = 'transfer' then
      if v_ticket.warehouse_to_id is null then
        raise exception 'Destination warehouse is required for transfer';
      end if;
      if v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
        raise exception 'Source and destination warehouses must be different';
      end if;

      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, variety_id, reproduction_id, batch_id_text, batch_class,
        warehouse_id, direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id, occurred_at, created_by, notes
      )
      values
        (
          v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.variety_id, v_line.reproduction_id,
          coalesce(v_line.batch_id::text, v_line.lot_id), coalesce(v_line.batch_class, 'commodity'),
          v_ticket.warehouse_from_id, 'out', v_qty, coalesce(v_line.uom, 'kg'), -abs(v_qty),
          'warehouse_transfer_out', v_ticket.id, now(), p_actor_user_id, v_ticket.notes
        ),
        (
          v_ticket.company_id, v_ticket.id, v_line.product_id, v_line.variety_id, v_line.reproduction_id,
          coalesce(v_line.batch_id::text, v_line.lot_id), coalesce(v_line.batch_class, 'commodity'),
          v_ticket.warehouse_to_id, 'in', v_qty, coalesce(v_line.uom, 'kg'), abs(v_qty),
          'warehouse_transfer_in', v_ticket.id, now(), p_actor_user_id, v_ticket.notes
        );
    elsif v_ticket.direction = 'outgoing' then
      v_reason := case
        when v_ticket.op_type = 'shipment_outbound' then 'shipment_outbound'
        when v_ticket.op_type = 'issue_to_field' then 'issue_to_field'
        when v_ticket.op_type = 'disposal' then coalesce(v_ticket.disposal_category, 'disposal')
        else coalesce(v_ticket.op_type, 'outgoing')
      end;

      insert into public.stock_ledger_entries (
        company_id,
        ticket_id,
        product_id,
        variety_id,
        reproduction_id,
        batch_id_text,
        batch_class,
        warehouse_id,
        direction,
        quantity,
        uom,
        delta_qty_signed,
        reason_type,
        reason_ref_id,
        occurred_at,
        created_by,
        notes
      )
      values (
        v_ticket.company_id,
        v_ticket.id,
        v_line.product_id,
        v_line.variety_id,
        v_line.reproduction_id,
        coalesce(v_line.batch_id::text, v_line.lot_id),
        coalesce(v_line.batch_class, v_batch_class, 'commodity'),
        v_ticket.warehouse_from_id,
        'out',
        v_qty,
        coalesce(v_line.uom, 'kg'),
        -abs(v_qty),
        v_reason,
        v_ticket.id,
        now(),
        p_actor_user_id,
        v_ticket.notes
      );

      if v_ticket.op_type = 'issue_to_field' then
        insert into public.field_material_consumptions (
          company_id,
          season_id,
          field_id,
          crop_structure_row_id,
          ticket_id,
          ticket_line_id,
          warehouse_id,
          operation_type,
          material_category,
          product_id,
          variety_id,
          reproduction_id,
          batch_id_text,
          batch_class,
          quantity_kg,
          area_ha,
          norm_per_ha,
          responsible_personnel_id,
          vehicle_id,
          notes,
          consumed_at,
          created_by_user_id
        )
        values (
          v_ticket.company_id,
          v_season_id,
          v_ticket.field_id,
          v_ticket.crop_structure_allocation_id,
          v_ticket.id,
          v_line.id,
          v_ticket.warehouse_from_id,
          'issued_to_field',
          v_ticket.field_material_category,
          v_line.product_id,
          v_line.variety_id,
          v_line.reproduction_id,
          coalesce(v_line.batch_id::text, v_line.lot_id),
          coalesce(v_line.batch_class, 'commodity'),
          v_qty,
          v_area_ha,
          case when coalesce(v_area_ha, 0) > 0 then v_qty / v_area_ha else null end,
          v_ticket.driver_id,
          v_ticket.vehicle_id,
          v_ticket.notes,
          now(),
          p_actor_user_id
        )
        on conflict (ticket_line_id) where ticket_line_id is not null
        do update set
          quantity_kg = excluded.quantity_kg,
          area_ha = excluded.area_ha,
          norm_per_ha = excluded.norm_per_ha,
          material_category = excluded.material_category,
          updated_at = now();
      end if;
    else
      raise exception 'Unsupported ticket direction %', v_ticket.direction;
    end if;
  end loop;

  update public.tickets
  set
    net_weight_kg = v_net,
    is_finalized = true,
    status = 'finalized',
    closed_by = p_actor_user_id,
    finalized_at = now(),
    updated_at = now()
  where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

create or replace function public.void_ticket_with_storno_v2(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_actor public.profiles%rowtype;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Void reason is required';
  end if;

  select *
    into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.is_voided or v_ticket.status = 'voided' then
    return p_ticket_id;
  end if;

  select *
    into v_actor
  from public.profiles
  where id = p_actor_user_id;

  if not found or v_actor.company_id <> v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;

  if coalesce(v_actor.role, '') not in ('admin', 'company_admin') then
    raise exception 'Only admin can void finalized tickets';
  end if;

  for v_entry in
    select *
    from public.stock_ledger_entries
    where ticket_id = p_ticket_id
      and coalesce(is_storno, false) = false
  loop
    if exists (
      select 1
      from public.stock_ledger_entries sle
      where sle.storno_of_entry_id = v_entry.id
    ) then
      continue;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      ticket_id,
      processing_id,
      product_id,
      variety_id,
      reproduction_id,
      batch_id_text,
      batch_class,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      batch_id,
      occurred_at,
      created_by,
      is_storno,
      storno_of_entry_id,
      notes
    )
    values (
      v_entry.company_id,
      v_entry.ticket_id,
      v_entry.processing_id,
      v_entry.product_id,
      v_entry.variety_id,
      v_entry.reproduction_id,
      v_entry.batch_id_text,
      v_entry.batch_class,
      v_entry.warehouse_id,
      case when v_entry.direction = 'in' then 'out' else 'in' end,
      v_entry.quantity,
      v_entry.uom,
      -v_entry.delta_qty_signed,
      'storno_' || v_entry.reason_type,
      v_entry.reason_ref_id,
      v_entry.batch_id,
      now(),
      p_actor_user_id,
      true,
      v_entry.id,
      p_reason
    );
  end loop;

  update public.field_material_consumptions
  set notes = concat_ws(E'\n', notes, 'Аннулировано талоном: ' || p_reason),
      updated_at = now()
  where ticket_id = p_ticket_id;

  update public.tickets
  set
    is_voided = true,
    status = 'voided',
    voided_by = p_actor_user_id,
    voided_at = now(),
    void_reason = p_reason,
    updated_at = now()
  where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

create or replace function public.finalize_batch_transformation(
  p_transformation_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trans public.batch_transformations%rowtype;
  v_actor public.profiles%rowtype;
  v_input public.batch_transformation_inputs%rowtype;
  v_output public.batch_transformation_outputs%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_output_batch_id uuid;
  v_output_batch_code text;
  v_batch_class text;
  v_total_input numeric := 0;
  v_total_output numeric := 0;
  v_available numeric;
  v_parent_batch_id uuid;
begin
  select *
    into v_trans
  from public.batch_transformations
  where id = p_transformation_id
  for update;

  if not found then
    raise exception 'Transformation not found';
  end if;

  if v_trans.status = 'completed' then
    return p_transformation_id;
  end if;

  if v_trans.status <> 'draft' then
    raise exception 'Only draft transformation can be finalized';
  end if;

  select *
    into v_actor
  from public.profiles
  where id = p_actor_user_id;

  if not found or v_actor.company_id <> v_trans.company_id then
    raise exception 'Actor does not belong to transformation company';
  end if;

  if coalesce(v_actor.role, '') not in ('admin', 'company_admin', 'warehouse', 'weighman') then
    raise exception 'Actor role is not allowed to finalize transformations';
  end if;

  select coalesce(sum(input_weight_kg), 0)
    into v_total_input
  from public.batch_transformation_inputs
  where transformation_id = p_transformation_id;

  select coalesce(sum(output_weight_kg), 0)
    into v_total_output
  from public.batch_transformation_outputs
  where transformation_id = p_transformation_id;

  if v_total_input <= 0 then
    raise exception 'Transformation input weight must be greater than zero';
  end if;

  if abs(v_total_input - v_total_output) > 0.001 then
    raise exception 'Outputs and losses must equal input weight. Input %, output %', v_total_input, v_total_output;
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.processing_id = p_transformation_id
      and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Transformation already has ledger entries';
  end if;

  for v_input in
    select *
    from public.batch_transformation_inputs
    where transformation_id = p_transformation_id
    order by created_at asc
  loop
    if v_input.warehouse_from_id is null then
      raise exception 'Input warehouse is required';
    end if;
    if v_input.batch_id is null then
      raise exception 'Input batch is required';
    end if;

    select *
      into v_batch
    from public.inventory_batches
    where id = v_input.batch_id
      and company_id = v_trans.company_id;

    if not found then
      raise exception 'Input batch not found';
    end if;

    v_parent_batch_id := coalesce(v_parent_batch_id, v_batch.id);

    select coalesce(sum(sbi.quantity), 0)
      into v_available
    from public.v_stock_balance_identity sbi
    where sbi.company_id = v_trans.company_id
      and sbi.warehouse_id = v_input.warehouse_from_id
      and sbi.product_id = coalesce(v_batch.product_id, v_batch.crop_id)
      and coalesce(sbi.variety_id::text, '') = coalesce(v_batch.variety_id::text, '')
      and coalesce(sbi.reproduction_id::text, '') = coalesce(v_batch.reproduction_id::text, '')
      and coalesce(sbi.batch_id, '') = coalesce(v_batch.id::text, v_batch.batch_code, '')
      and coalesce(sbi.batch_class, 'commodity') = coalesce(v_batch.batch_class, 'commodity');

    if coalesce(v_available, 0) < v_input.input_weight_kg then
      raise exception 'Insufficient input batch stock. Available %, required %', coalesce(v_available, 0), v_input.input_weight_kg;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      processing_id,
      product_id,
      variety_id,
      reproduction_id,
      batch_id_text,
      batch_class,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes
    )
    values (
      v_trans.company_id,
      v_trans.id,
      coalesce(v_batch.product_id, v_batch.crop_id),
      v_batch.variety_id,
      v_batch.reproduction_id,
      coalesce(v_batch.id::text, v_batch.batch_code),
      coalesce(v_batch.batch_class, 'commodity'),
      v_input.warehouse_from_id,
      'out',
      v_input.input_weight_kg,
      'kg',
      -abs(v_input.input_weight_kg),
      'processing_input',
      v_trans.id,
      now(),
      p_actor_user_id,
      v_trans.note
    );
  end loop;

  for v_output in
    select *
    from public.batch_transformation_outputs
    where transformation_id = p_transformation_id
    order by created_at asc
  loop
    v_batch_class := coalesce(
      v_output.batch_class,
      case
        when v_output.line_type in ('cleaned_seed', 'treated_seed', 'potato_seed') then 'seed'
        when v_output.line_type in ('forage_fraction', 'potato_small') then 'feed'
        when v_output.line_type in ('waste_fraction', 'soil', 'potato_rotten', 'potato_soil') then 'waste'
        when v_output.line_type in ('shrink_loss', 'process_loss') then 'waste'
        else 'commodity'
      end
    );

    if v_output.line_type in ('shrink_loss', 'process_loss') then
      continue;
    end if;

    if v_output.warehouse_to_id is null then
      raise exception 'Stored output requires destination warehouse';
    end if;

    select *
      into v_batch
    from public.inventory_batches
    where id = v_parent_batch_id
      and company_id = v_trans.company_id;

    v_output_batch_id := v_output.output_batch_id;

    if v_output_batch_id is null then
      v_output_batch_code := 'TR-' || left(v_trans.id::text, 8) || '-' || left(v_output.id::text, 8);

      insert into public.inventory_batches (
        company_id,
        season_id,
        product_id,
        crop_id,
        variety_id,
        reproduction_id,
        batch_code,
        status,
        batch_class,
        initial_weight_kg,
        current_weight_kg,
        parent_batch_id,
        source_transformation_id,
        origin_type,
        origin_ref_id,
        treatment_status,
        quality_json
      )
      values (
        v_trans.company_id,
        v_batch.season_id,
        v_batch.product_id,
        v_batch.crop_id,
        v_batch.variety_id,
        v_batch.reproduction_id,
        v_output_batch_code,
        case
          when v_batch_class = 'seed' and v_trans.transformation_type = 'seed_treatment' then 'treated'
          when v_batch_class = 'seed' then 'ready_for_seeding'
          when v_batch_class = 'waste' then 'waste'
          when v_trans.transformation_type = 'drying' then 'conditioned'
          when v_trans.transformation_type = 'cleaning' then 'conditioned'
          else 'commodity'
        end,
        v_batch_class,
        v_output.output_weight_kg,
        v_output.output_weight_kg,
        v_parent_batch_id,
        v_trans.id,
        'processing',
        v_trans.id,
        case
          when v_trans.transformation_type = 'seed_treatment' then 'treated'
          when v_batch_class = 'seed' then coalesce(v_batch.treatment_status, 'untreated')
          else 'not_applicable'
        end,
        v_output.output_quality_json
      )
      returning id into v_output_batch_id;

      update public.batch_transformation_outputs
      set output_batch_id = v_output_batch_id,
          batch_class = v_batch_class
      where id = v_output.id;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      processing_id,
      product_id,
      variety_id,
      reproduction_id,
      batch_id_text,
      batch_class,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes
    )
    values (
      v_trans.company_id,
      v_trans.id,
      coalesce(v_batch.product_id, v_batch.crop_id),
      v_batch.variety_id,
      v_batch.reproduction_id,
      v_output_batch_id::text,
      v_batch_class,
      v_output.warehouse_to_id,
      'in',
      v_output.output_weight_kg,
      'kg',
      abs(v_output.output_weight_kg),
      'processing_output',
      v_trans.id,
      now(),
      p_actor_user_id,
      v_trans.note
    );
  end loop;

  update public.batch_transformations
  set
    status = 'completed',
    completed_at = now(),
    completed_by = p_actor_user_id,
    updated_at = now()
  where id = p_transformation_id;

  return p_transformation_id;
end;
$$;

drop index if exists public.idx_processing_nodes_company_active;

notify pgrst, 'reload schema';

commit;
