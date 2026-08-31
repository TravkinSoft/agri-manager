-- TZ315 P1: a processing-output WIP ticket must carry the physical state of
-- the exact output batch into the downstream DRYER/CLEANER cycle. The released
-- close RPC created the correct output batch/output row but left the ticket at
-- the upstream input state, so the AFTER UPDATE handoff copied stale metadata.
--
-- This is deliberately DDL-only: no historical ticket or batch is backfilled.

create or replace function private.tz315_processing_wip_physical_state_valid_v1(
  p_ticket_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_output public.batch_transformation_outputs%rowtype;
  v_output_batch public.inventory_batches%rowtype;
  v_upstream public.batch_transformations%rowtype;
  v_line public.ticket_lines%rowtype;
  v_input public.batch_transformation_inputs%rowtype;
  v_downstream public.batch_transformations%rowtype;
  v_destination public.warehouses%rowtype;
  v_output_count integer := 0;
  v_membership_count integer := 0;
  v_line_count integer := 0;
  v_input_count integer := 0;
  v_line_weight numeric := 0;
begin
  select * into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id;
  if not found then
    return false;
  end if;
  if v_ticket.source_kind <> 'processing_wip' then
    return true;
  end if;
  if not v_ticket.is_finalized
     or v_ticket.is_voided
     or v_ticket.status <> 'finalized'
     or v_ticket.batch_id is not null
     or v_ticket.source_id is null
     or v_ticket.processing_output_role not in (
       'GRAIN', 'SCREENINGS', 'FEED', 'WASTE', 'TRIER_WASTE', 'OTHER'
     )
     or v_ticket.destination_kind <> 'warehouse'
     or v_ticket.warehouse_from_id is null
     or v_ticket.warehouse_to_id is null
     or v_ticket.harvest_lot_id is null
     or v_ticket.season_id is null
     or nullif(pg_catalog.btrim(coalesce(v_ticket.source_physical_state, '')), '') is null
     or coalesce(v_ticket.net_weight_kg, 0) <= 0
     or v_ticket.linked_processing_id is null
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
  where output.source_ticket_id = p_ticket_id;
  if v_output.company_id is distinct from v_ticket.company_id
     or v_output.transformation_id::text is distinct from v_ticket.source_id
     or v_output.output_batch_id is null
     or v_output.warehouse_to_id is distinct from v_ticket.warehouse_to_id
     or v_output.output_role is distinct from v_ticket.processing_output_role
     or upper(coalesce(v_output.physical_state, ''))
        is distinct from upper(v_ticket.source_physical_state)
     or coalesce(v_output.output_weight_kg, 0) <= 0
     or abs(v_output.output_weight_kg - v_ticket.net_weight_kg) > 0.001
  then
    return false;
  end if;

  select * into v_upstream
  from public.batch_transformations transformation
  where transformation.id = v_output.transformation_id;
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

  select * into v_output_batch
  from public.inventory_batches batch
  where batch.id = v_output.output_batch_id;
  if not found
     or v_output_batch.company_id is distinct from v_ticket.company_id
     or v_output_batch.season_id is distinct from v_ticket.season_id
     or v_output_batch.source_ticket_id is distinct from p_ticket_id
     or v_output_batch.source_transformation_id is distinct from v_output.transformation_id
     or v_output_batch.warehouse_id is distinct from v_ticket.warehouse_to_id
     or upper(coalesce(v_output_batch.physical_state, ''))
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
  if v_line.company_id is distinct from v_ticket.company_id
     or v_line.warehouse_from_id is distinct from v_ticket.warehouse_from_id
     or v_line.warehouse_to_id is distinct from v_ticket.warehouse_to_id
     or coalesce(
       v_line.destination_batch_id::text,
       nullif(v_line.batch_id, '')
     ) is distinct from v_output.output_batch_id::text
     or coalesce(v_line_weight, 0) <= 0
     or abs(v_line_weight - v_output.output_weight_kg) > 0.001
  then
    return false;
  end if;

  if v_ticket.linked_processing_id = v_output.transformation_id then
    return not exists (
      select 1
      from public.batch_transformation_inputs input
      where input.source_ticket_id = p_ticket_id
    );
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
  select * into v_downstream
  from public.batch_transformations transformation
  where transformation.id = v_ticket.linked_processing_id;
  select * into v_destination
  from public.warehouses warehouse
  where warehouse.id = v_ticket.warehouse_to_id;
  if not found
     or v_input.company_id is distinct from v_ticket.company_id
     or v_input.transformation_id is distinct from v_ticket.linked_processing_id
     or v_input.source_ticket_line_id is distinct from v_line.id
     or v_input.batch_id is distinct from v_output.output_batch_id
     or v_input.warehouse_from_id is distinct from v_ticket.warehouse_to_id
     or v_input.node_warehouse_id is distinct from v_ticket.warehouse_to_id
     or abs(v_input.input_weight_kg - v_output.output_weight_kg) > 0.001
     or v_downstream.company_id is distinct from v_ticket.company_id
     or v_downstream.season_id is distinct from v_ticket.season_id
     or v_downstream.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or v_downstream.node_warehouse_id is distinct from v_ticket.warehouse_to_id
     or v_downstream.processing_node_id is distinct from v_ticket.processing_node_id
     or upper(coalesce(v_downstream.source_physical_state, ''))
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
     or v_destination.id is null
     or v_destination.company_id is distinct from v_ticket.company_id
     or coalesce(v_destination.archived, false)
     or coalesce(v_destination.is_archived, false)
     or upper(coalesce(v_destination.place_type, ''))
        not in ('DRYER', 'CLEANER')
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

  return true;
end
$function$;

alter function private.tz315_processing_wip_physical_state_valid_v1(uuid)
  owner to postgres;
revoke all on function private.tz315_processing_wip_physical_state_valid_v1(uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_close_oid oid;
  v_close_owner text;
  v_close_security_definer boolean;
  v_close_config text[];
  v_close_definition text;
  v_trigger_definition text;
  v_update_tail text;
  v_update_block text;
  v_update_hash text;
  v_update_start integer;
  v_update_end integer;
  v_match_count integer := 0;
  v_pattern constant text :=
    E'(source_id\\s*=\\s*v_transformation\\.id::text,)(\\s*)(destination_kind\\s*=\\s*''warehouse'',)';
  v_replacement constant text :=
    E'\\1\\2-- TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1\\2source_physical_state = v_physical_state,\\2\\3';
begin
  v_close_oid := pg_catalog.to_regprocedure(
    'public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'
  );
  if v_close_oid is null
     or pg_catalog.to_regprocedure(
       'public.attach_route_processing_input_ticket_v1(uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.tg_sync_grain_movement_shadow_v1()'
     ) is null
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    pg_catalog.pg_get_functiondef(proc.oid)
  into
    v_close_owner,
    v_close_security_definer,
    v_close_config,
    v_close_definition
  from pg_catalog.pg_proc proc
  where proc.oid = v_close_oid;

  if v_close_owner is distinct from 'postgres'
     or not coalesce(v_close_security_definer, false)
     or v_close_config is distinct from
       array['search_path=pg_catalog, public, private, extensions']::text[]
     or exists (
       select 1
       from pg_catalog.pg_proc close_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           close_proc.proacl,
           pg_catalog.acldefault('f', close_proc.proowner)
         )
       ) close_acl
       where close_proc.oid = v_close_oid
         and close_acl.grantee = 0
         and close_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_close_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'authenticated', v_close_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_close_oid, 'EXECUTE'
     )
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_CLOSE_METADATA_INVALID'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.tg_sync_grain_movement_shadow_v1()'::pg_catalog.regprocedure
  ) into v_trigger_definition;
  if pg_catalog.strpos(
       v_trigger_definition,
       'perform public.attach_route_processing_input_ticket_v1(new.id);'
     ) = 0
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.tickets'::pg_catalog.regclass
         and trigger_row.tgname = 'trg_tickets_grain_movement_shadow_v1'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled in ('O', 'A')
         and trigger_row.tgfoid =
           'public.tg_sync_grain_movement_shadow_v1()'::pg_catalog.regprocedure
     )
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_HANDOFF_TRIGGER_INVALID'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(
       v_close_definition,
       'output_ticket.status::text <> ''voided'''
     ) = 0
     or pg_catalog.strpos(v_close_definition, 'v_physical_state := case') = 0
     or pg_catalog.strpos(
       v_close_definition,
       'insert into public.inventory_batches'
     ) = 0
     or pg_catalog.strpos(
       v_close_definition,
       'insert into public.batch_transformation_outputs'
     ) = 0
     or pg_catalog.strpos(
       v_close_definition,
       'output_role, is_projected_child, physical_state, output_type'
     ) = 0
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_CLOSE_ANCHOR_INVALID'
      using errcode = '55000';
  end if;

  if (
       pg_catalog.length(v_close_definition)
       - pg_catalog.length(
         pg_catalog.replace(v_close_definition, 'update public.tickets', '')
       )
     ) / pg_catalog.length('update public.tickets') <> 1
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_CLOSE_UPDATE_AMBIGUOUS'
      using errcode = '55000';
  end if;
  v_update_start := pg_catalog.strpos(
    v_close_definition,
    'update public.tickets'
  );
  v_update_tail := pg_catalog.substr(v_close_definition, v_update_start);
  v_update_end := pg_catalog.strpos(
    v_update_tail,
    'where id = v_ticket.id;'
  );
  if v_update_start = 0 or v_update_end = 0 then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_CLOSE_UPDATE_MISSING'
      using errcode = '55000';
  end if;
  v_update_block := pg_catalog.substr(
    v_update_tail,
    1,
    v_update_end + pg_catalog.length('where id = v_ticket.id;') - 1
  );
  v_update_block := pg_catalog.btrim(
    pg_catalog.regexp_replace(v_update_block, E'\\s+', ' ', 'g')
  );
  v_update_hash := pg_catalog.md5(v_update_block);

  if pg_catalog.strpos(
       v_close_definition,
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1'
     ) > 0
  then
    if v_update_hash is distinct from 'e531c4ed2fd93776ca4136867f58716f'
       or (
         select count(*)
         from pg_catalog.regexp_matches(
           v_close_definition,
           E'source_physical_state\\s*=\\s*v_physical_state',
           'g'
         )
       ) <> 1
    then
      raise exception 'TZ315_WIP_PHYSICAL_STATE_REPEAT_STATE_INVALID'
        using errcode = '55000';
    end if;
  else
    if v_update_hash is distinct from 'bb9bcaee449556b065767b6885c4a4f7' then
      raise exception
        'TZ315_WIP_PHYSICAL_STATE_CLOSE_UPDATE_HASH_MISMATCH: %',
        v_update_hash
        using errcode = '55000';
    end if;
    select count(*)::integer into v_match_count
    from pg_catalog.regexp_matches(v_close_definition, v_pattern, 'g');
    if v_match_count <> 1 then
      raise exception 'TZ315_WIP_PHYSICAL_STATE_PATCH_ANCHOR_COUNT: %',
        v_match_count
        using errcode = '55000';
    end if;
    execute pg_catalog.regexp_replace(
      v_close_definition,
      v_pattern,
      v_replacement,
      'g'
    );
  end if;
