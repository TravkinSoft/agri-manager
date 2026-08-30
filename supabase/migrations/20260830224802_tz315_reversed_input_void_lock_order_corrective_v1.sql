-- TZ315 P1 corrective: make ticket void and processing reversal use the same
-- lock order. The migration does not touch business rows. It preserves the
-- physically installed ticket-storno implementation by cloning that exact
-- function body into a private core, then adds a narrow canonical wrapper:
--
--   linked transformations (UUID order)
--     -> processing input/output/reversal tables
--     -> ticket / ledger / physical batches (the pre-existing core)
--
-- The processing-shadow helper repeats the same boundary lock and performs a
-- stable-set recheck before it may remove mutable shadow documents. Receipt-
-- backed reversed documents remain immutable and untouched.

do $migration_preflight$
declare
  v_trigger_definition text;
  v_void_definition text;
begin
  if pg_catalog.to_regprocedure('public.void_ticket_with_storno_v2(uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('private.reconcile_voided_ticket_processing_shadow_v1(uuid)') is null
     or pg_catalog.to_regprocedure('public.tg_sync_grain_movement_shadow_v1()') is null
     or pg_catalog.to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)') is null
     or pg_catalog.to_regprocedure('public.attach_route_processing_input_ticket_v1(uuid)') is null
     or pg_catalog.to_regprocedure('public.recompute_grain_processing_shadow_v1(uuid)') is null
     or pg_catalog.to_regprocedure('public.get_user_company_id()') is null
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_LOCK_PREREQUISITE_MISSING' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger tr
    where tr.tgrelid = 'public.tickets'::pg_catalog.regclass
      and tr.tgname = 'trg_tickets_grain_movement_shadow_v1'
      and not tr.tgisinternal
      and tr.tgenabled in ('O', 'A')
      and tr.tgfoid = 'public.tg_sync_grain_movement_shadow_v1()'::pg_catalog.regprocedure
  ) then
    raise exception 'TZ315_REVERSED_INPUT_VOID_TRIGGER_TARGET_OR_STATE_INVALID' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.tg_sync_grain_movement_shadow_v1()'::pg_catalog.regprocedure
  ) into v_trigger_definition;

  if pg_catalog.strpos(
       v_trigger_definition,
       'perform public.attach_route_processing_input_ticket_v1(new.id);'
     ) = 0
     or pg_catalog.strpos(
       v_trigger_definition,
       'perform private.reconcile_voided_ticket_processing_shadow_v1(new.id);'
     ) = 0
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_TRIGGER_BODY_INVALID' using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure(
       'private.void_ticket_with_storno_v2_core_20260830_v1(uuid,uuid,text)'
     ) is null
  then
    select pg_catalog.pg_get_functiondef(
      'public.void_ticket_with_storno_v2(uuid,uuid,text)'::pg_catalog.regprocedure
    ) into v_void_definition;

    if pg_catalog.strpos(v_void_definition, 'WEIGHBRIDGE_VOID_CONTEXT_REQUIRED') = 0
       or pg_catalog.strpos(v_void_definition, 'WEIGHBRIDGE_VOID_PROCESSING_CYCLE_REVERSAL_REQUIRED') = 0
       or pg_catalog.strpos(v_void_definition, 'WEIGHBRIDGE_VOID_BATCH_POSTCONDITION_FAILED') = 0
       or pg_catalog.strpos(v_void_definition, 'TZ315_PROCESSING_VOID_LOCK_ORDER_WRAPPER_V1') > 0
    then
      raise exception 'TZ315_REVERSED_INPUT_VOID_CANONICAL_BODY_CHANGED' using errcode = '55000';
    end if;
  else
    select pg_catalog.pg_get_functiondef(
      'public.void_ticket_with_storno_v2(uuid,uuid,text)'::pg_catalog.regprocedure
    ) into v_void_definition;

    if pg_catalog.strpos(v_void_definition, 'TZ315_PROCESSING_VOID_LOCK_ORDER_WRAPPER_V1') = 0 then
      raise exception 'TZ315_REVERSED_INPUT_VOID_WRAPPER_BODY_CHANGED' using errcode = '55000';
    end if;
  end if;
end
$migration_preflight$;

