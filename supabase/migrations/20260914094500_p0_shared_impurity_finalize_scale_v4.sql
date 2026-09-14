-- P0: a shared impurity ticket can legitimately contain hundreds of physical
-- incoming batches. Keep the exact per-trip ledger trace, but stop executing
-- availability and reconciliation queries once per source row.

create index if not exists idx_stock_ledger_company_wh_batch_v4
  on public.stock_ledger_entries(company_id, warehouse_id, inventory_batch_id)
  where inventory_batch_id is not null;

do $patch_v1_availability$
declare
  v_definition text;
  v_old text := $needle$
    -- Exclude this shared ticket's own whole-batch reservation, but subtract
    -- every other open ticket and active processing allocation through the
    -- canonical availability contract while the source batch is locked.
    v_available_balance := private.weighbridge_batch_available_for_ticket_v1(
      v_ticket.id,
      v_source.inventory_batch_id
    );$needle$;
  v_new text := $replacement$
    -- Conflicting reservations and processing allocations are checked once
    -- for the complete frozen source set below. Re-running those views for
    -- every physical trip made large field groups exceed statement_timeout.
    v_available_balance := v_current_balance;$replacement$;
  v_anchor text := $needle$
  for v_source in
    select
      s.*,$needle$;
  v_replacement text := $replacement$
  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    join public.v_weighbridge_open_ticket_reservations_v1 reservation
      on reservation.company_id = source.company_id
     and reservation.warehouse_id = source.warehouse_id
     and reservation.batch_id = source.inventory_batch_id
     and reservation.ticket_id <> v_ticket.id
    where source.group_id = v_pool.id
  ) or exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    join public.v_processing_active_allocations_v1 allocation
     on allocation.company_id = source.company_id
     and allocation.warehouse_id = source.warehouse_id
     and allocation.batch_id = source.inventory_batch_id
    where source.group_id = v_pool.id
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_COMMITTED_OR_CHANGED'
      using errcode = '40001';
  end if;

  for v_source in
    select
      s.*,$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';

  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old) = 0
     or pg_catalog.strpos(v_definition, v_anchor) = 0
  then
    raise exception 'SHARED_IMPURITY_V4_AVAILABILITY_PATCH_CONTRACT_MISSING|%|%',
      pg_catalog.strpos(v_definition, v_old),
      pg_catalog.strpos(v_definition, v_anchor);
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  v_definition := pg_catalog.replace(v_definition, v_anchor, v_replacement);
  execute v_definition;
end
$patch_v1_availability$;

