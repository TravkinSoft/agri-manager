begin;

-- P0: large shared-impurity tickets used a correlated COALESCE expression to
-- verify every source balance. That expression could not use the canonical
-- batch indexes and scanned the same warehouse ledger once per source batch.
-- Keep all three supported identity representations, but aggregate them through
-- mutually-exclusive indexed paths.
create index if not exists idx_stock_ledger_picker_batch_text_trimmed_v6
  on public.stock_ledger_entries (
    company_id,
    warehouse_id,
    (nullif(pg_catalog.btrim(batch_id_text), ''))
  )
  where inventory_batch_id is null
    and nullif(pg_catalog.btrim(batch_id_text), '') is not null;

create index if not exists idx_stock_ledger_picker_legacy_batch_trimmed_v6
  on public.stock_ledger_entries (
    company_id,
    warehouse_id,
    (nullif(pg_catalog.btrim(batch_id), ''))
  )
  where inventory_batch_id is null
    and nullif(pg_catalog.btrim(batch_id_text), '') is null
    and nullif(pg_catalog.btrim(batch_id), '') is not null;

create or replace function private.shared_impurity_sources_have_nonzero_balance_v1(
  p_group_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with source_set as materialized (
    select
      source.id,
      source.company_id,
      source.warehouse_id,
      source.inventory_batch_id
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = p_group_id
      and source.company_id = p_company_id
  ), balance_rows as (
    select source.id as source_id, entry.delta_qty_signed
    from source_set source
    join public.stock_ledger_entries entry
      on entry.company_id = source.company_id
     and entry.warehouse_id = source.warehouse_id
     and entry.inventory_batch_id = source.inventory_batch_id

    union all

    select source.id, entry.delta_qty_signed
    from source_set source
    join public.stock_ledger_entries entry
      on entry.company_id = source.company_id
     and entry.warehouse_id = source.warehouse_id
     and entry.inventory_batch_id is null
     and nullif(pg_catalog.btrim(entry.batch_id_text), '') = source.inventory_batch_id::text

    union all

    select source.id, entry.delta_qty_signed
    from source_set source
    join public.stock_ledger_entries entry
      on entry.company_id = source.company_id
     and entry.warehouse_id = source.warehouse_id
     and entry.inventory_batch_id is null
     and nullif(pg_catalog.btrim(entry.batch_id_text), '') is null
     and nullif(pg_catalog.btrim(entry.batch_id), '') = source.inventory_batch_id::text
  )
  select exists (
    select 1
    from source_set source
    left join balance_rows row on row.source_id = source.id
    group by source.id
    having pg_catalog.abs(coalesce(pg_catalog.sum(row.delta_qty_signed), 0)) > 0.001
  );
$function$;

revoke all on function private.shared_impurity_sources_have_nonzero_balance_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function private.shared_impurity_sources_have_nonzero_balance_v1(uuid, uuid) is
  'Returns whether any frozen shared-impurity source has a non-zero ledger balance using indexed canonical and legacy identity paths.';

do $patch_finalize_balance_check$
declare
  v_definition text;
  v_old text := $needle$
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
  end if;$needle$;
  v_new text := $replacement$
  if private.shared_impurity_sources_have_nonzero_balance_v1(
    v_pool.id,
    v_pool.company_id
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_NOT_ZERO'
      using errcode = '23514';
  end if;$replacement$;
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
    raise exception 'SHARED_IMPURITY_V6_FINALIZE_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$patch_finalize_balance_check$;

do $patch_settlement_balance_check$
declare
  v_definition text;
  v_old text := $needle$
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
  end if;$needle$;
  v_new text := $replacement$
  if private.shared_impurity_sources_have_nonzero_balance_v1(
    v_group.id,
    v_group.company_id
  ) then
    raise exception 'SHARED_IMPURITY_V2_SOURCE_NOT_ZERO'
      using errcode = '23514';
  end if;$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'settle_shared_impurity_members_v2'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_group_id uuid';

  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13), '');
  if v_definition is null or pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'SHARED_IMPURITY_V6_SETTLEMENT_PATCH_CONTRACT_MISSING|%',
      pg_catalog.strpos(v_definition, v_old);
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$patch_settlement_balance_check$;

comment on function public.finalize_weighbridge_shared_impurity_pool_ticket_v1(
  uuid, text, numeric, boolean, uuid
) is
  'Finalizes shared impurity atomically with indexed source-balance verification, exact source ledger trace and bulk member settlement.';

do $verify_v6_patch$
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

  if pg_catalog.strpos(
       v_engine,
       'private.shared_impurity_sources_have_nonzero_balance_v1'
     ) = 0
     or pg_catalog.strpos(v_engine, 'v_pool.company_id') = 0
     or pg_catalog.strpos(
       v_settlement,
       'private.shared_impurity_sources_have_nonzero_balance_v1'
     ) = 0
     or pg_catalog.strpos(v_settlement, 'v_group.company_id') = 0
  then
    raise exception 'SHARED_IMPURITY_V6_PATCH_VERIFICATION_FAILED';
  end if;
end
$verify_v6_patch$;

commit;
