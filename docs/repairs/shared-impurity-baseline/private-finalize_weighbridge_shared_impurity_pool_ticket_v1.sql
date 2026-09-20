CREATE OR REPLACE FUNCTION private.finalize_weighbridge_shared_impurity_pool_ticket_v1(p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_principal_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_gate_actor record;
  v_session private.weighbridge_operator_sessions%rowtype;
  v_shift public.weighbridge_shifts%rowtype;
  v_ticket public.tickets%rowtype;
  v_pool public.weighbridge_shared_impurity_groups%rowtype;
  v_line public.ticket_lines%rowtype;
  v_source record;
  v_pool_batch public.inventory_batches%rowtype;
  v_tare numeric(14,3) := pg_catalog.round(p_tare_weight_kg, 3);
  v_impurity numeric(18,6);
  v_clean numeric(18,6);
  v_previous_tare numeric(14,3);
  v_tare_difference_percent numeric(8,2);
  v_current_balance numeric(18,6);
  v_available_balance numeric(18,6);
  v_reconciled_balance numeric(18,6);
  v_source_sum numeric(18,6) := 0;
  v_member_sum numeric(18,6) := 0;
  v_ticket_effect numeric(18,6) := 0;
  v_pool_balance numeric(18,6) := 0;
  v_source_count integer := 0;
  v_member_count integer := 0;
  v_zero_source_count integer := 0;
  v_line_count integer := 0;
  v_weighing_count integer := 0;
  v_ledger_count integer := 0;
  v_source_out_count integer := 0;
  v_pool_in_count integer := 0;
  v_impurity_out_count integer := 0;
  v_pool_batch_id uuid := extensions.gen_random_uuid();
  v_pool_batch_code text;
  v_source_ledger_id uuid;
  v_pool_in_ledger_id uuid;
  v_impurity_out_ledger_id uuid;
  v_line_id uuid;
  v_fingerprint text;
  v_create_fingerprint text;
  v_scope_hash text;
  v_source_scope jsonb;
  v_expires timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if v_principal_id is null then
    raise exception 'SHARED_IMPURITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_ticket_id is null or p_idempotency_key is null then
    raise exception 'SHARED_IMPURITY_FINALIZE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_session_token, '')), '') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if v_tare is null
     or v_tare::text in ('NaN', 'Infinity', '-Infinity')
     or v_tare < 0
  then
    raise exception 'SHARED_IMPURITY_TARE_INVALID' using errcode = '22023';
  end if;

  select gate_actor.* into v_gate_actor
  from private.resolve_processing_gate_session_actor_v1() gate_actor;
  if not found
     or v_gate_actor.actor_profile_id is null
     or v_gate_actor.selected_company_id is null
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Authorization and business attribution follow the canonical effective
  -- actor (including a validated impersonation), while the PIN session remains
  -- bound to the actual authenticated principal below.
  select p.* into v_actor
  from public.profiles p
  where p.id = v_gate_actor.actor_profile_id
    and coalesce(p.status, 'active') = 'active';
  if not found
     or v_actor.role not in ('global_admin', 'company_admin', 'weighman')
  then
    raise exception 'SHARED_IMPURITY_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin'
     and v_actor.company_id is distinct from v_gate_actor.selected_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Bind the document lookup to the actor's selected company before revealing
  -- whether a ticket or shared pool exists.
  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
    and t.company_id = v_gate_actor.selected_company_id;
  if not found then
    raise exception 'SHARED_IMPURITY_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;
  select p.* into v_pool
  from public.weighbridge_shared_impurity_groups p
  where p.ticket_id = p_ticket_id
    and p.company_id = v_ticket.company_id;
  if not found then
    raise exception 'SHARED_IMPURITY_POOL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = v_ticket.company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  order by s.created_at desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open';
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if not exists (
    select 1 from public.company_people cp
    where cp.id = v_session.person_id
      and cp.company_id = v_ticket.company_id
      and cp.role_type = 'weighbridge_operator'
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_OPERATOR_FORBIDDEN' using errcode = '42501';
  end if;

  perform private.assert_processing_gate_actor_v1(v_ticket.company_id, v_actor.id);
  perform private.tz315_lock_company_season_write_gate_v1(
    v_ticket.company_id, v_pool.season_id
  );

  -- Re-lock and re-read every security and business resource after the common
  -- accounting gate.  This is the write-side scope snapshot.
  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.id = v_session.id
    and s.company_id = v_ticket.company_id
    and s.auth_user_id = v_principal_id
    and s.token_hash = pg_catalog.encode(
      extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex'
    )
    and s.status = 'active'
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  select ws.* into v_shift
  from public.weighbridge_shifts ws
  where ws.id = v_session.shift_id
    and ws.company_id = v_ticket.company_id
    and ws.status = 'open'
  for update;
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    if found then
      update public.weighbridge_shifts
      set status = 'closed',
          closed_at = last_activity_at + interval '24 hours',
          closed_by = null,
          closed_by_person_id = operator_person_id,
          close_reason = 'inactivity_24h'
      where id = v_shift.id and status = 'open';
    end if;
    update private.weighbridge_operator_sessions
    set status = 'expired', revoked_at = pg_catalog.now()
    where id = v_session.id;
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;

  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;
  select p.* into v_pool
  from public.weighbridge_shared_impurity_groups p
  where p.ticket_id = p_ticket_id
    and p.company_id = v_ticket.company_id
  for update;
  if not found then
    raise exception 'SHARED_IMPURITY_POOL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_ticket.company_id is distinct from v_pool.company_id
     or v_ticket.warehouse_from_id is distinct from v_pool.source_warehouse_id
     or v_ticket.season_id is distinct from v_pool.season_id
  then
    raise exception 'SHARED_IMPURITY_TICKET_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if coalesce(v_ticket.is_voided, false)
     or v_ticket.status::text = 'voided'
     or v_pool.state = 'voided'
  then
    raise exception 'SHARED_IMPURITY_VOIDED' using errcode = '23514';
  end if;
  if v_ticket.direction::text <> 'outgoing'
     or v_ticket.op_type <> 'weighbridge_impurities'
     or v_ticket.ticket_type <> 'impurity_removal'
     or v_ticket.source_kind <> 'warehouse'
     or v_ticket.source_id is distinct from v_pool.source_warehouse_id::text
     or v_ticket.destination_kind <> 'impurity_removal'
     or v_ticket.destination_id is not null
     or v_ticket.warehouse_to_id is not null
     or v_ticket.weigh_method::text <> 'double_weighing'
     or v_ticket.weight_source is distinct from 'manual'
     or v_ticket.source_physical_state is distinct from 'SOURCE'
     or v_ticket.crop_structure_allocation_id is not null
     or v_ticket.replacement_ticket_id is not null
     or v_ticket.correction_of_ticket_id is not null
     or v_ticket.linked_request_id is not null
     or v_ticket.linked_processing_id is not null
     or v_ticket.processing_output_role is not null
     or v_ticket.created_by is distinct from v_pool.created_by
     or v_ticket.responsible_user_id is distinct from v_pool.created_by
  then
    raise exception 'SHARED_IMPURITY_TICKET_TYPE_INVALID' using errcode = '23514';
  end if;
  if v_ticket.shift_id is distinct from v_shift.id then
    if v_ticket.created_by_person_id is distinct from v_session.person_id
       or not exists (
         select 1
         from public.weighbridge_shifts opening_shift
         where opening_shift.id = v_ticket.shift_id
           and opening_shift.company_id = v_ticket.company_id
           and opening_shift.operator_person_id = v_ticket.created_by_person_id
           and opening_shift.status = 'closed'
       )
    then
      raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
    end if;
  elsif v_ticket.created_by_person_id is distinct from v_session.person_id then
    raise exception 'SHARED_IMPURITY_OPERATOR_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if v_ticket.gross_weight_kg is null
     or v_ticket.gross_weight_kg::text in ('NaN', 'Infinity', '-Infinity')
     or v_pool.source_total_kg is null
     or v_pool.source_total_kg::text in ('NaN', 'Infinity', '-Infinity')
     or v_ticket.gross_weight_kg <= 0
     or v_tare >= v_ticket.gross_weight_kg
  then
    raise exception 'SHARED_IMPURITY_WEIGHT_INVALID' using errcode = '22023';
  end if;
  if v_pool.state = 'open'
     and (
       v_ticket.status::text <> 'active'
       or coalesce(v_ticket.is_finalized, false)
       or v_ticket.tare_weight_kg is not null
       or v_ticket.net_weight_kg is not null
       or v_ticket.physical_net_kg is not null
       or v_ticket.accepted_weight_kg is not null
       or v_ticket.weighing_2_at is not null
       or v_ticket.batch_id is not null
       or v_ticket.lot_id is not null
     )
  then
    raise exception 'SHARED_IMPURITY_OPEN_TICKET_CHANGED' using errcode = '23514';
  end if;

  -- The legacy ticket tables still have broad tenant policies.  Treat their
  -- identity fields as untrusted on finalize and compare them with the frozen
  -- group fingerprint before any inventory write.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'harvest_lot_id', source_scope.harvest_lot_id,
        'crop_structure_id', source_scope.crop_structure_id
      ) order by source_scope.crop_structure_id, source_scope.harvest_lot_id
    ),
    '[]'::jsonb
  )
  into v_source_scope
  from (
    select distinct source.harvest_lot_id, source.crop_structure_id
    from public.weighbridge_shared_impurity_source_batches source
    where source.group_id = v_pool.id
  ) source_scope;
  v_create_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id', v_ticket.company_id,
          'source_warehouse_id', v_pool.source_warehouse_id,
          'sources', v_source_scope,
          'vehicle_id', v_ticket.vehicle_id,
          'driver_id', v_ticket.driver_id,
          'gross_weight_kg', pg_catalog.round(v_ticket.gross_weight_kg, 3),
          'impurity_type', v_pool.impurity_type,
          'notes', nullif(pg_catalog.btrim(coalesce(v_ticket.notes, '')), ''),
          'contract_version', 'shared_impurity_pool_v1'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_create_fingerprint is distinct from v_pool.create_request_fingerprint then
    raise exception 'SHARED_IMPURITY_CREATE_SNAPSHOT_CHANGED' using errcode = '23514';
  end if;

  if v_pool.state = 'open' and not (
    exists (
      select 1 from public.reference_vehicles rv
      where rv.id = v_ticket.vehicle_id
        and rv.company_id = v_ticket.company_id
        and coalesce(rv.is_active, false)
        and not coalesce(rv.archived, false)
    )
    or exists (
      select 1 from public.reference_machines rm
      where rm.id = v_ticket.vehicle_id
        and rm.company_id = v_ticket.company_id
        and coalesce(rm.is_active, false)
        and not coalesce(rm.archived, false)
    )
  ) then
    raise exception 'SHARED_IMPURITY_VEHICLE_INVALID' using errcode = '23503';
  end if;
  if v_pool.state = 'open' and not exists (
    select 1 from public.company_people cp
    where cp.id = v_ticket.driver_id
      and cp.company_id = v_ticket.company_id
      and cp.role_type in ('driver', 'mechanic_operator')
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_DRIVER_INVALID' using errcode = '23503';
  end if;
  if v_pool.state = 'open' and (not exists (
    select 1 from public.seasons season
    where season.id = v_pool.season_id
      and season.company_id = v_pool.company_id
      and not coalesce(season.archived, false)
  ) or not exists (
    select 1 from public.warehouses warehouse
    where warehouse.id = v_pool.source_warehouse_id
      and warehouse.company_id = v_pool.company_id
      and not coalesce(warehouse.archived, false)
      and not coalesce(warehouse.is_archived, false)
      and (
        warehouse.place_type in ('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER')
        or pg_catalog.lower(coalesce(warehouse.warehouse_type, '')) in (
          'grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator'
        )
      )
  ) or not exists (
    select 1 from public.products product
    where product.id = v_pool.product_id
      and public.canonical_stock_uom(
        coalesce(nullif(product.base_uom, ''), product.unit)
      ) = 'kg'
  )) then
    raise exception 'SHARED_IMPURITY_SOURCE_PLACE_OR_SEASON_INVALID'
      using errcode = '23514';
  end if;

  v_impurity := pg_catalog.round(v_ticket.gross_weight_kg - v_tare, 6);
  v_clean := pg_catalog.round(v_pool.source_total_kg - v_impurity, 6);
  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'ticket_id', p_ticket_id,
          'tare_weight_kg', v_tare,
          'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false),
          'contract_version', 'shared_impurity_pool_v1'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'travkinflow.shared-impurity.finalize.v1|'
        || v_ticket.company_id::text || '|' || p_idempotency_key::text,
      0::bigint
    )
  );

  if exists (
    select 1
    from public.weighbridge_shared_impurity_groups other_pool
    where other_pool.company_id = v_ticket.company_id
      and other_pool.finalize_idempotency_key = p_idempotency_key
      and other_pool.id <> v_pool.id
  ) then
    raise exception 'SHARED_IMPURITY_FINALIZE_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;

  if v_pool.state = 'finalized'
     or coalesce(v_ticket.is_finalized, false)
     or v_ticket.status::text = 'finalized'
  then
    if v_pool.state <> 'finalized'
       or not coalesce(v_ticket.is_finalized, false)
       or v_ticket.status::text <> 'finalized'
    then
      raise exception 'SHARED_IMPURITY_FINALIZE_STATE_INCONSISTENT' using errcode = '23514';
    end if;
    if v_pool.finalize_idempotency_key is distinct from p_idempotency_key
       or v_pool.finalize_request_fingerprint is distinct from v_fingerprint
    then
      raise exception 'SHARED_IMPURITY_ALREADY_FINALIZED' using errcode = '23505';
    end if;

    select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
    into v_ticket_effect
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id;
    if pg_catalog.abs(v_ticket_effect + v_pool.impurity_weight_kg) > 0.001
       or exists (
         select 1
         from public.weighbridge_shared_impurity_source_batches s
         join public.inventory_batches ib on ib.id = s.inventory_batch_id
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
           )
       )
    then
      raise exception 'SHARED_IMPURITY_REPLAY_POSTCONDITION_FAILED' using errcode = '23514';
    end if;
    select pg_catalog.count(*)::integer into v_source_count
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_pool.id;
    select pg_catalog.count(*)::integer into v_member_count
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool.id;
    select pg_catalog.count(*)::integer into v_ledger_count
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
      and not coalesce(sle.is_storno, false);
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'ticket_id', v_ticket.id,
      'pool_id', v_pool.id,
      'pool_inventory_batch_id', v_pool.pool_inventory_batch_id,
      'source_total_kg', v_pool.source_total_kg,
      'impurity_weight_kg', v_pool.impurity_weight_kg,
      'clean_total_kg', v_pool.clean_total_kg,
      'source_batch_count', v_source_count,
      'member_count', v_member_count,
      'member_resolution_status', v_pool.member_resolution_status,
      'ledger_count', v_ledger_count,
      'idempotent_replay', true
    );
  end if;

  if v_pool.state <> 'open' then
    raise exception 'SHARED_IMPURITY_POOL_NOT_OPEN' using errcode = '23514';
  end if;
  if v_impurity <= 0 then
    raise exception 'SHARED_IMPURITY_NET_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if v_clean < 0 then
    raise exception 'IMPURITY_WEIGHT_EXCEEDS_AVAILABLE|%', v_pool.source_total_kg
      using errcode = '23514';
  end if;
  v_clean := greatest(v_clean, 0);

  select t.tare_weight_kg into v_previous_tare
  from public.tickets t
  where t.company_id = v_ticket.company_id
    and t.vehicle_id = v_ticket.vehicle_id
    and t.id <> v_ticket.id
    and t.status::text = 'finalized'
    and coalesce(t.is_finalized, false)
    and not coalesce(t.is_voided, false)
    and t.tare_weight_kg > 0
  order by t.finalized_at desc nulls last, t.updated_at desc
  limit 1;
  if v_previous_tare is not null then
    v_tare_difference_percent := pg_catalog.round(
      ((v_tare - v_previous_tare) / v_previous_tare) * 100,
      2
    );
    if pg_catalog.abs(v_tare_difference_percent) >= 20
       and not coalesce(p_tare_variance_confirmed, false)
    then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'requires_confirmation', true,
        'code', 'tare_variance_confirmation_required',
        'previous_tare_kg', v_previous_tare,
        'current_tare_kg', v_tare,
        'difference_percent', v_tare_difference_percent
      );
    end if;
  end if;

  select pg_catalog.count(*)::integer,
         min(tl.id::text)::uuid
  into v_line_count, v_line_id
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id
    and tl.company_id = v_ticket.company_id;
  if v_line_count <> 1 then
    raise exception 'SHARED_IMPURITY_REQUIRES_ONE_TICKET_LINE' using errcode = '23514';
  end if;
  select tl.* into v_line
  from public.ticket_lines tl
  where tl.id = v_line_id
  for update;
  if v_line.product_id is distinct from v_pool.product_id
     or v_line.crop_id is distinct from v_pool.crop_id
     or v_line.warehouse_from_id is distinct from v_pool.source_warehouse_id
     or v_line.warehouse_to_id is not null
     or v_line.line_type is distinct from 'impurity_removal'
     or v_line.uom <> 'kg'
     or v_line.batch_id is not null
     or v_line.lot_id is not null
     or v_line.variety_id is not null
     or v_line.reproduction_id is not null
     or v_line.batch_class is distinct from 'commodity'
     or v_line.quantity <> 0
     or coalesce(v_line.quantity_kg, 0) <> 0
     or coalesce(v_line.net_line_weight_kg, 0) <> 0
     or coalesce(v_line.mass_kg, 0) <> 0
     or v_line.unit_source is distinct from 'shared_impurity_pool_v1'
     or v_line.unit_contract_version is not null
     or coalesce(v_line.quality_json ->> 'shared_impurity_pool_id', '') <> v_pool.id::text
     or coalesce(v_line.quality_json ->> 'member_resolution_status', '') <> 'unresolved'
  then
    raise exception 'SHARED_IMPURITY_TICKET_LINE_CHANGED' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id
      and tw.company_id = v_ticket.company_id
      and tw.weighing_no = 1
      and pg_catalog.abs(tw.measured_weight_kg - v_ticket.gross_weight_kg) <= 0.001
      and tw.device_source = 'manual'
      and tw.operator_user_id = v_pool.created_by
      and tw.operator_person_id = v_ticket.created_by_person_id
      and tw.weighbridge_shift_id = v_ticket.shift_id
  ) then
    raise exception 'SHARED_IMPURITY_GROSS_EVENT_INVALID' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.ticket_weighings tw
    where tw.ticket_id = p_ticket_id and tw.weighing_no = 2
  ) then
    raise exception 'SHARED_IMPURITY_TARE_EVENT_ALREADY_EXISTS' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
  ) then
    raise exception 'SHARED_IMPURITY_LEDGER_ALREADY_EXISTS' using errcode = '23505';
  end if;

  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'crop_structure_id', s.crop_structure_id,
              'harvest_lot_id', s.harvest_lot_id,
              'inventory_batch_id', s.inventory_batch_id,
              'source_balance_snapshot_kg', s.source_balance_snapshot_kg
            ) order by s.inventory_batch_id
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) into v_scope_hash
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool.id;
  if v_scope_hash is distinct from v_pool.source_scope_hash then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_CHANGED' using errcode = '23514';
  end if;
  if v_pool.identity_kind <> 'shared_unresolved'
     or not v_pool.is_mixed_harvest
     or pg_catalog.jsonb_array_length(v_pool.composition_snapshot) <> (
       select pg_catalog.count(*)::integer
       from public.weighbridge_shared_impurity_source_batches source
       where source.group_id = v_pool.id
     )
     or v_pool.composition_hash is distinct from pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(v_pool.composition_snapshot::text, 'UTF8'),
         'sha256'
       ),
       'hex'
     )
  then
    raise exception 'SHARED_IMPURITY_COMPOSITION_SNAPSHOT_CHANGED' using errcode = '23514';
  end if;

  perform 1
  from public.weighbridge_shared_impurity_source_batches s
  join public.inventory_batches ib
    on ib.id = s.inventory_batch_id and ib.company_id = s.company_id
  where s.group_id = v_pool.id
  order by ib.id
  for update of ib, s;

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
      s.*,
      ib.season_id as batch_season_id,
      ib.crop_id as batch_crop_id,
       ib.crop_structure_id as batch_crop_structure_id,
       ib.product_id as batch_product_id,
       ib.variety_id as batch_variety_id,
       ib.reproduction_id as batch_reproduction_id,
       ib.composition_snapshot as batch_composition_snapshot,
       ib.composition_hash as batch_composition_hash,
       ib.is_mixed_harvest as batch_is_mixed_harvest,
       ib.warehouse_id as batch_warehouse_id,
       ib.batch_class as batch_class,
       ib.physical_state as batch_physical_state,
       ib.uom as batch_uom,
       ib.origin_type as batch_origin_type,
       ib.source_ticket_id as batch_source_ticket_id,
       ib.current_quantity as batch_current_quantity,
      ib.current_weight_kg as batch_current_weight_kg,
      ib.mass_kg as batch_mass_kg,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = s.company_id
          and sle.warehouse_id = s.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = s.inventory_batch_id::text
      ), 0), 6) as exact_balance
    from public.weighbridge_shared_impurity_source_batches s
    join public.inventory_batches ib on ib.id = s.inventory_batch_id
    where s.group_id = v_pool.id
    order by s.inventory_batch_id
  loop
    v_source_count := v_source_count + 1;
    v_source_sum := v_source_sum + v_source.source_balance_snapshot_kg;
    v_current_balance := v_source.exact_balance;
    -- Conflicting reservations and processing allocations are checked once
    -- for the complete frozen source set below. Re-running those views for
    -- every physical trip made large field groups exceed statement_timeout.
    v_available_balance := v_current_balance;
    if v_source.state <> 'selected'
       or v_source.reclass_out_ledger_entry_id is not null
       or v_source.company_id is distinct from v_pool.company_id
       or v_source.warehouse_id is distinct from v_pool.source_warehouse_id
       or v_source.product_id is distinct from v_pool.product_id
       or v_source.batch_season_id is distinct from v_pool.season_id
       or v_source.batch_crop_id is distinct from v_pool.crop_id
       or v_source.batch_crop_structure_id is distinct from v_source.crop_structure_id
       or v_source.batch_product_id is distinct from v_pool.product_id
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(v_pool.composition_snapshot) component(value)
         where component.value @> pg_catalog.jsonb_build_object(
           'inventory_batch_id', v_source.inventory_batch_id,
           'harvest_lot_id', v_source.harvest_lot_id,
           'crop_structure_id', v_source.crop_structure_id,
           'source_ticket_id', v_source.source_ticket_id,
           'product_id', v_source.batch_product_id,
           'crop_id', v_source.batch_crop_id,
           'variety_id', v_source.batch_variety_id,
           'reproduction_id', v_source.batch_reproduction_id,
           'source_is_mixed_harvest', coalesce(v_source.batch_is_mixed_harvest, false),
           'source_composition_hash', v_source.batch_composition_hash,
           'source_composition_snapshot', coalesce(v_source.batch_composition_snapshot, '[]'::jsonb),
           'pre_impurity_source_mass_kg', v_source.source_balance_snapshot_kg,
           'clean_mass_status', 'unresolved'
         )
       )
       or v_source.batch_warehouse_id is distinct from v_pool.source_warehouse_id
       or v_source.batch_class is distinct from 'commodity'
       or coalesce(v_source.batch_physical_state, 'SOURCE') <> 'SOURCE'
       or public.canonical_stock_uom(v_source.batch_uom) is distinct from 'kg'
       or coalesce(v_source.batch_origin_type, '') not in ('harvest', 'transfer')
       or not exists (
         select 1
         from public.harvest_lot_batches hlb
         join public.harvest_lots hl
           on hl.id = hlb.harvest_lot_id
          and hl.company_id = hlb.company_id
           and hl.status = 'active'
           and hl.season_id is not distinct from v_pool.season_id
           and hl.crop_id is not distinct from v_pool.crop_id
         join public.crop_structure cs
           on cs.id = hlb.crop_structure_id
          and cs.company_id = hlb.company_id
          and cs.season_id is not distinct from v_pool.season_id
          and cs.crop_id is not distinct from v_pool.crop_id
          and not coalesce(cs.archived, false)
          and coalesce(cs.land_use_type, 'crop') = 'crop'
         join public.fields f
           on f.id = cs.field_id
          and f.company_id = cs.company_id
          and not coalesce(f.archived, false)
         join public.weighbridge_shared_impurity_members m
           on m.group_id = v_pool.id
          and m.company_id = hlb.company_id
          and m.crop_structure_id = cs.id
          and m.field_id = cs.field_id
         where hlb.harvest_lot_id = v_source.harvest_lot_id
           and hlb.company_id = v_source.company_id
           and hlb.inventory_batch_id = v_source.inventory_batch_id
           and hlb.crop_structure_id = v_source.crop_structure_id
           and coalesce(v_source.batch_source_ticket_id, hlb.source_ticket_id)
                 is not distinct from v_source.source_ticket_id
       )
       or (
         v_source.source_ticket_id is not null
         and not exists (
           select 1 from public.tickets source_ticket
           where source_ticket.id = v_source.source_ticket_id
             and source_ticket.company_id = v_pool.company_id
             and source_ticket.status::text = 'finalized'
             and coalesce(source_ticket.is_finalized, false)
             and not coalesce(source_ticket.is_voided, false)
             and source_ticket.replacement_ticket_id is null
         )
       )
       or (
         v_source.source_ticket_id is not null
         and exists (
           select 1 from public.stock_ledger_entries source_entry
           where source_entry.ticket_id = v_source.source_ticket_id
             and source_entry.inventory_batch_id is null
             and coalesce(
               nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
               nullif(pg_catalog.btrim(source_entry.batch_id), '')
             ) is distinct from v_source.inventory_batch_id::text
         )
       )
       or exists (
         select 1
         from public.stock_ledger_entries source_entry
         where source_entry.company_id = v_source.company_id
           and source_entry.warehouse_id = v_source.warehouse_id
           and coalesce(
             source_entry.inventory_batch_id::text,
             nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
             nullif(pg_catalog.btrim(source_entry.batch_id), '')
           ) = v_source.inventory_batch_id::text
           and public.canonical_stock_uom(source_entry.uom) is distinct from 'kg'
       )
     then
      raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_CHANGED|%', v_source.inventory_batch_id
        using errcode = '23514';
    end if;
    if pg_catalog.abs(v_current_balance - v_source.source_balance_snapshot_kg) > 0.001
       or pg_catalog.abs(v_available_balance - v_current_balance) > 0.001
       or (v_source.batch_current_quantity is not null
          and pg_catalog.abs(v_source.batch_current_quantity - v_current_balance) > 0.001)
       or (v_source.batch_current_weight_kg is not null
          and pg_catalog.abs(v_source.batch_current_weight_kg - v_current_balance) > 0.001)
       or (v_source.batch_mass_kg is not null
          and pg_catalog.abs(v_source.batch_mass_kg - v_current_balance) > 0.001)
    then
      raise exception 'SHARED_IMPURITY_SOURCE_COMMITTED_OR_CHANGED|%|%',
        v_source.inventory_batch_id, v_available_balance
        using errcode = '40001';
    end if;
  end loop;
  if v_source_count < 1
     or pg_catalog.abs(v_source_sum - v_pool.source_total_kg) > 0.001
  then
    raise exception 'SHARED_IMPURITY_SOURCE_TOTAL_INVALID' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.round(coalesce(pg_catalog.sum(m.source_total_snapshot_kg), 0), 6)
  into v_member_count, v_member_sum
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool.id
    and m.company_id = v_pool.company_id;
  if v_member_count < 1
     or pg_catalog.abs(v_member_sum - v_pool.source_total_kg) > 0.001
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool.id
         and (m.clean_balance_status <> 'unresolved' or m.yield_status <> 'unresolved')
     )
     -- The canonical availability helper excludes this ticket's own promise.
     -- Before consuming anything, nevertheless prove that the published
     -- promise still covers every frozen source completely and nothing else.
     or exists (
       select 1
       from public.weighbridge_shared_impurity_source_batches source
       left join (
         select reservation.company_id,
                reservation.ticket_id,
                reservation.warehouse_id,
                reservation.batch_id,
                pg_catalog.sum(reservation.reserved_kg) as reserved_kg
         from public.v_weighbridge_open_ticket_reservations_v1 reservation
         where reservation.ticket_id = v_ticket.id
         group by reservation.company_id, reservation.ticket_id,
                  reservation.warehouse_id, reservation.batch_id
       ) own_reservation
         on own_reservation.company_id = source.company_id
        and own_reservation.ticket_id = v_ticket.id
        and own_reservation.warehouse_id = source.warehouse_id
        and own_reservation.batch_id = source.inventory_batch_id
       where source.group_id = v_pool.id
         and pg_catalog.abs(
           coalesce(own_reservation.reserved_kg, 0)
             - source.source_balance_snapshot_kg
         ) > 0.001
     )
     or exists (
       select 1
       from public.v_weighbridge_open_ticket_reservations_v1 own_reservation
       where own_reservation.ticket_id = v_ticket.id
         and not exists (
           select 1
           from public.weighbridge_shared_impurity_source_batches source
           where source.group_id = v_pool.id
             and source.company_id = own_reservation.company_id
             and source.warehouse_id = own_reservation.warehouse_id
             and source.inventory_batch_id = own_reservation.batch_id
         )
     )
  then
    raise exception 'SHARED_IMPURITY_MEMBER_TOTAL_INVALID' using errcode = '23514';
  end if;

  v_pool_batch_code := 'SIP-' || pg_catalog.replace(v_pool.id::text, '-', '');
  insert into public.inventory_batches (
    id, company_id, season_id, product_id, crop_id,
    variety_id, reproduction_id, source_field_id, source_ticket_id,
    batch_code, status, initial_weight_kg, current_weight_kg, quality_json,
    batch_class, parent_batch_id, origin_type, origin_ref_id, treatment_status,
    initial_quantity, current_quantity, uom, mass_kg, unit_source,
    unit_contract_version, crop_structure_id, warehouse_id, received_at,
    source_type, composition_snapshot, composition_hash,
    is_mixed_harvest, physical_state, display_name
  ) values (
    v_pool_batch_id, v_pool.company_id, v_pool.season_id,
    v_pool.product_id, v_pool.crop_id,
    null, null, null, null,
    v_pool_batch_code, 'commodity', v_pool.source_total_kg,
    v_pool.source_total_kg,
    pg_catalog.jsonb_build_object(
      'shared_impurity_pool_id', v_pool.id,
      'identity_kind', 'shared_unresolved',
      'source_scope_hash', v_pool.source_scope_hash,
      'member_resolution_status', 'unresolved',
      'source_total_kg', v_pool.source_total_kg
    ),
    'commodity', null, 'shared_impurity_pool', v_pool.id, 'not_applicable',
    v_pool.source_total_kg, v_pool.source_total_kg, 'kg',
    v_pool.source_total_kg, 'shared_impurity_pool_v1',
    2, null, v_pool.source_warehouse_id, pg_catalog.now(),
    'shared_impurity_pool', v_pool.composition_snapshot,
    v_pool.composition_hash, true, 'SOURCE', v_pool.display_name
  ) returning * into v_pool_batch;

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

  if private.shared_impurity_sources_have_nonzero_balance_v1(
    v_pool.id,
    v_pool.company_id
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
    and batch.company_id = source.company_id;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  ) values (
    v_pool.company_id, v_ticket.id, v_pool.product_id, v_pool.crop_id,
    null, null,
    v_pool.source_warehouse_id, v_pool_batch.id,
    v_pool_batch.id::text, v_pool_batch.id::text, 'commodity',
    'in', v_pool.source_total_kg, 'kg', v_pool.source_total_kg,
    v_pool.source_total_kg, 'shared_impurity_pool_v1', 2,
    'harvest_pool_reclass_in', v_pool.id, pg_catalog.now(), v_actor.id, false,
    'Aggregate pool receipt. Member clean balances remain unresolved.'
  ) returning id into v_pool_in_ledger_id;

  insert into public.stock_ledger_entries (
    company_id, ticket_id, product_id, crop_id, variety_id, reproduction_id,
    warehouse_id, inventory_batch_id, batch_id, batch_id_text, batch_class,
    direction, quantity, uom, delta_qty_signed, mass_kg,
    unit_source, unit_contract_version, reason_type, reason_ref_id,
    occurred_at, created_by, is_storno, notes
  ) values (
    v_pool.company_id, v_ticket.id, v_pool.product_id, v_pool.crop_id,
    null, null,
    v_pool.source_warehouse_id, v_pool_batch.id,
    v_pool_batch.id::text, v_pool_batch.id::text, 'commodity',
    'out', v_impurity, 'kg', -v_impurity, v_impurity,
    'shared_impurity_pool_v1', 2, 'weighbridge_impurities_shared',
    v_ticket.id, pg_catalog.now(), v_actor.id, false,
    'One measured group impurity debit; no proportional member allocation.'
  ) returning id into v_impurity_out_ledger_id;

  v_reconciled_balance := private.reconcile_warehouse_local_batch_balance_v1(
    v_pool_batch.id
  );
  if pg_catalog.abs(v_reconciled_balance - v_clean) > 0.001
     or v_pool_batch.variety_id is not null
     or v_pool_batch.reproduction_id is not null
     or coalesce(v_pool_batch.composition_snapshot, '[]'::jsonb)
          is distinct from v_pool.composition_snapshot
     or v_pool_batch.composition_hash is distinct from v_pool.composition_hash
     or coalesce(v_pool_batch.is_mixed_harvest, false)
          is distinct from v_pool.is_mixed_harvest
  then
    raise exception 'SHARED_IMPURITY_POOL_BALANCE_INVALID|%', v_reconciled_balance
      using errcode = '23514';
  end if;

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id,
    weighbridge_shift_id, comment
  ) values (
    v_ticket.id, v_ticket.company_id, 2, v_tare, pg_catalog.now(),
    'manual', v_actor.id, v_session.person_id, v_shift.id,
    case when coalesce(p_tare_variance_confirmed, false)
      then 'Финальная тара общего вывоза; необычная тара подтверждена'
      else 'Финальная тара общего вывоза примеси'
    end
  );

  update public.ticket_lines
  set quantity = v_impurity,
      quantity_kg = v_impurity,
      net_line_weight_kg = v_impurity,
      mass_kg = v_impurity,
      batch_id = v_pool_batch.id,
      lot_id = v_pool_batch.batch_code,
      variety_id = null,
      reproduction_id = null,
      batch_class = 'commodity',
      unit_source = 'shared_impurity_pool_v1',
      unit_contract_version = 2,
      quality_json = coalesce(quality_json, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'shared_impurity_pool', pg_catalog.jsonb_build_object(
               'pool_id', v_pool.id,
               'source_total_kg', v_pool.source_total_kg,
               'impurity_weight_kg', v_impurity,
               'clean_total_kg', v_clean,
               'member_resolution_status', 'unresolved'
             )
           ),
      updated_at = pg_catalog.now()
  where id = v_line.id;

  update public.tickets
  set tare_weight_kg = v_tare,
      net_weight_kg = v_impurity,
      physical_net_kg = v_impurity,
      explicit_deductions_kg = 0,
      accepted_weight_kg = v_impurity,
      weighing_2_at = pg_catalog.now(),
      batch_id = v_pool_batch.id,
      lot_id = v_pool_batch.batch_code,
      status = 'finalized',
      is_finalized = true,
      closed_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      finalized_at = pg_catalog.now(),
      audit_json = coalesce(audit_json, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'stock_source', 'shared_impurity_pool_exact_sources',
             'shared_impurity_pool_finalize', pg_catalog.jsonb_build_object(
               'contract_version', 'shared_impurity_pool_v1',
               'pool_id', v_pool.id,
               'pool_inventory_batch_id', v_pool_batch.id,
               'source_scope_hash', v_pool.source_scope_hash,
               'source_total_kg', v_pool.source_total_kg,
               'impurity_weight_kg', v_impurity,
               'clean_total_kg', v_clean,
               'member_resolution_status', 'unresolved',
               'allocation_rule', 'unknown_not_allocated',
               'idempotency_key', p_idempotency_key,
               'request_fingerprint', v_fingerprint,
               'auth_principal_profile_id', v_principal_id,
               'effective_actor_profile_id', v_actor.id,
               'operator_person_id', v_session.person_id,
               'shift_id', v_shift.id,
               'tare_variance_confirmed', coalesce(p_tare_variance_confirmed, false)
             )
           ),
      updated_at = pg_catalog.now()
  where id = v_ticket.id;

  update public.weighbridge_shared_impurity_groups
  set pool_inventory_batch_id = v_pool_batch.id,
      state = 'finalized',
      impurity_weight_kg = v_impurity,
      clean_total_kg = v_clean,
      finalize_idempotency_key = p_idempotency_key,
      finalize_request_fingerprint = v_fingerprint,
      pool_in_ledger_entry_id = v_pool_in_ledger_id,
      impurity_out_ledger_entry_id = v_impurity_out_ledger_id,
      finalized_by = v_actor.id,
      finalized_by_person_id = v_session.person_id,
      finalized_at = pg_catalog.now(),
      audit_json = audit_json || pg_catalog.jsonb_build_object(
        'finalize', pg_catalog.jsonb_build_object(
          'source_total_kg', source_total_kg,
          'impurity_weight_kg', v_impurity,
          'clean_total_kg', v_clean,
          'pool_inventory_batch_id', v_pool_batch.id,
          'pool_in_ledger_entry_id', v_pool_in_ledger_id,
          'impurity_out_ledger_entry_id', v_impurity_out_ledger_id,
          'member_resolution_status', 'unresolved'
        )
      ),
      updated_at = pg_catalog.now()
  where id = v_pool.id and state = 'open';
  if not found then
    raise exception 'SHARED_IMPURITY_FINALIZE_STATE_CHANGED_RETRY' using errcode = '40001';
  end if;

  select pg_catalog.count(*)::integer into v_weighing_count
  from public.ticket_weighings tw
  where tw.ticket_id = v_ticket.id and tw.company_id = v_ticket.company_id;
  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'harvest_pool_reclass_out'
    )::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'harvest_pool_reclass_in'
    )::integer,
    pg_catalog.count(*) filter (
      where sle.reason_type = 'weighbridge_impurities_shared'
    )::integer,
    pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
  into v_ledger_count, v_source_out_count, v_pool_in_count,
       v_impurity_out_count, v_ticket_effect
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_ticket.id
    and not coalesce(sle.is_storno, false);
  select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
  into v_pool_balance
  from public.stock_ledger_entries sle
  where sle.company_id = v_pool.company_id
    and sle.warehouse_id = v_pool.source_warehouse_id
    and sle.inventory_batch_id = v_pool_batch.id;
  select pg_catalog.count(*)::integer into v_zero_source_count
  from public.weighbridge_shared_impurity_source_batches s
  join public.inventory_batches ib on ib.id = s.inventory_batch_id
  where s.group_id = v_pool.id
    and s.state = 'reclassified'
    and pg_catalog.abs(coalesce(ib.current_quantity, 0)) <= 0.001
    and pg_catalog.abs(coalesce(ib.current_weight_kg, 0)) <= 0.001
    and pg_catalog.abs(coalesce(ib.mass_kg, 0)) <= 0.001;

  if v_weighing_count <> 2
     or v_ledger_count <> v_source_count + 2
     or v_source_out_count <> v_source_count
     or v_pool_in_count <> 1
     or v_impurity_out_count <> 1
     or v_zero_source_count <> v_source_count
     or pg_catalog.abs(v_ticket_effect + v_impurity) > 0.001
     or pg_catalog.abs(v_pool_balance - v_clean) > 0.001
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool.id
         and (m.clean_balance_status <> 'unresolved' or m.yield_status <> 'unresolved')
     )
     -- Finalized ticket and reclassified sources must no longer reserve the
     -- original batches; otherwise later stock operations would see ghost
     -- commitments even though the source debit already happened.
     or exists (
       select 1
       from public.v_weighbridge_open_ticket_reservations_v1 reservation
       where reservation.ticket_id = v_ticket.id
     )
   then
    raise exception 'SHARED_IMPURITY_FINALIZE_POSTCONDITION_FAILED'
      using errcode = '23514';
  end if;

  update public.weighbridge_shifts
  set last_activity_at = pg_catalog.now()
  where id = v_shift.id and status = 'open';
  update private.weighbridge_operator_sessions
  set expires_at = v_expires, last_seen_at = pg_catalog.now()
  where id = v_session.id and status = 'active';

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, new_values, reason
  ) values (
    v_pool.company_id, v_actor.id, 'weighbridge_shared_impurity_pool',
    v_pool.id::text, 'finalize',
    pg_catalog.jsonb_build_object(
      'ticket_id', v_ticket.id,
      'pool_inventory_batch_id', v_pool_batch.id,
      'source_batch_count', v_source_count,
      'source_total_kg', v_pool.source_total_kg,
      'impurity_weight_kg', v_impurity,
      'clean_total_kg', v_clean,
      'ticket_ledger_effect_kg', v_ticket_effect,
      'member_resolution_status', 'unresolved',
      'auth_principal_profile_id', v_principal_id,
      'effective_actor_profile_id', v_actor.id,
      'operator_person_id', v_session.person_id,
      'shift_id', v_shift.id,
      'idempotency_key', p_idempotency_key
    ),
    'Exact sources reclassified; group impurity posted once; members remain unresolved.'
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'pool_id', v_pool.id,
    'pool_inventory_batch_id', v_pool_batch.id,
    'source_total_kg', v_pool.source_total_kg,
    'impurity_weight_kg', v_impurity,
    'clean_total_kg', v_clean,
    'source_batch_count', v_source_count,
    'member_count', v_member_count,
    'member_resolution_status', 'unresolved',
    'ledger_count', v_ledger_count,
    'idempotent_replay', false
  );
end
$function$