do $patch_v1_reclassification$
declare
  v_definition text;
  v_old text := $needle$
  for v_source in
    select s.*, ib.crop_id, ib.variety_id, ib.reproduction_id
    from public.weighbridge_shared_impurity_source_batches s
    join public.inventory_batches ib on ib.id = s.inventory_batch_id
    where s.group_id = v_pool.id
    order by s.inventory_batch_id
  loop
    insert into public.stock_ledger_entries (
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
      direction, quantity, uom, delta_qty_signed, mass_kg,
      unit_source, unit_contract_version, reason_type, reason_ref_id,
      occurred_at, created_by, is_storno, notes
    ) values (
      v_pool.company_id, v_ticket.id, v_pool.product_id,
      v_source.crop_id, v_source.variety_id, v_source.reproduction_id,
      v_pool.source_warehouse_id, v_source.inventory_batch_id,
      v_source.inventory_batch_id::text, v_source.inventory_batch_id::text,
      'commodity', 'out', v_source.source_balance_snapshot_kg, 'kg',
      -v_source.source_balance_snapshot_kg, v_source.source_balance_snapshot_kg,
      'shared_impurity_pool_v1', 2, 'harvest_pool_reclass_out', v_source.id,
      pg_catalog.now(), v_actor.id, false,
      'Full exact source balance moved to shared pool; no member impurity allocation.'
    ) returning id into v_source_ledger_id;

    update public.weighbridge_shared_impurity_source_batches
    set state = 'reclassified',
        reclass_out_ledger_entry_id = v_source_ledger_id,
        reclassified_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = v_source.id and state = 'selected';
    if not found then
      raise exception 'SHARED_IMPURITY_SOURCE_RECLASS_UPDATE_FAILED'
        using errcode = '23514';
    end if;

    v_reconciled_balance := private.reconcile_harvest_lot_batch_balance_v1(
      v_source.inventory_batch_id
    );
    if pg_catalog.abs(v_reconciled_balance) > 0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_NOT_ZERO|%|%',
        v_source.inventory_batch_id, v_reconciled_balance
        using errcode = '23514';
    end if;
  end loop;$needle$;
  v_new text := $replacement$
  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  )
  select
    v_pool.company_id, v_ticket.id, v_pool.product_id,
    ib.crop_id, ib.variety_id, ib.reproduction_id,
    v_pool.source_warehouse_id, source.inventory_batch_id,
    source.inventory_batch_id::text, source.inventory_batch_id::text,
    'commodity', 'out', source.source_balance_snapshot_kg, 'kg',
    -source.source_balance_snapshot_kg, source.source_balance_snapshot_kg,
    'shared_impurity_pool_v1', 2, 'harvest_pool_reclass_out', source.id,
    pg_catalog.now(), v_actor.id, false,
    'Full exact source balance moved to shared pool; no member impurity allocation.'
  from public.weighbridge_shared_impurity_source_batches source
  join public.inventory_batches ib on ib.id = source.inventory_batch_id
  where source.group_id = v_pool.id
    and source.state = 'selected'
  order by source.inventory_batch_id;

  update public.weighbridge_shared_impurity_source_batches source
  set state = 'reclassified',
      reclass_out_ledger_entry_id = entry.id,
      reclassified_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  from public.stock_ledger_entries entry
  where source.group_id = v_pool.id
    and source.state = 'selected'
    and entry.ticket_id = v_ticket.id
    and entry.reason_type = 'harvest_pool_reclass_out'
    and entry.reason_ref_id = source.id;
  get diagnostics v_source_out_count = row_count;
  if v_source_out_count <> v_source_count then
    raise exception 'SHARED_IMPURITY_SOURCE_RECLASS_UPDATE_FAILED'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_pool.id
      and pg_catalog.abs(coalesce((
        select pg_catalog.sum(entry.delta_qty_signed)
        from public.stock_ledger_entries entry
        where entry.company_id = source.company_id
          and entry.warehouse_id = source.warehouse_id
          and coalesce(
            entry.inventory_batch_id::text,
            nullif(pg_catalog.btrim(entry.batch_id_text), ''),
            nullif(pg_catalog.btrim(entry.batch_id), '')
          ) = source.inventory_batch_id::text
      ), 0)) > 0.001
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_NOT_ZERO'
      using errcode = '23514';
  end if;

  update public.inventory_batches batch
  set current_quantity = 0,
      current_weight_kg = 0,
      mass_kg = 0,
      updated_at = pg_catalog.now()
  from public.weighbridge_shared_impurity_source_batches source
  where source.group_id = v_pool.id
    and batch.id = source.inventory_batch_id
    and batch.company_id = source.company_id;$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  if v_definition is null or pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'SHARED_IMPURITY_V4_RECLASS_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_definition;
end
$patch_v1_reclassification$;

