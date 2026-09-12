-- P0 exact impurity source scope V1.
-- Extends the existing atomic unresolved-weight path to one exact crop-structure source.
-- Whole-party legacy impurity tickets remain unchanged.

begin;

alter table public.weighbridge_shared_impurity_groups
  drop constraint weighbridge_shared_impurity_groups_composition_snapshot_check;

alter table public.weighbridge_shared_impurity_groups
  add constraint weighbridge_shared_impurity_groups_composition_snapshot_check
  check (
    pg_catalog.jsonb_typeof(composition_snapshot) = 'array'
    and pg_catalog.jsonb_array_length(composition_snapshot) >= 1
  );

do $migration$
declare
  v_definition text;
  v_guard text := 'if pg_catalog.cardinality(v_ids) < 2 then';
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_source_warehouse_id uuid, p_sources jsonb, p_vehicle_id uuid, p_driver_id uuid, p_gross_weight_kg numeric, p_impurity_type text, p_notes text, p_session_token text, p_idempotency_key uuid';

  if v_definition is null or pg_catalog.strpos(v_definition, v_guard) = 0 then
    raise exception 'P0_EXACT_IMPURITY_CREATE_GUARD_NOT_FOUND';
  end if;

  execute pg_catalog.replace(
    v_definition,
    v_guard,
    'if pg_catalog.cardinality(v_ids) < 1 then'
  );
end
$migration$;

do $migration$
declare
  v_definition text;
  v_source_guard text := 'if v_source_count < 2';
  v_member_guard text := 'if v_member_count < 2';
begin
  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'finalize_weighbridge_shared_impurity_pool_ticket_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_ticket_id uuid, p_session_token text, p_tare_weight_kg numeric, p_tare_variance_confirmed boolean, p_idempotency_key uuid';

  if v_definition is null
     or pg_catalog.strpos(v_definition, v_source_guard) = 0
     or pg_catalog.strpos(v_definition, v_member_guard) = 0
  then
    raise exception 'P0_EXACT_IMPURITY_FINALIZE_GUARDS_NOT_FOUND';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_source_guard, 'if v_source_count < 1');
  v_definition := pg_catalog.replace(v_definition, v_member_guard, 'if v_member_count < 1');
  execute v_definition;
end
$migration$;

commit;
