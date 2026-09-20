CREATE OR REPLACE FUNCTION private.settle_shared_impurity_members_v2(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group public.weighbridge_shared_impurity_groups%rowtype;
  v_source record;
  v_source_count integer := 0;
  v_source_index integer := 0;
  v_restore_count integer := 0;
  v_impurity_count integer := 0;
  v_allocated_total numeric(18,3) := 0;
  v_impurity numeric(18,3);
  v_clean numeric(18,3);
  v_allocation numeric(18,3);
  v_source_clean numeric(18,3);
  v_source_balance numeric(18,6);
  v_available_balance numeric(18,6);
  v_pool_balance numeric(18,6);
  v_restore_entry_id uuid;
  v_impurity_entry_id uuid;
  v_pool_split_entry_id uuid;
begin
  select g.* into v_group
  from public.weighbridge_shared_impurity_groups g
  where g.id = p_group_id
  for update;

  if not found then
    raise exception 'SHARED_IMPURITY_V2_GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_group.state <> 'finalized'
     or v_group.pool_inventory_batch_id is null
     or v_group.impurity_weight_kg is null
     or v_group.clean_total_kg is null
  then
    raise exception 'SHARED_IMPURITY_V2_GROUP_NOT_FINALIZED' using errcode = '23514';
  end if;
  if pg_catalog.abs(v_group.impurity_weight_kg - pg_catalog.round(v_group.impurity_weight_kg, 3)) > 0.000001
     or pg_catalog.abs(v_group.clean_total_kg - pg_catalog.round(v_group.clean_total_kg, 3)) > 0.000001
  then
    raise exception 'SHARED_IMPURITY_V2_LEDGER_PRECISION_UNSUPPORTED' using errcode = '23514';
  end if;

  if v_group.settlement_mode = 'proportional_members_v2' then
    select pg_catalog.round(coalesce(pg_catalog.sum(s.allocated_impurity_kg), 0), 3)
    into v_allocated_total
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_group.id;
    select pg_catalog.round(coalesce(pg_catalog.sum(e.delta_qty_signed), 0), 6)
    into v_pool_balance
    from public.stock_ledger_entries e
    where e.company_id = v_group.company_id
      and e.warehouse_id = v_group.source_warehouse_id
      and e.inventory_batch_id = v_group.pool_inventory_batch_id;
    if pg_catalog.abs(v_allocated_total - v_group.impurity_weight_kg) > 0.001
       or pg_catalog.abs(v_pool_balance) > 0.001
    then
      raise exception 'SHARED_IMPURITY_V2_REPLAY_INVARIANT_FAILED' using errcode = '23514';
    end if;
    return pg_catalog.jsonb_build_object(
      'settlement_mode', 'proportional_members_v2',
      'allocated_impurity_kg', v_allocated_total,
      'idempotent_settlement', true
    );
  end if;
  if v_group.settlement_mode <> 'legacy_pool_unresolved'
     or v_group.member_resolution_status <> 'unresolved'
  then
    raise exception 'SHARED_IMPURITY_V2_SETTLEMENT_STATE_INVALID' using errcode = '23514';
  end if;

  v_impurity := pg_catalog.round(v_group.impurity_weight_kg, 3);
  v_clean := pg_catalog.round(v_group.clean_total_kg, 3);

  select pg_catalog.count(*)::integer into v_source_count
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_group.id
    and s.company_id = v_group.company_id;
  if v_source_count < 1 then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_MISSING' using errcode = '23514';
  end if;

  select pg_catalog.round(coalesce(pg_catalog.sum(e.delta_qty_signed), 0), 6)
  into v_pool_balance
  from public.stock_ledger_entries e
  where e.company_id = v_group.company_id
    and e.warehouse_id = v_group.source_warehouse_id
    and e.inventory_batch_id = v_group.pool_inventory_batch_id;
  if pg_catalog.abs(v_pool_balance - v_clean) > 0.001 then
    raise exception 'SHARED_IMPURITY_V2_POOL_BALANCE_INVALID|%', v_pool_balance
      using errcode = '23514';
  end if;
  v_available_balance := private.weighbridge_batch_available_for_ticket_v1(
    v_group.ticket_id,
    v_group.pool_inventory_batch_id
  );
  if pg_catalog.abs(v_available_balance - v_pool_balance) > 0.001 then
    raise exception 'SHARED_IMPURITY_V2_POOL_ALREADY_COMMITTED|%', v_available_balance
      using errcode = '40001';
  end if;


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

  if private.shared_impurity_sources_have_nonzero_balance_v1(
    v_group.id,
    v_group.company_id
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
    and source.company_id = v_group.company_id;

  if pg_catalog.abs(v_allocated_total - v_impurity) > 0.001 then
    raise exception 'SHARED_IMPURITY_V2_ALLOCATION_TOTAL_INVALID|%', v_allocated_total
      using errcode = '23514';
  end if;

  if v_clean > 0 then
    insert into public.stock_ledger_entries (
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
      direction, quantity, uom, delta_qty_signed, mass_kg,
      unit_source, unit_contract_version, reason_type, reason_ref_id,
      occurred_at, created_by, is_storno, notes
    ) values (
      v_group.company_id, v_group.ticket_id, v_group.product_id, v_group.crop_id,
      null, null, v_group.source_warehouse_id, v_group.pool_inventory_batch_id,
      v_group.pool_inventory_batch_id::text, v_group.pool_inventory_batch_id::text,
      'commodity', 'out', v_clean, 'kg', -v_clean, v_clean,
      'shared_impurity_member_settlement_v2', 2,
      'harvest_pool_split_out', v_group.id,
      pg_catalog.now(), v_group.finalized_by, false,
      'Technical pool closed after clean mass returned to original stock identities.'
    ) returning id into v_pool_split_entry_id;
  end if;

  v_pool_balance := private.reconcile_warehouse_local_batch_balance_v1(
    v_group.pool_inventory_batch_id
  );
  if pg_catalog.abs(v_pool_balance) > 0.001 then
    raise exception 'SHARED_IMPURITY_V2_POOL_NOT_ZERO|%', v_pool_balance
      using errcode = '23514';
  end if;

  update public.weighbridge_shared_impurity_members m
  set allocated_impurity_kg = allocation.allocated_impurity_kg,
      clean_total_kg = allocation.clean_total_kg,
      clean_balance_status = 'proportional',
      yield_status = 'proportional',
      updated_at = pg_catalog.now()
  from (
    select s.member_id,
           pg_catalog.round(pg_catalog.sum(s.allocated_impurity_kg), 3) as allocated_impurity_kg,
           pg_catalog.round(pg_catalog.sum(
             s.source_balance_snapshot_kg - s.allocated_impurity_kg
           ), 3) as clean_total_kg
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_group.id
    group by s.member_id
  ) allocation
  where m.id = allocation.member_id
    and m.group_id = v_group.id;

  update public.weighbridge_shared_impurity_groups g
  set settlement_mode = 'proportional_members_v2',
      member_resolution_status = 'proportional',
      pool_split_out_ledger_entry_id = v_pool_split_entry_id,
      audit_json = coalesce(g.audit_json, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'member_settlement_v2', pg_catalog.jsonb_build_object(
               'allocation_rule', 'proportional_by_source_balance',
               'allocated_impurity_kg', v_allocated_total,
               'clean_total_kg', v_clean,
               'source_restore_count', v_restore_count,
               'member_impurity_entry_count', v_impurity_count,
               'pool_split_out_ledger_entry_id', v_pool_split_entry_id,
               'settled_at', pg_catalog.now()
             )
           ),
      updated_at = pg_catalog.now()
  where g.id = v_group.id
    and g.settlement_mode = 'legacy_pool_unresolved';
  if not found then
    raise exception 'SHARED_IMPURITY_V2_GROUP_UPDATE_FAILED' using errcode = '40001';
  end if;

  update public.tickets t
  set audit_json = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          coalesce(t.audit_json, '{}'::jsonb),
          '{shared_impurity_pool_finalize,member_resolution_status}',
          '"proportional"'::jsonb,
          true
        ),
        '{shared_impurity_pool_finalize,allocation_rule}',
        '"proportional_by_source_balance"'::jsonb,
        true
      ) || pg_catalog.jsonb_build_object(
        'shared_impurity_member_settlement_v2', pg_catalog.jsonb_build_object(
          'group_id', v_group.id,
          'allocated_impurity_kg', v_allocated_total,
          'clean_total_kg', v_clean
        )
      ),
      updated_at = pg_catalog.now()
  where t.id = v_group.ticket_id and t.company_id = v_group.company_id;

  update public.ticket_lines line
  set quality_json = pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          coalesce(line.quality_json, '{}'::jsonb),
          '{shared_impurity_pool,member_resolution_status}',
          '"proportional"'::jsonb,
          true
        ),
        '{shared_impurity_pool,allocation_rule}',
        '"proportional_by_source_balance"'::jsonb,
        true
      ),
      updated_at = pg_catalog.now()
  where line.ticket_id = v_group.ticket_id and line.company_id = v_group.company_id;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, new_values, reason
  ) values (
    v_group.company_id, v_group.finalized_by,
    'weighbridge_shared_impurity_pool', v_group.id::text,
    'settle_members_v2',
    pg_catalog.jsonb_build_object(
      'ticket_id', v_group.ticket_id,
      'allocation_rule', 'proportional_by_source_balance',
      'allocated_impurity_kg', v_allocated_total,
      'clean_total_kg', v_clean,
      'source_restore_count', v_restore_count,
      'member_impurity_entry_count', v_impurity_count,
      'pool_split_out_ledger_entry_id', v_pool_split_entry_id
    ),
    'Shared weighing retained as one document; stock identities settled separately.'
  );

  return pg_catalog.jsonb_build_object(
    'settlement_mode', 'proportional_members_v2',
    'allocated_impurity_kg', v_allocated_total,
    'source_restore_count', v_restore_count,
    'member_impurity_entry_count', v_impurity_count,
    'pool_split_out_ledger_entry_id', v_pool_split_entry_id,
    'idempotent_settlement', false
  );
end
$function$