do $patch_v2_settlement$
declare
  v_definition text;
  v_start integer;
  v_finish integer;
  v_prefix text;
  v_suffix text;
  v_start_marker text := E'  for v_source in\n    select s.*, ib.crop_id, ib.variety_id, ib.reproduction_id\n    from public.weighbridge_shared_impurity_source_batches s';
  v_end_marker text := E'  end loop;\n\n  if pg_catalog.abs(v_allocated_total - v_impurity) > 0.001 then';
  v_new text := $replacement$
  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_group.id
      and source.company_id = v_group.company_id
      and (
        source.state <> 'reclassified'
        or source.source_restore_ledger_entry_id is not null
        or source.impurity_out_ledger_entry_id is not null
        or source.allocated_impurity_kg is not null
      )
  ) then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_STATE_INVALID'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_group.id
      and source.company_id = v_group.company_id
      and pg_catalog.abs(coalesce((
        select pg_catalog.sum(entry.delta_qty_signed)
        from public.stock_ledger_entries entry
        where entry.company_id = source.company_id
          and entry.warehouse_id = source.warehouse_id
          and coalesce(
            entry.inventory_batch_id::text,
            nullif(pg_catalog.btrim(entry.batch_id_text), ''),
            nullif(pg_catalog.btrim(entry.batch_id), '')
          ) = source.inventory_batch_id::text
      ), 0)) > 0.001
  ) then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_NOT_ZERO'
      using errcode = '23514';
  end if;

  if exists (
    with ranked as (
      select source.*,
             pg_catalog.row_number() over (order by source.inventory_batch_id) as source_index,
             pg_catalog.count(*) over () as source_count
      from public.weighbridge_shared_impurity_source_batches source
      where source.group_id = v_group.id
        and source.company_id = v_group.company_id
    ), provisional as (
      select ranked.*,
             pg_catalog.round(
               v_impurity * ranked.source_balance_snapshot_kg / v_group.source_total_kg,
               3
             ) as provisional_allocation
      from ranked
    ), allocation as (
      select provisional.*,
             case when source_index = source_count
               then v_impurity - coalesce(
                 pg_catalog.sum(provisional_allocation) over (
                   order by inventory_batch_id
                   rows between unbounded preceding and 1 preceding
                 ), 0
               )
               else provisional_allocation
             end as allocation_kg
      from provisional
    )
    select 1 from allocation
    where allocation_kg < 0
       or allocation_kg > source_balance_snapshot_kg
  ) then
    raise exception 'SHARED_IMPURITY_V2_ALLOCATION_INVALID'
      using errcode = '23514';
  end if;

  with ranked as (
    select source.*,
           ib.crop_id, ib.variety_id, ib.reproduction_id,
           pg_catalog.row_number() over (order by source.inventory_batch_id) as source_index,
           pg_catalog.count(*) over () as source_count
    from public.weighbridge_shared_impurity_source_batches source
    join public.inventory_batches ib on ib.id = source.inventory_batch_id
    where source.group_id = v_group.id
      and source.company_id = v_group.company_id
  )
  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  )
  select
    v_group.company_id, v_group.ticket_id, v_group.product_id,
    ranked.crop_id, ranked.variety_id, ranked.reproduction_id,
    v_group.source_warehouse_id, ranked.inventory_batch_id,
    ranked.inventory_batch_id::text, ranked.inventory_batch_id::text,
    'commodity', 'in', ranked.source_balance_snapshot_kg, 'kg',
    ranked.source_balance_snapshot_kg, ranked.source_balance_snapshot_kg,
    'shared_impurity_member_settlement_v2', 2,
    'harvest_pool_source_restore_in', ranked.id,
    pg_catalog.now(), v_group.finalized_by, false,
    'Technical restoration of the original stock identity after shared impurity weighing.'
  from ranked
  order by ranked.inventory_batch_id;
  get diagnostics v_restore_count = row_count;

  with ranked as (
    select source.*,
           ib.crop_id, ib.variety_id, ib.reproduction_id,
           pg_catalog.row_number() over (order by source.inventory_batch_id) as source_index,
           pg_catalog.count(*) over () as source_count
    from public.weighbridge_shared_impurity_source_batches source
    join public.inventory_batches ib on ib.id = source.inventory_batch_id
    where source.group_id = v_group.id
      and source.company_id = v_group.company_id
  ), provisional as (
    select ranked.*,
           pg_catalog.round(
             v_impurity * ranked.source_balance_snapshot_kg / v_group.source_total_kg,
             3
           ) as provisional_allocation
    from ranked
  ), allocation as (
    select provisional.*,
           case when source_index = source_count
             then v_impurity - coalesce(
               pg_catalog.sum(provisional_allocation) over (
                 order by inventory_batch_id
                 rows between unbounded preceding and 1 preceding
               ), 0
             )
             else provisional_allocation
           end as allocation_kg
    from provisional
  )
  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  )
  select
    v_group.company_id, v_group.ticket_id, v_group.product_id,
    allocation.crop_id, allocation.variety_id, allocation.reproduction_id,
    v_group.source_warehouse_id, allocation.inventory_batch_id,
    allocation.inventory_batch_id::text, allocation.inventory_batch_id::text,
    'commodity', 'out', allocation.allocation_kg, 'kg',
    -allocation.allocation_kg, allocation.allocation_kg,
    'shared_impurity_member_settlement_v2', 2,
    'weighbridge_impurities_shared_member', allocation.id,
    pg_catalog.now(), v_group.finalized_by, false,
    'Measured group impurity allocated proportionally by pre-impurity source mass.'
  from allocation
  where allocation.allocation_kg > 0
  order by allocation.inventory_batch_id;
  get diagnostics v_impurity_count = row_count;

  with ranked as (
    select source.*,
           pg_catalog.row_number() over (order by source.inventory_batch_id) as source_index,
           pg_catalog.count(*) over () as source_count
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_group.id
      and source.company_id = v_group.company_id
  ), provisional as (
    select ranked.*,
           pg_catalog.round(
             v_impurity * ranked.source_balance_snapshot_kg / v_group.source_total_kg,
             3
           ) as provisional_allocation
    from ranked
  ), allocation as (
    select provisional.*,
           case when source_index = source_count
             then v_impurity - coalesce(
               pg_catalog.sum(provisional_allocation) over (
                 order by inventory_batch_id
                 rows between unbounded preceding and 1 preceding
               ), 0
             )
             else provisional_allocation
           end as allocation_kg
    from provisional
  )
  update public.weighbridge_shared_impurity_source_batches source
  set state = 'released',
      allocated_impurity_kg = allocation.allocation_kg,
      source_restore_ledger_entry_id = restore.id,
      impurity_out_ledger_entry_id = impurity.id,
      updated_at = pg_catalog.now()
  from allocation
  join public.stock_ledger_entries restore
    on restore.ticket_id = v_group.ticket_id
   and restore.reason_type = 'harvest_pool_source_restore_in'
   and restore.reason_ref_id = allocation.id
  left join public.stock_ledger_entries impurity
    on impurity.ticket_id = v_group.ticket_id
   and impurity.reason_type = 'weighbridge_impurities_shared_member'
   and impurity.reason_ref_id = allocation.id
  where source.id = allocation.id
    and source.group_id = v_group.id
    and source.state = 'reclassified'
    and source.allocated_impurity_kg is null;
  if not found or v_restore_count <> v_source_count then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_UPDATE_FAILED'
      using errcode = '40001';
  end if;

  update public.inventory_batches batch
  set current_quantity = source.source_balance_snapshot_kg - source.allocated_impurity_kg,
      current_weight_kg = source.source_balance_snapshot_kg - source.allocated_impurity_kg,
      mass_kg = source.source_balance_snapshot_kg - source.allocated_impurity_kg,
      updated_at = pg_catalog.now()
  from public.weighbridge_shared_impurity_source_batches source
  where source.group_id = v_group.id
    and source.company_id = v_group.company_id
    and source.state = 'released'
    and batch.id = source.inventory_batch_id
    and batch.company_id = source.company_id;

  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches source
    join public.inventory_batches batch on batch.id = source.inventory_batch_id
    where source.group_id = v_group.id
      and (
        pg_catalog.abs(
          coalesce(batch.current_quantity, 0)
            - (source.source_balance_snapshot_kg - source.allocated_impurity_kg)
        ) > 0.001
        or pg_catalog.abs(
          coalesce(batch.current_weight_kg, 0)
            - (source.source_balance_snapshot_kg - source.allocated_impurity_kg)
        ) > 0.001
        or pg_catalog.abs(
          coalesce(batch.mass_kg, 0)
            - (source.source_balance_snapshot_kg - source.allocated_impurity_kg)
        ) > 0.001
      )
  ) then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_RECONCILE_FAILED'
      using errcode = '23514';
  end if;

  select pg_catalog.round(coalesce(pg_catalog.sum(source.allocated_impurity_kg), 0), 3)
  into v_allocated_total
  from public.weighbridge_shared_impurity_source_batches source
  where source.group_id = v_group.id
    and source.company_id = v_group.company_id;$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'settle_shared_impurity_members_v2'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_group_id uuid';
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  v_start := pg_catalog.strpos(v_definition, v_start_marker);
  v_finish := pg_catalog.strpos(v_definition, v_end_marker);
  if v_definition is null or v_start = 0 or v_finish = 0 or v_finish <= v_start then
    raise exception 'SHARED_IMPURITY_V4_SETTLEMENT_PATCH_CONTRACT_MISSING|%|%',
      v_start, v_finish;
  end if;
  v_prefix := pg_catalog.substr(v_definition, 1, v_start - 1);
  v_suffix := pg_catalog.substr(v_definition, v_finish + pg_catalog.length(E'  end loop;\n\n'));
  execute v_prefix || v_new || E'\n\n' || v_suffix;
end
$patch_v2_settlement$;

comment on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) is
  'Finalizes shared impurity atomically with set-based reservation checks, exact source ledger trace and bulk member settlement for large field groups.';

do $verify_v4_patch$
declare
  v_engine text;
  v_settlement text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into v_engine
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';
  select pg_catalog.pg_get_functiondef(p.oid) into v_settlement
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'settle_shared_impurity_members_v2'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_group_id uuid';

  if pg_catalog.strpos(v_engine, 'v_available_balance := v_current_balance') = 0
     or pg_catalog.strpos(v_engine, 'get diagnostics v_source_out_count = row_count') = 0
     or pg_catalog.strpos(v_settlement, 'get diagnostics v_restore_count = row_count') = 0
     or pg_catalog.strpos(v_settlement, 'rows between unbounded preceding and 1 preceding') = 0
  then
    raise exception 'SHARED_IMPURITY_V4_PATCH_VERIFICATION_FAILED';
  end if;
end
$verify_v4_patch$;