end
$migration$;

do $migration_postconditions$
declare
  v_close_oid oid :=
    'public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)'::pg_catalog.regprocedure;
  v_definition text;
  v_update_tail text;
  v_update_block text;
  v_update_start integer;
  v_update_end integer;
begin
  select pg_catalog.pg_get_functiondef(v_close_oid)
  into v_definition;
  v_update_start := pg_catalog.strpos(v_definition, 'update public.tickets');
  v_update_tail := pg_catalog.substr(v_definition, v_update_start);
  v_update_end := pg_catalog.strpos(v_update_tail, 'where id = v_ticket.id;');
  v_update_block := pg_catalog.substr(
    v_update_tail,
    1,
    v_update_end + pg_catalog.length('where id = v_ticket.id;') - 1
  );
  v_update_block := pg_catalog.btrim(
    pg_catalog.regexp_replace(v_update_block, E'\\s+', ' ', 'g')
  );

  if pg_catalog.strpos(
       v_definition,
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1'
     ) = 0
     or pg_catalog.md5(v_update_block) is distinct from
       'e531c4ed2fd93776ca4136867f58716f'
     or (
       select count(*)
       from pg_catalog.regexp_matches(
         v_definition,
         E'source_physical_state\\s*=\\s*v_physical_state',
         'g'
       )
     ) <> 1
  then
    raise exception
      'TZ315_WIP_PHYSICAL_STATE_POSTCONDITION_FAILED: marker=%, hash=%, assignments=%',
      pg_catalog.strpos(
        v_definition,
        'TZ315_PROCESSING_WIP_PHYSICAL_STATE_V1'
      ),
      pg_catalog.md5(v_update_block),
      (
        select count(*)
        from pg_catalog.regexp_matches(
          v_definition,
          E'source_physical_state\\s*=\\s*v_physical_state',
          'g'
        )
      )
      using errcode = '55000';
  end if;
