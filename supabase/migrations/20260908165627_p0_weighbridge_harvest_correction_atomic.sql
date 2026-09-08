-- P0: a harvest ticket correction must replace the original physical intake
-- atomically. It must not reuse the original inventory batch through the
-- generic ticket finalizer. This migration is deliberately DDL-only: it
-- defines/patches functions and never executes a correction or backfill.

begin;

do $p0_harvest_correction_preflight$
declare
  v_missing text;
  v_dependency_source text;
  v_finalize_source text;
begin
  if pg_catalog.to_regprocedure(
       'private.weighbridge_ticket_has_downstream_dependencies_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.acquire_ticket_processing_gate_for_session_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.reconcile_harvest_lot_batch_balance_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.ensure_harvest_lot_for_batch_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.backfill_ticket_operation_line_links_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.canonical_stock_uom(text)'
     ) is null
  then
    raise exception 'P0 harvest correction prerequisite function drift';
  end if;

  select pg_catalog.string_agg(required.relation_name || '.' || required.column_name, ', ')
    into v_missing
  from (
    values
      ('tickets', 'id'),
      ('tickets', 'company_id'),
      ('tickets', 'correction_of_ticket_id'),
      ('tickets', 'replacement_ticket_id'),
      ('tickets', 'op_type'),
      ('tickets', 'direction'),
      ('tickets', 'warehouse_to_id'),
      ('tickets', 'season_id'),
      ('tickets', 'field_id'),
      ('tickets', 'gross_weight_kg'),
      ('tickets', 'tare_weight_kg'),
      ('tickets', 'net_weight_kg'),
      ('tickets', 'physical_net_kg'),
      ('tickets', 'explicit_deductions_kg'),
      ('tickets', 'accepted_weight_kg'),
      ('tickets', 'harvest_lot_id'),
      ('tickets', 'batch_id'),
      ('tickets', 'lot_id'),
      ('tickets', 'is_finalized'),
      ('tickets', 'is_voided'),
      ('tickets', 'status'),
      ('tickets', 'audit_json'),
      ('tickets', 'processing_allocation_ready'),
      ('tickets', 'correction_reason'),
      ('tickets', 'correction_completed_at'),
      ('tickets', 'created_by_person_id'),
      ('tickets', 'finalized_by_person_id'),
      ('tickets', 'closed_by'),
      ('tickets', 'finalized_at'),
      ('tickets', 'notes'),
      ('tickets', 'updated_at'),
      ('ticket_lines', 'ticket_id'),
      ('ticket_lines', 'company_id'),
      ('ticket_lines', 'product_id'),
      ('ticket_lines', 'crop_id'),
      ('ticket_lines', 'variety_id'),
      ('ticket_lines', 'reproduction_id'),
      ('ticket_lines', 'gross_line_weight_kg'),
      ('ticket_lines', 'tare_line_weight_kg'),
      ('ticket_lines', 'net_line_weight_kg'),
      ('ticket_lines', 'quantity'),
      ('ticket_lines', 'quantity_kg'),
      ('ticket_lines', 'mass_kg'),
      ('ticket_lines', 'batch_id'),
      ('ticket_lines', 'lot_id'),
      ('ticket_lines', 'quality_json'),
      ('ticket_lines', 'uom'),
      ('ticket_lines', 'moisture_percent'),
      ('ticket_lines', 'dirt_tare_percent'),
      ('ticket_lines', 'batch_class'),
      ('ticket_lines', 'warehouse_to_id'),
      ('ticket_lines', 'unit_source'),
      ('ticket_lines', 'unit_contract_version'),
      ('ticket_lines', 'updated_at'),
      ('inventory_batches', 'source_ticket_id'),
      ('inventory_batches', 'origin_type'),
      ('inventory_batches', 'warehouse_id'),
      ('inventory_batches', 'batch_code'),
      ('inventory_batches', 'initial_weight_kg'),
      ('inventory_batches', 'current_weight_kg'),
      ('inventory_batches', 'initial_quantity'),
      ('inventory_batches', 'current_quantity'),
      ('inventory_batches', 'mass_kg'),
      ('inventory_batches', 'season_id'),
      ('inventory_batches', 'product_id'),
      ('inventory_batches', 'crop_id'),
      ('inventory_batches', 'variety_id'),
      ('inventory_batches', 'reproduction_id'),
      ('inventory_batches', 'source_field_id'),
      ('inventory_batches', 'status'),
      ('inventory_batches', 'batch_class'),
      ('inventory_batches', 'origin_ref_id'),
      ('inventory_batches', 'moisture_percent'),
      ('inventory_batches', 'treatment_status'),
      ('inventory_batches', 'uom'),
      ('inventory_batches', 'unit_source'),
      ('inventory_batches', 'unit_contract_version'),
      ('inventory_batches', 'received_at'),
      ('harvest_lots', 'id'),
      ('harvest_lots', 'company_id'),
      ('harvest_lots', 'status'),
      ('harvest_lot_batches', 'harvest_lot_id'),
      ('harvest_lot_batches', 'inventory_batch_id'),
      ('harvest_lot_batches', 'source_ticket_id'),
      ('stock_ledger_entries', 'ticket_id'),
      ('stock_ledger_entries', 'inventory_batch_id'),
      ('stock_ledger_entries', 'delta_qty_signed'),
      ('stock_ledger_entries', 'is_storno'),
      ('stock_ledger_entries', 'id'),
      ('stock_ledger_entries', 'company_id'),
      ('stock_ledger_entries', 'product_id'),
      ('stock_ledger_entries', 'crop_id'),
      ('stock_ledger_entries', 'variety_id'),
      ('stock_ledger_entries', 'reproduction_id'),
      ('stock_ledger_entries', 'batch_id'),
      ('stock_ledger_entries', 'batch_id_text'),
      ('stock_ledger_entries', 'batch_class'),
      ('stock_ledger_entries', 'warehouse_id'),
      ('stock_ledger_entries', 'direction'),
      ('stock_ledger_entries', 'quantity'),
      ('stock_ledger_entries', 'uom'),
      ('stock_ledger_entries', 'reason_type'),
      ('stock_ledger_entries', 'reason_ref_id'),
      ('stock_ledger_entries', 'occurred_at'),
      ('stock_ledger_entries', 'created_by'),
      ('stock_ledger_entries', 'notes'),
      ('stock_ledger_entries', 'mass_kg'),
      ('stock_ledger_entries', 'unit_source'),
      ('stock_ledger_entries', 'unit_contract_version'),
      ('ticket_weighings', 'ticket_id'),
      ('ticket_weighings', 'company_id'),
      ('ticket_weighings', 'weighing_no'),
      ('ticket_weighings', 'measured_weight_kg'),
      ('batch_transformation_inputs', 'batch_id'),
      ('field_history_entries', 'harvest_ticket_id')
  ) as required(relation_name, column_name)
  where not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = required.relation_name
      and attribute.attname = required.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped
  );
  if v_missing is not null then
    raise exception 'P0 harvest correction column drift: %', v_missing;
  end if;

  select procedure.prosrc
    into v_dependency_source
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'private.weighbridge_ticket_has_downstream_dependencies_v1(uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(v_dependency_source, 'P0_HARVEST_CORRECTION_SELF_REFERENCE_V1') = 0
     and (
       pg_catalog.strpos(v_dependency_source, 'from public.batch_transformation_inputs') = 0
       or pg_catalog.strpos(v_dependency_source, 'from public.stock_ledger_entries') = 0
       or pg_catalog.strpos(v_dependency_source, 'from public.ticket_lines') = 0
       or pg_catalog.strpos(v_dependency_source, 'tl.ticket_id <> p_ticket_id') = 0
     )
  then
    raise exception 'P0 harvest correction downstream helper drift';
  end if;

  select procedure.prosrc
    into v_finalize_source
  from pg_catalog.pg_proc procedure
  where procedure.oid =
    'public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(v_finalize_source, 'P0_HARVEST_CORRECTION_ATOMIC_V1') = 0
     and (
       pg_catalog.strpos(v_finalize_source, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') = 0
       or pg_catalog.strpos(
         v_finalize_source,
         'perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);'
       ) = 0
       or pg_catalog.strpos(v_finalize_source, 'v_lineage jsonb;') = 0
     )
  then
    raise exception 'P0 harvest correction canonical finalizer drift';
  end if;
end
$p0_harvest_correction_preflight$;

create or replace function private.weighbridge_ticket_has_downstream_dependencies_v1(
  p_ticket_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  -- P0_HARVEST_CORRECTION_SELF_REFERENCE_V1
  with source_batches as (
    select ib.id, ib.batch_code
    from public.inventory_batches ib
    where ib.source_ticket_id = p_ticket_id
  )
  select
    exists (
      select 1
      from public.batch_transformation_inputs bti
      join source_batches sb on sb.id = bti.batch_id
    )
    or exists (
      select 1
      from public.stock_ledger_entries sle
      where coalesce(sle.is_storno, false) = false
        and sle.ticket_id is distinct from p_ticket_id
        and (
          sle.inventory_batch_id in (select id from source_batches)
          or sle.batch_id_text in (select id::text from source_batches)
          or sle.batch_id_text in (select batch_code from source_batches)
        )
    )
    or exists (
      select 1
      from public.ticket_lines tl
      join public.tickets t on t.id = tl.ticket_id
      where tl.ticket_id <> p_ticket_id
        and t.correction_of_ticket_id is distinct from p_ticket_id
        and coalesce(t.is_voided, false) = false
        and (
          tl.batch_id in (select id::text from source_batches)
          or tl.batch_id in (select batch_code from source_batches)
          or tl.lot_id in (select id::text from source_batches)
          or tl.lot_id in (select batch_code from source_batches)
        )
    );
$function$;

revoke all on function private.weighbridge_ticket_has_downstream_dependencies_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.finalize_harvest_correction_accounting_v1(
  p_ticket_id uuid,
  p_original_ticket_id uuid,
  p_actor_user_id uuid,
  p_operator_person_id uuid default null
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
  v_source_batch public.inventory_batches%rowtype;
  v_line_id uuid;
  v_source_batch_id uuid;
  v_new_batch_id uuid;
  v_expected_lot_id uuid;
  v_actual_lot_id uuid;
  v_ledger_id uuid;
  v_batch_code text;
  v_gross numeric(18,6);
  v_tare numeric(18,6);
  v_net numeric(18,6);
  v_line_count integer;
  v_source_count integer;
  v_count integer;
  v_balance numeric(18,6);
begin
  -- P0_HARVEST_CORRECTION_ACCOUNTING_V1
  select * into v_new
  from public.tickets
  where id = p_ticket_id
  for update;
  if not found then raise exception 'Harvest correction ticket not found'; end if;

  select * into v_old
  from public.tickets
  where id = p_original_ticket_id
  for update;
  if not found then raise exception 'Harvest correction original ticket not found'; end if;

  if v_new.correction_of_ticket_id is distinct from v_old.id
     or v_new.company_id is distinct from v_old.company_id
     or v_new.op_type <> 'harvest_incoming'
     or v_old.op_type <> 'harvest_incoming'
     or v_new.direction::text <> 'incoming'
     or v_old.direction::text <> 'incoming'
  then
    raise exception 'Harvest correction ticket identity drift';
  end if;
  if not v_old.is_voided
     or v_old.status::text <> 'voided'
     or v_old.replacement_ticket_id is distinct from v_new.id
     or v_new.is_finalized
     or v_new.is_voided
     or v_new.status::text in ('finalized', 'voided')
  then
    raise exception 'Harvest correction state drift';
  end if;
  if v_new.warehouse_to_id is null
     or v_new.season_id is null
     or v_new.field_id is null
  then
    raise exception 'Harvest correction trace is incomplete';
  end if;
  if abs(coalesce(v_old.explicit_deductions_kg, 0)) > 0.001
     or abs(coalesce(v_new.explicit_deductions_kg, 0)) > 0.001
  then
    raise exception 'Harvest correction with explicit deductions requires a dedicated review';
  end if;

  select count(*)::integer, min(tl.id::text)::uuid
    into v_line_count, v_line_id
  from public.ticket_lines tl
  where tl.ticket_id = v_new.id
    and tl.company_id = v_new.company_id;
  if v_line_count <> 1 then
    raise exception 'Harvest correction line identity is ambiguous';
  end if;
  select * into v_line
  from public.ticket_lines
  where id = v_line_id
  for update;
  if public.canonical_stock_uom(v_line.uom) <> 'kg' then
    raise exception 'Harvest correction accounting requires kilogram stock unit';
  end if;

  select count(*)::integer,
         min(ib.id::text)::uuid,
         min(hlb.harvest_lot_id::text)::uuid
    into v_source_count, v_source_batch_id, v_expected_lot_id
  from public.inventory_batches ib
  join public.harvest_lot_batches hlb
    on hlb.company_id = ib.company_id
   and hlb.inventory_batch_id = ib.id
  where ib.company_id = v_old.company_id
    and ib.source_ticket_id = v_old.id
    and ib.origin_type = 'harvest';
  if v_source_count <> 1
     or v_source_batch_id is null
     or v_expected_lot_id is null
  then
    raise exception 'Harvest correction original batch lineage is ambiguous';
  end if;
  select * into v_source_batch
  from public.inventory_batches
  where id = v_source_batch_id
  for update;
  if v_source_batch.warehouse_id is distinct from v_new.warehouse_to_id
     or v_source_batch.product_id is distinct from v_line.product_id
     or v_source_batch.crop_id is distinct from v_line.crop_id
     or v_source_batch.variety_id is distinct from v_line.variety_id
     or v_source_batch.reproduction_id is distinct from v_line.reproduction_id
  then
    raise exception 'Harvest correction physical batch identity conflicts with replacement line';
  end if;
  if v_old.harvest_lot_id is not null
     and v_old.harvest_lot_id is distinct from v_expected_lot_id
  then
    raise exception 'Harvest correction original aggregate lot conflicts with physical batch';
  end if;
  if v_new.harvest_lot_id is not null
     and v_new.harvest_lot_id is distinct from v_expected_lot_id
  then
    raise exception 'Harvest correction replacement aggregate lot conflicts with original';
  end if;
  perform 1
  from public.harvest_lots hl
  where hl.id = v_expected_lot_id
    and hl.company_id = v_new.company_id
    and hl.status = 'active'
  for update;
  if not found then
    raise exception 'Harvest correction aggregate lot is unavailable';
  end if;

  select count(*)::integer into v_count
  from public.inventory_batches ib
  where ib.company_id = v_new.company_id
    and ib.source_ticket_id = v_new.id;
  if v_count <> 0 then
    raise exception 'Harvest correction replacement batch already exists before finalize';
  end if;
  select count(*)::integer into v_count
  from public.stock_ledger_entries sle
  where sle.company_id = v_new.company_id
    and sle.ticket_id = v_new.id;
  if v_count <> 0 then
    raise exception 'Harvest correction replacement ledger already exists before finalize';
  end if;
  select count(*)::integer into v_count
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_new.company_id
    and hlb.source_ticket_id = v_new.id;
  if v_count <> 0 then
    raise exception 'Harvest correction replacement lot link already exists before finalize';
  end if;
  select count(*)::integer into v_count
  from public.field_history_entries fhe
  where fhe.company_id = v_new.company_id
    and fhe.harvest_ticket_id = v_new.id;
  if v_count <> 0 then
    raise exception 'Harvest correction replacement field trace already exists before finalize';
  end if;

  v_gross := round(v_new.gross_weight_kg, 3);
  v_tare := round(v_new.tare_weight_kg, 3);
  if v_gross is null or v_gross <= 0 then
    raise exception 'Harvest correction gross weight must be greater than zero';
  end if;
  if v_tare is null or v_tare < 0 or v_tare >= v_gross then
    raise exception 'Harvest correction tare weight is invalid';
  end if;
  v_net := round(v_gross - v_tare, 3);
  if v_net <= 0
     or v_new.net_weight_kg is null
     or abs(v_new.net_weight_kg - v_net) > 0.001
  then
    raise exception 'Harvest correction net weight does not match gross minus tare';
  end if;

  select count(*)::integer into v_count
  from public.ticket_weighings tw
  where tw.company_id = v_new.company_id
    and tw.ticket_id = v_new.id;
  if v_count <> 2
     or not exists (
       select 1 from public.ticket_weighings tw
       where tw.company_id = v_new.company_id
         and tw.ticket_id = v_new.id
         and tw.weighing_no = 1
         and abs(tw.measured_weight_kg - v_gross) <= 0.001
     )
     or not exists (
       select 1 from public.ticket_weighings tw
       where tw.company_id = v_new.company_id
         and tw.ticket_id = v_new.id
         and tw.weighing_no = 2
         and abs(tw.measured_weight_kg - v_tare) <= 0.001
     )
  then
    raise exception 'Harvest correction requires exactly two matching weighing events';
  end if;

  -- Recheck after the canonical processing gate and row locks. The replacement
  -- ticket itself is excluded by the corrected downstream helper.
  if private.weighbridge_ticket_has_downstream_dependencies_v1(v_old.id) then
    raise exception 'Harvest correction original batch gained downstream dependencies';
  end if;

  perform private.reconcile_harvest_lot_batch_balance_v1(v_source_batch.id);
  select current_quantity into v_balance
  from public.inventory_batches
  where id = v_source_batch.id;
  if abs(coalesce(v_balance, 0)) > 0.001 then
    raise exception 'Harvest correction original batch was not fully reversed';
  end if;

  v_batch_code := 'HAR-CORR-' || upper(left(replace(v_new.id::text, '-', ''), 12));
  insert into public.inventory_batches (
    company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
    source_field_id, source_ticket_id, batch_code, status, batch_class,
    origin_type, origin_ref_id, initial_weight_kg, current_weight_kg,
    moisture_percent, treatment_status, initial_quantity, current_quantity,
    uom, mass_kg, unit_source, unit_contract_version, warehouse_id, received_at
  ) values (
    v_new.company_id, v_new.season_id, v_line.product_id, v_line.crop_id,
    v_line.variety_id, v_line.reproduction_id, v_new.field_id, v_new.id,
    v_batch_code, 'commodity', 'commodity', 'harvest', v_new.id,
    v_net, v_net, v_line.moisture_percent, 'not_applicable',
    v_net, v_net, 'kg', v_net, 'weighbridge_harvest_correction', 2,
    v_new.warehouse_to_id, now()
  )
  returning id into v_new_batch_id;

  v_actual_lot_id := public.ensure_harvest_lot_for_batch_v1(v_new_batch_id);
  if v_actual_lot_id is null
     or v_actual_lot_id is distinct from v_expected_lot_id
  then
    raise exception 'Harvest correction replacement aggregate lot lineage changed';
  end if;

  update public.ticket_lines
  set gross_line_weight_kg = v_gross,
      tare_line_weight_kg = v_tare,
      net_line_weight_kg = v_net,
      quantity = v_net,
      quantity_kg = v_net,
      mass_kg = v_net,
      batch_id = v_new_batch_id::text,
      lot_id = v_batch_code,
      batch_class = 'commodity',
      warehouse_to_id = v_new.warehouse_to_id,
      unit_source = 'weighbridge_harvest_correction',
      unit_contract_version = 2,
      dirt_tare_percent = 0,
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake', jsonb_build_object(
          'contract_version', 'p0_harvest_correction_v1',
          'physical_net_kg', v_net,
          'explicit_deductions_kg', 0,
          'explicit_deductions_percent', 0,
          'accepted_weight_kg', v_net,
          'deduction_reason', null,
          'original_ticket_id', v_old.id,
          'original_batch_id', v_source_batch.id,
          'replacement_batch_id', v_new_batch_id,
          'aggregate_lot_id', v_actual_lot_id
        )
      ),
      updated_at = now()
  where id = v_line.id;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    batch_id, batch_id_text, batch_class, inventory_batch_id, warehouse_id,
    direction, quantity, uom, delta_qty_signed, reason_type, reason_ref_id,
    occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
  ) values (
    v_new.company_id, v_new.id, v_line.product_id, v_line.crop_id,
    v_line.variety_id, v_line.reproduction_id, v_new_batch_id::text,
    v_new_batch_id::text, 'commodity', v_new_batch_id, v_new.warehouse_to_id,
    'in', v_net, 'kg', v_net, 'harvest_incoming_in', v_new.id,
    now(), p_actor_user_id, v_new.notes, v_net,
    'weighbridge_harvest_correction', 2
  )
  returning id into v_ledger_id;

  perform public.backfill_ticket_operation_line_links_v1(v_new.id);

  -- Ticket transition is intentionally last: the existing finalized-harvest
  -- trigger sees a complete batch, lot, line and ledger lineage.
  update public.tickets
  set batch_id = v_new_batch_id,
      lot_id = v_batch_code,
      harvest_lot_id = v_actual_lot_id,
      net_weight_kg = v_net,
      physical_net_kg = v_net,
      explicit_deductions_kg = 0,
      accepted_weight_kg = v_net,
      is_finalized = true,
      status = 'finalized',
      closed_by = p_actor_user_id,
      finalized_by_person_id = coalesce(
        p_operator_person_id,
        v_new.finalized_by_person_id,
        v_new.created_by_person_id
      ),
      finalized_at = now(),
      correction_completed_at = now(),
      processing_allocation_ready = false,
      audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'harvest_intake_finalize', jsonb_build_object(
          'contract_version', 'p0_harvest_correction_v1',
          'physical_net_kg', v_net,
          'explicit_deductions_kg', 0,
          'accepted_weight_kg', v_net,
          'operator_person_id', p_operator_person_id
        ),
        'harvest_correction_accounting', jsonb_build_object(
          'contract_version', 'p0_harvest_correction_v1',
          'original_ticket_id', v_old.id,
          'original_batch_id', v_source_batch.id,
          'replacement_batch_id', v_new_batch_id,
          'aggregate_lot_id', v_actual_lot_id,
          'ledger_entry_id', v_ledger_id,
          'finalized_at', now()
        )
      ),
      updated_at = now()
  where id = v_new.id;

  select count(*)::integer into v_count
  from public.inventory_batches ib
  where ib.company_id = v_new.company_id
    and ib.source_ticket_id = v_new.id
    and ib.origin_type = 'harvest'
    and ib.id = v_new_batch_id
    and ib.warehouse_id = v_new.warehouse_to_id
    and abs(ib.initial_weight_kg - v_net) <= 0.001
    and abs(ib.current_weight_kg - v_net) <= 0.001
    and abs(ib.initial_quantity - v_net) <= 0.001
    and abs(ib.current_quantity - v_net) <= 0.001
    and abs(ib.mass_kg - v_net) <= 0.001;
  if v_count <> 1 then
    raise exception 'Harvest correction replacement batch accounting postcondition failed';
  end if;

  select count(*)::integer into v_count
  from public.stock_ledger_entries sle
  where sle.company_id = v_new.company_id
    and sle.ticket_id = v_new.id
    and sle.id = v_ledger_id
    and sle.direction::text = 'in'
    and not coalesce(sle.is_storno, false)
    and sle.inventory_batch_id = v_new_batch_id
    and abs(sle.quantity - v_net) <= 0.001
    and abs(sle.delta_qty_signed - v_net) <= 0.001
    and abs(sle.mass_kg - v_net) <= 0.001;
  if v_count <> 1 then
    raise exception 'Harvest correction replacement ledger accounting postcondition failed';
  end if;

  select count(*)::integer into v_count
  from public.harvest_lot_batches hlb
  where hlb.company_id = v_new.company_id
    and hlb.harvest_lot_id = v_expected_lot_id
    and hlb.inventory_batch_id = v_new_batch_id
    and hlb.source_ticket_id = v_new.id;
  if v_count <> 1 then
    raise exception 'Harvest correction replacement aggregate lot link postcondition failed';
  end if;

  if not exists (
    select 1
    from public.ticket_lines tl
    where tl.id = v_line.id
      and abs(tl.gross_line_weight_kg - v_gross) <= 0.001
      and abs(tl.tare_line_weight_kg - v_tare) <= 0.001
      and abs(tl.net_line_weight_kg - v_net) <= 0.001
      and abs(tl.quantity - v_net) <= 0.001
      and abs(tl.quantity_kg - v_net) <= 0.001
      and abs(tl.mass_kg - v_net) <= 0.001
      and tl.batch_id = v_new_batch_id::text
      and tl.lot_id = v_batch_code
  ) then
    raise exception 'Harvest correction replacement line accounting postcondition failed';
  end if;

  select count(*)::integer into v_count
  from public.field_history_entries fhe
  where fhe.company_id = v_new.company_id
    and fhe.harvest_ticket_id = v_new.id
    and fhe.source = 'weighbridge_harvest';
  if v_count <> 1 then
    raise exception 'Harvest correction replacement field trace postcondition failed';
  end if;

  select round(coalesce(sum(sle.delta_qty_signed), 0), 6)
    into v_balance
  from public.stock_ledger_entries sle
  where sle.company_id = v_new.company_id
    and sle.ticket_id in (v_old.id, v_new.id);
  if abs(v_balance - v_net) > 0.001 then
    raise exception 'Harvest correction combined ledger balance postcondition failed';
  end if;

  insert into public.audit_log(
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_new.company_id,
    p_actor_user_id,
    'weighbridge_ticket',
    v_new.id::text,
    'harvest_correction_accounting_finalized',
    jsonb_build_object(
      'ticket_id', v_old.id,
      'batch_id', v_source_batch.id,
      'net_weight_kg', v_old.net_weight_kg
    ),
    jsonb_build_object(
      'ticket_id', v_new.id,
      'batch_id', v_new_batch_id,
      'aggregate_lot_id', v_actual_lot_id,
      'ledger_entry_id', v_ledger_id,
      'net_weight_kg', v_net,
      'accounting_contract', 'p0_harvest_correction_v1'
    ),
    v_new.correction_reason
  );

  return jsonb_build_object(
    'accounting_contract', 'p0_harvest_correction_v1',
    'original_ticket_id', v_old.id,
    'original_batch_id', v_source_batch.id,
    'replacement_ticket_id', v_new.id,
    'replacement_batch_id', v_new_batch_id,
    'aggregate_lot_id', v_actual_lot_id,
    'ledger_entry_id', v_ledger_id,
    'accepted_weight_kg', v_net
  );
