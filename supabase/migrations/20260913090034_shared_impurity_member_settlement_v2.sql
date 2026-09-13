-- P0 shared impurity member settlement V2.
-- A shared weighing is one impurity document, not a new mixed stock identity.
-- The legacy V1 finalizer is retained as the atomic source lock/reclassification
-- engine, then its clean pool is deterministically returned to the original
-- source batches and only the measured impurity is allocated proportionally.

begin;

alter table public.weighbridge_shared_impurity_groups
  add column settlement_mode text not null default 'legacy_pool_unresolved',
  add column pool_split_out_ledger_entry_id uuid
    references public.stock_ledger_entries(id) on delete restrict;

alter table public.weighbridge_shared_impurity_groups
  add constraint weighbridge_shared_impurity_groups_settlement_mode_check
  check (settlement_mode in ('legacy_pool_unresolved', 'proportional_members_v2'));

alter table public.weighbridge_shared_impurity_groups
  drop constraint weighbridge_shared_impurity_grou_member_resolution_status_check;

alter table public.weighbridge_shared_impurity_groups
  add constraint weighbridge_shared_impurity_groups_member_status_v2_check
  check (member_resolution_status in ('unresolved', 'proportional'));

alter table public.weighbridge_shared_impurity_members
  add column allocated_impurity_kg numeric(18,3),
  add column clean_total_kg numeric(18,3);

alter table public.weighbridge_shared_impurity_members
  drop constraint weighbridge_shared_impurity_members_clean_balance_status_check;

alter table public.weighbridge_shared_impurity_members
  drop constraint weighbridge_shared_impurity_members_yield_status_check;

alter table public.weighbridge_shared_impurity_members
  add constraint weighbridge_shared_impurity_members_clean_balance_status_check
  check (clean_balance_status in ('unresolved', 'proportional')),
  add constraint weighbridge_shared_impurity_members_yield_status_check
  check (yield_status in ('unresolved', 'proportional')),
  add constraint weighbridge_shared_impurity_members_allocation_check
  check (
    (clean_balance_status = 'unresolved'
      and allocated_impurity_kg is null
      and clean_total_kg is null)
    or (clean_balance_status = 'proportional'
      and allocated_impurity_kg >= 0
      and clean_total_kg >= 0
      and pg_catalog.abs(
        source_total_snapshot_kg - allocated_impurity_kg - clean_total_kg
      ) <= 0.001)
  );

alter table public.weighbridge_shared_impurity_source_batches
  add column allocated_impurity_kg numeric(18,3),
  add column source_restore_ledger_entry_id uuid
    references public.stock_ledger_entries(id) on delete restrict,
  add column impurity_out_ledger_entry_id uuid
    references public.stock_ledger_entries(id) on delete restrict;

alter table public.weighbridge_shared_impurity_source_batches
  add constraint weighbridge_shared_impurity_source_batches_allocation_check
  check (
    allocated_impurity_kg is null
    or (allocated_impurity_kg >= 0
      and allocated_impurity_kg <= source_balance_snapshot_kg
      and source_restore_ledger_entry_id is not null
      and (
        (allocated_impurity_kg = 0 and impurity_out_ledger_entry_id is null)
        or (allocated_impurity_kg > 0 and impurity_out_ledger_entry_id is not null)
      ))
  );