end
$migration_postconditions$;

-- The canonical output source debit is deferred until commit. By then the
-- route trigger may already have moved linked_processing_id from the upstream
-- output owner to the downstream input cycle. Admit only that exact physical
-- handoff; a generic processing-id divergence remains an integrity failure.
do $source_debit_guard$
declare
  v_source_debit_oid oid;
  v_source_debit_owner text;
  v_source_debit_security_definer boolean;
  v_source_debit_config text[];
  v_source_debit_definition text;
  v_source_debit_hash text;
  v_guard_tail text;
  v_guard_raw text;
  v_guard_block text;
  v_guard_start integer;
  v_guard_end integer;
  v_marker_start integer;
  v_marker_tail text;
  v_guard_hash text;
  v_anchor_count integer := 0;
  v_new constant text :=
    E'  -- TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1\n  if (\n       v_ticket.linked_processing_id is distinct from v_t.id\n       and (\n         v_ticket.source_kind <> ''processing_wip''\n         or v_ticket.source_id is distinct from v_t.id::text\n         or not private.tz315_processing_wip_physical_state_valid_v1(v_ticket.id)\n       )\n     )\n     or v_ticket.season_id is distinct from v_t.season_id\n  then\n    raise exception ''PROCESSING_OUTPUT_SOURCE_TICKET_CONTEXT_MISMATCH'' using errcode=''23514'';\n  end if;';
