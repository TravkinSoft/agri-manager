-- TZ315 corrective: canonical ticket void must reverse the complete physical
-- ledger identity and reconcile every affected warehouse-local batch.
--
-- This intentionally preserves the existing public function signature used by
-- both session wrappers. It changes no historical migration and performs no
-- business backfill.

do $migration_preconditions$
begin
  if pg_catalog.to_regprocedure('private.reconcile_warehouse_local_batch_balance_v1(uuid)') is null then
    raise exception 'TZ315 prerequisite missing: private.reconcile_warehouse_local_batch_balance_v1(uuid)';
  end if;
  if pg_catalog.to_regprocedure('private.reconcile_harvest_lot_batch_balance_v1(uuid)') is null then
    raise exception 'TZ315 prerequisite missing: private.reconcile_harvest_lot_batch_balance_v1(uuid)';
  end if;
end
$migration_preconditions$;

create or replace function public.void_ticket_with_storno_v2(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_actor public.profiles%rowtype;
  v_entry public.stock_ledger_entries%rowtype;
  v_actor_role text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_was_canonically_voided boolean := false;
  v_batch_ids uuid[] := array[]::uuid[];
  v_batch_id uuid;
  v_current_balance numeric(18,6);
  v_pending_delta numeric(18,6);
  v_projected_balance numeric(18,6);
  v_batch_quantity numeric;
  v_batch_weight numeric;
  v_batch_mass numeric;
  v_outstanding bigint := 0;
  v_invalid_pairs bigint := 0;
  v_ticket_effect numeric(18,6) := 0;
  v_processing_id uuid;
  v_processing_state text;
  v_is_processing_output boolean := false;
begin
  if p_ticket_id is null or p_actor_user_id is null then
    raise exception 'WEIGHBRIDGE_VOID_CONTEXT_REQUIRED' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'WEIGHBRIDGE_VOID_REASON_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is null or auth.uid() is distinct from p_actor_user_id then
    raise exception 'WEIGHBRIDGE_VOID_FORBIDDEN' using errcode = '42501';
  end if;

  select *
  into v_ticket
  from public.tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'WEIGHBRIDGE_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Whole-cycle reversal locks the transformation before its output tickets.
  -- Use the same order here so ticket-level void cannot deadlock with it.
  select o.transformation_id
  into v_processing_id
  from public.batch_transformation_outputs o
  where o.company_id = v_ticket.company_id
    and o.source_ticket_id = p_ticket_id
  order by o.id
  limit 1;
  v_is_processing_output := found;

  if v_is_processing_output then
    select t.processing_state
    into v_processing_state
    from public.batch_transformations t
    where t.id = v_processing_id
      and t.company_id = v_ticket.company_id
    for update;
    if not found then
      raise exception 'WEIGHBRIDGE_VOID_PROCESSING_REFERENCE_INVALID' using errcode = '23503';
    end if;
  end if;

  select *
  into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'WEIGHBRIDGE_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;
  select *
  into v_actor
  from public.profiles
  where id = p_actor_user_id
    and coalesce(status, 'active') = 'active';

  if not found then
    raise exception 'WEIGHBRIDGE_VOID_ACTOR_NOT_FOUND' using errcode = '42501';
  end if;

  v_actor_role := coalesce(v_actor.role, '');
  if v_actor_role <> 'global_admin'
     and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'WEIGHBRIDGE_VOID_COMPANY_MISMATCH' using errcode = '42501';
  end if;

  if v_ticket.status = 'finalized' or coalesce(v_ticket.is_finalized, false) then
    if v_actor_role not in ('global_admin', 'admin', 'company_admin', 'director') then
      raise exception 'WEIGHBRIDGE_FINALIZED_VOID_FORBIDDEN' using errcode = '42501';
    end if;
  elsif v_actor_role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'WEIGHBRIDGE_VOID_FORBIDDEN' using errcode = '42501';
  end if;

  v_was_canonically_voided :=
    coalesce(v_ticket.is_voided, false)
    and v_ticket.status = 'voided';

  -- The ticket row is the resource-level idempotency lock. Lock its immutable
  -- accounting effects in deterministic order before checking or appending.
  perform 1
  from public.stock_ledger_entries sle
  where sle.ticket_id = p_ticket_id
    and not coalesce(sle.is_storno, false)
  order by sle.id
  for update;

  -- Once material balance is closed, an output ticket is only one document of
  -- the cycle. Direct ticket void would leave the cycle receipt inconsistent;
  -- require the canonical whole-cycle reversal. That reversal creates every
  -- full-fidelity storno first and then calls this function to void documents.
  if v_is_processing_output
     and v_processing_state = 'processing_closed'
     and not v_was_canonically_voided
     and (
       not exists (
         select 1
         from public.stock_ledger_entries base
         where base.ticket_id = p_ticket_id
           and not coalesce(base.is_storno, false)
       )
       or exists (
         select 1
         from public.stock_ledger_entries base
         where base.ticket_id = p_ticket_id
           and not coalesce(base.is_storno, false)
           and not exists (
             select 1
             from public.stock_ledger_entries reversal
             where reversal.storno_of_entry_id = base.id
               and reversal.reason_type = 'storno_processing_reversal'
               and reversal.processing_id is not distinct from base.processing_id
               and reversal.reason_ref_id is not distinct from base.processing_id
               and coalesce(reversal.is_storno, false)
           )
       )
     ) then
    raise exception 'WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
      and not coalesce(sle.is_storno, false)
      and sle.company_id is distinct from v_ticket.company_id
  ) then
    raise exception 'WEIGHBRIDGE_VOID_LEDGER_COMPANY_MISMATCH' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.ticket_id = p_ticket_id
      and not coalesce(sle.is_storno, false)
      and sle.inventory_batch_id is not null
      and not exists (
        select 1
        from public.inventory_batches b
        where b.id = sle.inventory_batch_id
          and b.company_id = sle.company_id
          and b.warehouse_id = sle.warehouse_id
      )
  ) then
    raise exception 'WEIGHBRIDGE_VOID_BATCH_REFERENCE_INVALID' using errcode = '23503';
  end if;

  select coalesce(pg_catalog.array_agg(linked.batch_id order by linked.batch_id), array[]::uuid[])
  into v_batch_ids
  from (
    select distinct b.id as batch_id
    from public.stock_ledger_entries sle
    join public.inventory_batches b
      on b.company_id = sle.company_id
     and b.warehouse_id = sle.warehouse_id
     and b.id::text = coalesce(
       sle.inventory_batch_id::text,
       nullif(sle.batch_id_text, ''),
       nullif(sle.batch_id, '')
     )
    where sle.ticket_id = p_ticket_id
      and not coalesce(sle.is_storno, false)
    union
    select b.id as batch_id
    from public.harvest_lot_batches hlb
    join public.inventory_batches b
      on b.id = hlb.inventory_batch_id
     and b.company_id = hlb.company_id
    where hlb.company_id = v_ticket.company_id
      and hlb.source_ticket_id = p_ticket_id
      and exists (
        select 1
        from public.stock_ledger_entries base
        where base.ticket_id = p_ticket_id
          and not coalesce(base.is_storno, false)
      )
  ) linked;

  perform 1
  from public.inventory_batches b
  where b.id = any(v_batch_ids)
  order by b.id
  for update;

  -- Existing storno rows are immutable accounting documents. A replay may use
  -- them only when they are a complete mirror of the original effect. The one
  -- accepted provenance variant is the canonical whole-processing reversal:
  -- it keeps the same physical/unit identity but owns its reason metadata at
  -- the transformation level before calling this ticket-level function.
  select pg_catalog.count(*)
  into v_invalid_pairs
  from public.stock_ledger_entries base
  join public.stock_ledger_entries reversal
    on reversal.storno_of_entry_id = base.id
  where base.ticket_id = p_ticket_id
    and not coalesce(base.is_storno, false)
    and (
      reversal.company_id is distinct from base.company_id
      or reversal.ticket_id is distinct from base.ticket_id
      or reversal.processing_id is distinct from base.processing_id
      or reversal.product_id is distinct from base.product_id
      or reversal.crop_id is distinct from base.crop_id
      or reversal.variety_id is distinct from base.variety_id
      or reversal.reproduction_id is distinct from base.reproduction_id
      or reversal.warehouse_id is distinct from base.warehouse_id
      or reversal.inventory_batch_id is distinct from base.inventory_batch_id
      or reversal.batch_id is distinct from base.batch_id
      or reversal.batch_id_text is distinct from base.batch_id_text
      or reversal.batch_class is distinct from base.batch_class
      or reversal.operation_line_id is distinct from base.operation_line_id
      or reversal.warehouse_issue_allocation_id is distinct from base.warehouse_issue_allocation_id
      or reversal.quantity is distinct from base.quantity
      or reversal.uom is distinct from base.uom
      or reversal.mass_kg is distinct from base.mass_kg
      or reversal.density_kg_per_l is distinct from base.density_kg_per_l
      or reversal.density_unit is distinct from base.density_unit
      or reversal.density_source is distinct from base.density_source
      or reversal.density_verification_status is distinct from base.density_verification_status
      or reversal.density_verified_at is distinct from base.density_verified_at
      or reversal.unit_source is distinct from base.unit_source
      or reversal.unit_contract_version is distinct from base.unit_contract_version
      or reversal.delta_qty_signed is distinct from -base.delta_qty_signed
      or reversal.direction is distinct from (
        case
          when base.direction = 'in'::public.ledger_direction then 'out'::public.ledger_direction
          else 'in'::public.ledger_direction
        end
      )
      or not (
        (
          reversal.reason_type = ('storno_' || base.reason_type)
          and reversal.reason_ref_id is not distinct from base.reason_ref_id
        )
        or (
          reversal.reason_type = 'storno_processing_reversal'
          and base.processing_id is not null
          and reversal.reason_ref_id is not distinct from base.processing_id
        )
      )
      or not coalesce(reversal.is_storno, false)
    );

  if v_invalid_pairs <> 0 then
    raise exception 'WEIGHBRIDGE_VOID_STORNO_FIDELITY_FAILED|%', v_invalid_pairs
      using errcode = '23514';
  end if;

  -- A finalized incoming ticket cannot be voided after its physical batch was
  -- consumed downstream. Evaluate the exact post-storno ledger balance first.
  foreach v_batch_id in array v_batch_ids
  loop
    select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
    into v_current_balance
    from public.inventory_batches b
    left join public.stock_ledger_entries sle
      on sle.company_id = b.company_id
     and sle.warehouse_id = b.warehouse_id
     and (
       coalesce(
         sle.inventory_batch_id::text,
         nullif(sle.batch_id_text, ''),
         nullif(sle.batch_id, '')
       ) = b.id::text
       or (
         sle.inventory_batch_id is null
         and sle.ticket_id is not null
         and b.source_ticket_id = sle.ticket_id
         and exists (
           select 1
           from public.harvest_lot_batches hlb
           where hlb.company_id = b.company_id
             and hlb.inventory_batch_id = b.id
         )
       )
     )
    where b.id = v_batch_id;

    select pg_catalog.round(coalesce(pg_catalog.sum(-base.delta_qty_signed), 0), 6)
    into v_pending_delta
    from public.stock_ledger_entries base
    left join public.stock_ledger_entries reversal
      on reversal.storno_of_entry_id = base.id
    join public.inventory_batches b
      on b.id = v_batch_id
     and b.company_id = base.company_id
     and b.warehouse_id = base.warehouse_id
     and (
       b.id::text = coalesce(
         base.inventory_batch_id::text,
         nullif(base.batch_id_text, ''),
         nullif(base.batch_id, '')
       )
       or (
         base.inventory_batch_id is null
         and base.ticket_id is not null
         and b.source_ticket_id = base.ticket_id
         and exists (
           select 1
           from public.harvest_lot_batches hlb
           where hlb.company_id = b.company_id
             and hlb.inventory_batch_id = b.id
         )
       )
     )
    where base.ticket_id = p_ticket_id
      and not coalesce(base.is_storno, false)
      and reversal.id is null;

    v_projected_balance := pg_catalog.round(v_current_balance + v_pending_delta, 6);
    if v_projected_balance < -0.001 then
      raise exception 'WEIGHBRIDGE_VOID_DOWNSTREAM_USAGE|%|%', v_batch_id, v_projected_balance
        using errcode = '23514';
    end if;
  end loop;

  for v_entry in
    select base.*
    from public.stock_ledger_entries base
    left join public.stock_ledger_entries reversal
      on reversal.storno_of_entry_id = base.id
    where base.ticket_id = p_ticket_id
      and not coalesce(base.is_storno, false)
      and reversal.id is null
    order by base.id
  loop
    insert into public.stock_ledger_entries (
      company_id,
      ticket_id,
      processing_id,
      product_id,
      crop_id,
      variety_id,
      reproduction_id,
      warehouse_id,
      inventory_batch_id,
      batch_id,
      batch_id_text,
      batch_class,
      operation_line_id,
      warehouse_issue_allocation_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      mass_kg,
      density_kg_per_l,
      density_unit,
      density_source,
      density_verification_status,
      density_verified_at,
      unit_source,
      unit_contract_version,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      is_storno,
      storno_of_entry_id,
      notes
    ) values (
      v_entry.company_id,
      v_entry.ticket_id,
      v_entry.processing_id,
      v_entry.product_id,
      v_entry.crop_id,
      v_entry.variety_id,
      v_entry.reproduction_id,
      v_entry.warehouse_id,
      v_entry.inventory_batch_id,
      v_entry.batch_id,
      v_entry.batch_id_text,
      v_entry.batch_class,
      v_entry.operation_line_id,
      v_entry.warehouse_issue_allocation_id,
      case
        when v_entry.direction = 'in'::public.ledger_direction then 'out'::public.ledger_direction
        else 'in'::public.ledger_direction
      end,
      v_entry.quantity,
      v_entry.uom,
      -v_entry.delta_qty_signed,
      v_entry.mass_kg,
      v_entry.density_kg_per_l,
      v_entry.density_unit,
      v_entry.density_source,
      v_entry.density_verification_status,
      v_entry.density_verified_at,
      v_entry.unit_source,
      v_entry.unit_contract_version,
      'storno_' || v_entry.reason_type,
      v_entry.reason_ref_id,
      pg_catalog.now(),
      p_actor_user_id,
      true,
      v_entry.id,
      pg_catalog.concat_ws(E'\n', v_entry.notes, 'STORNO: ' || v_reason)
    )
    on conflict (storno_of_entry_id)
      where storno_of_entry_id is not null
    do nothing;
  end loop;

  -- Reconcile only stale batches. A pure idempotent replay performs no batch
  -- UPDATE and therefore does not churn updated_at.
  foreach v_batch_id in array v_batch_ids
  loop
    select
      b.current_quantity,
      b.current_weight_kg,
      b.mass_kg,
       pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
    into v_batch_quantity, v_batch_weight, v_batch_mass, v_current_balance
    from public.inventory_batches b
    left join public.stock_ledger_entries sle
      on sle.company_id = b.company_id
     and sle.warehouse_id = b.warehouse_id
      and (
        coalesce(
          sle.inventory_batch_id::text,
          nullif(sle.batch_id_text, ''),
          nullif(sle.batch_id, '')
        ) = b.id::text
        or (
          sle.inventory_batch_id is null
          and sle.ticket_id is not null
          and b.source_ticket_id = sle.ticket_id
          and exists (
            select 1
            from public.harvest_lot_batches hlb
            where hlb.company_id = b.company_id
              and hlb.inventory_batch_id = b.id
          )
        )
      )
    where b.id = v_batch_id
    group by b.id, b.current_quantity, b.current_weight_kg, b.mass_kg;

    if v_current_balance < -0.001 then
      raise exception 'WEIGHBRIDGE_VOID_BATCH_NEGATIVE|%|%', v_batch_id, v_current_balance
        using errcode = '23514';
    end if;

    if pg_catalog.abs(coalesce(v_batch_quantity, 0) - greatest(v_current_balance, 0)) > 0.001
       or pg_catalog.abs(coalesce(v_batch_weight, 0) - greatest(v_current_balance, 0)) > 0.001
       or pg_catalog.abs(coalesce(v_batch_mass, 0) - greatest(v_current_balance, 0)) > 0.001 then
      if exists (
        select 1
        from public.harvest_lot_batches hlb
        where hlb.inventory_batch_id = v_batch_id
      ) then
        perform private.reconcile_harvest_lot_batch_balance_v1(v_batch_id);
      else
        perform private.reconcile_warehouse_local_batch_balance_v1(v_batch_id);
      end if;
    end if;
  end loop;

  if not v_was_canonically_voided then
    update public.field_material_consumptions
    set notes = pg_catalog.concat_ws(E'\n', notes, 'Аннулировано талоном: ' || v_reason),
        updated_at = pg_catalog.now()
    where ticket_id = p_ticket_id;

    update public.tickets
    set is_voided = true,
        status = 'voided',
        voided_by = p_actor_user_id,
        voided_at = pg_catalog.now(),
        void_reason = v_reason,
        updated_at = pg_catalog.now()
    where id = p_ticket_id;
  end if;

  select pg_catalog.count(*) filter (where reversal.id is null),
         pg_catalog.count(*) filter (
           where reversal.id is null
              or reversal.company_id is distinct from base.company_id
              or reversal.ticket_id is distinct from base.ticket_id
              or reversal.processing_id is distinct from base.processing_id
              or reversal.product_id is distinct from base.product_id
              or reversal.crop_id is distinct from base.crop_id
              or reversal.variety_id is distinct from base.variety_id
              or reversal.reproduction_id is distinct from base.reproduction_id
              or reversal.warehouse_id is distinct from base.warehouse_id
              or reversal.inventory_batch_id is distinct from base.inventory_batch_id
              or reversal.batch_id is distinct from base.batch_id
              or reversal.batch_id_text is distinct from base.batch_id_text
              or reversal.batch_class is distinct from base.batch_class
              or reversal.operation_line_id is distinct from base.operation_line_id
              or reversal.warehouse_issue_allocation_id is distinct from base.warehouse_issue_allocation_id
              or reversal.quantity is distinct from base.quantity
              or reversal.uom is distinct from base.uom
              or reversal.mass_kg is distinct from base.mass_kg
              or reversal.density_kg_per_l is distinct from base.density_kg_per_l
              or reversal.density_unit is distinct from base.density_unit
              or reversal.density_source is distinct from base.density_source
              or reversal.density_verification_status is distinct from base.density_verification_status
              or reversal.density_verified_at is distinct from base.density_verified_at
              or reversal.unit_source is distinct from base.unit_source
              or reversal.unit_contract_version is distinct from base.unit_contract_version
              or reversal.delta_qty_signed is distinct from -base.delta_qty_signed
              or reversal.direction is distinct from (
                case
                  when base.direction = 'in'::public.ledger_direction then 'out'::public.ledger_direction
                  else 'in'::public.ledger_direction
                end
              )
              or not (
                (
                  reversal.reason_type = ('storno_' || base.reason_type)
                  and reversal.reason_ref_id is not distinct from base.reason_ref_id
                )
                or (
                  reversal.reason_type = 'storno_processing_reversal'
                  and base.processing_id is not null
                  and reversal.reason_ref_id is not distinct from base.processing_id
                )
              )
              or not coalesce(reversal.is_storno, false)
         )
  into v_outstanding, v_invalid_pairs
  from public.stock_ledger_entries base
  left join public.stock_ledger_entries reversal
    on reversal.storno_of_entry_id = base.id
  where base.ticket_id = p_ticket_id
    and not coalesce(base.is_storno, false);

  select pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
  into v_ticket_effect
  from public.stock_ledger_entries sle
  where sle.ticket_id = p_ticket_id;

  if v_outstanding <> 0 or v_invalid_pairs <> 0 or pg_catalog.abs(v_ticket_effect) > 0.001 then
    raise exception 'WEIGHBRIDGE_VOID_POSTCONDITION_FAILED|%|%|%',
      v_outstanding, v_invalid_pairs, v_ticket_effect
      using errcode = '23514';
  end if;

  foreach v_batch_id in array v_batch_ids
  loop
    select
      b.current_quantity,
      b.current_weight_kg,
      b.mass_kg,
       pg_catalog.round(coalesce(pg_catalog.sum(sle.delta_qty_signed), 0), 6)
    into v_batch_quantity, v_batch_weight, v_batch_mass, v_current_balance
    from public.inventory_batches b
    left join public.stock_ledger_entries sle
      on sle.company_id = b.company_id
     and sle.warehouse_id = b.warehouse_id
      and (
        coalesce(
          sle.inventory_batch_id::text,
          nullif(sle.batch_id_text, ''),
          nullif(sle.batch_id, '')
        ) = b.id::text
        or (
          sle.inventory_batch_id is null
          and sle.ticket_id is not null
          and b.source_ticket_id = sle.ticket_id
          and exists (
            select 1
            from public.harvest_lot_batches hlb
            where hlb.company_id = b.company_id
              and hlb.inventory_batch_id = b.id
          )
        )
      )
    where b.id = v_batch_id
    group by b.id, b.current_quantity, b.current_weight_kg, b.mass_kg;

    if v_current_balance < -0.001
       or pg_catalog.abs(coalesce(v_batch_quantity, 0) - greatest(v_current_balance, 0)) > 0.001
       or pg_catalog.abs(coalesce(v_batch_weight, 0) - greatest(v_current_balance, 0)) > 0.001
       or pg_catalog.abs(coalesce(v_batch_mass, 0) - greatest(v_current_balance, 0)) > 0.001 then
      raise exception 'WEIGHBRIDGE_VOID_BATCH_POSTCONDITION_FAILED|%|%', v_batch_id, v_current_balance
        using errcode = '23514';
    end if;
  end loop;

  return p_ticket_id;
end
$function$;

-- The session wrappers remain the authenticated API. Preserve the physical
-- server-only ACL of the underlying actor-explicit function.
revoke all on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  to service_role;
