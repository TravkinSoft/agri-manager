-- TZ315 universal processing concurrency gate.
--
-- One transaction-scoped advisory gate, keyed by company + canonical season,
-- is injected before the first row lock/write of every current canonical
-- accounting entrypoint. Existing SQL bodies, signatures, defaults, owners,
-- SECURITY DEFINER flags, search_path settings and ACLs are otherwise kept
-- byte-for-byte. The injection deliberately leaves every later source-debit
-- regexp anchor intact and is safe in both migration orders.
--
-- DDL only: no business rows are inserted, updated, deleted or backfilled.

do $physical_preflight$
declare
  v_target record;
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
  v_base_definition text;
  v_base_body text;
  v_gate_fragment text;
  v_definition_hash text;
  v_body_hash text;
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null
     or pg_catalog.to_regprocedure('auth.role()') is null
     or pg_catalog.to_regprocedure('public.resolve_actor_context_from_session_v1()') is null
     or pg_catalog.to_regclass('public.tickets') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.seasons') is null
     or pg_catalog.to_regclass('public.harvest_lots') is null
     or pg_catalog.to_regclass('public.harvest_lot_batches') is null
     or pg_catalog.to_regclass('public.inventory_batches') is null
     or pg_catalog.to_regclass('public.batch_transformations') is null
     or pg_catalog.to_regclass('public.batch_transformation_inputs') is null
     or pg_catalog.to_regclass('public.batch_transformation_outputs') is null
     or pg_catalog.to_regclass('public.stock_ledger_entries') is null
  then
    raise exception 'TZ315_UNIVERSAL_GATE_PREREQUISITE_MISSING' using errcode = '55000';
  end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.resolve_actor_context_from_session_v1()'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
  if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.provolatile <> 'v'
     or v_proc.proparallel <> 'u'
     or v_proc.proconfig is null
     or pg_catalog.cardinality(v_proc.proconfig) <> 1
     or v_proc.proconfig[1] is distinct from 'search_path=pg_catalog, public'
     or coalesce(v_proc.proacl::text, '') is distinct from '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'
     or pg_catalog.md5(pg_catalog.regexp_replace(v_definition, '\s+', ' ', 'g'))
          <> '9d1edf5101f226f9d4ed87f9748df916'
     or pg_catalog.md5(pg_catalog.regexp_replace(v_proc.prosrc, '\s+', ' ', 'g'))
          <> 'ca1e2f7c7bf523204c02160ed5076f37'
  then
    raise exception 'TZ315_UNIVERSAL_GATE_ACTOR_CONTEXT_CONTRACT_MISMATCH' using errcode = '55000';
  end if;

  for v_target in
    select * from (values
      ('public.void_ticket_with_storno_v2(uuid,uuid,text)',
       array['993cb6f058a8b8a3b2959c7880e0daf4']::text[],
       array['56b24f966e30525abad2601c4fa5d414']::text[],
       'search_path=""', '{postgres=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_actor_v1',
       'perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);'),
      ('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)',
       array['485073abd5b8f85cd65c482e2779fe60','4d3b289a4acb497d835660525f8e37df']::text[],
       array['f51d55b8628848f5d55fe3ae4ae37c81','e26fc2212b453b95d5283c0fac080814']::text[],
       'search_path=""', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}',
       'acquire_transformation_processing_gate_v1',
       'perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);'),
      ('public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text)',
       array['d274a37700b2d505eab3819c4d70a7c8']::text[],
       array['078177b34a77442900cd0c2b670dc99d']::text[],
       'search_path=pg_catalog, public, private, extensions',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_session_v1',
       'perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);'),
      ('public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text)',
       array['f5c240e5714ab02087c12fef65ddae0d']::text[],
       array['369e8dc82e88d9a590f0b65e9ad7005c']::text[],
       'search_path=pg_catalog, public, private, extensions',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_session_v1',
       'perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);'),
      ('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)',
       array['d48fcb31997d70e4ddaa3554b7b42372','ba7b8d22fe3dcc5b8e386b2599088dfe']::text[],
       array['59e195df4b432de27bca6f73491f5d77','5c0c9693278646483749bea64e9cde8f']::text[],
       'search_path=pg_catalog, public, private, extensions',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_session_v1',
       'perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);'),
      ('public.finalize_weighbridge_ticket_v2(uuid,uuid)',
       array['4f2f5c25ee3bb9898256e63351e13420']::text[],
       array['f1dcb87a4a4128389d8b9ef6fb6fcd8e']::text[],
       'search_path=pg_catalog, public', '{postgres=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_actor_v1',
       'perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);'),
      ('public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid)',
       array['9ae55ba26f9b4202a0fcad7314bbdee6']::text[],
       array['db9378e76a2ae1324025237ddaf4035e']::text[],
       'search_path=""',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_actor_v1',
       'perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);'),
      ('public.finalize_weighbridge_ticket_for_session_v1(uuid)',
       array['d653502088a41e030e391bfad9a3a04e']::text[],
       array['33d7f0f183e53187288ed7976d2fd3c3']::text[],
       'search_path=pg_catalog, public',
       '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}',
       'acquire_ticket_processing_gate_for_session_v1',
       'perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);'),
      ('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)',
       array['c47a12f9d542cb4d11c2c4bca21d9893']::text[],
       array['c212c3432f0869064d5c06c145e60467']::text[],
       'search_path=pg_catalog, public',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_ticket_processing_gate_for_session_v1',
       'perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);'),
      ('public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text)',
       array['a13d63f36698b6b338c1995ff8cf0f26']::text[],
       array['3d7a793e556024c353ee87ad1cdd2ee9']::text[],
       'search_path=""',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_nonprocessing_company_gate_v1',
       'perform private.acquire_nonprocessing_company_gate_v1(p_company_id);'),
      ('public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamp with time zone,text,text,text,jsonb,uuid)',
       array['3321cb3856be8bfb130ac080c9c02f32']::text[],
       array['f373241039a2b9efb5ab8d3a53ea8938']::text[],
       'search_path=pg_catalog, public',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_nonprocessing_company_gate_v1',
       'perform private.acquire_nonprocessing_company_gate_v1(p_company_id);'),
      ('public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamp with time zone,uuid,uuid,text,text,jsonb,uuid)',
       array['7730438973d27e8bc0bf0f1e6a41f60e']::text[],
       array['d85061635dcf2cabc0004b649fe2d7d0']::text[],
       'search_path=pg_catalog, public', '{postgres=X/postgres,service_role=X/postgres}',
       'acquire_nonprocessing_company_gate_v1',
       'perform private.acquire_nonprocessing_company_gate_v1(p_company_id);'),
      ('public.reassign_harvest_batch_lot_v1(uuid,uuid,text)',
       array['b39fcfc520abeac31197d4cc5e00bbfb']::text[],
       array['881612b337e75679957b4182d93ec4e2']::text[],
       'search_path=pg_catalog, public',
       '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
       'acquire_harvest_batch_reassignment_gate_v1',
       'perform private.acquire_harvest_batch_reassignment_gate_v1(p_inventory_batch_id, p_destination_lot_id);')
    ) as expected(
      public_regprocedure, definition_hashes, body_hashes,
      config_1, acl_text, required_helper, expected_gate_call
    )
  loop
    if pg_catalog.to_regprocedure(v_target.public_regprocedure) is null then
      raise exception 'TZ315_UNIVERSAL_GATE_FUNCTION_MISSING|%', v_target.public_regprocedure
        using errcode = '55000';
    end if;

    select p.* into strict v_proc
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(v_target.public_regprocedure);
    select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;

    if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or not v_proc.prosecdef
       or v_proc.provolatile <> 'v'
       or v_proc.proparallel <> 'u'
       or v_proc.proconfig is null
       or pg_catalog.cardinality(v_proc.proconfig) <> 1
       or v_proc.proconfig[1] is distinct from v_target.config_1
       or coalesce(v_proc.proacl::text, '') is distinct from v_target.acl_text
    then
      raise exception 'TZ315_UNIVERSAL_GATE_METADATA_MISMATCH|%', v_target.public_regprocedure
        using errcode = '55000';
    end if;

    if pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') > 0 then
      v_gate_fragment := E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  '
        || v_target.expected_gate_call || E'\n';
      if pg_catalog.length(v_definition)
           - pg_catalog.length(pg_catalog.replace(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1', ''))
           <> pg_catalog.length('TZ315_UNIVERSAL_PROCESSING_GATE_V1')
         or pg_catalog.strpos(v_definition, v_gate_fragment) = 0
      then
        raise exception 'TZ315_UNIVERSAL_GATE_REPEAT_BODY_MISMATCH|%', v_target.public_regprocedure
          using errcode = '55000';
      end if;
      v_base_definition := pg_catalog.replace(v_definition, v_gate_fragment, '');
      v_base_body := pg_catalog.replace(v_proc.prosrc, v_gate_fragment, '');
    else
      v_base_definition := v_definition;
      v_base_body := v_proc.prosrc;
    end if;

    v_definition_hash := pg_catalog.md5(
      pg_catalog.regexp_replace(v_base_definition, '\s+', ' ', 'g')
    );
    v_body_hash := pg_catalog.md5(
      pg_catalog.regexp_replace(v_base_body, '\s+', ' ', 'g')
    );
    if not (v_definition_hash = any(v_target.definition_hashes))
       or not (v_body_hash = any(v_target.body_hashes))
    then
      raise exception 'TZ315_UNIVERSAL_GATE_BODY_HASH_MISMATCH|%|def=%|body=%',
        v_target.public_regprocedure, v_definition_hash, v_body_hash
        using errcode = '55000';
    end if;

    if v_target.required_helper = 'acquire_nonprocessing_company_gate_v1'
       and (
         pg_catalog.strpos(v_definition, 'batch_transformations') > 0
         or pg_catalog.strpos(v_definition, 'linked_processing_id') > 0
         or pg_catalog.strpos(v_definition, 'processing_id') > 0
       )
    then
      raise exception 'TZ315_UNIVERSAL_GATE_SENTINEL_PROOF_FAILED|%', v_target.public_regprocedure
        using errcode = '55000';
    end if;
  end loop;
end
$physical_preflight$;

create or replace function private.tz315_lock_company_season_write_gate_v1(
  p_company_id uuid,
  p_canonical_season_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- TZ315_PROCESSING_COMPANY_SEASON_GATE_V1
  if p_company_id is null then
    raise exception 'TZ315_PROCESSING_GATE_COMPANY_REQUIRED' using errcode = '22004';
  end if;
  if p_canonical_season_id is null then
    -- A legacy/non-processing writer has no proven canonical season.  Take the
    -- company umbrella exclusively so it conflicts with every known-season
    -- writer for the same company.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'travkinflow.processing.company.v1|' || p_company_id::text,
        315::bigint
      )
    );
    return;
  end if;

  -- Known-season writers share the company umbrella, then serialize only on
  -- their canonical season.  The umbrella is always acquired first, which
  -- makes the known/legacy interaction deadlock-free and fail-closed.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(
      'travkinflow.processing.company.v1|' || p_company_id::text,
      315::bigint
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'travkinflow.processing.company-season.v1|'
        || p_company_id::text || '|' || p_canonical_season_id::text,
      315::bigint
    )
  );