begin
  v_source_debit_oid := pg_catalog.to_regprocedure(
    'private.post_processing_output_source_debit_v1()'
  );
  if v_source_debit_oid is null then
    raise exception 'TZ315_WIP_SOURCE_DEBIT_PREREQUISITE_MISSING'
      using errcode = '55000';
  end if;

  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    pg_catalog.pg_get_functiondef(proc.oid)
  into
    v_source_debit_owner,
    v_source_debit_security_definer,
    v_source_debit_config,
    v_source_debit_definition
  from pg_catalog.pg_proc proc
  where proc.oid = v_source_debit_oid;
  v_source_debit_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(
      v_source_debit_definition,
      E'\\s+',
      ' ',
      'g'
    )
  ));

  if v_source_debit_owner is distinct from 'postgres'
     or not coalesce(v_source_debit_security_definer, false)
     or v_source_debit_config is distinct from array['search_path=""']::text[]
     or exists (
       select 1
       from pg_catalog.pg_proc source_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           source_proc.proacl,
           pg_catalog.acldefault('f', source_proc.proowner)
         )
       ) source_acl
       where source_proc.oid = v_source_debit_oid
         and source_acl.grantee = 0
         and source_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', v_source_debit_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_source_debit_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_source_debit_oid, 'EXECUTE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'public.stock_ledger_entries'::pg_catalog.regclass
         and trigger_row.tgname = 'trg_processing_output_source_debit_v1'
         and not trigger_row.tgisinternal
         and trigger_row.tgenabled in ('O', 'A')
         and trigger_row.tgdeferrable
         and trigger_row.tginitdeferred
         and trigger_row.tgfoid = v_source_debit_oid
     )
     or pg_catalog.strpos(
       v_source_debit_definition,
       'where t.id=new.processing_id and t.company_id=new.company_id'
     ) = 0
     or pg_catalog.strpos(
       v_source_debit_definition,
       'PROCESSING_OUTPUT_SOURCE_DOCUMENT_MISMATCH'
     ) = 0
     or pg_catalog.strpos(
       v_source_debit_definition,
       'PROCESSING_OUTPUT_SOURCE_POSTCONDITION'
     ) = 0
  then
    raise exception 'TZ315_WIP_SOURCE_DEBIT_METADATA_INVALID'
      using errcode = '55000';
  end if;

  v_marker_start := pg_catalog.strpos(
    v_source_debit_definition,
    'TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1'
  );
  if v_marker_start > 0 then
    v_marker_tail := pg_catalog.substr(
      v_source_debit_definition,
      v_marker_start
    );
    v_guard_start := v_marker_start
      + pg_catalog.strpos(v_marker_tail, 'if (') - 1;
  else
    v_guard_start := pg_catalog.strpos(
      v_source_debit_definition,
      'if v_ticket.linked_processing_id is distinct from v_t.id'
    );
  end if;
  v_guard_tail := pg_catalog.substr(
    v_source_debit_definition,
    v_guard_start
  );
  v_guard_end := pg_catalog.strpos(v_guard_tail, 'end if;');
  if v_guard_start = 0 or v_guard_end = 0 then
    raise exception 'TZ315_WIP_SOURCE_DEBIT_GUARD_MISSING'
      using errcode = '55000';
  end if;
  v_guard_raw := pg_catalog.substr(
    v_guard_tail,
    1,
    v_guard_end + pg_catalog.length('end if;') - 1
  );
  v_guard_block := pg_catalog.btrim(
    pg_catalog.regexp_replace(v_guard_raw, E'\\s+', ' ', 'g')
  );
  v_guard_hash := pg_catalog.md5(v_guard_block);

  if pg_catalog.strpos(
       v_source_debit_definition,
       'TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1'
     ) > 0
  then
    if v_source_debit_hash is distinct from
       '06faea79fabc74d7e4f9440bd6cea749'
    then
      raise exception 'TZ315_WIP_SOURCE_DEBIT_REPEAT_HASH_MISMATCH: %',
        v_source_debit_hash
        using errcode = '55000';
    end if;
    if v_guard_hash is distinct from 'b2a51d601f4f7cb18d2eb44fab3726a1'
       or (
         select count(*)
         from pg_catalog.regexp_matches(
           v_source_debit_definition,
           E'private\\.tz315_processing_wip_physical_state_valid_v1\\(v_ticket\\.id\\)',
           'g'
         )
       ) <> 1
    then
      raise exception 'TZ315_WIP_SOURCE_DEBIT_REPEAT_STATE_INVALID: %',
        v_guard_hash
        using errcode = '55000';
    end if;
  else
    if v_source_debit_hash is distinct from
       '6835a7bd2b7742886c82232a361b3f70'
    then
      raise exception 'TZ315_WIP_SOURCE_DEBIT_FUNCTION_HASH_MISMATCH: %',
        v_source_debit_hash
        using errcode = '55000';
    end if;
    if v_guard_hash is distinct from 'c9de372f5c7e19dbe5bfb70003aaa685'
    then
      raise exception 'TZ315_WIP_SOURCE_DEBIT_GUARD_HASH_MISMATCH: %',
        v_guard_hash
        using errcode = '55000';
    end if;
    select count(*)::integer into v_anchor_count
    from pg_catalog.regexp_matches(
      v_source_debit_definition,
      'PROCESSING_OUTPUT_SOURCE_TICKET_CONTEXT_MISMATCH',
      'g'
    );
    if v_anchor_count <> 1 then
      raise exception 'TZ315_WIP_SOURCE_DEBIT_PATCH_ANCHOR_COUNT: %',
        v_anchor_count
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      v_source_debit_definition,
      v_guard_raw,
      v_new
    );
  end if;