-- The generic ticket void creates full-fidelity storno rows before this
-- lifecycle trigger runs. Extend the already-audited V1 validator with the
-- three V2 technical movements; open-ticket behavior remains unchanged.
do $patch_void_trigger$
declare
  v_definition text;
  v_old_count text := $needle$if v_base_count <> (
        select pg_catalog.count(*)::integer + 2
        from public.weighbridge_shared_impurity_source_batches source
        where source.group_id = v_group.id
      ) then$needle$;
  v_new_count text := $replacement$if v_base_count <> (
        select (
          pg_catalog.count(*)
          + pg_catalog.count(source.source_restore_ledger_entry_id)
          + pg_catalog.count(source.impurity_out_ledger_entry_id)
          + 2
          + case when v_group.pool_split_out_ledger_entry_id is null then 0 else 1 end
        )::integer
        from public.weighbridge_shared_impurity_source_batches source
        where source.group_id = v_group.id
      ) then$replacement$;
  v_old_tail text := $needle$when 'weighbridge_impurities_shared' then not (
                base.id = v_group.impurity_out_ledger_entry_id
                and base.reason_ref_id = new.id
                and base.inventory_batch_id = v_group.pool_inventory_batch_id
                and base.quantity = v_group.impurity_weight_kg
                and base.delta_qty_signed = -v_group.impurity_weight_kg
                and base.direction::text = 'out'
                and base.variety_id is null
                and base.reproduction_id is null
              )
              else true$needle$;
  v_new_tail text := $replacement$when 'weighbridge_impurities_shared' then not (
                base.id = v_group.impurity_out_ledger_entry_id
                and base.reason_ref_id = new.id
                and base.inventory_batch_id = v_group.pool_inventory_batch_id
                and base.quantity = v_group.impurity_weight_kg
                and base.delta_qty_signed = -v_group.impurity_weight_kg
                and base.direction::text = 'out'
                and base.variety_id is null
                and base.reproduction_id is null
              )
              when 'harvest_pool_source_restore_in' then not exists (
                select 1
                from public.weighbridge_shared_impurity_source_batches source
                where source.group_id = v_group.id
                  and source.id = base.reason_ref_id
                  and source.source_restore_ledger_entry_id = base.id
                  and source.inventory_batch_id = base.inventory_batch_id
                  and source.source_balance_snapshot_kg = base.quantity
                  and base.delta_qty_signed = source.source_balance_snapshot_kg
                  and base.direction::text = 'in'
              )
              when 'weighbridge_impurities_shared_member' then not exists (
                select 1
                from public.weighbridge_shared_impurity_source_batches source
                where source.group_id = v_group.id
                  and source.id = base.reason_ref_id
                  and source.impurity_out_ledger_entry_id = base.id
                  and source.inventory_batch_id = base.inventory_batch_id
                  and source.allocated_impurity_kg = base.quantity
                  and base.delta_qty_signed = -source.allocated_impurity_kg
                  and base.direction::text = 'out'
              )
              when 'harvest_pool_split_out' then not (
                base.id = v_group.pool_split_out_ledger_entry_id
                and base.reason_ref_id = v_group.id
                and base.inventory_batch_id = v_group.pool_inventory_batch_id
                and base.quantity = v_group.clean_total_kg
                and base.delta_qty_signed = -v_group.clean_total_kg
                and base.direction::text = 'out'
                and base.variety_id is null
                and base.reproduction_id is null
              )
              else true$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'sync_shared_impurity_pool_ticket_void_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  v_old_count := pg_catalog.replace(v_old_count, pg_catalog.chr(13), '');
  v_new_count := pg_catalog.replace(v_new_count, pg_catalog.chr(13), '');
  v_old_tail := pg_catalog.replace(v_old_tail, pg_catalog.chr(13), '');
  v_new_tail := pg_catalog.replace(v_new_tail, pg_catalog.chr(13), '');

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old_count) = 0
     or pg_catalog.strpos(v_definition, v_old_tail) = 0
  then
    raise exception 'SHARED_IMPURITY_V2_VOID_PATCH_CONTRACT_MISSING|%|%',
      pg_catalog.strpos(v_definition, v_old_count),
      pg_catalog.strpos(v_definition, v_old_tail);
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_count, v_new_count);
  v_definition := pg_catalog.replace(v_definition, v_old_tail, v_new_tail);
  execute v_definition;
end
$patch_void_trigger$;