create or replace function private.lock_ticket_processing_boundary_v2(
  p_ticket_id uuid,
  p_require_voided boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_ticket_locked public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_lot_locked public.harvest_lots%rowtype;
  v_canonical_season_id uuid;
  v_transformation_ids_before uuid[] := array[]::uuid[];
  v_transformation_ids_after uuid[] := array[]::uuid[];
  v_locked_count integer := 0;
begin
  select *
  into v_ticket
  from public.tickets t
  where t.id = p_ticket_id;

  if not found then
    raise exception 'WEIGHBRIDGE_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(
    pg_catalog.array_agg(linked.transformation_id order by linked.transformation_id),
    array[]::uuid[]
  )
  into v_transformation_ids_before
  from (
    select i.transformation_id
    from public.batch_transformation_inputs i
    where i.source_ticket_id = p_ticket_id
    union
    select o.transformation_id
    from public.batch_transformation_outputs o
    where o.source_ticket_id = p_ticket_id
  ) linked;

  if v_ticket.harvest_lot_id is null then
    if pg_catalog.cardinality(v_transformation_ids_before) <> 0 then
      raise exception 'TZ315_REVERSED_INPUT_VOID_LOT_BOUNDARY_INVALID' using errcode = '23514';
    end if;
  else
    select *
    into v_lot
    from public.harvest_lots hl
    where hl.id = v_ticket.harvest_lot_id;

    if not found
       or v_lot.company_id is distinct from v_ticket.company_id
       or (
         v_ticket.season_id is not null
         and v_lot.season_id is not null
         and v_ticket.season_id is distinct from v_lot.season_id
       )
    then
      raise exception 'TZ315_REVERSED_INPUT_VOID_LOT_BOUNDARY_INVALID' using errcode = '23514';
    end if;

    v_canonical_season_id := coalesce(v_ticket.season_id, v_lot.season_id);
    if v_canonical_season_id is null
       or not exists (
         select 1
         from public.seasons s
         where s.id = v_canonical_season_id
           and s.company_id = v_ticket.company_id
       )
    then
      raise exception 'TZ315_REVERSED_INPUT_VOID_SEASON_BOUNDARY_INVALID' using errcode = '23514';
    end if;

    -- Fail closed before taking a foreign transformation row lock. The same
    -- complete validation is repeated after all relevant table locks are held.
    if exists (
      select 1
      from (
        select i.company_id, i.transformation_id
        from public.batch_transformation_inputs i
        where i.source_ticket_id = p_ticket_id
        union all
        select o.company_id, o.transformation_id
        from public.batch_transformation_outputs o
        where o.source_ticket_id = p_ticket_id
      ) d
      left join public.batch_transformations t on t.id = d.transformation_id
      left join public.batch_processing_reversals r on r.transformation_id = d.transformation_id
      where d.company_id is distinct from v_ticket.company_id
         or t.id is null
         or t.company_id is distinct from v_ticket.company_id
         or t.season_id is distinct from v_canonical_season_id
         or t.harvest_lot_id is distinct from v_ticket.harvest_lot_id
         or (r.id is not null and (
           r.company_id is distinct from v_ticket.company_id
           or r.season_id is distinct from v_canonical_season_id
         ))
    ) then
      raise exception 'TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH' using errcode = '23514';
    end if;
  end if;

  -- Canonical deadlock-breaking row order: every linked transformation is
  -- locked before the processing document tables and before the ticket core.
  perform 1
  from public.batch_transformations t
  where t.id = any(v_transformation_ids_before)
  order by t.id
  for update;
  get diagnostics v_locked_count = row_count;

  if v_locked_count <> pg_catalog.cardinality(v_transformation_ids_before) then
    raise exception 'TZ315_REVERSED_INPUT_VOID_TRANSFORMATION_SET_INVALID' using errcode = '23514';
  end if;

  -- TZ315_TEST_STABLE_SET_RECHECK_ANCHOR
  lock table
    public.batch_transformation_inputs,
    public.batch_transformation_outputs
  in share row exclusive mode;
  lock table public.batch_processing_reversals in share row exclusive mode;

  select coalesce(
    pg_catalog.array_agg(linked.transformation_id order by linked.transformation_id),
    array[]::uuid[]
  )
  into v_transformation_ids_after
  from (
    select i.transformation_id
    from public.batch_transformation_inputs i
    where i.source_ticket_id = p_ticket_id
    union
    select o.transformation_id
    from public.batch_transformation_outputs o
    where o.source_ticket_id = p_ticket_id
  ) linked;

  if v_transformation_ids_after is distinct from v_transformation_ids_before then
    raise exception 'TZ315_REVERSED_INPUT_VOID_LINK_SET_CHANGED_RETRY' using errcode = '40001';
  end if;

  -- The ticket is intentionally locked only after the transformation/table
  -- boundary. This is the lock order shared with canonical reversal.
  select *
  into v_ticket_locked
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found
     or v_ticket_locked.company_id is distinct from v_ticket.company_id
     or v_ticket_locked.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or v_ticket_locked.season_id is distinct from v_ticket.season_id
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_TICKET_BOUNDARY_CHANGED_RETRY' using errcode = '40001';
  end if;
  v_ticket := v_ticket_locked;

  -- Empty/non-harvest tickets still pass the global table lock and stable-set
  -- recheck above. Only now is it safe to return without a lot/season scope.
  if v_ticket.harvest_lot_id is null then
    if pg_catalog.cardinality(v_transformation_ids_after) <> 0 then
      raise exception 'TZ315_REVERSED_INPUT_VOID_LOT_BOUNDARY_INVALID' using errcode = '23514';
    end if;
    return v_transformation_ids_after;
  end if;

  select *
  into v_lot_locked
  from public.harvest_lots hl
  where hl.id = v_ticket.harvest_lot_id
  for share;

  if not found
     or v_lot_locked.company_id is distinct from v_lot.company_id
     or v_lot_locked.season_id is distinct from v_lot.season_id
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_LOT_BOUNDARY_CHANGED_RETRY' using errcode = '40001';
  end if;
  v_lot := v_lot_locked;
  v_canonical_season_id := coalesce(v_ticket.season_id, v_lot.season_id);

  if p_require_voided
     and v_ticket.is_finalized
     and not v_ticket.is_voided
     and v_ticket.status = 'finalized'
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_REQUIRES_VOIDED_TICKET' using errcode = '23514';
  end if;

  if v_canonical_season_id is null
     or not exists (
       select 1
       from public.seasons s
       where s.id = v_canonical_season_id
         and s.company_id = v_ticket.company_id
     )
     or exists (
       select 1
       from (
         select i.company_id, i.transformation_id
         from public.batch_transformation_inputs i
         where i.source_ticket_id = p_ticket_id
         union all
         select o.company_id, o.transformation_id
         from public.batch_transformation_outputs o
         where o.source_ticket_id = p_ticket_id
       ) d
       left join public.batch_transformations t on t.id = d.transformation_id
       left join public.batch_processing_reversals r on r.transformation_id = d.transformation_id
       where d.company_id is distinct from v_ticket.company_id
          or t.id is null
          or t.company_id is distinct from v_ticket.company_id
          or t.season_id is distinct from v_canonical_season_id
          or t.harvest_lot_id is distinct from v_ticket.harvest_lot_id
          or (r.id is not null and (
            r.company_id is distinct from v_ticket.company_id
            or r.season_id is distinct from v_canonical_season_id
          ))
     )
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH' using errcode = '23514';
  end if;

  return v_transformation_ids_after;
