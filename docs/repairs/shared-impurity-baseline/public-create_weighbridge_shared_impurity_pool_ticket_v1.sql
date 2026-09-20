CREATE OR REPLACE FUNCTION public.create_weighbridge_shared_impurity_pool_ticket_v1(p_company_id uuid, p_source_warehouse_id uuid, p_sources jsonb, p_vehicle_id uuid, p_driver_id uuid, p_gross_weight_kg numeric, p_impurity_type text, p_notes text, p_session_token text, p_idempotency_key uuid)
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
  v_existing public.weighbridge_shared_impurity_groups%rowtype;
  v_source record;
  v_member record;
  v_ids uuid[];
  v_source_scope jsonb;
  v_seasons uuid[];
  v_crops uuid[];
  v_requested_pair_count integer := 0;
  v_structure_count integer := 0;
  v_null_scope_count integer := 0;
  v_source_count integer := 0;
  v_frozen_source_count integer := 0;
  v_member_count integer := 0;
  v_line_count integer := 0;
  v_weighing_count integer := 0;
  v_ledger_count integer := 0;
  v_source_total numeric(18,6) := 0;
  v_source_snapshot_sum numeric(18,6) := 0;
  v_member_snapshot_sum numeric(18,6) := 0;
  v_balance numeric(18,6);
  v_reserved_balance numeric(18,6) := 0;
  v_processing_balance numeric(18,6) := 0;
  v_available_balance numeric(18,6) := 0;
  v_product_id uuid;
  v_composition_snapshot jsonb := '[]'::jsonb;
  v_composition_hash text;
  v_pool_display_name text := 'Общая партия после очистки — состав не распределён';
  v_season_id uuid;
  v_crop_id uuid;
  v_ticket_id uuid := extensions.gen_random_uuid();
  v_pool_id uuid := extensions.gen_random_uuid();
  v_ticket_no text;
  v_fingerprint text;
  v_scope_hash text;
  v_notes text := nullif(pg_catalog.btrim(coalesce(p_notes, '')), '');
  v_gross numeric(14,3) := pg_catalog.round(p_gross_weight_kg, 3);
  v_expires timestamptz := pg_catalog.now() + interval '24 hours';