end
$source_debit_guard$;

do $source_debit_postconditions$
declare
  v_definition text;
  v_definition_hash text;
  v_guard_tail text;
  v_guard_block text;
  v_guard_start integer;
  v_guard_end integer;
  v_marker_start integer;
  v_marker_tail text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.post_processing_output_source_debit_v1()'::pg_catalog.regprocedure
  ) into v_definition;
  v_definition_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(v_definition, E'\\s+', ' ', 'g')
  ));
  v_marker_start := pg_catalog.strpos(
    v_definition,
    'TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1'
  );
  v_marker_tail := pg_catalog.substr(v_definition, v_marker_start);
  v_guard_start := v_marker_start
    + pg_catalog.strpos(v_marker_tail, 'if (') - 1;
  v_guard_tail := pg_catalog.substr(v_definition, v_guard_start);
  v_guard_end := pg_catalog.strpos(v_guard_tail, 'end if;');
  v_guard_block := pg_catalog.substr(
    v_guard_tail,
    1,
    v_guard_end + pg_catalog.length('end if;') - 1
  );
  v_guard_block := pg_catalog.btrim(
    pg_catalog.regexp_replace(v_guard_block, E'\\s+', ' ', 'g')
  );
  if v_guard_start = 0
     or v_guard_end = 0
     or pg_catalog.strpos(
       v_definition,
       'TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1'
     ) = 0
     or v_definition_hash is distinct from
       '06faea79fabc74d7e4f9440bd6cea749'
     or pg_catalog.md5(v_guard_block) is distinct from
       'b2a51d601f4f7cb18d2eb44fab3726a1'
     or (
       select count(*)
       from pg_catalog.regexp_matches(
         v_definition,
         E'private\\.tz315_processing_wip_physical_state_valid_v1\\(v_ticket\\.id\\)',
         'g'
       )
     ) <> 1
  then
    raise exception
      'TZ315_WIP_SOURCE_DEBIT_POSTCONDITION_FAILED: start=%, end=%, marker=%, hash=%, helpers=%',
      v_guard_start,
      v_guard_end,
      pg_catalog.strpos(
        v_definition,
        'TZ315_PROCESSING_WIP_SOURCE_DEBIT_DOWNSTREAM_V1'
      ),
      pg_catalog.md5(v_guard_block),
      (
        select count(*)
        from pg_catalog.regexp_matches(
          v_definition,
          E'private\\.tz315_processing_wip_physical_state_valid_v1\\(v_ticket\\.id\\)',
          'g'
        )
      )
      using errcode = '55000';
  end if;
