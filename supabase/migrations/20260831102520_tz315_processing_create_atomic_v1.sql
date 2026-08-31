-- TZ315: one atomic, actor-scoped create boundary for processing drafts.
--
-- The HTTP route previously used three service-role DML statements and a
-- best-effort DELETE compensation path.  This RPC validates the entire graph,
-- acquires the shared company+season gate before any row lock or write, then
-- creates the transformation, inputs, outputs and optional ticket link in the
-- one PostgreSQL transaction provided by the function call.

do $migration$
declare
  v_gate_oid oid;
  v_gate_definition text;
  v_gate_owner text;
  v_gate_security_definer boolean;
  v_attach_oid oid;
  v_attach_definition text;
  v_attach_owner text;
  v_attach_security_definer boolean;
  v_attach_config text[];
  v_route_attach_oid oid;
  v_route_attach_definition text;
  v_route_attach_owner text;
  v_route_attach_security_definer boolean;
  v_route_attach_config text[];
  v_wip_state_oid oid;
  v_wip_state_definition text;
  v_wip_state_owner text;
  v_wip_state_security_definer boolean;
  v_wip_state_config text[];
  v_output_trace_oid oid;
  v_output_trace_definition text;
  v_output_trace_owner text;
  v_output_trace_security_definer boolean;
  v_output_trace_config text[];
  v_output_close_oid oid;
  v_output_close_definition text;
  v_output_close_owner text;
  v_output_close_security_definer boolean;
  v_output_close_config text[];