end
$function$;

revoke all on function private.finalize_harvest_correction_accounting_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

do $p0_patch_canonical_correction$
declare
  v_signature pg_catalog.regprocedure :=
    'public.finalize_weighbridge_ticket_correction_v1(uuid,uuid,uuid)'::pg_catalog.regprocedure;
  v_definition text;
  v_definition_after text;
  v_owner_before oid;
  v_owner_after oid;
  v_security_definer_before boolean;
  v_security_definer_after boolean;
  v_config_before text[];
  v_config_after text[];
  v_acl_before aclitem[];
  v_acl_after aclitem[];
  v_anchor_begin constant text :=
    'select * into v_new from public.tickets where id = p_ticket_id for update;';
  v_anchor_finalize constant text :=
    'perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);';
  v_anchor_audit_contract constant text :=
    '''shift_id'', p_shift_id, ''accounting_contract'', ''warehouse_local_transfer_v2'',';
  v_replacement_finalize constant text := E'if v_new.op_type = ''harvest_incoming'' then\n    -- P0_HARVEST_CORRECTION_ATOMIC_V1\n    v_lineage := private.finalize_harvest_correction_accounting_v1(\n      v_new.id, v_old.id, v_actor.id, p_operator_person_id\n    );\n  else\n    perform public.finalize_weighbridge_ticket_for_session_v1(v_new.id);\n  end if;';
  v_replacement_audit_contract constant text := E'''shift_id'', p_shift_id, ''accounting_contract'',\n      -- P0_HARVEST_CORRECTION_AUDIT_CONTRACT_V1\n      coalesce(v_lineage ->> ''accounting_contract'', ''warehouse_local_transfer_v2''),';