end
$function$;

revoke all on function private.lock_ticket_processing_boundary_v2(uuid,boolean)
  from public, anon, authenticated, service_role;

create or replace function private.reconcile_voided_ticket_processing_shadow_v1(
  p_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transformation_ids uuid[] := array[]::uuid[];
  v_transformation_id uuid;
begin
  v_transformation_ids := private.lock_ticket_processing_boundary_v2(p_ticket_id, true);

  for v_transformation_id in
    select linked.transformation_id
    from pg_catalog.unnest(v_transformation_ids) linked(transformation_id)
    where not exists (
      select 1
      from public.batch_processing_reversals r
      where r.transformation_id = linked.transformation_id
    )
    order by linked.transformation_id
  loop
    delete from public.batch_transformation_inputs i
    where i.source_ticket_id = p_ticket_id
      and i.transformation_id = v_transformation_id
      and not exists (
        select 1
        from public.batch_processing_reversals r
        where r.transformation_id = i.transformation_id
      );

    delete from public.batch_transformation_outputs o
    where o.source_ticket_id = p_ticket_id
      and o.transformation_id = v_transformation_id
      and not exists (
        select 1
        from public.batch_processing_reversals r
        where r.transformation_id = o.transformation_id
      );

    perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  end loop;
end
$function$;

revoke all on function private.reconcile_voided_ticket_processing_shadow_v1(uuid)
  from public, anon, authenticated, service_role;

-- Clone the exact physically installed implementation once. This avoids a
-- hand-maintained fork of the 600+ line accounting function: the private core
-- is byte-for-byte the installed body apart from its schema/name header.
do $clone_canonical_core$
declare
  v_definition text;
  v_core_definition text;
  v_public_header constant text :=
    'CREATE OR REPLACE FUNCTION public.void_ticket_with_storno_v2(p_ticket_id uuid, p_actor_user_id uuid, p_reason text)';
  v_private_header constant text :=
    'CREATE OR REPLACE FUNCTION private.void_ticket_with_storno_v2_core_20260830_v1(p_ticket_id uuid, p_actor_user_id uuid, p_reason text)';
begin
  if pg_catalog.to_regprocedure(
       'private.void_ticket_with_storno_v2_core_20260830_v1(uuid,uuid,text)'
     ) is null
  then
    select pg_catalog.pg_get_functiondef(
      'public.void_ticket_with_storno_v2(uuid,uuid,text)'::pg_catalog.regprocedure
    ) into v_definition;

    if pg_catalog.strpos(v_definition, v_public_header) = 0
       or pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_public_header, ''))
          <> pg_catalog.length(v_public_header)
    then
      raise exception 'TZ315_REVERSED_INPUT_VOID_CANONICAL_HEADER_CHANGED' using errcode = '55000';
    end if;

    v_core_definition := pg_catalog.replace(v_definition, v_public_header, v_private_header);
    execute v_core_definition;
  end if;
