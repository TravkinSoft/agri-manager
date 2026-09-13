-- A finalized V2 shared-impurity group restores every source batch and books
-- only its proportional impurity outflow back to that original identity. The
-- source row is therefore historical after settlement and must no longer hold
-- the partial unique lock that protects open/reclassifying groups.

do $patch_finalize_replay_source_lifecycle$
declare
  v_definition text;
  v_old_check text := $needle$
         where s.group_id = v_pool.id
           and s.state <> 'reclassified'
           and not exists (
             select 1 from public.stock_ledger_entries reversal
             where reversal.storno_of_entry_id = s.reclass_out_ledger_entry_id
           )$needle$;
  v_new_check text := $replacement$
         where s.group_id = v_pool.id
           and s.state <> 'reclassified'
           and not (
             (
               s.state = 'released'
               and v_pool.settlement_mode = 'proportional_members_v2'
               and v_pool.member_resolution_status = 'proportional'
               and s.allocated_impurity_kg is not null
               and s.source_restore_ledger_entry_id is not null
             )
             or exists (
               select 1 from public.stock_ledger_entries reversal
               where reversal.storno_of_entry_id = s.reclass_out_ledger_entry_id
             )
           )$replacement$;
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
  v_old_check := pg_catalog.replace(v_old_check, pg_catalog.chr(13), '');
  v_new_check := pg_catalog.replace(v_new_check, pg_catalog.chr(13), '');

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old_check) = 0
  then
    raise exception 'SHARED_IMPURITY_V3_REPLAY_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old_check);
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_check, v_new_check);
  execute v_definition;
end
$patch_finalize_replay_source_lifecycle$;

do $patch_void_source_lifecycle$
declare
  v_definition text;
  v_old_check text := $needle$
          and (
            source.state <> 'reclassified'
            or pg_catalog.abs(coalesce(batch.current_quantity, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.current_weight_kg, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.mass_kg, 0) - source.source_balance_snapshot_kg) > 0.001
          )$needle$;
  v_new_check text := $replacement$
          and (
            not (
              source.state = 'reclassified'
              or (
                source.state = 'released'
                and v_group.settlement_mode = 'proportional_members_v2'
                and v_group.member_resolution_status = 'proportional'
                and source.allocated_impurity_kg is not null
                and source.source_restore_ledger_entry_id is not null
              )
            )
            or pg_catalog.abs(coalesce(batch.current_quantity, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.current_weight_kg, 0) - source.source_balance_snapshot_kg) > 0.001
            or pg_catalog.abs(coalesce(batch.mass_kg, 0) - source.source_balance_snapshot_kg) > 0.001
          )$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'sync_shared_impurity_pool_ticket_void_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  v_old_check := pg_catalog.replace(v_old_check, pg_catalog.chr(13), '');
  v_new_check := pg_catalog.replace(v_new_check, pg_catalog.chr(13), '');

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old_check) = 0
  then
    raise exception 'SHARED_IMPURITY_V3_VOID_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old_check);
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_check, v_new_check);
  execute v_definition;
end
$patch_void_source_lifecycle$;

do $patch_settlement_source_lifecycle$
declare
  v_definition text;
  v_old_update text := $needle$
    update public.weighbridge_shared_impurity_source_batches s
    set allocated_impurity_kg = v_allocation,
        source_restore_ledger_entry_id = v_restore_entry_id,
        impurity_out_ledger_entry_id = v_impurity_entry_id,
        updated_at = pg_catalog.now()
    where s.id = v_source.id
      and s.group_id = v_group.id
      and s.allocated_impurity_kg is null;$needle$;
  v_new_update text := $replacement$
    update public.weighbridge_shared_impurity_source_batches s
    set state = 'released',
        allocated_impurity_kg = v_allocation,
        source_restore_ledger_entry_id = v_restore_entry_id,
        impurity_out_ledger_entry_id = v_impurity_entry_id,
        updated_at = pg_catalog.now()
    where s.id = v_source.id
      and s.group_id = v_group.id
      and s.state = 'reclassified'
      and s.allocated_impurity_kg is null;$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'settle_shared_impurity_members_v2'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_group_id uuid';

  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  v_old_update := pg_catalog.replace(v_old_update, pg_catalog.chr(13), '');
  v_new_update := pg_catalog.replace(v_new_update, pg_catalog.chr(13), '');

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_old_update) = 0
  then
    raise exception 'SHARED_IMPURITY_V3_SETTLEMENT_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old_update);
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_update, v_new_update);
  execute v_definition;
end
$patch_settlement_source_lifecycle$;

-- Repair only source rows whose V2 settlement is already complete and whose
-- original inventory identity has been restored. This changes lifecycle state
-- only; it does not create, remove or alter any stock-ledger movement.
update public.weighbridge_shared_impurity_source_batches s
set state = 'released',
    updated_at = pg_catalog.now()
from public.weighbridge_shared_impurity_groups g
where g.id = s.group_id
  and g.company_id = s.company_id
  and g.state = 'finalized'
  and g.settlement_mode = 'proportional_members_v2'
  and g.member_resolution_status = 'proportional'
  and s.state = 'reclassified'
  and s.allocated_impurity_kg is not null
  and s.source_restore_ledger_entry_id is not null;

do $verify_released_settled_sources$
begin
  if exists (
    select 1
    from public.weighbridge_shared_impurity_source_batches s
    join public.weighbridge_shared_impurity_groups g on g.id = s.group_id
    where g.company_id = s.company_id
      and g.state = 'finalized'
      and g.settlement_mode = 'proportional_members_v2'
      and g.member_resolution_status = 'proportional'
      and s.allocated_impurity_kg is not null
      and s.source_restore_ledger_entry_id is not null
      and s.state <> 'released'
  ) then
    raise exception 'SHARED_IMPURITY_V3_SETTLED_SOURCE_NOT_RELEASED';
  end if;
end
$verify_released_settled_sources$;

comment on table public.weighbridge_shared_impurity_source_batches is
  'Frozen source snapshots for shared impurity tickets. selected/reclassified rows hold an active source lock; released rows retain finalized history and may be selected by a later ticket.';