begin
  select pg_catalog.pg_get_functiondef(v_signature),
         procedure.proowner,
         procedure.prosecdef,
         procedure.proconfig,
         procedure.proacl
    into v_definition,
         v_owner_before,
         v_security_definer_before,
         v_config_before,
         v_acl_before
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_signature;

  if pg_catalog.strpos(v_definition, 'P0_HARVEST_CORRECTION_ATOMIC_V1') > 0 then
    if pg_catalog.strpos(v_definition, 'private.finalize_harvest_correction_accounting_v1(') = 0
       or pg_catalog.strpos(v_definition, 'private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id)') = 0
       or pg_catalog.strpos(v_definition, v_anchor_finalize) = 0
       or pg_catalog.strpos(v_definition, 'P0_HARVEST_CORRECTION_AUDIT_CONTRACT_V1') = 0
       or pg_catalog.strpos(v_definition, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') = 0
       or not v_security_definer_before
       or pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres'
       or v_config_before is distinct from array['search_path=pg_catalog, public, private']::text[]
       or not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
    then
      raise exception 'P0 harvest correction replay verification failed';
    end if;
    return;
  end if;

  if pg_catalog.strpos(v_definition, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') = 0
     or pg_catalog.strpos(v_definition, v_anchor_begin) = 0
     or (
       (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(
         v_definition, v_anchor_finalize, ''
       ))) / pg_catalog.length(v_anchor_finalize)
     ) <> 1
     or (
       (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(
         v_definition, v_anchor_audit_contract, ''
       ))) / pg_catalog.length(v_anchor_audit_contract)
     ) <> 1
  then
    raise exception 'P0 harvest correction function drift: expected anchors not found exactly once';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_anchor_begin,
    E'-- P0_HARVEST_CORRECTION_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n  select * into v_new from public.tickets where id = p_ticket_id for update;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_anchor_finalize,
    v_replacement_finalize
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_anchor_audit_contract,
    v_replacement_audit_contract
  );
  execute v_definition;

  select pg_catalog.pg_get_functiondef(v_signature),
         procedure.proowner,
         procedure.prosecdef,
         procedure.proconfig,
         procedure.proacl
    into v_definition_after,
         v_owner_after,
         v_security_definer_after,
         v_config_after,
         v_acl_after
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_signature;

  if pg_catalog.strpos(v_definition_after, 'P0_HARVEST_CORRECTION_ATOMIC_V1') = 0
     or pg_catalog.strpos(v_definition_after, 'P0_HARVEST_CORRECTION_PROCESSING_GATE_V1') = 0
     or pg_catalog.strpos(v_definition_after, 'P0_HARVEST_CORRECTION_AUDIT_CONTRACT_V1') = 0
     or pg_catalog.strpos(v_definition_after, 'TZ315_NONTRANSFER_CORRECTION_STOCK_POSTCONDITION_V1') = 0
     or pg_catalog.strpos(
       v_definition_after,
       'private.finalize_harvest_correction_accounting_v1('
     ) = 0
     or not v_security_definer_before
     or not v_security_definer_after
     or pg_catalog.pg_get_userbyid(v_owner_before) <> 'postgres'
     or v_owner_after is distinct from v_owner_before
     or v_config_after is distinct from v_config_before
     or v_acl_after is distinct from v_acl_before
     or v_config_after is distinct from array['search_path=pg_catalog, public, private']::text[]
     or not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
  then
    raise exception 'P0 harvest correction canonical patch verification failed';
  end if;
end
$p0_patch_canonical_correction$;

comment on function private.weighbridge_ticket_has_downstream_dependencies_v1(uuid)
  is 'Detects real downstream use while excluding the correction ticket that directly replaces the source ticket.';
comment on function private.finalize_harvest_correction_accounting_v1(uuid, uuid, uuid, uuid)
  is 'Creates a dedicated replacement harvest batch, ledger IN and lot lineage atomically; never called directly by clients.';
comment on function public.finalize_weighbridge_ticket_correction_v1(uuid, uuid, uuid)
  is 'Canonical atomic ticket correction with dedicated harvest replacement accounting and transfer-only company-total invariant.';

notify pgrst, 'reload schema';

commit;