begin
  if v_principal_id is null then
    raise exception 'SHARED_IMPURITY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_source_warehouse_id is null
     or p_sources is null
     or p_vehicle_id is null
     or p_driver_id is null
     or p_idempotency_key is null
  then
    raise exception 'SHARED_IMPURITY_CREATE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_session_token, '')), '') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if v_gross is null
     or v_gross::text in ('NaN', 'Infinity', '-Infinity')
     or v_gross <= 0
  then
    raise exception 'SHARED_IMPURITY_GROSS_REQUIRED' using errcode = '22023';
  end if;
  if p_impurity_type is null or p_impurity_type not in (
    'soil_and_trash', 'nonconforming_crop', 'plant_residues', 'other'
  ) then
    raise exception 'SHARED_IMPURITY_TYPE_INVALID' using errcode = '22023';
  end if;
  if p_impurity_type = 'other' and v_notes is null then
    raise exception 'SHARED_IMPURITY_OTHER_NOTE_REQUIRED' using errcode = '22023';
  end if;

  -- Canonicalize the UI scope as exact (harvest_lot_id, crop_structure_id)
  -- pairs.  Keeping the lot in the identity is intentional: selecting one
  -- field slice must never consume a different lot that happens to carry the
  -- same crop_structure_id.
  if pg_catalog.jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_INVALID' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_sources) = 0
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_sources) item(value)
       where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
          or nullif(pg_catalog.btrim(item.value ->> 'harvest_lot_id'), '') is null
          or nullif(pg_catalog.btrim(item.value ->> 'crop_structure_id'), '') is null
     )
  then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_INVALID' using errcode = '22023';
  end if;

  with parsed as (
    select source.harvest_lot_id, source.crop_structure_id
    from pg_catalog.jsonb_to_recordset(p_sources) as source(
      harvest_lot_id uuid,
      crop_structure_id uuid
    )
  ), canonical as (
    select parsed.harvest_lot_id, parsed.crop_structure_id
    from parsed
    group by parsed.harvest_lot_id, parsed.crop_structure_id
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'harvest_lot_id', canonical.harvest_lot_id,
          'crop_structure_id', canonical.crop_structure_id
        ) order by canonical.crop_structure_id, canonical.harvest_lot_id
      ),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.array_agg(
        distinct canonical.crop_structure_id
        order by canonical.crop_structure_id
      ),
      array[]::uuid[]
    ),
    pg_catalog.count(*)::integer
  into v_source_scope, v_ids, v_requested_pair_count
  from canonical;

  if v_requested_pair_count <> pg_catalog.jsonb_array_length(p_sources) then
    raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_DUPLICATE'
      using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_ids) < 1 then
    raise exception 'SHARED_IMPURITY_REQUIRES_MULTIPLE_CROP_STRUCTURES' using errcode = '22023';
  end if;

  select gate_actor.* into v_gate_actor
  from private.resolve_processing_gate_session_actor_v1() gate_actor;
  if not found
     or v_gate_actor.actor_profile_id is null
     or v_gate_actor.selected_company_id is distinct from p_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Use the effective session actor for role checks and attribution.  A global
  -- admin principal under impersonation does not inherit write permission from
  -- the principal role; the impersonated profile itself must be allowed.
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
     and v_actor.company_id is distinct from p_company_id
  then
    raise exception 'SHARED_IMPURITY_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;

  -- Read-only token preflight.  The rows are locked and revalidated only after
  -- the universal company+season accounting gate is held.
  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.company_id = p_company_id
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
    and ws.company_id = p_company_id
    and ws.status = 'open';
  if not found
     or v_session.expires_at <= pg_catalog.now()
     or v_shift.last_activity_at + interval '24 hours' <= pg_catalog.now()
     or v_shift.operator_person_id is distinct from v_session.person_id
  then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'shift_expired');
  end if;
  if not exists (
    select 1
    from public.company_people cp
    where cp.id = v_session.person_id
      and cp.company_id = p_company_id
      and cp.role_type = 'weighbridge_operator'
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_OPERATOR_FORBIDDEN' using errcode = '42501';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where cs.season_id is null or cs.crop_id is null or cs.field_id is null
    )::integer,
    coalesce(pg_catalog.array_agg(distinct cs.season_id order by cs.season_id), array[]::uuid[]),
    coalesce(pg_catalog.array_agg(distinct cs.crop_id order by cs.crop_id), array[]::uuid[])
  into v_structure_count, v_null_scope_count, v_seasons, v_crops
  from public.crop_structure cs
  join public.fields f
    on f.id = cs.field_id
   and f.company_id = cs.company_id
  where cs.company_id = p_company_id
    and cs.id = any(v_ids)
    and not coalesce(cs.archived, false)
    and coalesce(cs.land_use_type, 'crop') = 'crop'
    and not coalesce(f.archived, false);
  if v_structure_count <> pg_catalog.cardinality(v_ids)
     or v_null_scope_count <> 0
     or pg_catalog.cardinality(v_seasons) <> 1
     or pg_catalog.cardinality(v_crops) <> 1
  then
    raise exception 'SHARED_IMPURITY_CROP_STRUCTURE_SCOPE_INVALID' using errcode = '23514';
  end if;
  v_season_id := v_seasons[1];
  v_crop_id := v_crops[1];

  if not exists (
    select 1 from public.seasons s
    where s.id = v_season_id
      and s.company_id = p_company_id
      and not coalesce(s.archived, false)
  ) then
    raise exception 'SHARED_IMPURITY_SEASON_INVALID' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_source_warehouse_id
      and w.company_id = p_company_id
      and not coalesce(w.archived, false)
      and not coalesce(w.is_archived, false)
      and (
        w.place_type in ('WAREHOUSE', 'YARD', 'DRYER', 'CLEANER')
        or pg_catalog.lower(coalesce(w.warehouse_type, '')) in (
          'grain', 'grain_storage', 'harvest', 'crop', 'produce', 'elevator'
        )
      )
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_PLACE_INVALID' using errcode = '23514';
  end if;

  -- This is the same gate hierarchy used by current ticket finalizers and
  -- processing writers.  It must precede every business-row lock or write.
  perform private.assert_processing_gate_actor_v1(p_company_id, v_actor.id);
  perform private.tz315_lock_company_season_write_gate_v1(
    p_company_id, v_season_id
  );

  select s.* into v_session
  from private.weighbridge_operator_sessions s
  where s.id = v_session.id
    and s.company_id = p_company_id
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
    and ws.company_id = p_company_id
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

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'company_id', p_company_id,
          'source_warehouse_id', p_source_warehouse_id,
          'sources', v_source_scope,
          'vehicle_id', p_vehicle_id,
          'driver_id', p_driver_id,
          'gross_weight_kg', v_gross,
          'impurity_type', p_impurity_type,
          'notes', v_notes,
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
      'travkinflow.shared-impurity.create.v1|'
        || p_company_id::text || '|' || p_idempotency_key::text,
      0::bigint
    )
  );
  select p.* into v_existing
  from public.weighbridge_shared_impurity_groups p
  where p.company_id = p_company_id
    and p.create_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.create_request_fingerprint is distinct from v_fingerprint then
      raise exception 'SHARED_IMPURITY_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select t.ticket_no into v_ticket_no
    from public.tickets t
    where t.id = v_existing.ticket_id
      and t.company_id = p_company_id;
    select pg_catalog.count(*)::integer into v_member_count
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_existing.id;
    select pg_catalog.count(*)::integer into v_source_count
    from public.weighbridge_shared_impurity_source_batches s
    where s.group_id = v_existing.id;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'ticket_id', v_existing.ticket_id,
      'pool_id', v_existing.id,
      'ticket_no', v_ticket_no,
      'state', v_existing.state,
      'source_total_kg', v_existing.source_total_kg,
      'source_batch_count', v_source_count,
      'member_count', v_member_count,
      'member_resolution_status', v_existing.member_resolution_status,
      'idempotent_replay', true
    );
  end if;

  if not (
    exists (
      select 1 from public.reference_vehicles rv
      where rv.id = p_vehicle_id
        and rv.company_id = p_company_id
        and coalesce(rv.is_active, false)
        and not coalesce(rv.archived, false)
    )
    or exists (
      select 1 from public.reference_machines rm
      where rm.id = p_vehicle_id
        and rm.company_id = p_company_id
        and coalesce(rm.is_active, false)
        and not coalesce(rm.archived, false)
    )
  ) then
    raise exception 'SHARED_IMPURITY_VEHICLE_INVALID' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.company_people cp
    where cp.id = p_driver_id
      and cp.company_id = p_company_id
      and cp.role_type in ('driver', 'mechanic_operator')
      and cp.status = 'active'
      and cp.deleted_at is null
  ) then
    raise exception 'SHARED_IMPURITY_DRIVER_INVALID' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.tickets t
    where t.company_id = p_company_id
      and t.status::text in ('draft', 'active', 'ready_to_close')
      and (t.vehicle_id = p_vehicle_id or t.driver_id = p_driver_id)
  ) then
    raise exception 'SHARED_IMPURITY_TRANSPORT_ALREADY_ACTIVE' using errcode = '23505';
  end if;

  -- Freeze crop-structure rows before deriving members, then lock every
  -- potential source batch in UUID order.  The second validation below makes
  -- a direct writer outside the canonical advisory gate fail closed as well.
  perform 1
  from public.crop_structure cs
  where cs.company_id = p_company_id and cs.id = any(v_ids)
  order by cs.id
  for share;

  perform 1
  from public.inventory_batches ib
  join public.harvest_lot_batches hlb
    on hlb.company_id = ib.company_id
   and hlb.inventory_batch_id = ib.id
   and hlb.crop_structure_id = ib.crop_structure_id
  join public.harvest_lots hl
    on hl.id = hlb.harvest_lot_id
   and hl.company_id = hlb.company_id
   and hl.status = 'active'
   and hl.season_id is not distinct from v_season_id
   and hl.crop_id is not distinct from v_crop_id
  where ib.company_id = p_company_id
    and ib.warehouse_id = p_source_warehouse_id
    and exists (
      select 1
      from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
        harvest_lot_id uuid,
        crop_structure_id uuid
      )
      where scope.harvest_lot_id = hlb.harvest_lot_id
        and scope.crop_structure_id = ib.crop_structure_id
    )
    and ib.batch_class = 'commodity'
    and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
    and ib.origin_type in ('harvest', 'transfer')
  order by ib.id
  for update;

  for v_source in
    select
      ib.*,
      cs.field_id as member_field_id,
      hlb.harvest_lot_id as exact_harvest_lot_id,
      hlb.source_ticket_id as lot_batch_source_ticket_id,
      coalesce(ib.source_ticket_id, hlb.source_ticket_id) as exact_source_ticket_id,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = ib.company_id
          and sle.warehouse_id = ib.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = ib.id::text
      ), 0), 6) as exact_balance
    from public.inventory_batches ib
    join public.crop_structure cs
      on cs.id = ib.crop_structure_id
     and cs.company_id = ib.company_id
    join public.harvest_lot_batches hlb
      on hlb.company_id = ib.company_id
     and hlb.inventory_batch_id = ib.id
     and hlb.crop_structure_id = ib.crop_structure_id
    join public.harvest_lots hl
      on hl.id = hlb.harvest_lot_id
     and hl.company_id = hlb.company_id
     and hl.status = 'active'
     and hl.season_id is not distinct from v_season_id
     and hl.crop_id is not distinct from v_crop_id
    where ib.company_id = p_company_id
      and ib.warehouse_id = p_source_warehouse_id
      and exists (
        select 1
        from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
          harvest_lot_id uuid,
          crop_structure_id uuid
        )
        where scope.harvest_lot_id = hlb.harvest_lot_id
          and scope.crop_structure_id = ib.crop_structure_id
      )
      and ib.batch_class = 'commodity'
      and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
      and ib.origin_type in ('harvest', 'transfer')
    order by ib.id
  loop
    v_balance := v_source.exact_balance;
    if v_balance::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'SHARED_IMPURITY_SOURCE_BALANCE_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    if v_balance <= 0.001 then
      continue;
    end if;
    -- This operation promises and later consumes the complete exact balance.
    -- Therefore even a partial foreign reservation/allocation makes the batch
    -- ineligible.  These reads happen after the common gate and batch row lock.
    select pg_catalog.round(coalesce(pg_catalog.sum(reservation.reserved_kg), 0), 6)
    into v_reserved_balance
    from public.v_weighbridge_open_ticket_reservations_v1 reservation
    where reservation.company_id = p_company_id
      and reservation.warehouse_id = p_source_warehouse_id
      and reservation.batch_id = v_source.id;

    select pg_catalog.round(coalesce(pg_catalog.sum(allocation.allocated_kg), 0), 6)
    into v_processing_balance
    from public.v_processing_active_allocations_v1 allocation
    where allocation.company_id = p_company_id
      and allocation.warehouse_id = p_source_warehouse_id
      and allocation.batch_id = v_source.id;

    v_available_balance := pg_catalog.round(
      v_balance - v_reserved_balance - v_processing_balance,
      6
    );
    if v_available_balance < -0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_AVAILABILITY_NEGATIVE|%|%',
        v_source.id, v_available_balance
        using errcode = '23514';
    end if;
    if pg_catalog.abs(v_available_balance - v_balance) > 0.001 then
      raise exception 'SHARED_IMPURITY_SOURCE_ALREADY_COMMITTED|%|%',
        v_source.id, greatest(v_available_balance, 0)
        using errcode = '23514';
    end if;
    if v_source.season_id is distinct from v_season_id
       or v_source.crop_id is distinct from v_crop_id
       or v_source.product_id is null
       or public.canonical_stock_uom(v_source.uom) is distinct from 'kg'
       or (
         v_source.source_ticket_id is not null
         and v_source.lot_batch_source_ticket_id is not null
         and v_source.source_ticket_id is distinct from v_source.lot_batch_source_ticket_id
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_SCOPE_MISMATCH|%', v_source.id
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.stock_ledger_entries source_entry
      where source_entry.company_id = p_company_id
        and source_entry.warehouse_id = p_source_warehouse_id
        and coalesce(
          source_entry.inventory_batch_id::text,
          nullif(pg_catalog.btrim(source_entry.batch_id_text), ''),
          nullif(pg_catalog.btrim(source_entry.batch_id), '')
        ) = v_source.id::text
        and public.canonical_stock_uom(source_entry.uom) is distinct from 'kg'
    ) then
      raise exception 'SHARED_IMPURITY_SOURCE_UOM_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    v_composition_snapshot := v_composition_snapshot || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'inventory_batch_id', v_source.id,
        'harvest_lot_id', v_source.exact_harvest_lot_id,
        'crop_structure_id', v_source.crop_structure_id,
        'field_id', v_source.member_field_id,
        'source_ticket_id', v_source.exact_source_ticket_id,
        'product_id', v_source.product_id,
        'crop_id', v_source.crop_id,
        'variety_id', v_source.variety_id,
        'reproduction_id', v_source.reproduction_id,
        'source_is_mixed_harvest', coalesce(v_source.is_mixed_harvest, false),
        'source_composition_hash', v_source.composition_hash,
        'source_composition_snapshot', coalesce(v_source.composition_snapshot, '[]'::jsonb),
        'pre_impurity_source_mass_kg', v_balance,
        'clean_mass_status', 'unresolved'
      )
    );
    if v_product_id is null then
      v_product_id := v_source.product_id;
    elsif v_product_id is distinct from v_source.product_id then
      raise exception 'SHARED_IMPURITY_MULTIPLE_PRODUCTS_UNSUPPORTED'
        using errcode = '23514';
    end if;
    if (v_source.current_quantity is not null
          and pg_catalog.abs(v_source.current_quantity - v_balance) > 0.001)
       or (v_source.current_weight_kg is not null
          and pg_catalog.abs(v_source.current_weight_kg - v_balance) > 0.001)
       or (v_source.mass_kg is not null
          and pg_catalog.abs(v_source.mass_kg - v_balance) > 0.001)
    then
      raise exception 'SHARED_IMPURITY_SOURCE_BALANCE_STALE|%', v_source.id
        using errcode = '23514';
    end if;
    if v_source.exact_source_ticket_id is not null
       and not exists (
         select 1 from public.tickets t
         where t.id = v_source.exact_source_ticket_id
           and t.company_id = p_company_id
           and t.status::text = 'finalized'
           and coalesce(t.is_finalized, false)
           and not coalesce(t.is_voided, false)
           and t.replacement_ticket_id is null
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_TICKET_INVALID|%', v_source.id
        using errcode = '23514';
    end if;
    if v_source.exact_source_ticket_id is not null
       and exists (
         select 1 from public.stock_ledger_entries sle
         where sle.ticket_id = v_source.exact_source_ticket_id
           and sle.inventory_batch_id is null
           and coalesce(
             nullif(pg_catalog.btrim(sle.batch_id_text), ''),
             nullif(pg_catalog.btrim(sle.batch_id), '')
           ) is distinct from v_source.id::text
       )
    then
      raise exception 'SHARED_IMPURITY_SOURCE_LEDGER_IDENTITY_AMBIGUOUS|%', v_source.id
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.weighbridge_shared_impurity_source_batches existing_source
      where existing_source.inventory_batch_id = v_source.id
        and existing_source.state in ('selected', 'reclassified')
    ) then
      raise exception 'SHARED_IMPURITY_SOURCE_ALREADY_SELECTED|%', v_source.id
        using errcode = '23505';
    end if;
    v_source_total := v_source_total + v_balance;
    v_source_count := v_source_count + 1;
  end loop;

  if v_source_count = 0 or v_product_id is null or v_source_total <= 0 then
    raise exception 'SHARED_IMPURITY_NO_EXACT_SOURCE_STOCK' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.products product
    where product.id = v_product_id
      and public.canonical_stock_uom(
        coalesce(nullif(product.base_uom, ''), product.unit)
      ) = 'kg'
  ) then
    raise exception 'SHARED_IMPURITY_PRODUCT_UOM_INVALID' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_array_length(v_composition_snapshot) <> v_source_count then
    raise exception 'SHARED_IMPURITY_COMPOSITION_SNAPSHOT_INVALID' using errcode = '23514';
  end if;
  v_composition_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_composition_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_frozen_source_count := v_source_count;

  v_ticket_no := 'SI-' || pg_catalog.replace(v_ticket_id::text, '-', '');
  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id,
    warehouse_from_id, warehouse_to_id, vehicle_id, driver_id,
    responsible_user_id, created_by, gross_weight_kg, weigh_method,
    weighing_1_at, is_finalized, is_voided, notes, shift_id, season_id,
    weight_source, batch_id, crop_structure_allocation_id,
    created_by_person_id, source_physical_state, audit_json
  ) values (
    v_ticket_id, p_company_id, v_ticket_no, 'impurity_removal',
    'weighbridge_impurities', 'active', 'outgoing',
    'warehouse', p_source_warehouse_id::text, 'impurity_removal', null,
    p_source_warehouse_id, null, p_vehicle_id, p_driver_id,
    v_actor.id, v_actor.id, v_gross, 'double_weighing',
    pg_catalog.now(), false, false, v_notes, v_shift.id, v_season_id,
    'manual', null, null, v_session.person_id, 'SOURCE',
    pg_catalog.jsonb_build_object(
      'impurity_type', p_impurity_type,
      'stock_source', 'shared_impurity_pool_exact_sources',
      'shared_impurity_pool', pg_catalog.jsonb_build_object(
        'contract_version', 'shared_impurity_pool_v1',
        'pool_id', v_pool_id,
        'sources', v_source_scope,
        'source_crop_structure_ids', pg_catalog.to_jsonb(v_ids),
        'member_resolution_status', 'unresolved',
        'create_idempotency_key', p_idempotency_key,
        'create_request_fingerprint', v_fingerprint,
        'auth_principal_profile_id', v_principal_id,
        'effective_actor_profile_id', v_actor.id,
        'operator_person_id', v_session.person_id,
        'shift_id', v_shift.id
      )
    )
  );

  insert into public.weighbridge_shared_impurity_groups (
    id, company_id, ticket_id, source_warehouse_id, season_id, crop_id,
    product_id, identity_kind, display_name, composition_snapshot,
    composition_hash, is_mixed_harvest, state, impurity_type, source_total_kg,
    create_idempotency_key, create_request_fingerprint,
    created_by, created_by_person_id, audit_json
  ) values (
    v_pool_id, p_company_id, v_ticket_id, p_source_warehouse_id,
    v_season_id, v_crop_id, v_product_id, 'shared_unresolved',
    v_pool_display_name, v_composition_snapshot, v_composition_hash, true,
    'open', p_impurity_type,
    pg_catalog.round(v_source_total, 6), p_idempotency_key, v_fingerprint,
    v_actor.id, v_session.person_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 'shared_impurity_pool_v1',
      'allocation_rule', 'unknown_not_allocated',
      'commodity_identity_rule', 'shared_unresolved_multi_source',
      'source_physical_state', 'SOURCE'
    )
  );

  insert into public.weighbridge_shared_impurity_members (
    group_id, company_id, crop_structure_id, field_id, identity_snapshot
  )
  select
    v_pool_id,
    p_company_id,
    cs.id,
    cs.field_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'field_id', cs.field_id,
      'field_name', f.name,
      'crop_id', cs.crop_id,
      'crop_name', coalesce(nullif(pg_catalog.btrim(c.name_ru), ''), c.name),
      'variety_id', cs.variety_id,
      'variety_name', nullif(pg_catalog.btrim(variety.name), ''),
      'reproduction_id', cs.reproduction_id,
      'reproduction_name', coalesce(
        nullif(pg_catalog.btrim(reproduction.name_ru), ''),
        nullif(pg_catalog.btrim(reproduction.name), ''),
        nullif(pg_catalog.btrim(reproduction.code), '')
      ),
      'area_ha', cs.area
    ))
  from public.crop_structure cs
  join public.fields f
    on f.id = cs.field_id
   and f.company_id = cs.company_id
  join public.crops c on c.id = cs.crop_id
  left join public.varieties variety on variety.id = cs.variety_id
  left join public.seed_reproductions reproduction on reproduction.id = cs.reproduction_id
  where cs.company_id = p_company_id
    and cs.id = any(v_ids)
  order by cs.id;

  for v_source in
    select
      ib.id,
      ib.crop_structure_id,
      ib.product_id,
      coalesce(ib.source_ticket_id, hlb.source_ticket_id) as exact_source_ticket_id,
      hlb.harvest_lot_id,
      pg_catalog.round(coalesce((
        select pg_catalog.sum(sle.delta_qty_signed)
        from public.stock_ledger_entries sle
        where sle.company_id = ib.company_id
          and sle.warehouse_id = ib.warehouse_id
          and coalesce(
            sle.inventory_batch_id::text,
            nullif(pg_catalog.btrim(sle.batch_id_text), ''),
            nullif(pg_catalog.btrim(sle.batch_id), '')
          ) = ib.id::text
      ), 0), 6) as exact_balance
    from public.inventory_batches ib
    join public.harvest_lot_batches hlb
      on hlb.company_id = ib.company_id
     and hlb.inventory_batch_id = ib.id
     and hlb.crop_structure_id = ib.crop_structure_id
    join public.harvest_lots hl
      on hl.id = hlb.harvest_lot_id
     and hl.company_id = hlb.company_id
     and hl.status = 'active'
     and hl.season_id is not distinct from v_season_id
     and hl.crop_id is not distinct from v_crop_id
    where ib.company_id = p_company_id
      and ib.warehouse_id = p_source_warehouse_id
      and exists (
        select 1
        from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
          harvest_lot_id uuid,
          crop_structure_id uuid
        )
        where scope.harvest_lot_id = hlb.harvest_lot_id
          and scope.crop_structure_id = ib.crop_structure_id
      )
      and ib.batch_class = 'commodity'
      and coalesce(ib.physical_state, 'SOURCE') = 'SOURCE'
      and ib.origin_type in ('harvest', 'transfer')
    order by ib.id
  loop
    if v_source.exact_balance <= 0.001 then
      continue;
    end if;
    select m.* into v_member
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool_id
      and m.company_id = p_company_id
      and m.crop_structure_id = v_source.crop_structure_id;
    if not found then
      raise exception 'SHARED_IMPURITY_MEMBER_POSTCONDITION_FAILED'
        using errcode = '23514';
    end if;

    insert into public.weighbridge_shared_impurity_source_batches (
      group_id, member_id, company_id, crop_structure_id,
      source_ticket_id, harvest_lot_id, inventory_batch_id,
      warehouse_id, product_id, source_balance_snapshot_kg
    ) values (
      v_pool_id, v_member.id, p_company_id, v_source.crop_structure_id,
      v_source.exact_source_ticket_id, v_source.harvest_lot_id, v_source.id,
      p_source_warehouse_id, v_source.product_id, v_source.exact_balance
    );

    update public.weighbridge_shared_impurity_members
    set source_batch_count = source_batch_count + 1,
        source_total_snapshot_kg = source_total_snapshot_kg + v_source.exact_balance,
        updated_at = pg_catalog.now()
    where id = v_member.id;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(v_source_scope) as scope(
      harvest_lot_id uuid,
      crop_structure_id uuid
    )
    where not exists (
      select 1
      from public.weighbridge_shared_impurity_source_batches source
      where source.group_id = v_pool_id
        and source.harvest_lot_id = scope.harvest_lot_id
        and source.crop_structure_id = scope.crop_structure_id
    )
  ) then
    raise exception 'SHARED_IMPURITY_SOURCE_PAIR_HAS_NO_STOCK' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.weighbridge_shared_impurity_members m
    where m.group_id = v_pool_id
      and (m.source_batch_count = 0 or m.source_total_snapshot_kg <= 0)
  ) then
    raise exception 'SHARED_IMPURITY_MEMBER_HAS_NO_SOURCE_STOCK' using errcode = '23514';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.round(coalesce(pg_catalog.sum(s.source_balance_snapshot_kg), 0), 6)
  into v_source_count, v_source_snapshot_sum
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool_id;
  select pg_catalog.round(
    coalesce(pg_catalog.sum(m.source_total_snapshot_kg), 0), 6
  )
  into v_member_snapshot_sum
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool_id;
  if v_source_count <> v_frozen_source_count
     or pg_catalog.abs(v_source_snapshot_sum - v_source_total) > 0.001
     or pg_catalog.abs(v_member_snapshot_sum - v_source_total) > 0.001
  then
    raise exception 'SHARED_IMPURITY_SOURCE_SNAPSHOT_CHANGED_RETRY'
      using errcode = '40001';
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
  where s.group_id = v_pool_id;

  update public.weighbridge_shared_impurity_groups
  set source_scope_hash = v_scope_hash,
      audit_json = audit_json || pg_catalog.jsonb_build_object(
        'source_scope_hash', v_scope_hash,
        'source_batch_count', v_source_count,
        'source_total_kg', pg_catalog.round(v_source_total, 6)
      ),
      updated_at = pg_catalog.now()
  where id = v_pool_id;

  insert into public.ticket_lines (
    ticket_id, company_id, product_id, crop_id, variety_id, reproduction_id,
    quantity, uom,
    warehouse_from_id, warehouse_to_id, batch_id, lot_id, batch_class,
    line_type, quality_json, mass_kg, unit_source, unit_contract_version,
    notes
  ) values (
    v_ticket_id, p_company_id, v_product_id, v_crop_id,
    null, null, 0, 'kg',
    p_source_warehouse_id, null, null, null, 'commodity',
    'impurity_removal',
    pg_catalog.jsonb_build_object(
      'shared_impurity_pool_id', v_pool_id,
      'member_resolution_status', 'unresolved',
      'identity_kind', 'shared_unresolved',
      'commodity_identity_rule', 'multi_source_provenance_only'
    ),
    null, 'shared_impurity_pool_v1', null,
    'Общий вес примеси; распределение по участкам не определено.'
  );

  insert into public.ticket_weighings (
    ticket_id, company_id, weighing_no, measured_weight_kg, measured_at,
    device_source, operator_user_id, operator_person_id,
    weighbridge_shift_id, comment
  ) values (
    v_ticket_id, p_company_id, 1, v_gross, pg_catalog.now(),
    'manual', v_actor.id, v_session.person_id, v_shift.id,
    'Первое взвешивание общего вывоза примеси'
  );

  select pg_catalog.count(*)::integer into v_member_count
  from public.weighbridge_shared_impurity_members m
  where m.group_id = v_pool_id;
  select pg_catalog.count(*)::integer into v_source_count
  from public.weighbridge_shared_impurity_source_batches s
  where s.group_id = v_pool_id;
  select pg_catalog.count(*)::integer into v_line_count
  from public.ticket_lines tl
  where tl.ticket_id = v_ticket_id and tl.company_id = p_company_id;
  select pg_catalog.count(*)::integer into v_weighing_count
  from public.ticket_weighings tw
  where tw.ticket_id = v_ticket_id and tw.company_id = p_company_id;
  select pg_catalog.count(*)::integer into v_ledger_count
  from public.stock_ledger_entries sle
  where sle.ticket_id = v_ticket_id;
  if v_member_count <> pg_catalog.cardinality(v_ids)
     or v_source_count < v_member_count
     or v_line_count <> 1
     or v_weighing_count <> 1
     or v_ledger_count <> 0
     or exists (
       select 1
       from public.weighbridge_shared_impurity_members m
       where m.group_id = v_pool_id
         and (
           m.clean_balance_status <> 'unresolved'
           or m.yield_status <> 'unresolved'
           or coalesce(m.identity_snapshot ->> 'field_id', '') <> m.field_id::text
           or coalesce(m.identity_snapshot ->> 'crop_id', '') = ''
         )
     )
     or exists (
       select 1
       from public.weighbridge_shared_impurity_source_batches source
       where source.group_id = v_pool_id
         and pg_catalog.abs(
           coalesce((
             select pg_catalog.sum(reservation.reserved_kg)
             from public.v_weighbridge_open_ticket_reservations_v1 reservation
             where reservation.ticket_id = v_ticket_id
               and reservation.company_id = p_company_id
               and reservation.warehouse_id = source.warehouse_id
               and reservation.batch_id = source.inventory_batch_id
           ), 0) - source.source_balance_snapshot_kg
         ) > 0.001
     )
  then
    raise exception 'SHARED_IMPURITY_CREATE_POSTCONDITION_FAILED'
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
    p_company_id, v_actor.id, 'weighbridge_shared_impurity_pool',
    v_pool_id::text, 'create',
    pg_catalog.jsonb_build_object(
      'ticket_id', v_ticket_id,
      'sources', v_source_scope,
      'crop_structure_ids', pg_catalog.to_jsonb(v_ids),
      'source_batch_count', v_source_count,
      'source_total_kg', pg_catalog.round(v_source_total, 6),
      'auth_principal_profile_id', v_principal_id,
      'effective_actor_profile_id', v_actor.id,
      'source_scope_hash', v_scope_hash,
      'member_resolution_status', 'unresolved',
      'operator_person_id', v_session.person_id,
      'shift_id', v_shift.id,
      'idempotency_key', p_idempotency_key
    ),
    'Physical impurity ticket created without a per-member allocation.'
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket_id,
    'pool_id', v_pool_id,
    'ticket_no', v_ticket_no,
    'state', 'open',
    'source_total_kg', pg_catalog.round(v_source_total, 6),
    'source_batch_count', v_source_count,
    'member_count', v_member_count,
    'member_resolution_status', 'unresolved',
    'idempotent_replay', false
  );
end
$function$