end
$function$;

revoke all on function private.tz315_lock_company_season_write_gate_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.resolve_ticket_processing_gate_scope_v1(
  p_ticket_id uuid
)
returns table(
  company_id uuid,
  canonical_season_id uuid,
  uses_company_umbrella boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_has_processing_link boolean := false;
  v_seasons uuid[] := array[]::uuid[];
begin
  select t.* into v_ticket
  from public.tickets t
  where t.id = p_ticket_id;
  if not found then return; end if;

  v_has_processing_link :=
    v_ticket.linked_processing_id is not null
    or exists (select 1 from public.batch_transformation_inputs i where i.source_ticket_id = v_ticket.id)
    or exists (select 1 from public.batch_transformation_outputs o where o.source_ticket_id = v_ticket.id)
    or exists (
      select 1 from public.stock_ledger_entries sle
      where sle.ticket_id = v_ticket.id and sle.processing_id is not null
    );

  if v_ticket.harvest_lot_id is not null then
    select hl.* into v_lot
    from public.harvest_lots hl
    where hl.id = v_ticket.harvest_lot_id;
    if not found
       or v_lot.company_id is distinct from v_ticket.company_id
       or v_lot.season_id is null
    then
      raise exception 'TZ315_PROCESSING_GATE_LOT_SCOPE_INVALID' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
    from (
      select i.company_id as document_company_id, i.transformation_id
      from public.batch_transformation_inputs i where i.source_ticket_id = v_ticket.id
      union all
      select o.company_id, o.transformation_id
      from public.batch_transformation_outputs o where o.source_ticket_id = v_ticket.id
      union all
      select sle.company_id, sle.processing_id
      from public.stock_ledger_entries sle
      where sle.ticket_id = v_ticket.id and sle.processing_id is not null
      union all
      select v_ticket.company_id, v_ticket.linked_processing_id
      where v_ticket.linked_processing_id is not null
    ) linked
    left join public.batch_transformations bt on bt.id = linked.transformation_id
    where linked.document_company_id is distinct from v_ticket.company_id
       or bt.id is null
       or bt.company_id is distinct from v_ticket.company_id
       or bt.season_id is null
       or (
         v_ticket.harvest_lot_id is not null
         and bt.harvest_lot_id is distinct from v_ticket.harvest_lot_id
       )
  ) then
    raise exception 'TZ315_PROCESSING_GATE_TRANSFORMATION_SCOPE_INVALID' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct scope.season_id order by scope.season_id),
    array[]::uuid[]
  ) into v_seasons
  from (
    select v_ticket.season_id where v_ticket.season_id is not null
    union all
    select v_lot.season_id where v_ticket.harvest_lot_id is not null
    union all
    select bt.season_id
    from public.batch_transformations bt
    where bt.id in (
      select v_ticket.linked_processing_id where v_ticket.linked_processing_id is not null
      union
      select i.transformation_id from public.batch_transformation_inputs i where i.source_ticket_id = v_ticket.id
      union
      select o.transformation_id from public.batch_transformation_outputs o where o.source_ticket_id = v_ticket.id
      union
      select sle.processing_id from public.stock_ledger_entries sle
      where sle.ticket_id = v_ticket.id and sle.processing_id is not null
    )
  ) scope;

  if pg_catalog.cardinality(v_seasons) > 1 then
    raise exception 'TZ315_PROCESSING_GATE_SEASON_SCOPE_AMBIGUOUS' using errcode = '23514';
  end if;

  company_id := v_ticket.company_id;
  if pg_catalog.cardinality(v_seasons) = 1 then
    canonical_season_id := v_seasons[1];
    uses_company_umbrella := false;
    if not exists (
      select 1 from public.seasons s
      where s.id = v_seasons[1] and s.company_id = v_ticket.company_id
    ) then
      raise exception 'TZ315_PROCESSING_GATE_COMPANY_SEASON_MISMATCH' using errcode = '23514';
    end if;
  else
    if v_ticket.harvest_lot_id is not null or v_has_processing_link then
      raise exception 'TZ315_PROCESSING_GATE_CANONICAL_SEASON_REQUIRED' using errcode = '23514';
    end if;
    canonical_season_id := null;
    uses_company_umbrella := true;
  end if;
  return next;