create or replace function private.settle_shared_impurity_members_v2(
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  for v_source in
    select s.*, ib.crop_id, ib.variety_id, ib.reproduction_id
    from public.weighbridge_shared_impurity_source_batches s
    join public.inventory_batches ib on ib.id = s.inventory_batch_id
    where s.group_id = v_group.id
      and s.company_id = v_group.company_id
    order by s.inventory_batch_id
    for update of s, ib
  loop
    v_source_index := v_source_index + 1;
    if v_source.state <> 'reclassified'
       or v_source.source_restore_ledger_entry_id is not null
       or v_source.impurity_out_ledger_entry_id is not null
       or v_source.allocated_impurity_kg is not null
    then
      raise exception 'SHARED_IMPURITY_V2_SOURCE_STATE_INVALID|%', v_source.inventory_batch_id
        using errcode = '23514';
    end if;
    select pg_catalog.round(coalesce(pg_catalog.sum(e.delta_qty_signed), 0), 6)
    into v_source_balance
    from public.stock_ledger_entries e
    where e.company_id = v_group.company_id
      and e.warehouse_id = v_group.source_warehouse_id
      and e.inventory_batch_id = v_source.inventory_batch_id;
    if pg_catalog.abs(v_source_balance) > 0.001 then
      raise exception 'SHARED_IMPURITY_V2_SOURCE_NOT_ZERO|%|%',
        v_source.inventory_batch_id, v_source_balance using errcode = '23514';
    end if;

    v_allocation := case
      when v_source_index = v_source_count then v_impurity - v_allocated_total
      else pg_catalog.round(
        v_impurity * v_source.source_balance_snapshot_kg / v_group.source_total_kg,
        3
      )
    end;
    if v_allocation < 0 or v_allocation > v_source.source_balance_snapshot_kg then
      raise exception 'SHARED_IMPURITY_V2_ALLOCATION_INVALID|%|%',
        v_source.inventory_batch_id, v_allocation using errcode = '23514';
    end if;
    v_source_clean := pg_catalog.round(v_source.source_balance_snapshot_kg - v_allocation, 3);

    insert into public.stock_ledger_entries (
      company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
      warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
      direction, quantity, uom, delta_qty_signed, mass_kg,
      unit_source, unit_contract_version, reason_type, reason_ref_id,
      occurred_at, created_by, is_storno, notes
    ) values (
      v_group.company_id, v_group.ticket_id, v_group.product_id,
      v_source.crop_id, v_source.variety_id, v_source.reproduction_id,
      v_group.source_warehouse_id, v_source.inventory_batch_id,
      v_source.inventory_batch_id::text, v_source.inventory_batch_id::text,
      'commodity', 'in', v_source.source_balance_snapshot_kg, 'kg',
      v_source.source_balance_snapshot_kg, v_source.source_balance_snapshot_kg,
      'shared_impurity_member_settlement_v2', 2,
      'harvest_pool_source_restore_in', v_source.id,
      pg_catalog.now(), v_group.finalized_by, false,
      'Technical restoration of the original stock identity after shared impurity weighing.'
    ) returning id into v_restore_entry_id;
    v_restore_count := v_restore_count + 1;

    v_impurity_entry_id := null;
    if v_allocation > 0 then
      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
        warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
        direction, quantity, uom, delta_qty_signed, mass_kg,
        unit_source, unit_contract_version, reason_type, reason_ref_id,
        occurred_at, created_by, is_storno, notes
      ) values (
        v_group.company_id, v_group.ticket_id, v_group.product_id,
        v_source.crop_id, v_source.variety_id, v_source.reproduction_id,
        v_group.source_warehouse_id, v_source.inventory_batch_id,
        v_source.inventory_batch_id::text, v_source.inventory_batch_id::text,
        'commodity', 'out', v_allocation, 'kg', -v_allocation, v_allocation,
        'shared_impurity_member_settlement_v2', 2,
        'weighbridge_impurities_shared_member', v_source.id,
        pg_catalog.now(), v_group.finalized_by, false,
        'Measured group impurity allocated proportionally by pre-impurity source mass.'
      ) returning id into v_impurity_entry_id;
      v_impurity_count := v_impurity_count + 1;
    end if;

    update public.weighbridge_shared_impurity_source_batches s
    set allocated_impurity_kg = v_allocation,
        source_restore_ledger_entry_id = v_restore_entry_id,
        impurity_out_ledger_entry_id = v_impurity_entry_id,
        updated_at = pg_catalog.now()
    where s.id = v_source.id
      and s.group_id = v_group.id
      and s.allocated_impurity_kg is null;
    if not found then
      raise exception 'SHARED_IMPURITY_V2_SOURCE_UPDATE_FAILED' using errcode = '40001';
    end if;

    v_source_balance := private.reconcile_harvest_lot_batch_balance_v1(
      v_source.inventory_batch_id
    );
    if pg_catalog.abs(v_source_balance - v_source_clean) > 0.001 then
      raise exception 'SHARED_IMPURITY_V2_SOURCE_RECONCILE_FAILED|%|%',
        v_source.inventory_batch_id, v_source_balance using errcode = '23514';
    end if;
    v_allocated_total := v_allocated_total + v_allocation;
  end loop;

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
$function$;