begin
  if to_regclass('public.v_effective_stock_balance_identity_v1') is null then
    raise exception 'TZ315_PROCESSING_CREATE_EFFECTIVE_BALANCE_VIEW_MISSING';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig
    into v_attach_oid, v_attach_definition, v_attach_owner,
         v_attach_security_definer, v_attach_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'attach_processing_input_ticket_live_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_ticket_id uuid';
  if v_attach_oid is null
     or v_attach_owner <> 'postgres'
     or not coalesce(v_attach_security_definer, false)
     or v_attach_config is distinct from array['search_path=""']::text[]
     or position('PROCESSING_INPUT_AMBIGUOUS' in coalesce(v_attach_definition, '')) = 0
     or position('PROCESSING_INPUT_FINISHED' in coalesce(v_attach_definition, '')) = 0
  then
    raise exception 'TZ315_PROCESSING_CREATE_CANONICAL_ATTACH_MISSING';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc attach_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(attach_proc.proacl, pg_catalog.acldefault('f', attach_proc.proowner))
       ) attach_acl
       where attach_proc.oid = v_attach_oid
         and attach_acl.grantee = 0
         and attach_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_attach_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_attach_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_attach_oid, 'EXECUTE')
  then
    raise exception 'TZ315_PROCESSING_CREATE_CANONICAL_ATTACH_EXPOSED';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig
    into v_route_attach_oid, v_route_attach_definition, v_route_attach_owner,
         v_route_attach_security_definer, v_route_attach_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'attach_route_processing_input_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_ticket_id uuid';
  if v_route_attach_oid is null
     or v_route_attach_owner <> 'postgres'
     or not coalesce(v_route_attach_security_definer, false)
     or v_route_attach_config is distinct from array['search_path=""']::text[]
     or position('not in (''DRYER'', ''CLEANER'')' in coalesce(v_route_attach_definition, '')) = 0
     or position('VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED' in coalesce(v_route_attach_definition, '')) = 0
     or position('v_category_slug = ''vegetable''' in coalesce(v_route_attach_definition, '')) = 0
     or position('v_crop_slug in (''potato'', ''carrot'')' in coalesce(v_route_attach_definition, '')) = 0
     or position(
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1'
       in coalesce(v_route_attach_definition, '')
     ) = 0
     or position(
       'tz315_processing_wip_physical_state_valid_v1'
       in coalesce(v_route_attach_definition, '')
     ) = 0
     or position('attach_processing_input_ticket_live_v1' in coalesce(v_route_attach_definition, '')) = 0
  then
    raise exception 'TZ315_PROCESSING_CREATE_ROUTE_ATTACH_NON_CANONICAL';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc route_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(route_proc.proacl, pg_catalog.acldefault('f', route_proc.proowner))
       ) route_acl
       where route_proc.oid = v_route_attach_oid
         and route_acl.grantee = 0
         and route_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_route_attach_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_route_attach_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', v_route_attach_oid, 'EXECUTE')
  then
    raise exception 'TZ315_PROCESSING_CREATE_ROUTE_ATTACH_EXPOSED';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig
    into v_wip_state_oid, v_wip_state_definition, v_wip_state_owner,
         v_wip_state_security_definer, v_wip_state_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'tz315_processing_wip_physical_state_valid_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_ticket_id uuid';
  if v_wip_state_oid is null
     or v_wip_state_owner <> 'postgres'
     or coalesce(v_wip_state_security_definer, false)
     or v_wip_state_config is distinct from array['search_path=""']::text[]
     or position(
       'TZ315_PROCESSING_WIP_ROLE_NULL_GUARD_V1'
       in coalesce(v_wip_state_definition, '')
     ) = 0
     or position(
       'coalesce(v_ticket.processing_output_role, '''') not in ('
       in coalesce(v_wip_state_definition, '')
     ) = 0
  then
    raise exception 'TZ315_PROCESSING_CREATE_WIP_ROLE_NULL_GUARD_MISSING';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc helper_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(helper_proc.proacl, pg_catalog.acldefault('f', helper_proc.proowner))
       ) helper_acl
       where helper_proc.oid = v_wip_state_oid
         and helper_acl.grantee = 0
         and helper_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_wip_state_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_wip_state_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_wip_state_oid, 'EXECUTE')
  then
    raise exception 'TZ315_PROCESSING_CREATE_WIP_ROLE_NULL_GUARD_EXPOSED';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig
    into v_output_trace_oid, v_output_trace_definition, v_output_trace_owner,
         v_output_trace_security_definer, v_output_trace_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'processing_output_ticket_trace_valid_v2'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_output_id uuid';
  if v_output_trace_oid is null
     or v_output_trace_owner <> 'postgres'
     or not coalesce(v_output_trace_security_definer, false)
     or v_output_trace_config is distinct from array['search_path=""']::text[]
     or position('processing_output_in' in coalesce(v_output_trace_definition, '')) = 0
     or position('processing_output_source_out' in coalesce(v_output_trace_definition, '')) = 0
     or position('o.output_batch_id' in coalesce(v_output_trace_definition, '')) = 0
     or position('o.warehouse_to_id' in coalesce(v_output_trace_definition, '')) = 0
     or position('o.transformation_id' in coalesce(v_output_trace_definition, '')) = 0
  then
    raise exception 'TZ315_PROCESSING_CREATE_OUTPUT_TRACE_NON_CANONICAL';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc trace_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(trace_proc.proacl, pg_catalog.acldefault('f', trace_proc.proowner))
       ) trace_acl
       where trace_proc.oid = v_output_trace_oid
         and trace_acl.grantee = 0
         and trace_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_output_trace_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_output_trace_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_output_trace_oid, 'EXECUTE')
  then
    raise exception 'TZ315_PROCESSING_CREATE_OUTPUT_TRACE_EXPOSED';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig
    into v_output_close_oid, v_output_close_definition, v_output_close_owner,
         v_output_close_security_definer, v_output_close_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'close_processing_output_ticket_atomic_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_moisture_percent numeric, p_tare_variance_confirmed boolean, p_idempotency_key text';
  if v_output_close_oid is null
     or v_output_close_owner <> 'postgres'
     or not coalesce(v_output_close_security_definer, false)
     or v_output_close_config is distinct from
       array['search_path=pg_catalog, public, private, extensions']::text[]
     or position(
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1'
       in coalesce(v_output_close_definition, '')
     ) = 0
     or position(
       'source_physical_state = v_physical_state'
       in coalesce(v_output_close_definition, '')
     ) = 0
     or position(
       'output_role, is_projected_child, physical_state, output_type'
       in coalesce(v_output_close_definition, '')
     ) = 0
  then
    raise exception 'TZ315_PROCESSING_CREATE_WIP_PHYSICAL_STATE_DEPENDENCY_INVALID';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc close_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(close_proc.proacl, pg_catalog.acldefault('f', close_proc.proowner))
       ) close_acl
       where close_proc.oid = v_output_close_oid
         and close_acl.grantee = 0
         and close_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', v_output_close_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated', v_output_close_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_output_close_oid, 'EXECUTE'
     )
  then
    raise exception 'TZ315_PROCESSING_CREATE_WIP_PHYSICAL_STATE_DEPENDENCY_EXPOSED';
  end if;

  select p.oid,
         pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef
    into v_gate_oid, v_gate_definition, v_gate_owner, v_gate_security_definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'tz315_lock_company_season_write_gate_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_company_id uuid, p_canonical_season_id uuid';

  if v_gate_oid is null then
    raise exception 'TZ315_PROCESSING_COMPANY_SEASON_GATE_REQUIRED';
  end if;
  if position('TZ315_PROCESSING_COMPANY_SEASON_GATE_V1' in coalesce(v_gate_definition, '')) = 0
     or v_gate_owner <> 'postgres'
     or coalesce(v_gate_security_definer, false)
  then
    raise exception 'TZ315_PROCESSING_COMPANY_SEASON_GATE_NON_CANONICAL';
  end if;
  if exists (
       select 1
       from pg_catalog.pg_proc gate_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           gate_proc.proacl,
           pg_catalog.acldefault('f', gate_proc.proowner)
         )
       ) gate_acl
       where gate_proc.oid = v_gate_oid
         and gate_acl.grantee = 0
         and gate_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_gate_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_gate_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_gate_oid, 'EXECUTE')
  then
    raise exception 'TZ315_PROCESSING_COMPANY_SEASON_GATE_EXPOSED';
  end if;
end;
$migration$;

-- A finalized processing-output ticket has two deliberately different
-- processing identities after the WIP handoff: its physical output/ledger
-- remains owned by the upstream transformation, while its current ticket link
-- and input row point at the downstream transformation. Keep that exception
-- private and exact so arbitrary cross-wired processing ids remain fail-closed.
create or replace function private.tz315_processing_wip_handoff_valid_v1(
  p_ticket_id uuid,
  p_upstream_transformation_id uuid,
  p_downstream_transformation_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_upstream public.batch_transformations%rowtype;
  v_downstream public.batch_transformations%rowtype;
  v_destination public.warehouses%rowtype;
  v_output public.batch_transformation_outputs%rowtype;
  v_output_batch public.inventory_batches%rowtype;
  v_line public.ticket_lines%rowtype;
  v_input public.batch_transformation_inputs%rowtype;
  v_output_count integer := 0;
  v_membership_count integer := 0;
  v_line_count integer := 0;
  v_input_count integer := 0;
  v_line_weight numeric := 0;
begin
  if p_ticket_id is null
     or p_upstream_transformation_id is null
     or p_downstream_transformation_id is null
     or p_upstream_transformation_id = p_downstream_transformation_id
  then
    return false;
  end if;

  select * into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id;
  if not found
     or not v_ticket.is_finalized
     or v_ticket.is_voided
     or v_ticket.status <> 'finalized'
     or v_ticket.source_kind <> 'processing_wip'
     or v_ticket.source_id is distinct from p_upstream_transformation_id::text
     or coalesce(v_ticket.processing_output_role, '') not in (
       'GRAIN', 'SCREENINGS', 'FEED', 'WASTE', 'TRIER_WASTE', 'OTHER'
     )
     or v_ticket.destination_kind <> 'warehouse'
     or v_ticket.batch_id is not null
     or v_ticket.warehouse_to_id is null
     or v_ticket.harvest_lot_id is null
     or v_ticket.season_id is null
     or nullif(btrim(coalesce(v_ticket.source_physical_state, '')), '') is null
     or coalesce(v_ticket.net_weight_kg, 0) <= 0
     or v_ticket.linked_processing_id is distinct from p_downstream_transformation_id
  then
    return false;
  end if;

  select * into v_upstream
  from public.batch_transformations transformation
  where transformation.id = p_upstream_transformation_id;
  if not found
     or v_upstream.company_id is distinct from v_ticket.company_id
     or v_upstream.season_id is distinct from v_ticket.season_id
     or v_upstream.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or v_upstream.node_warehouse_id is distinct from v_ticket.warehouse_from_id
     or upper(v_ticket.source_physical_state) is distinct from (case
       when v_ticket.processing_output_role = 'GRAIN'
            and v_upstream.transformation_type = 'drying'
         then 'AFTER_DRYING'
       when v_ticket.processing_output_role = 'GRAIN' then 'AFTER_CLEANING'
       when v_ticket.processing_output_role in ('SCREENINGS', 'FEED')
         then 'SCREENINGS'
       when v_ticket.processing_output_role = 'TRIER_WASTE' then 'TRIER_WASTE'
       else 'OTHER'
     end)
     or not (
       (
         v_upstream.status = 'draft'
         and v_upstream.processing_state in (
           'in_processing', 'processing_pending_outputs'
         )
       )
       or (
         v_upstream.status = 'completed'
         and v_upstream.processing_state = 'processing_closed'
       )
     )
  then
    return false;
  end if;

  select * into v_downstream
  from public.batch_transformations transformation
  where transformation.id = p_downstream_transformation_id;
  if not found
     or v_downstream.company_id is distinct from v_ticket.company_id
     or v_downstream.season_id is distinct from v_ticket.season_id
     or v_downstream.node_warehouse_id is distinct from v_ticket.warehouse_to_id
     or v_downstream.processing_node_id is distinct from v_ticket.processing_node_id
     or v_downstream.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or upper(coalesce(v_downstream.source_physical_state, 'SOURCE'))
        is distinct from upper(v_ticket.source_physical_state)
     or not coalesce(v_downstream.shadow_mode, false)
     or not (
       (
         v_downstream.status = 'draft'
         and v_downstream.processing_state in (
           'in_processing', 'processing_pending_outputs'
         )
       )
       or (
         v_downstream.status = 'completed'
         and v_downstream.processing_state = 'processing_closed'
       )
     )
  then
    return false;
  end if;

  select * into v_destination
  from public.warehouses warehouse
  where warehouse.id = v_ticket.warehouse_to_id;
  if not found
     or v_destination.company_id is distinct from v_ticket.company_id
     or coalesce(v_destination.archived, false)
     or coalesce(v_destination.is_archived, false)
     or upper(coalesce(v_destination.place_type, '')) not in ('DRYER', 'CLEANER')
     or v_downstream.transformation_type is distinct from (case
       when upper(v_destination.place_type) = 'CLEANER' then 'cleaning'
       else 'drying'
     end)
     or v_downstream.processing_method is distinct from (case
       when upper(v_destination.place_type) = 'CLEANER' then 'CLEANING'
       else 'MECHANICAL_DRYING'
     end)
  then
    return false;
  end if;

  select count(*)::integer into v_output_count
  from public.batch_transformation_outputs output
  where output.source_ticket_id = p_ticket_id;
  if v_output_count <> 1 then
    return false;
  end if;
  select * into v_output
  from public.batch_transformation_outputs output
  where output.source_ticket_id = p_ticket_id
    and output.transformation_id = p_upstream_transformation_id;
  if not found
     or v_output.company_id is distinct from v_ticket.company_id
     or v_output.output_batch_id is null
     or v_output.warehouse_to_id is distinct from v_ticket.warehouse_to_id
     or v_output.output_role is distinct from v_ticket.processing_output_role
     or upper(coalesce(v_output.physical_state, ''))
        is distinct from upper(v_ticket.source_physical_state)
     or coalesce(v_output.output_weight_kg, 0) <= 0
     or abs(v_output.output_weight_kg - v_ticket.net_weight_kg) > 0.001
     or not private.processing_output_ticket_trace_valid_v2(v_output.id)
     or exists (
       select 1
       from public.stock_ledger_entries ledger
       where ledger.ticket_id = p_ticket_id
         and (
           ledger.company_id is distinct from v_ticket.company_id
           or ledger.processing_id is distinct from p_upstream_transformation_id
         )
     )
  then
    return false;
  end if;

  select * into v_output_batch
  from public.inventory_batches batch
  where batch.id = v_output.output_batch_id;
  if not found
     or v_output_batch.company_id is distinct from v_ticket.company_id
     or v_output_batch.season_id is distinct from v_ticket.season_id
     or v_output_batch.source_ticket_id is distinct from p_ticket_id
     or v_output_batch.source_transformation_id is distinct from p_upstream_transformation_id
     or v_output_batch.warehouse_id is distinct from v_ticket.warehouse_to_id
     or upper(coalesce(v_output_batch.physical_state, 'SOURCE'))
        is distinct from upper(v_ticket.source_physical_state)
  then
    return false;
  end if;

  select count(*)::integer into v_membership_count
  from public.harvest_lot_batches membership
  where membership.inventory_batch_id = v_output.output_batch_id;
  if v_membership_count <> 1
     or not exists (
       select 1
       from public.harvest_lot_batches membership
       where membership.company_id = v_ticket.company_id
         and membership.harvest_lot_id = v_ticket.harvest_lot_id
         and membership.inventory_batch_id = v_output.output_batch_id
     )
  then
    return false;
  end if;

  select count(*)::integer into v_line_count
  from public.ticket_lines line
  where line.ticket_id = p_ticket_id;
  if v_line_count <> 1 then
    return false;
  end if;
  select * into v_line
  from public.ticket_lines line
  where line.ticket_id = p_ticket_id;
  v_line_weight := coalesce(
    v_line.net_line_weight_kg,
    v_line.quantity_kg,
    v_line.mass_kg,
    v_line.quantity
  );
  if coalesce(v_line_weight, 0) <= 0
     or v_line.company_id is distinct from v_ticket.company_id
     or v_line.warehouse_from_id is distinct from v_ticket.warehouse_from_id
     or v_line.warehouse_to_id is distinct from v_ticket.warehouse_to_id
     or coalesce(
       v_line.destination_batch_id::text,
       nullif(v_line.batch_id, '')
     ) is distinct from v_output.output_batch_id::text
     or abs(v_line_weight - v_output.output_weight_kg) > 0.001
  then
    return false;
  end if;

  select count(*)::integer into v_input_count
  from public.batch_transformation_inputs input
  where input.source_ticket_id = p_ticket_id;
  if v_input_count <> 1 then
    return false;
  end if;
  select * into v_input
  from public.batch_transformation_inputs input
  where input.source_ticket_id = p_ticket_id;
  if v_input.company_id is distinct from v_ticket.company_id
     or v_input.transformation_id is distinct from p_downstream_transformation_id
     or v_input.source_ticket_line_id is distinct from v_line.id
     or v_input.batch_id is distinct from v_output.output_batch_id
     or v_input.warehouse_from_id is distinct from v_ticket.warehouse_to_id
     or v_input.node_warehouse_id is distinct from v_ticket.warehouse_to_id
     or abs(v_input.input_weight_kg - v_output.output_weight_kg) > 0.001
  then
    return false;
  end if;

  return true;
end;
$function$;

alter function private.tz315_processing_wip_handoff_valid_v1(uuid, uuid, uuid)
  owner to postgres;
revoke all on function private.tz315_processing_wip_handoff_valid_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_processing_transformation_atomic_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_transformation_type text,
  p_processing_node_id uuid,
  p_source_ticket_id uuid,
  p_note text,
  p_input jsonb,
  p_outputs jsonb,
  p_input_quality_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_auth_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_auth_profile public.profiles%rowtype;
  v_actor_profile public.profiles%rowtype;
  v_impersonation public.global_admin_impersonation_contexts%rowtype;
  v_context_company_id uuid;
  v_selected_company_id uuid;
  v_transformation_type text := lower(nullif(pg_catalog.btrim(p_transformation_type), ''));
  v_processing_method text;
  v_processing_node_id uuid := p_processing_node_id;
  v_source_ticket_id uuid := p_source_ticket_id;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_outputs jsonb := coalesce(p_outputs, '[]'::jsonb);
  v_input_quality_json jsonb := case
    when pg_catalog.jsonb_typeof(coalesce(p_input_quality_json, '{}'::jsonb)) = 'object'
      then coalesce(p_input_quality_json, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_input_batch_id uuid;
  v_requested_lot_id uuid;
  v_canonical_lot_id uuid;
  v_input_warehouse_id uuid;
  v_input_weight_kg numeric(18,3);
  v_input_place_type text;
  v_source_physical_state text;
  v_canonical_season_id uuid;
  v_transformation_id uuid;
  v_constraint_name text;
  v_existing_ids uuid[];
  v_warehouse_ids uuid[];
  v_allocations jsonb := '[]'::jsonb;
  v_normalized_outputs jsonb := '[]'::jsonb;
  v_requested_output_graph jsonb := '[]'::jsonb;
  v_existing_output_graph jsonb := '[]'::jsonb;
  v_output_total_kg numeric := 0;
  v_existing_output_total_kg numeric := 0;
  v_available_kg numeric := 0;
  v_remaining_kg numeric := 0;
  v_take_kg numeric := 0;
  v_expected_inputs integer := 0;
  v_expected_outputs integer := 0;
  v_actual_inputs integer := 0;
  v_actual_outputs integer := 0;
  v_source_was_attached boolean := false;
  v_attached_input_total_kg numeric := 0;
  v_total_transformation_input_kg numeric := 0;
  v_locked_warehouse_count integer := 0;
  v_linked_batch_count integer := 0;
  v_output record;
  v_candidate record;
  v_allocation record;
  v_ticket public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_existing_transformation public.batch_transformations%rowtype;
  v_node public.processing_nodes%rowtype;
  v_warehouse public.warehouses%rowtype;
begin
  if p_company_id is null then
    raise exception 'PROCESSING_COMPANY_REQUIRED' using errcode = '22004';
  end if;
  if p_actor_user_id is null then
    raise exception 'PROCESSING_ACTOR_REQUIRED' using errcode = '22004';
  end if;

  if v_auth_user_id is null then
    raise exception 'PROCESSING_AUTH_SESSION_REQUIRED' using errcode = '42501';
  end if;
  select * into v_auth_profile
  from public.profiles profile
  where profile.id = v_auth_user_id
     or (
       v_auth_email <> ''
       and lower(coalesce(profile.email, '')) = v_auth_email
     )
  order by
    case when profile.id = v_auth_user_id then 0 else 1 end,
    case when coalesce(profile.status, 'active') = 'active' then 0 else 1 end,
    profile.id
  limit 1;
  if not found or coalesce(v_auth_profile.status, 'active') <> 'active' then
    raise exception 'PROCESSING_AUTH_PROFILE_INVALID' using errcode = '42501';
  end if;

  select * into v_impersonation
  from public.global_admin_impersonation_contexts impersonation
  where impersonation.admin_user_id in (v_auth_profile.id, v_auth_user_id)
  order by
    case when impersonation.admin_user_id = v_auth_profile.id then 0 else 1 end,
    impersonation.updated_at desc
  limit 1;

  select * into v_actor_profile
  from public.profiles profile
  where profile.id = p_actor_user_id
    and coalesce(profile.status, 'active') = 'active';
  if not found
     or v_actor_profile.role not in ('global_admin', 'company_admin', 'weighman')
  then
    raise exception 'PROCESSING_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;

  if v_impersonation.impersonated_profile_id is not null then
    if v_auth_profile.role <> 'global_admin'
       or p_actor_user_id is distinct from v_impersonation.impersonated_profile_id
       or v_actor_profile.company_id is distinct from p_company_id
       or coalesce(v_impersonation.impersonated_company_id, v_actor_profile.company_id)
          is distinct from p_company_id
    then
      raise exception 'PROCESSING_IMPERSONATION_CONTEXT_MISMATCH' using errcode = '42501';
    end if;
    v_selected_company_id := coalesce(
      v_impersonation.impersonated_company_id,
      v_actor_profile.company_id
    );
  else
    if p_actor_user_id is distinct from v_auth_profile.id then
      raise exception 'PROCESSING_ACTOR_SESSION_MISMATCH' using errcode = '42501';
    end if;
    if v_auth_profile.role = 'global_admin' then
      select context.company_id into v_context_company_id
      from public.global_admin_company_contexts context
      where context.user_id in (v_auth_profile.id, v_auth_user_id)
      order by
        case when context.user_id = v_auth_profile.id then 0 else 1 end
      limit 1;
      if v_context_company_id is distinct from p_company_id then
        raise exception 'PROCESSING_GLOBAL_COMPANY_CONTEXT_MISMATCH' using errcode = '42501';
      end if;
      v_selected_company_id := v_context_company_id;
    elsif v_actor_profile.company_id is distinct from p_company_id then
      raise exception 'PROCESSING_ACTOR_COMPANY_MISMATCH' using errcode = '42501';
    else
      v_selected_company_id := v_actor_profile.company_id;
    end if;
  end if;
  if v_selected_company_id is null
     or v_selected_company_id is distinct from p_company_id
  then
    raise exception 'PROCESSING_SELECTED_COMPANY_MISMATCH' using errcode = '42501';
  end if;

  if v_source_ticket_id is null then
    if v_transformation_type is null
       or v_transformation_type not in (
         'drying', 'cleaning', 'sorting', 'calibration', 'seed_treatment',
         'seed_selection', 'packaging', 'aeration', 'conditioning',
         'reclassification', 'potato_sorting', 'other'
       )
    then
      raise exception 'PROCESSING_TRANSFORMATION_TYPE_INVALID' using errcode = '22023';
    end if;
  end if;
  if pg_catalog.jsonb_typeof(v_input) <> 'object' then
    raise exception 'PROCESSING_INPUT_OBJECT_REQUIRED' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v_outputs) <> 'array'
     or pg_catalog.jsonb_array_length(v_outputs) > 32
     or (
       v_source_ticket_id is null
       and pg_catalog.jsonb_array_length(v_outputs) = 0
     )
  then
    raise exception 'PROCESSING_OUTPUTS_REQUIRED' using errcode = '22023';
  end if;

  begin
    v_input_batch_id := nullif(pg_catalog.btrim(v_input ->> 'batch_id'), '')::uuid;
    v_requested_lot_id := nullif(pg_catalog.btrim(v_input ->> 'harvest_lot_id'), '')::uuid;
    v_input_warehouse_id := nullif(pg_catalog.btrim(v_input ->> 'warehouse_from_id'), '')::uuid;
    v_input_weight_kg := round((v_input ->> 'input_weight_kg')::numeric, 3);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'PROCESSING_INPUT_SHAPE_INVALID' using errcode = '22023';
  end;

  if v_source_ticket_id is null then
    if (v_input_batch_id is null) = (v_requested_lot_id is null) then
      raise exception 'PROCESSING_ONE_SOURCE_IDENTITY_REQUIRED' using errcode = '22023';
    end if;
    if v_input_warehouse_id is null or coalesce(v_input_weight_kg, 0) <= 0 then
      raise exception 'PROCESSING_INPUT_DETAILS_REQUIRED' using errcode = '22023';
    end if;
    v_source_physical_state := upper(
      coalesce(nullif(pg_catalog.btrim(v_input ->> 'source_physical_state'), ''), 'SOURCE')
    );
    if v_source_physical_state not in (
      'SOURCE', 'AFTER_CLEANING', 'AFTER_DRYING', 'COMMODITY_GRAIN',
      'SCREENINGS', 'TRIER_WASTE', 'OTHER'
    ) then
      raise exception 'PROCESSING_SOURCE_PHYSICAL_STATE_INVALID' using errcode = '22023';
    end if;
  end if;

  for v_output in
    select value, ordinality::integer as position
    from pg_catalog.jsonb_array_elements(v_outputs) with ordinality
  loop
    declare
      v_line_type text := lower(nullif(pg_catalog.btrim(v_output.value ->> 'line_type'), ''));
      v_batch_class text := lower(coalesce(
        nullif(pg_catalog.btrim(v_output.value ->> 'batch_class'), ''),
        'commodity'
      ));
      v_output_warehouse_id uuid;
      v_output_weight_kg numeric(18,3);
      v_is_loss boolean;
      v_output_type text;
    begin
      begin
        v_output_warehouse_id := nullif(
          pg_catalog.btrim(v_output.value ->> 'warehouse_to_id'),
          ''
        )::uuid;
        v_output_weight_kg := round((v_output.value ->> 'output_weight_kg')::numeric, 3);
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'PROCESSING_OUTPUT_SHAPE_INVALID' using errcode = '22023';
      end;

      if v_line_type is null
         or v_line_type not in (
           'cleaned_seed', 'commodity', 'forage_fraction', 'waste_fraction',
           'soil', 'shrink_loss', 'process_loss', 'treated_seed',
           'calibrated_fraction', 'packaged', 'reclassified',
           'potato_marketable', 'potato_seed', 'potato_small',
           'potato_rotten', 'potato_soil', 'other'
         )
      then
        raise exception 'PROCESSING_OUTPUT_LINE_TYPE_INVALID' using errcode = '22023';
      end if;
      if v_batch_class not in (
        'commodity', 'seed', 'feed', 'waste', 'processing', 'rejected'
      ) then
        raise exception 'PROCESSING_OUTPUT_BATCH_CLASS_INVALID' using errcode = '22023';
      end if;
      if coalesce(v_output_weight_kg, 0) <= 0 then
        raise exception 'PROCESSING_OUTPUT_WEIGHT_INVALID' using errcode = '22023';
      end if;

      v_is_loss := v_line_type in ('shrink_loss', 'process_loss');
      v_output_type := case
        when v_line_type = 'shrink_loss' then 'moisture_loss'
        when v_line_type = 'process_loss' then 'process_loss'
        when v_batch_class = 'waste'
          or v_line_type in ('waste_fraction', 'soil', 'potato_rotten', 'potato_soil')
          then 'stock_waste'
        when v_line_type in ('forage_fraction', 'potato_small') then 'byproduct'
        else 'main_product'
      end;
      if v_is_loss and v_output_warehouse_id is not null then
        raise exception 'PROCESSING_LOSS_DESTINATION_FORBIDDEN' using errcode = '22023';
      end if;
      if not v_is_loss and v_output_warehouse_id is null then
        raise exception 'PROCESSING_STORED_OUTPUT_DESTINATION_REQUIRED' using errcode = '22023';
      end if;

      v_output_total_kg := v_output_total_kg + v_output_weight_kg;
      v_normalized_outputs := v_normalized_outputs || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'position', v_output.position,
          'line_type', v_line_type,
          'output_type', v_output_type,
          'batch_class', v_batch_class,
          'warehouse_to_id', v_output_warehouse_id,
          'output_weight_kg', v_output_weight_kg
        )
      );
    end;
  end loop;

  -- Output identity is an order-independent multiset. Every shared-cycle
  -- caller must describe the same normalized graph: later tickets may add
  -- inputs, but can neither replace nor duplicate the cycle outputs.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'line_type', output.value ->> 'line_type',
        'output_type', output.value ->> 'output_type',
        'batch_class', output.value ->> 'batch_class',
        'warehouse_to_id', nullif(output.value ->> 'warehouse_to_id', ''),
        'output_weight_kg', round((output.value ->> 'output_weight_kg')::numeric, 3)
      )
      order by
        output.value ->> 'line_type',
        output.value ->> 'output_type',
        output.value ->> 'batch_class',
        coalesce(output.value ->> 'warehouse_to_id', ''),
        round((output.value ->> 'output_weight_kg')::numeric, 3),
        (output.value ->> 'position')::integer
    ),
    '[]'::jsonb
  ) into v_requested_output_graph
  from pg_catalog.jsonb_array_elements(v_normalized_outputs) output;

  -- Read-only derivation of the canonical season.  The same state is re-read
  -- under row locks after the shared gate is acquired.
  if v_source_ticket_id is not null then
    select * into v_ticket
    from public.tickets
    where id = v_source_ticket_id
      and company_id = p_company_id;
    if not found
       or not v_ticket.is_finalized
       or v_ticket.is_voided
       or v_ticket.status <> 'finalized'
       or v_ticket.destination_kind not in ('warehouse', 'processing_node')
       or v_ticket.harvest_lot_id is null
       or v_ticket.warehouse_to_id is null
       or coalesce(v_ticket.net_weight_kg, 0) <= 0
    then
      raise exception 'PROCESSING_SOURCE_TICKET_UNAVAILABLE' using errcode = '23514';
    end if;

    select * into v_lot
    from public.harvest_lots lot
    where lot.id = v_ticket.harvest_lot_id
      and lot.company_id = p_company_id
      and lot.status = 'active';
    if not found or v_lot.season_id is null then
      raise exception 'PROCESSING_SOURCE_TICKET_LOT_UNAVAILABLE' using errcode = '23514';
    end if;

    v_canonical_season_id := v_lot.season_id;
    v_canonical_lot_id := v_ticket.harvest_lot_id;
    v_input_warehouse_id := v_ticket.warehouse_to_id;
    v_input_weight_kg := round(v_ticket.net_weight_kg, 3);
    v_processing_node_id := v_ticket.processing_node_id;
    v_source_physical_state := upper(coalesce(v_ticket.source_physical_state, 'SOURCE'));
  elsif v_requested_lot_id is not null then
    select * into v_lot
    from public.harvest_lots
    where id = v_requested_lot_id
      and company_id = p_company_id;
    if not found or v_lot.status <> 'active' or v_lot.season_id is null then
      raise exception 'PROCESSING_HARVEST_LOT_UNAVAILABLE' using errcode = '23514';
    end if;
    v_canonical_lot_id := v_lot.id;
    v_canonical_season_id := v_lot.season_id;
  else
    select * into v_batch
    from public.inventory_batches
    where id = v_input_batch_id
      and company_id = p_company_id;
    if not found or v_batch.season_id is null then
      raise exception 'PROCESSING_INPUT_BATCH_UNAVAILABLE' using errcode = '23514';
    end if;
    v_canonical_season_id := v_batch.season_id;
  end if;

  if v_canonical_season_id is null then
    raise exception 'PROCESSING_CANONICAL_SEASON_REQUIRED' using errcode = '22004';
  end if;
  if not exists (
    select 1
    from public.seasons season
    where season.id = v_canonical_season_id
      and season.company_id = p_company_id
      and not coalesce(season.archived, false)
  ) then
    raise exception 'PROCESSING_CANONICAL_SEASON_INVALID' using errcode = '23514';
  end if;

  -- Universal order boundary: this is intentionally the first lock and is
  -- acquired before every row lock and every write below.
  perform private.tz315_lock_company_season_write_gate_v1(
    p_company_id,
    v_canonical_season_id
  );

  perform 1
  from public.seasons season
  where season.id = v_canonical_season_id
    and season.company_id = p_company_id
    and not coalesce(season.archived, false)
  for key share;
  if not found then
    raise exception 'PROCESSING_CANONICAL_SEASON_CHANGED' using errcode = '40001';
  end if;

  if v_source_ticket_id is not null then
    select * into v_ticket
    from public.tickets
    where id = v_source_ticket_id
      and company_id = p_company_id
    for update;
    if not found
       or not v_ticket.is_finalized
       or v_ticket.is_voided
       or v_ticket.status <> 'finalized'
       or v_ticket.destination_kind not in ('warehouse', 'processing_node')
       or v_ticket.harvest_lot_id is null
       or v_ticket.warehouse_to_id is null
       or coalesce(v_ticket.net_weight_kg, 0) <= 0
    then
      raise exception 'PROCESSING_SOURCE_TICKET_CHANGED' using errcode = '40001';
    end if;
    if v_ticket.season_id is not null
       and v_ticket.season_id is distinct from v_canonical_season_id
    then
      raise exception 'PROCESSING_SOURCE_TICKET_SEASON_CHANGED' using errcode = '40001';
    end if;
    if v_ticket.harvest_lot_id is distinct from v_canonical_lot_id then
      raise exception 'PROCESSING_SOURCE_TICKET_LOT_CHANGED' using errcode = '40001';
    end if;

    select array_agg(distinct existing_id order by existing_id)
      into v_existing_ids
    from (
      select t.id as existing_id
      from public.batch_transformations t
      where t.source_ticket_id = v_source_ticket_id
      union
      select i.transformation_id
      from public.batch_transformation_inputs i
      where i.source_ticket_id = v_source_ticket_id
      union
      select v_ticket.linked_processing_id
      where v_ticket.linked_processing_id is not null
    ) existing;
    if coalesce(cardinality(v_existing_ids), 0) > 1 then
      raise exception 'PROCESSING_SOURCE_TICKET_AMBIGUOUS' using errcode = '23514';
    end if;
    v_source_was_attached := exists (
      select 1
      from public.batch_transformation_inputs input_row
      where input_row.source_ticket_id = v_source_ticket_id
    );
    v_canonical_lot_id := v_ticket.harvest_lot_id;
    v_input_warehouse_id := v_ticket.warehouse_to_id;
    v_input_weight_kg := round(v_ticket.net_weight_kg, 3);
    v_processing_node_id := v_ticket.processing_node_id;
    v_source_physical_state := upper(coalesce(v_ticket.source_physical_state, 'SOURCE'));
  end if;

  if v_canonical_lot_id is not null then
    select * into v_lot
    from public.harvest_lots
    where id = v_canonical_lot_id
      and company_id = p_company_id
    for update;
    if not found
       or v_lot.status <> 'active'
       or v_lot.season_id is distinct from v_canonical_season_id
    then
      raise exception 'PROCESSING_HARVEST_LOT_CHANGED' using errcode = '40001';
    end if;
  end if;

  select array_agg(distinct warehouse_id order by warehouse_id)
    into v_warehouse_ids
  from (
    select v_input_warehouse_id as warehouse_id
    union all
    select nullif(output.value ->> 'warehouse_to_id', '')::uuid
    from pg_catalog.jsonb_array_elements(v_normalized_outputs) output
    where nullif(output.value ->> 'warehouse_to_id', '') is not null
  ) warehouse_ids
  where warehouse_id is not null;

  perform 1
  from public.warehouses warehouse
  where warehouse.id = any(v_warehouse_ids)
  order by warehouse.id
  for key share;
  select count(*)::integer into v_locked_warehouse_count
  from public.warehouses warehouse
  where warehouse.id = any(v_warehouse_ids)
    and warehouse.company_id = p_company_id;
  if v_locked_warehouse_count <> cardinality(v_warehouse_ids) then
    raise exception 'PROCESSING_WAREHOUSE_COMPANY_MISMATCH' using errcode = '42501';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = v_input_warehouse_id
    and company_id = p_company_id;
  if not found
     or coalesce(v_warehouse.archived, false)
     or coalesce(v_warehouse.is_archived, false)
     or lower(coalesce(v_warehouse.warehouse_type, '')) not in (
       'grain', 'seed', 'vegetable', 'potato_storage', 'universal', 'temporary'
     )
  then
    raise exception 'PROCESSING_INPUT_WAREHOUSE_UNAVAILABLE' using errcode = '23514';
  end if;
  v_input_place_type := upper(coalesce(v_warehouse.place_type, ''));
  if v_source_ticket_id is not null then
    -- The live destination is the only canonical method/type authority.  A
    -- legacy client may still send a stale or malformed type, but it can never
    -- override the physical CLEANER/DRYER/YARD contract.
    v_transformation_type := case v_input_place_type
      when 'CLEANER' then 'cleaning'
      when 'DRYER' then 'drying'
      when 'YARD' then 'drying'
      else null
    end;
    v_processing_method := case v_input_place_type
      when 'CLEANER' then 'CLEANING'
      when 'DRYER' then 'MECHANICAL_DRYING'
      when 'YARD' then 'NATURAL_DRYING'
      else null
    end;
    if v_transformation_type is null then
      raise exception 'PROCESSING_SOURCE_TICKET_DESTINATION_TYPE_INVALID' using errcode = '23514';
    end if;
  end if;

  if v_processing_node_id is not null then
    select * into v_node
    from public.processing_nodes
    where id = v_processing_node_id
      and company_id = p_company_id
    for key share;
    if not found
       or not coalesce(v_node.is_active, true)
       or coalesce(v_node.archived, false)
       or (
         v_node.linked_warehouse_id is not null
         and v_node.linked_warehouse_id is distinct from v_input_warehouse_id
       )
    then
      raise exception 'PROCESSING_NODE_UNAVAILABLE' using errcode = '23514';
    end if;
  end if;

  for v_output in
    select value
    from pg_catalog.jsonb_array_elements(v_normalized_outputs)
    where nullif(value ->> 'warehouse_to_id', '') is not null
  loop
    select * into v_warehouse
    from public.warehouses
    where id = (v_output.value ->> 'warehouse_to_id')::uuid
      and company_id = p_company_id;
    if not found
       or coalesce(v_warehouse.archived, false)
       or coalesce(v_warehouse.is_archived, false)
       or lower(coalesce(v_warehouse.warehouse_type, '')) not in (
         'grain', 'seed', 'vegetable', 'potato_storage', 'universal', 'temporary'
       )
    then
      raise exception 'PROCESSING_OUTPUT_WAREHOUSE_UNAVAILABLE' using errcode = '23514';
    end if;
  end loop;

  if v_source_ticket_id is not null then
    -- An already attached ticket is replay-only.  This preserves historical
    -- YARD/non-null-node graphs without letting this authenticated boundary
    -- mutate or re-route them.  Any partial identity is fail-closed.
    if v_source_was_attached then
      if coalesce(cardinality(v_existing_ids), 0) <> 1 then
        raise exception 'PROCESSING_SOURCE_TICKET_LINEAGE_INCOMPLETE' using errcode = '23514';
      end if;
      v_transformation_id := v_existing_ids[1];
    elsif coalesce(cardinality(v_existing_ids), 0) > 0 then
      raise exception 'PROCESSING_SOURCE_TICKET_LINEAGE_INCOMPLETE' using errcode = '23514';
    else
      -- New route tickets must pass the canonical DRYER/CLEANER and crop guard.
      -- In particular, raw attach would incorrectly admit YARD and vegetables.
      -- The universal company+season gate above is deliberately acquired before
      -- this call, so its inner row/context locks cannot race another writer.
      v_transformation_id := public.attach_route_processing_input_ticket_v1(
        v_source_ticket_id
      );
    end if;
    if v_transformation_id is null then
      raise exception 'PROCESSING_SOURCE_TICKET_ATTACH_REJECTED' using errcode = '23514';
    end if;
    if coalesce(cardinality(v_existing_ids), 0) = 1
       and v_existing_ids[1] is distinct from v_transformation_id
    then
      raise exception 'PROCESSING_SOURCE_TICKET_LINEAGE_CONFLICT' using errcode = '23514';
    end if;

    select * into v_existing_transformation
    from public.batch_transformations transformation
    where transformation.id = v_transformation_id
    for update;
    if not found
       or v_existing_transformation.company_id is distinct from p_company_id
       or v_existing_transformation.season_id is distinct from v_canonical_season_id
       or v_existing_transformation.node_warehouse_id is distinct from v_input_warehouse_id
       or v_existing_transformation.processing_node_id is distinct from v_processing_node_id
       or v_existing_transformation.harvest_lot_id is distinct from v_canonical_lot_id
       or upper(coalesce(v_existing_transformation.source_physical_state, 'SOURCE'))
          is distinct from v_source_physical_state
       or v_existing_transformation.transformation_type is distinct from v_transformation_type
       or (
         v_input_place_type in ('DRYER', 'CLEANER')
         and (
           not coalesce(v_existing_transformation.shadow_mode, false)
           or v_existing_transformation.processing_method is distinct from v_processing_method
         )
       )
       or not (
         (
           v_existing_transformation.status = 'draft'
           and v_existing_transformation.processing_state in (
             'in_processing', 'processing_pending_outputs'
           )
         )
         or (
           v_existing_transformation.status = 'completed'
           and v_existing_transformation.processing_state = 'processing_closed'
         )
       )
       or v_existing_transformation.source_ticket_id is null
       or not exists (
         select 1
         from public.batch_transformation_inputs header_input
         join public.tickets header_ticket
           on header_ticket.id = header_input.source_ticket_id
          and header_ticket.company_id = p_company_id
          and header_ticket.linked_processing_id = v_transformation_id
         where header_input.company_id = p_company_id
           and header_input.transformation_id = v_transformation_id
           and header_input.source_ticket_id = v_existing_transformation.source_ticket_id
       )
    then
      raise exception 'PROCESSING_SOURCE_TICKET_ATTACHED_CONTEXT_INVALID' using errcode = '23514';
    end if;

    -- The schema uses single-column FKs, so prove every row in the shared graph
    -- belongs to the same tenant and physical lot instead of filtering corrupt
    -- foreign rows out of the later aggregates.
    if exists (
         select 1
         from public.batch_transformation_inputs shared_input
         left join public.inventory_batches shared_batch
           on shared_batch.id = shared_input.batch_id
         left join public.tickets shared_ticket
           on shared_ticket.id = shared_input.source_ticket_id
         left join public.ticket_lines shared_line
           on shared_line.id = shared_input.source_ticket_line_id
          and shared_line.ticket_id = shared_input.source_ticket_id
         where shared_input.transformation_id = v_transformation_id
           and (
             shared_input.company_id is distinct from p_company_id
             or shared_input.source_ticket_id is null
             or shared_line.id is null
             or shared_ticket.company_id is distinct from p_company_id
             or shared_ticket.linked_processing_id is distinct from v_transformation_id
             or not shared_ticket.is_finalized
             or shared_ticket.is_voided
             or shared_ticket.status <> 'finalized'
             or shared_ticket.destination_kind not in ('warehouse', 'processing_node')
             or shared_ticket.harvest_lot_id is distinct from v_canonical_lot_id
             or shared_ticket.warehouse_to_id is distinct from v_input_warehouse_id
             or shared_ticket.processing_node_id is distinct from v_processing_node_id
             or coalesce(shared_ticket.net_weight_kg, 0) <= 0
             or (
               shared_ticket.season_id is not null
               and shared_ticket.season_id is distinct from v_canonical_season_id
             )
             or upper(coalesce(shared_ticket.source_physical_state, 'SOURCE'))
                is distinct from v_source_physical_state
             or shared_batch.id is null
             or shared_batch.company_id is distinct from p_company_id
             or (
               shared_batch.season_id is not null
               and shared_batch.season_id is distinct from v_canonical_season_id
             )
             or shared_input.warehouse_from_id is distinct from v_input_warehouse_id
             or shared_input.node_warehouse_id is distinct from v_input_warehouse_id
             or coalesce(shared_input.input_weight_kg, 0) <= 0
             or shared_input.batch_id is distinct from coalesce(
               shared_line.destination_batch_id::text,
               nullif(shared_line.batch_id, '')
             )::uuid
             or abs(
               shared_input.input_weight_kg - coalesce(
                 shared_line.net_line_weight_kg,
                 shared_line.quantity_kg,
                 shared_line.mass_kg,
                 shared_line.quantity
               )
             ) > 0.001
             or (
               select count(*)
               from public.ticket_lines expected_line
               where expected_line.ticket_id = shared_ticket.id
             ) <> (
               select count(*)
               from public.batch_transformation_inputs ticket_input
               where ticket_input.company_id = p_company_id
                 and ticket_input.transformation_id = v_transformation_id
                 and ticket_input.source_ticket_id = shared_ticket.id
             )
             or abs(
               coalesce((
                 select sum(coalesce(
                   expected_line.net_line_weight_kg,
                   expected_line.quantity_kg,
                   expected_line.mass_kg,
                   expected_line.quantity
                 ))
                 from public.ticket_lines expected_line
                 where expected_line.ticket_id = shared_ticket.id
               ), 0) - coalesce((
                 select sum(ticket_input.input_weight_kg)
                 from public.batch_transformation_inputs ticket_input
                 where ticket_input.company_id = p_company_id
                   and ticket_input.transformation_id = v_transformation_id
                   and ticket_input.source_ticket_id = shared_ticket.id
               ), 0)
             ) > 0.001
             or abs(
               shared_ticket.net_weight_kg - coalesce((
                 select sum(ticket_input.input_weight_kg)
                 from public.batch_transformation_inputs ticket_input
                 where ticket_input.company_id = p_company_id
                   and ticket_input.transformation_id = v_transformation_id
                   and ticket_input.source_ticket_id = shared_ticket.id
               ), 0)
             ) > 0.001
             or not exists (
               select 1
               from public.harvest_lot_batches shared_membership
               where shared_membership.company_id = p_company_id
                 and shared_membership.harvest_lot_id = v_canonical_lot_id
                 and shared_membership.inventory_batch_id = shared_input.batch_id
             )
           )
       )
       or exists (
         select 1
         from (
           select distinct shared_input.source_ticket_id as ticket_id
           from public.batch_transformation_inputs shared_input
           where shared_input.transformation_id = v_transformation_id
             and shared_input.source_ticket_id is not null
         ) shared_input_ticket
         join public.stock_ledger_entries shared_ledger
           on shared_ledger.ticket_id = shared_input_ticket.ticket_id
         where shared_ledger.company_id is distinct from p_company_id
            or (
              shared_ledger.processing_id is not null
              and shared_ledger.processing_id is distinct from v_transformation_id
              and not private.tz315_processing_wip_handoff_valid_v1(
                shared_ledger.ticket_id,
                shared_ledger.processing_id,
                v_transformation_id
              )
            )
       )
       or exists (
         select 1
         from public.tickets linked_shared_ticket
         where linked_shared_ticket.linked_processing_id = v_transformation_id
           and not exists (
             select 1
             from public.batch_transformation_inputs linked_input
             where linked_input.transformation_id = v_transformation_id
               and linked_input.source_ticket_id = linked_shared_ticket.id
           )
           and not exists (
             select 1
             from public.batch_transformation_outputs linked_output
             where linked_output.transformation_id = v_transformation_id
               and linked_output.source_ticket_id = linked_shared_ticket.id
           )
       )
       or exists (
         select 1
         from public.batch_transformation_outputs shared_output
         left join public.warehouses shared_destination
           on shared_destination.id = shared_output.warehouse_to_id
         left join public.tickets shared_output_ticket
           on shared_output_ticket.id = shared_output.source_ticket_id
         left join public.inventory_batches shared_output_batch
           on shared_output_batch.id = shared_output.output_batch_id
         where shared_output.transformation_id = v_transformation_id
           and (
             shared_output.company_id is distinct from p_company_id
             or coalesce(shared_output.output_weight_kg, 0) <= 0
             or shared_output.line_type not in (
               'cleaned_seed', 'commodity', 'forage_fraction', 'waste_fraction',
               'soil', 'shrink_loss', 'process_loss', 'treated_seed',
               'calibrated_fraction', 'packaged', 'reclassified',
               'potato_marketable', 'potato_seed', 'potato_small',
               'potato_rotten', 'potato_soil', 'other'
             )
             or coalesce(shared_output.batch_class, 'commodity') not in (
               'commodity', 'seed', 'feed', 'waste', 'processing', 'rejected'
             )
             or shared_output.output_type is distinct from case
               when shared_output.line_type = 'shrink_loss' then 'moisture_loss'
               when shared_output.line_type = 'process_loss' then 'process_loss'
               when coalesce(shared_output.batch_class, 'commodity') = 'waste'
                 or shared_output.line_type in (
                   'waste_fraction', 'soil', 'potato_rotten', 'potato_soil'
                 ) then 'stock_waste'
               when shared_output.line_type in ('forage_fraction', 'potato_small')
                 then 'byproduct'
               else 'main_product'
             end
             or (
               shared_output.line_type in ('shrink_loss', 'process_loss')
               and shared_output.warehouse_to_id is not null
             )
             or (
               shared_output.line_type not in ('shrink_loss', 'process_loss')
               and (
                 shared_output.warehouse_to_id is null
                 or shared_destination.id is null
                 or shared_destination.company_id is distinct from p_company_id
                 or coalesce(shared_destination.archived, false)
                 or coalesce(shared_destination.is_archived, false)
                 or lower(coalesce(shared_destination.warehouse_type, '')) not in (
                   'grain', 'seed', 'vegetable', 'potato_storage', 'universal', 'temporary'
                 )
               )
             )
             or (
               shared_output.source_ticket_id is not null
               and (
                 shared_output_ticket.id is null
                 or shared_output_ticket.company_id is distinct from p_company_id
                 or shared_output_ticket.season_id is distinct from v_canonical_season_id
                or (
                  shared_output_ticket.linked_processing_id is distinct from v_transformation_id
                  and not private.tz315_processing_wip_handoff_valid_v1(
                    shared_output_ticket.id,
                    v_transformation_id,
                    shared_output_ticket.linked_processing_id
                  )
                )
                 or not shared_output_ticket.is_finalized
                 or shared_output_ticket.is_voided
                 or shared_output_ticket.status <> 'finalized'
                 or shared_output.output_batch_id is null
                 or shared_output_batch.id is null
                 or shared_output_batch.company_id is distinct from p_company_id
                 or shared_output_batch.season_id is distinct from v_canonical_season_id
                 or not private.processing_output_ticket_trace_valid_v2(shared_output.id)
               )
             )
           )
       )
    then
      raise exception 'PROCESSING_SOURCE_TICKET_SHARED_GRAPH_INVALID' using errcode = '23514';
    end if;

    select count(*)::integer, coalesce(sum(input_row.input_weight_kg), 0)
      into v_actual_inputs, v_attached_input_total_kg
    from public.batch_transformation_inputs input_row
    where input_row.source_ticket_id = v_source_ticket_id;
    if v_actual_inputs < 1
       or abs(v_attached_input_total_kg - v_input_weight_kg) > 0.001
       or not exists (
         select 1 from public.ticket_lines source_line
         where source_line.ticket_id = v_source_ticket_id
       )
       or exists (
         select 1
         from public.ticket_lines source_line
         where source_line.ticket_id = v_source_ticket_id
           and (
             coalesce(
               source_line.net_line_weight_kg,
               source_line.quantity_kg,
               source_line.mass_kg,
               source_line.quantity
             ) <= 0
             or (
               select count(*)
               from public.batch_transformation_inputs exact_input
               where exact_input.company_id = p_company_id
                 and exact_input.transformation_id = v_transformation_id
                 and exact_input.source_ticket_id = v_source_ticket_id
                 and exact_input.source_ticket_line_id = source_line.id
                 and exact_input.batch_id = coalesce(
                   source_line.destination_batch_id::text,
                   nullif(source_line.batch_id, '')
                 )::uuid
                 and abs(
                   exact_input.input_weight_kg - coalesce(
                     source_line.net_line_weight_kg,
                     source_line.quantity_kg,
                     source_line.mass_kg,
                     source_line.quantity
                   )
                 ) <= 0.001
             ) <> 1
           )
       )
       or exists (
         select 1
         from public.batch_transformation_inputs input_row
         left join public.ticket_lines source_line
           on source_line.id = input_row.source_ticket_line_id
          and source_line.ticket_id = v_source_ticket_id
         left join public.inventory_batches batch
           on batch.id = input_row.batch_id
         where input_row.source_ticket_id = v_source_ticket_id
           and (
             source_line.id is null
             or input_row.company_id is distinct from p_company_id
             or input_row.transformation_id is distinct from v_transformation_id
             or input_row.batch_id is distinct from coalesce(
               source_line.destination_batch_id::text,
               nullif(source_line.batch_id, '')
             )::uuid
             or abs(
               input_row.input_weight_kg - coalesce(
                 source_line.net_line_weight_kg,
                 source_line.quantity_kg,
                 source_line.mass_kg,
                 source_line.quantity
               )
             ) > 0.001
             or input_row.warehouse_from_id is distinct from v_input_warehouse_id
             or input_row.node_warehouse_id is distinct from v_input_warehouse_id
             or batch.id is null
             or batch.company_id is distinct from p_company_id
             or batch.physical_state is distinct from v_source_physical_state
             or (
               batch.season_id is not null
               and batch.season_id is distinct from v_canonical_season_id
             )
             or not exists (
               select 1
               from public.harvest_lot_batches source_membership
               where source_membership.company_id = p_company_id
                 and source_membership.harvest_lot_id = v_canonical_lot_id
                 and source_membership.inventory_batch_id = input_row.batch_id
             )
           )
       )
    then
      raise exception 'PROCESSING_SOURCE_TICKET_INPUT_GRAPH_INVALID' using errcode = '23514';
    end if;
    if not exists (
         select 1
         from public.tickets linked_ticket
         where linked_ticket.id = v_source_ticket_id
           and linked_ticket.company_id = p_company_id
           and linked_ticket.linked_processing_id = v_transformation_id
       )
       or exists (
         select 1
         from public.batch_transformation_outputs output_row
         where output_row.source_ticket_id = v_source_ticket_id
           and (
             output_row.company_id is distinct from p_company_id
             or (
               output_row.transformation_id is distinct from v_transformation_id
               and not private.tz315_processing_wip_handoff_valid_v1(
                 v_source_ticket_id,
                 output_row.transformation_id,
                 v_transformation_id
               )
             )
           )
       )
       or exists (
         select 1
         from public.stock_ledger_entries ledger
         where ledger.ticket_id = v_source_ticket_id
           and ledger.processing_id is not null
           and (
             ledger.company_id is distinct from p_company_id
             or (
               ledger.processing_id is distinct from v_transformation_id
               and not private.tz315_processing_wip_handoff_valid_v1(
                 v_source_ticket_id,
                 ledger.processing_id,
                 v_transformation_id
               )
             )
           )
       )
    then
      raise exception 'PROCESSING_SOURCE_TICKET_LINK_GRAPH_INVALID' using errcode = '23514';
    end if;

    select count(*)::integer into v_actual_outputs
    from public.batch_transformation_outputs output_row
    where output_row.company_id = p_company_id
      and output_row.transformation_id = v_transformation_id;
    if v_actual_outputs = 0
       and pg_catalog.jsonb_array_length(v_normalized_outputs) > 0
    then
      if v_existing_transformation.status <> 'draft'
         or v_existing_transformation.processing_state <> 'in_processing'
         or not coalesce(v_existing_transformation.shadow_mode, false)
         or v_existing_transformation.processing_method is distinct from v_processing_method
      then
        raise exception 'PROCESSING_SOURCE_TICKET_CYCLE_READ_ONLY' using errcode = '23514';
      end if;
      select coalesce(sum(input_row.input_weight_kg), 0)
        into v_total_transformation_input_kg
      from public.batch_transformation_inputs input_row
      where input_row.company_id = p_company_id
        and input_row.transformation_id = v_transformation_id;
      if v_output_total_kg > v_total_transformation_input_kg + 0.0001 then
        raise exception 'PROCESSING_OUTPUT_EXCEEDS_INPUT' using errcode = '23514';
      end if;

      for v_output in
        select value
        from pg_catalog.jsonb_array_elements(v_normalized_outputs)
        order by (value ->> 'position')::integer
      loop
        insert into public.batch_transformation_outputs(
          company_id,
          transformation_id,
          warehouse_to_id,
          line_type,
          output_weight_kg,
          output_quality_json,
          batch_class,
          output_type
        ) values (
          p_company_id,
          v_transformation_id,
          nullif(v_output.value ->> 'warehouse_to_id', '')::uuid,
          v_output.value ->> 'line_type',
          (v_output.value ->> 'output_weight_kg')::numeric,
          '{}'::jsonb,
          v_output.value ->> 'batch_class',
          v_output.value ->> 'output_type'
        );
      end loop;
    end if;

    select count(*)::integer,
           coalesce(sum(output_row.output_weight_kg), 0),
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'line_type', lower(output_row.line_type),
                 'output_type', lower(output_row.output_type),
                 'batch_class', lower(coalesce(output_row.batch_class, 'commodity')),
                 'warehouse_to_id', output_row.warehouse_to_id::text,
                 'output_weight_kg', round(output_row.output_weight_kg, 3)
               )
               order by
                 lower(output_row.line_type),
                 lower(output_row.output_type),
                 lower(coalesce(output_row.batch_class, 'commodity')),
                 coalesce(output_row.warehouse_to_id::text, ''),
                 round(output_row.output_weight_kg, 3),
                 output_row.id
             ),
             '[]'::jsonb
           )
      into v_actual_outputs, v_existing_output_total_kg, v_existing_output_graph
    from public.batch_transformation_outputs output_row
    where output_row.company_id = p_company_id
      and output_row.transformation_id = v_transformation_id;
    if pg_catalog.jsonb_array_length(v_normalized_outputs) > 0
       and v_existing_output_graph is distinct from v_requested_output_graph
    then
      raise exception 'PROCESSING_SOURCE_TICKET_OUTPUT_GRAPH_CONFLICT' using errcode = '23514';
    end if;
    select coalesce(sum(input_row.input_weight_kg), 0)
      into v_total_transformation_input_kg
    from public.batch_transformation_inputs input_row
    where input_row.company_id = p_company_id
      and input_row.transformation_id = v_transformation_id;
    if v_existing_output_total_kg > v_total_transformation_input_kg + 0.0001 then
      raise exception 'PROCESSING_OUTPUT_EXCEEDS_INPUT' using errcode = '23514';
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_transformation_id,
      'idempotent_replay', v_source_was_attached
    );
  end if;

  if v_requested_lot_id is not null and v_source_ticket_id is null then
    -- The universal gate also wraps lot reassignment. Lock the exact membership
    -- rows before their inventory batches and re-read the identity under lock;
    -- a move-out can therefore never commit a stale lot allocation.
    perform 1
    from public.harvest_lot_batches link
    where link.company_id = p_company_id
      and link.harvest_lot_id = v_requested_lot_id
    order by link.id
    for update;

    perform 1
    from public.inventory_batches batch
    join public.harvest_lot_batches link
      on link.inventory_batch_id = batch.id
     and link.harvest_lot_id = v_requested_lot_id
     and link.company_id = p_company_id
    where batch.company_id = p_company_id
    order by batch.id
    for update of batch;

    select count(distinct link.inventory_batch_id)::integer
      into v_linked_batch_count
    from public.harvest_lot_batches link
    where link.company_id = p_company_id
      and link.harvest_lot_id = v_requested_lot_id;
    if v_linked_batch_count = 0 then
      raise exception 'PROCESSING_HARVEST_LOT_BATCHES_MISSING' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.harvest_lot_batches link
      left join public.inventory_batches batch
        on batch.id = link.inventory_batch_id
      where link.company_id = p_company_id
        and link.harvest_lot_id = v_requested_lot_id
        and (
          batch.id is null
          or batch.company_id is distinct from p_company_id
        )
    ) then
      raise exception 'PROCESSING_HARVEST_LOT_MEMBERSHIP_CHANGED' using errcode = '40001';
    end if;
    if exists (
      select 1
      from public.harvest_lot_batches link
      join public.inventory_batches batch on batch.id = link.inventory_batch_id
      where link.company_id = p_company_id
        and link.harvest_lot_id = v_requested_lot_id
        and batch.company_id = p_company_id
        and batch.season_id is not null
        and batch.season_id is distinct from v_canonical_season_id
    ) then
      raise exception 'PROCESSING_BATCH_SEASON_MISMATCH' using errcode = '23514';
    end if;

    v_remaining_kg := v_input_weight_kg;
    for v_candidate in
      select batch.*,
             coalesce((
               select sum(balance.effective_available_kg)
               from public.v_effective_stock_balance_identity_v1 balance
               where balance.company_id = p_company_id
                 and balance.warehouse_id = v_input_warehouse_id
                 and balance.batch_id = batch.id::text
                 and balance.uom = 'kg'
             ), 0) as available_kg
      from public.inventory_batches batch
      join public.harvest_lot_batches link
        on link.inventory_batch_id = batch.id
       and link.harvest_lot_id = v_requested_lot_id
       and link.company_id = p_company_id
      where batch.company_id = p_company_id
        and batch.physical_state = v_source_physical_state
      order by coalesce(batch.received_at, batch.created_at), batch.id
    loop
      if v_candidate.season_id is not null
         and v_candidate.season_id is distinct from v_canonical_season_id
      then
        raise exception 'PROCESSING_BATCH_SEASON_MISMATCH' using errcode = '23514';
      end if;
      if v_remaining_kg <= 0.0001 then
        exit;
      end if;
      v_take_kg := least(v_remaining_kg, coalesce(v_candidate.available_kg, 0));
      if v_take_kg > 0 then
        v_allocations := v_allocations || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'batch_id', v_candidate.id,
            'input_weight_kg', round(v_take_kg, 3)
          )
        );
        v_remaining_kg := round(v_remaining_kg - v_take_kg, 3);
      end if;
    end loop;
    if v_remaining_kg > 0.0001 then
      raise exception 'PROCESSING_INSUFFICIENT_EFFECTIVE_STOCK:%', v_remaining_kg
        using errcode = '23514';
    end if;
  else
    select * into v_batch
    from public.inventory_batches
    where id = v_input_batch_id
      and company_id = p_company_id
    for update;
    if not found
       or (v_batch.season_id is not null and v_batch.season_id is distinct from v_canonical_season_id)
       or v_batch.physical_state is distinct from v_source_physical_state
    then
      raise exception 'PROCESSING_INPUT_BATCH_CHANGED' using errcode = '40001';
    end if;
    if exists (
      select 1
      from public.harvest_lot_batches membership
      where membership.inventory_batch_id = v_input_batch_id
    ) then
      raise exception 'PROCESSING_BATCH_CANONICAL_LOT_REQUIRED' using errcode = '23514';
    end if;

    select coalesce(sum(balance.effective_available_kg), 0)
      into v_available_kg
    from public.v_effective_stock_balance_identity_v1 balance
    where balance.company_id = p_company_id
      and balance.warehouse_id = v_input_warehouse_id
      and balance.batch_id = v_input_batch_id::text
      and balance.uom = 'kg';
    if v_available_kg + 0.0001 < v_input_weight_kg then
      raise exception 'PROCESSING_INSUFFICIENT_EFFECTIVE_STOCK:%',
        round(v_input_weight_kg - v_available_kg, 3)
        using errcode = '23514';
    end if;
    v_allocations := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'batch_id', v_input_batch_id,
        'input_weight_kg', v_input_weight_kg
      )
    );
  end if;

  if v_output_total_kg > v_input_weight_kg + 0.0001 then
    raise exception 'PROCESSING_OUTPUT_EXCEEDS_INPUT' using errcode = '23514';
  end if;

  v_transformation_id := gen_random_uuid();
  begin
    insert into public.batch_transformations(
      id,
      company_id,
      season_id,
      node_warehouse_id,
      processing_node_id,
      transformation_type,
      status,
      source_ticket_id,
      harvest_lot_id,
      source_physical_state,
      started_at,
      created_by,
      note
    ) values (
      v_transformation_id,
      p_company_id,
      v_canonical_season_id,
      v_input_warehouse_id,
      v_processing_node_id,
      v_transformation_type,
      'draft',
      null,
      v_canonical_lot_id,
      v_source_physical_state,
      statement_timestamp(),
      p_actor_user_id,
      v_note
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'uq_batch_transformations_active_identity_v1' then
        raise exception 'PROCESSING_ACTIVE_CYCLE_EXISTS'
          using errcode = '23505', constraint = v_constraint_name;
      end if;
      raise;
  end;

  v_expected_inputs := pg_catalog.jsonb_array_length(v_allocations);
  for v_allocation in
    select value
    from pg_catalog.jsonb_array_elements(v_allocations)
  loop
    insert into public.batch_transformation_inputs(
      company_id,
      transformation_id,
      batch_id,
      warehouse_from_id,
      input_weight_kg,
      input_quality_json,
      source_ticket_id,
      node_warehouse_id
    ) values (
      p_company_id,
      v_transformation_id,
      (v_allocation.value ->> 'batch_id')::uuid,
      v_input_warehouse_id,
      (v_allocation.value ->> 'input_weight_kg')::numeric,
      v_input_quality_json,
      null,
      v_input_warehouse_id
    );
  end loop;

  v_expected_outputs := pg_catalog.jsonb_array_length(v_normalized_outputs);
  for v_output in
    select value
    from pg_catalog.jsonb_array_elements(v_normalized_outputs)
    order by (value ->> 'position')::integer
  loop
    insert into public.batch_transformation_outputs(
      company_id,
      transformation_id,
      warehouse_to_id,
      line_type,
      output_weight_kg,
      output_quality_json,
      batch_class,
      output_type
    ) values (
      p_company_id,
      v_transformation_id,
      nullif(v_output.value ->> 'warehouse_to_id', '')::uuid,
      v_output.value ->> 'line_type',
      (v_output.value ->> 'output_weight_kg')::numeric,
      '{}'::jsonb,
      v_output.value ->> 'batch_class',
      v_output.value ->> 'output_type'
    );
  end loop;

  select count(*)::integer into v_actual_inputs
  from public.batch_transformation_inputs input_row
  where input_row.transformation_id = v_transformation_id
    and input_row.company_id = p_company_id;
  select count(*)::integer into v_actual_outputs
  from public.batch_transformation_outputs output_row
  where output_row.transformation_id = v_transformation_id
    and output_row.company_id = p_company_id;
  if v_actual_inputs <> v_expected_inputs
     or v_actual_outputs <> v_expected_outputs
  then
    raise exception 'PROCESSING_ATOMIC_CREATE_POSTCONDITION_FAILED' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_transformation_id,
    'idempotent_replay', false
  );
end;
$function$;

alter function public.create_processing_transformation_atomic_v1(
  uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb
) owner to postgres;

revoke all on function public.create_processing_transformation_atomic_v1(
  uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb
) from public, anon, service_role;
grant execute on function public.create_processing_transformation_atomic_v1(
  uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb
) to authenticated;

comment on function public.create_processing_transformation_atomic_v1(
  uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb
) is 'TZ315_PROCESSING_CREATE_ATOMIC_V1: authenticated server route boundary; validates actor/company/season/lot and writes the whole draft graph atomically after the universal company-season gate.';