end
$clone_canonical_core$;

revoke all on function private.void_ticket_with_storno_v2_core_20260830_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;

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
  v_actor_role text;
  v_selected_company_id uuid;
begin
  -- TZ315_PROCESSING_VOID_LOCK_ORDER_WRAPPER_V1
  -- Preserve the core's exact validation/error order for malformed or spoofed
  -- calls and avoid taking processing locks for a request it will reject.
  if p_ticket_id is null
     or p_actor_user_id is null
     or nullif(pg_catalog.btrim(coalesce(p_reason, '')), '') is null
     or auth.uid() is null
     or auth.uid() is distinct from p_actor_user_id
  then
    return private.void_ticket_with_storno_v2_core_20260830_v1(
      p_ticket_id,
      p_actor_user_id,
      p_reason
    );
  end if;

  -- Read-only authorization happens before the processing lock helper. The
  -- authenticated session wrapper is SECURITY DEFINER, so the inner ACL alone
  -- is not a tenant boundary. Match the canonical core's actor/status/role
  -- matrix and additionally bind global-admin access to its selected company.
  select *
  into v_ticket
  from public.tickets t
  where t.id = p_ticket_id;

  if not found then
    return private.void_ticket_with_storno_v2_core_20260830_v1(
      p_ticket_id,
      p_actor_user_id,
      p_reason
    );
  end if;

  select *
  into v_actor
  from public.profiles p
  where p.id = p_actor_user_id
    and coalesce(p.status, 'active') = 'active';

  if not found then
    raise exception 'WEIGHBRIDGE_VOID_ACTOR_NOT_FOUND' using errcode = '42501';
  end if;

  v_actor_role := coalesce(v_actor.role, '');
  v_selected_company_id := public.get_user_company_id();
  if v_selected_company_id is null
     or v_selected_company_id is distinct from v_ticket.company_id
     or (
       v_actor_role <> 'global_admin'
       and v_actor.company_id is distinct from v_ticket.company_id
     )
  then
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

  perform private.lock_ticket_processing_boundary_v2(p_ticket_id, false);
  return private.void_ticket_with_storno_v2_core_20260830_v1(
    p_ticket_id,
    p_actor_user_id,
    p_reason
  );
end
$function$;

revoke all on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  to service_role;

comment on function public.void_ticket_with_storno_v2(uuid,uuid,text)
  is 'Canonical ticket storno; TZ315 locks linked processing transformations before ticket, ledger and batch resources.';

do $migration_postconditions$
declare
  v_public_owner text;
  v_core_owner text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner)
  into v_public_owner
  from pg_catalog.pg_proc p
  where p.oid = 'public.void_ticket_with_storno_v2(uuid,uuid,text)'::pg_catalog.regprocedure;

  select pg_catalog.pg_get_userbyid(p.proowner)
  into v_core_owner
  from pg_catalog.pg_proc p
  where p.oid = 'private.void_ticket_with_storno_v2_core_20260830_v1(uuid,uuid,text)'::pg_catalog.regprocedure;

  if v_public_owner is distinct from v_core_owner
     or not exists (
       select 1
       from pg_catalog.pg_trigger tr
       where tr.tgrelid = 'public.tickets'::pg_catalog.regclass
         and tr.tgname = 'trg_tickets_grain_movement_shadow_v1'
         and not tr.tgisinternal
         and tr.tgenabled in ('O', 'A')
         and tr.tgfoid = 'public.tg_sync_grain_movement_shadow_v1()'::pg_catalog.regprocedure
     )
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_LOCK_POSTCONDITION_FAILED' using errcode = '55000';
  end if;
end
$migration_postconditions$;

notify pgrst, 'reload schema';