end
$source_debit_postconditions$;

do $route_guard$
declare
  v_route_oid oid;
  v_route_owner text;
  v_route_security_definer boolean;
  v_route_config text[];
  v_route_definition text;
  v_route_hash text;
  v_anchor_count integer := 0;
  v_old constant text :=
    '  return public.attach_processing_input_ticket_live_v1(p_ticket_id);';
  v_new constant text :=
    E'  -- TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1\n  if not private.tz315_processing_wip_physical_state_valid_v1(p_ticket_id) then\n    raise exception ''PROCESSING_WIP_PHYSICAL_STATE_MISMATCH'' using errcode = ''23514'';\n  end if;\n\n  return public.attach_processing_input_ticket_live_v1(p_ticket_id);';
begin
  v_route_oid := pg_catalog.to_regprocedure(
    'public.attach_route_processing_input_ticket_v1(uuid)'
  );
  select
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.proconfig,
    pg_catalog.pg_get_functiondef(proc.oid)
  into
    v_route_owner,
    v_route_security_definer,
    v_route_config,
    v_route_definition
  from pg_catalog.pg_proc proc
  where proc.oid = v_route_oid;
  v_route_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(v_route_definition, E'\\s+', ' ', 'g')
  ));

  if v_route_oid is null
     or v_route_owner is distinct from 'postgres'
     or not coalesce(v_route_security_definer, false)
     or v_route_config is distinct from array['search_path=""']::text[]
     or pg_catalog.strpos(
       v_route_definition,
       'not in (''DRYER'', ''CLEANER'')'
     ) = 0
     or pg_catalog.strpos(
       v_route_definition,
       'VEGETABLE_PROCESSING_ROUTE_NOT_ALLOWED'
     ) = 0
     or exists (
       select 1
       from pg_catalog.pg_proc route_proc
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           route_proc.proacl,
           pg_catalog.acldefault('f', route_proc.proowner)
         )
       ) route_acl
       where route_proc.oid = v_route_oid
         and route_acl.grantee = 0
         and route_acl.privilege_type = 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', v_route_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_route_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_route_oid, 'EXECUTE'
     )
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_ROUTE_METADATA_INVALID'
      using errcode = '55000';
  end if;

  if pg_catalog.strpos(
       v_route_definition,
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1'
     ) > 0
  then
    if v_route_hash is distinct from 'e59b8782c4b0ddc873dbdd45bf3d7af9'
       or (
         select count(*)
         from pg_catalog.regexp_matches(
           v_route_definition,
           E'private\\.tz315_processing_wip_physical_state_valid_v1\\(p_ticket_id\\)',
           'g'
         )
       ) <> 1
       or pg_catalog.strpos(
         v_route_definition,
         'PROCESSING_WIP_PHYSICAL_STATE_MISMATCH'
       ) = 0
    then
      raise exception 'TZ315_WIP_PHYSICAL_STATE_ROUTE_REPEAT_STATE_INVALID'
        using errcode = '55000';
    end if;
  else
    if v_route_hash is distinct from '0187db7dfb3b6db3cd4950cc0571dc65'
    then
      raise exception 'TZ315_WIP_PHYSICAL_STATE_ROUTE_HASH_MISMATCH: %',
        v_route_hash
        using errcode = '55000';
    end if;
    select count(*)::integer into v_anchor_count
    from pg_catalog.regexp_matches(
      v_route_definition,
      E'return\\s+public\\.attach_processing_input_ticket_live_v1\\(p_ticket_id\\);',
      'g'
    );
    if v_anchor_count <> 1
       or pg_catalog.strpos(v_route_definition, v_old) = 0
    then
      raise exception 'TZ315_WIP_PHYSICAL_STATE_ROUTE_ANCHOR_COUNT: %',
        v_anchor_count
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(v_route_definition, v_old, v_new);
  end if;