revoke all on function private.settle_shared_impurity_members_v2(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the already-hardened atomic V1 finalizer as an internal engine.
alter function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) set schema private;

revoke all on function private.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_tare_variance_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_settlement jsonb;
  v_group_id uuid;
begin
  v_result := private.finalize_weighbridge_shared_impurity_pool_ticket_v1(
    p_ticket_id,
    p_session_token,
    p_tare_weight_kg,
    p_tare_variance_confirmed,
    p_idempotency_key
  );
  v_group_id := nullif(v_result ->> 'pool_id', '')::uuid;
  if v_group_id is null then
    select g.id into v_group_id
    from public.weighbridge_shared_impurity_groups g
    where g.ticket_id = p_ticket_id;
  end if;
  v_settlement := private.settle_shared_impurity_members_v2(v_group_id);
  return v_result || v_settlement || pg_catalog.jsonb_build_object(
    'member_resolution_status', 'proportional'
  );
end
$function$;

revoke all on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) to authenticated;

comment on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) is
  'Finalizes one shared impurity weighing atomically, then returns clean mass to each original stock identity and allocates only the measured impurity proportionally by source mass.';

-- Repair every already-finalized V1 pool in the same transaction. No history
-- is deleted: compensating technical ledger entries preserve a complete audit.
do $repair_existing$
declare
  v_group_id uuid;
begin
  for v_group_id in
    select g.id
    from public.weighbridge_shared_impurity_groups g
    where g.state = 'finalized'
      and g.settlement_mode = 'legacy_pool_unresolved'
    order by g.created_at, g.id
  loop
    perform private.settle_shared_impurity_members_v2(v_group_id);
  end loop;
end
$repair_existing$;

do $postconditions$
begin
  if exists (
    select 1
    from public.weighbridge_shared_impurity_groups g
    where g.state = 'finalized'
      and g.settlement_mode <> 'proportional_members_v2'
  ) then
    raise exception 'SHARED_IMPURITY_V2_UNSETTLED_FINAL_GROUP';
  end if;
  if exists (
    select 1
    from public.weighbridge_shared_impurity_groups g
    join public.inventory_batches batch on batch.id = g.pool_inventory_batch_id
    where g.state = 'finalized'
      and g.settlement_mode = 'proportional_members_v2'
      and (
        pg_catalog.abs(coalesce(batch.current_quantity, 0)) > 0.001
        or pg_catalog.abs(coalesce(batch.current_weight_kg, 0)) > 0.001
        or pg_catalog.abs(coalesce(batch.mass_kg, 0)) > 0.001
      )
  ) then
    raise exception 'SHARED_IMPURITY_V2_VISIBLE_POOL_REMAINS';
  end if;
  if has_function_privilege(
    'anon',
    'public.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.finalize_weighbridge_shared_impurity_pool_ticket_v1(uuid,text,numeric,boolean,uuid)',
    'EXECUTE'
  ) then
    raise exception 'SHARED_IMPURITY_V2_RPC_GRANT_INVALID';
  end if;
end
$postconditions$;

commit;