end
$function$;

revoke all on function private.resolve_ticket_processing_gate_scope_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.resolve_processing_gate_session_actor_v1()
returns table(
  actor_profile_id uuid,
  selected_company_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from public.resolve_actor_context_from_session_v1();
  if not found
     or v_context.profile_id is null
     or coalesce(v_context.status, 'active') <> 'active'
  then
    raise exception 'TZ315_PROCESSING_GATE_SESSION_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;

  if v_context.impersonated_profile_id is not null then
    if v_context.role is distinct from 'global_admin'
       or coalesce(v_context.impersonated_status, 'active') <> 'active'
       or v_context.impersonated_company_id is null
    then
      raise exception 'TZ315_PROCESSING_GATE_IMPERSONATION_INVALID' using errcode = '42501';
    end if;
    actor_profile_id := v_context.impersonated_profile_id;
    selected_company_id := v_context.impersonated_company_id;
  else
    actor_profile_id := v_context.profile_id;
    selected_company_id := case
      when v_context.role = 'global_admin'
        then coalesce(v_context.context_company_id, v_context.company_id)
      else v_context.company_id
    end;
  end if;

  if actor_profile_id is null or selected_company_id is null then
    raise exception 'TZ315_PROCESSING_GATE_SESSION_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return next;
end
$function$;

revoke all on function private.resolve_processing_gate_session_actor_v1()
  from public, anon, authenticated, service_role;

create or replace function private.assert_processing_gate_actor_v1(
  p_company_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_context record;
  v_session_actor_id uuid;
  v_selected_company_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;

  -- Authenticated callers use the same canonical id/email/impersonation
  -- resolver as getServerActorFromSession. Trusted service-role core calls
  -- bind the explicit actor below without depending on auth.uid().
  if auth.role() is distinct from 'service_role' then
    select * into v_context
    from public.resolve_actor_context_from_session_v1();
    select session_actor.actor_profile_id, session_actor.selected_company_id
    into v_session_actor_id, v_selected_company_id
    from private.resolve_processing_gate_session_actor_v1() session_actor;
    if v_selected_company_id is distinct from p_company_id
    then
      raise exception 'TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN' using errcode = '42501';
    end if;
    if v_session_actor_id is distinct from p_actor_user_id
       and (
         v_context.role is distinct from 'global_admin'
         or coalesce(v_context.status, 'active') <> 'active'
         or v_context.impersonated_profile_id is null
         or v_context.profile_id is distinct from p_actor_user_id
         or v_context.impersonated_profile_id is distinct from v_session_actor_id
         or v_context.impersonated_company_id is distinct from p_company_id
         or v_context.impersonated_role is null
         or coalesce(v_context.impersonated_status, 'active') <> 'active'
       )
    then
      -- Legacy session wrappers pass the authenticated global-admin principal
      -- to their actor-explicit core. Permit only that exact principal while a
      -- canonical, active impersonation binds it to this effective actor and
      -- company. Ordinary callers still require exact effective-actor identity.
      raise exception 'TZ315_PROCESSING_GATE_ACTOR_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  select p.* into v_actor
  from public.profiles p
  where p.id = p_actor_user_id
    and coalesce(p.status, 'active') = 'active';
  if not found
     or (v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id)
  then
    raise exception 'TZ315_PROCESSING_GATE_COMPANY_FORBIDDEN' using errcode = '42501';
  end if;
end
$function$;

revoke all on function private.assert_processing_gate_actor_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.acquire_ticket_processing_gate_for_actor_v1(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_season_id uuid;
  v_uses_company_umbrella boolean;
  v_company_after uuid;
  v_season_after uuid;
  v_uses_company_umbrella_after boolean;
begin
  if p_ticket_id is null then return; end if;
  select scope.company_id, scope.canonical_season_id, scope.uses_company_umbrella
  into v_company_id, v_season_id, v_uses_company_umbrella
  from private.resolve_ticket_processing_gate_scope_v1(p_ticket_id) scope;
  if not found then return; end if;

  perform private.assert_processing_gate_actor_v1(v_company_id, p_actor_user_id);
  perform private.tz315_lock_company_season_write_gate_v1(v_company_id, v_season_id);

  select scope.company_id, scope.canonical_season_id, scope.uses_company_umbrella
  into v_company_after, v_season_after, v_uses_company_umbrella_after
  from private.resolve_ticket_processing_gate_scope_v1(p_ticket_id) scope;
  if not found
     or v_company_after is distinct from v_company_id
     or v_season_after is distinct from v_season_id
     or v_uses_company_umbrella_after is distinct from v_uses_company_umbrella
  then
    raise exception 'TZ315_PROCESSING_GATE_SCOPE_CHANGED_RETRY' using errcode = '40001';
  end if;
end
$function$;

revoke all on function private.acquire_ticket_processing_gate_for_actor_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.acquire_ticket_processing_gate_for_session_v1(
  p_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_profile_id uuid;
begin
  select actor.actor_profile_id into v_actor_profile_id
  from private.resolve_processing_gate_session_actor_v1() actor;
  perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, v_actor_profile_id);
end
$function$;

revoke all on function private.acquire_ticket_processing_gate_for_session_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.acquire_transformation_processing_gate_v1(
  p_transformation_id uuid,
  p_company_id uuid,
  p_season_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before public.batch_transformations%rowtype;
  v_after public.batch_transformations%rowtype;
begin
  if p_transformation_id is null or p_company_id is null or p_season_id is null then return; end if;
  perform private.assert_processing_gate_actor_v1(p_company_id, p_actor_user_id);
  select bt.* into v_before
  from public.batch_transformations bt
  where bt.id = p_transformation_id
    and bt.company_id = p_company_id
    and bt.season_id = p_season_id;
  if not found then return; end if;
  if not exists (
    select 1 from public.seasons s
    where s.id = p_season_id and s.company_id = p_company_id
  ) then
    raise exception 'PROCESSING_REVERSAL_SEASON_INVALID' using errcode = '23514';
  end if;

  perform private.tz315_lock_company_season_write_gate_v1(p_company_id, p_season_id);
  select bt.* into v_after
  from public.batch_transformations bt
  where bt.id = p_transformation_id
    and bt.company_id = p_company_id
    and bt.season_id = p_season_id;
  if not found
     or v_after.harvest_lot_id is distinct from v_before.harvest_lot_id
     or v_after.node_warehouse_id is distinct from v_before.node_warehouse_id
     or v_after.processing_node_id is distinct from v_before.processing_node_id
     or v_after.transformation_type is distinct from v_before.transformation_type
  then
    raise exception 'TZ315_PROCESSING_GATE_SCOPE_CHANGED_RETRY' using errcode = '40001';
  end if;
end
$function$;

revoke all on function private.acquire_transformation_processing_gate_v1(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.acquire_harvest_batch_reassignment_gate_v1(
  p_inventory_batch_id uuid,
  p_destination_lot_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before record;
  v_after record;
begin
  if p_inventory_batch_id is null or p_destination_lot_id is null then return; end if;

  select
    ib.id as batch_id,
    ib.company_id as batch_company_id,
    ib.season_id as batch_season_id,
    link.id as link_id,
    link.company_id as link_company_id,
    link.harvest_lot_id as source_lot_id,
    source_lot.company_id as source_company_id,
    source_lot.season_id as source_season_id,
    destination.id as destination_lot_id,
    destination.company_id as destination_company_id,
    destination.season_id as destination_season_id,
    destination.status as destination_status
  into v_before
  from public.inventory_batches ib
  left join public.harvest_lot_batches link on link.inventory_batch_id = ib.id
  left join public.harvest_lots source_lot on source_lot.id = link.harvest_lot_id
  left join public.harvest_lots destination on destination.id = p_destination_lot_id
  where ib.id = p_inventory_batch_id;

  -- Missing/inactive rows are left to the original RPC so its existing error
  -- contract remains unchanged. A complete but inconsistent scope fails closed.
  if not found
     or v_before.link_id is null
     or v_before.source_lot_id is null
     or v_before.destination_lot_id is null
     or v_before.destination_status is distinct from 'active'
  then
    return;
  end if;
  if v_before.batch_company_id is null
     or v_before.batch_season_id is null
     or v_before.link_company_id is distinct from v_before.batch_company_id
     or v_before.source_company_id is distinct from v_before.batch_company_id
     or v_before.destination_company_id is distinct from v_before.batch_company_id
     or v_before.source_season_id is distinct from v_before.batch_season_id
     or v_before.destination_season_id is distinct from v_before.batch_season_id
     or not exists (
       select 1 from public.seasons s
       where s.id = v_before.batch_season_id
         and s.company_id = v_before.batch_company_id
     )
  then
    raise exception 'TZ315_HARVEST_BATCH_REASSIGN_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  perform private.tz315_lock_company_season_write_gate_v1(
    v_before.batch_company_id,
    v_before.batch_season_id
  );

  -- Every canonical mutator reaches these row locks only after the shared
  -- advisory hierarchy. The exact membership row is locked first, followed by
  -- its batch and the source/destination lots in UUID order.
  perform 1 from public.harvest_lot_batches link
  where link.id = v_before.link_id for update;
  if not found then
    raise exception 'TZ315_HARVEST_BATCH_REASSIGN_SCOPE_CHANGED_RETRY' using errcode = '40001';
  end if;
  perform 1 from public.inventory_batches ib
  where ib.id = v_before.batch_id for update;
  if not found then
    raise exception 'TZ315_HARVEST_BATCH_REASSIGN_SCOPE_CHANGED_RETRY' using errcode = '40001';
  end if;
  perform 1 from public.harvest_lots lot
  where lot.id in (v_before.source_lot_id, v_before.destination_lot_id)
  order by lot.id for update;

  select
    ib.id as batch_id,
    ib.company_id as batch_company_id,
    ib.season_id as batch_season_id,
    link.id as link_id,
    link.company_id as link_company_id,
    link.harvest_lot_id as source_lot_id,
    source_lot.company_id as source_company_id,
    source_lot.season_id as source_season_id,
    destination.id as destination_lot_id,
    destination.company_id as destination_company_id,
    destination.season_id as destination_season_id,
    destination.status as destination_status
  into v_after
  from public.inventory_batches ib
  join public.harvest_lot_batches link on link.inventory_batch_id = ib.id
  join public.harvest_lots source_lot on source_lot.id = link.harvest_lot_id
  join public.harvest_lots destination on destination.id = p_destination_lot_id
  where ib.id = p_inventory_batch_id;

  if not found
     or v_after.batch_id is distinct from v_before.batch_id
     or v_after.batch_company_id is distinct from v_before.batch_company_id
     or v_after.batch_season_id is distinct from v_before.batch_season_id
     or v_after.link_id is distinct from v_before.link_id
     or v_after.link_company_id is distinct from v_before.link_company_id
     or v_after.source_lot_id is distinct from v_before.source_lot_id
     or v_after.source_company_id is distinct from v_before.source_company_id
     or v_after.source_season_id is distinct from v_before.source_season_id
     or v_after.destination_lot_id is distinct from v_before.destination_lot_id
     or v_after.destination_company_id is distinct from v_before.destination_company_id
     or v_after.destination_season_id is distinct from v_before.destination_season_id
     or v_after.destination_status is distinct from 'active'
  then
    raise exception 'TZ315_HARVEST_BATCH_REASSIGN_SCOPE_CHANGED_RETRY' using errcode = '40001';
  end if;
end
$function$;

revoke all on function private.acquire_harvest_batch_reassignment_gate_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.acquire_nonprocessing_company_gate_v1(
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_profile_id uuid;
begin
  if p_company_id is null then return; end if;
  select actor.actor_profile_id into v_actor_profile_id
  from private.resolve_processing_gate_session_actor_v1() actor;
  perform private.assert_processing_gate_actor_v1(p_company_id, v_actor_profile_id);
  perform private.tz315_lock_company_season_write_gate_v1(
    p_company_id,
    null
  );
end
$function$;

revoke all on function private.acquire_nonprocessing_company_gate_v1(uuid)
  from public, anon, authenticated, service_role;

-- Fail-closed dynamic injection. Only the first top-level BEGIN is replaced;
-- every pre-existing body fragment and later migration anchor remains intact.
do $inject_gate$
declare
  v_target record;
  v_oid oid;
  v_definition text;
  v_anchor text;
  v_position integer;
  v_injected text;
begin
  for v_target in
    select * from (values
      ('public.void_ticket_with_storno_v2(uuid,uuid,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);\n'),
      ('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_transformation_processing_gate_v1(p_transformation_id, p_company_id, p_season_id, p_actor_user_id);\n'),
      ('public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n'),
      ('public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n'),
      ('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n'),
      ('public.finalize_weighbridge_ticket_v2(uuid,uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);\n'),
      ('public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_actor_v1(p_ticket_id, p_actor_user_id);\n'),
      ('public.finalize_weighbridge_ticket_for_session_v1(uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n'),
      ('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_ticket_processing_gate_for_session_v1(p_ticket_id);\n'),
      ('public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_nonprocessing_company_gate_v1(p_company_id);\n'),
      ('public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamp with time zone,text,text,text,jsonb,uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_nonprocessing_company_gate_v1(p_company_id);\n'),
      ('public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamp with time zone,uuid,uuid,text,text,jsonb,uuid)',
       E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n  perform private.acquire_nonprocessing_company_gate_v1(p_company_id);\n')
    ) as injections(public_regprocedure, statement)
  loop
    v_oid := pg_catalog.to_regprocedure(v_target.public_regprocedure);
    select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
    if pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') > 0 then
      continue;
    end if;
    if pg_catalog.strpos(v_definition, E'begin\n') > 0 then
      v_anchor := E'begin\n';
    elsif pg_catalog.strpos(v_definition, E'begin\r\n') > 0 then
      v_anchor := E'begin\r\n';
    else
      v_anchor := null;
    end if;
    v_position := coalesce(pg_catalog.strpos(v_definition, v_anchor), 0);
    if v_position = 0 then
      raise exception 'TZ315_UNIVERSAL_GATE_BEGIN_ANCHOR_MISSING|%', v_target.public_regprocedure
        using errcode = '55000';
    end if;
    v_injected := pg_catalog.overlay(
      v_definition,
      v_anchor || v_target.statement,
      v_position,
      pg_catalog.length(v_anchor)
    );
    execute v_injected;
  end loop;
end
$inject_gate$;

-- The reassignment RPC intentionally keeps its existing actor/reason checks
-- before the gate. Only its first membership FOR UPDATE is moved behind the
-- common company+season gate; every original statement remains byte-for-byte.
do $inject_reassignment_gate$
declare
  v_oid oid := 'public.reassign_harvest_batch_lot_v1(uuid,uuid,text)'::pg_catalog.regprocedure;
  v_definition text;
  v_anchor text;
  v_statement constant text :=
    E'  -- TZ315_UNIVERSAL_PROCESSING_GATE_V1\n'
    || E'  perform private.acquire_harvest_batch_reassignment_gate_v1(p_inventory_batch_id, p_destination_lot_id);\n';
  v_position integer;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') > 0 then
    return;
  end if;
  if pg_catalog.strpos(
       v_definition,
       E'  select * into v_link from public.harvest_lot_batches\n  where inventory_batch_id = p_inventory_batch_id for update;\n'
     ) > 0
  then
    v_anchor := E'  select * into v_link from public.harvest_lot_batches\n  where inventory_batch_id = p_inventory_batch_id for update;\n';
  elsif pg_catalog.strpos(
          v_definition,
          E'  select * into v_link from public.harvest_lot_batches\r\n  where inventory_batch_id = p_inventory_batch_id for update;\r\n'
        ) > 0
  then
    v_anchor := E'  select * into v_link from public.harvest_lot_batches\r\n  where inventory_batch_id = p_inventory_batch_id for update;\r\n';
  else
    raise exception 'TZ315_UNIVERSAL_GATE_REASSIGN_ANCHOR_MISSING' using errcode = '55000';
  end if;
  v_position := pg_catalog.strpos(v_definition, v_anchor);
  execute pg_catalog.overlay(
    v_definition,
    v_statement || v_anchor,
    v_position,
    pg_catalog.length(v_anchor)
  );
end
$inject_reassignment_gate$;

do $postconditions$
declare
  v_target record;
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
begin
  for v_target in
    select * from (values
      ('public.void_ticket_with_storno_v2(uuid,uuid,text)', 'search_path=""', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.reverse_processing_material_balance_v1(uuid,uuid,uuid,uuid,text,text,text)', 'search_path=""', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'),
      ('public.finalize_harvest_intake_for_session_v1(uuid,text,numeric,numeric,numeric,numeric,text,boolean,text)', 'search_path=pg_catalog, public, private, extensions', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.close_transfer_ticket_atomic_v2(uuid,text,numeric,numeric,boolean,text)', 'search_path=pg_catalog, public, private, extensions', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)', 'search_path=pg_catalog, public, private, extensions', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.finalize_weighbridge_ticket_v2(uuid,uuid)', 'search_path=pg_catalog, public', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.finalize_weighbridge_ticket_authenticated_v1(uuid,uuid)', 'search_path=""', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.finalize_weighbridge_ticket_for_session_v1(uuid)', 'search_path=pg_catalog, public', '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}'),
      ('public.finalize_weighbridge_impurity_ticket_for_session_v1(uuid)', 'search_path=pg_catalog, public', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text)', 'search_path=""', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.create_warehouse_receipt_atomic_v1(uuid,uuid,timestamp with time zone,text,text,text,jsonb,uuid)', 'search_path=pg_catalog, public', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.create_warehouse_receipt_atomic_v2(uuid,uuid,timestamp with time zone,uuid,uuid,text,text,jsonb,uuid)', 'search_path=pg_catalog, public', '{postgres=X/postgres,service_role=X/postgres}')
      ,('public.reassign_harvest_batch_lot_v1(uuid,uuid,text)', 'search_path=pg_catalog, public', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) as expected(public_regprocedure, config_1, acl_text)
  loop
    select p.* into strict v_proc
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(v_target.public_regprocedure);
    select pg_catalog.pg_get_functiondef(v_proc.oid) into v_definition;
    if pg_catalog.strpos(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1') = 0
       or pg_catalog.length(v_definition)
            - pg_catalog.length(pg_catalog.replace(v_definition, 'TZ315_UNIVERSAL_PROCESSING_GATE_V1', ''))
            <> pg_catalog.length('TZ315_UNIVERSAL_PROCESSING_GATE_V1')
       or pg_catalog.strpos(v_definition, 'perform private.acquire_') = 0
       or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or not v_proc.prosecdef
       or v_proc.proconfig is null
       or pg_catalog.cardinality(v_proc.proconfig) <> 1
       or v_proc.proconfig[1] is distinct from v_target.config_1
       or coalesce(v_proc.proacl::text, '') is distinct from v_target.acl_text
    then
      raise exception 'TZ315_UNIVERSAL_GATE_POSTCONDITION_FAILED|%', v_target.public_regprocedure
        using errcode = '55000';
    end if;
  end loop;

  for v_target in
    select * from (values
      ('private.tz315_lock_company_season_write_gate_v1(uuid,uuid)', false),
      ('private.resolve_ticket_processing_gate_scope_v1(uuid)', true),
      ('private.resolve_processing_gate_session_actor_v1()', true),
      ('private.assert_processing_gate_actor_v1(uuid,uuid)', true),
      ('private.acquire_ticket_processing_gate_for_actor_v1(uuid,uuid)', true),
      ('private.acquire_ticket_processing_gate_for_session_v1(uuid)', true),
      ('private.acquire_transformation_processing_gate_v1(uuid,uuid,uuid,uuid)', true),
      ('private.acquire_harvest_batch_reassignment_gate_v1(uuid,uuid)', true),
      ('private.acquire_nonprocessing_company_gate_v1(uuid)', true)
    ) as helpers(private_regprocedure, expected_security_definer)
  loop
    select p.* into strict v_proc
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure(v_target.private_regprocedure);
    if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
       or v_proc.prosecdef is distinct from v_target.expected_security_definer
       or v_proc.provolatile <> 'v'
       or v_proc.proparallel <> 'u'
       or v_proc.proconfig is null
       or pg_catalog.cardinality(v_proc.proconfig) <> 1
       or v_proc.proconfig[1] is distinct from 'search_path=""'
       or coalesce(v_proc.proacl::text, '') is distinct from '{postgres=X/postgres}'
    then
      raise exception 'TZ315_UNIVERSAL_GATE_PRIVATE_HELPER_METADATA_FAILED|%',
        v_target.private_regprocedure using errcode = '55000';
    end if;
  end loop;

  if exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) acl
       where p.oid = 'private.tz315_lock_company_season_write_gate_v1(uuid,uuid)'::pg_catalog.regprocedure
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', 'private.tz315_lock_company_season_write_gate_v1(uuid,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'private.tz315_lock_company_season_write_gate_v1(uuid,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', 'private.tz315_lock_company_season_write_gate_v1(uuid,uuid)', 'EXECUTE')
  then
    raise exception 'TZ315_UNIVERSAL_GATE_HELPER_ACL_FAILED' using errcode = '55000';
  end if;
end
$postconditions$;

comment on function private.tz315_lock_company_season_write_gate_v1(uuid,uuid)
  is 'Private TZ315 advisory transaction gate: known season takes shared company umbrella then exclusive company-season; NULL season takes exclusive company umbrella.';

notify pgrst, 'reload schema';