end
$route_guard$;

do $route_postconditions$
declare
  v_route_oid oid :=
    'public.attach_route_processing_input_ticket_v1(uuid)'::pg_catalog.regprocedure;
  v_route_definition text;
  v_route_hash text;
begin
  select pg_catalog.pg_get_functiondef(v_route_oid)
  into v_route_definition;
  v_route_hash := pg_catalog.md5(pg_catalog.btrim(
    pg_catalog.regexp_replace(v_route_definition, E'\\s+', ' ', 'g')
  ));
  if pg_catalog.strpos(
       v_route_definition,
       'TZ315_PROCESSING_WIP_PHYSICAL_STATE_ROUTE_GUARD_V1'
     ) = 0
     or pg_catalog.strpos(
       v_route_definition,
       'PROCESSING_WIP_PHYSICAL_STATE_MISMATCH'
     ) = 0
     or v_route_hash is distinct from 'e59b8782c4b0ddc873dbdd45bf3d7af9'
     or (
       select count(*)
       from pg_catalog.regexp_matches(
         v_route_definition,
         E'private\\.tz315_processing_wip_physical_state_valid_v1\\(p_ticket_id\\)',
         'g'
       )
     ) <> 1
  then
    raise exception 'TZ315_WIP_PHYSICAL_STATE_ROUTE_POSTCONDITION_FAILED: %',
      v_route_hash
      using errcode = '55000';
  end if;
end
$route_postconditions$;

notify pgrst, 'reload schema';
