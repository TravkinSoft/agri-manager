-- TZ315 release prerequisite: restore the canonical TZ281 movement-shadow sync
-- function only when it is absent. Existing definitions are never replaced:
-- any drift fails closed before later processing migrations can run.
do $preflight$
declare
  v_missing_columns text[];
begin
  with required(table_name, column_name) as (
    values
      ('tickets','id'),
      ('tickets','company_id'),
      ('tickets','harvest_lot_id'),
      ('tickets','is_finalized'),
      ('tickets','is_voided'),
      ('tickets','status'),
      ('tickets','warehouse_from_id'),
      ('tickets','warehouse_to_id'),
      ('tickets','net_weight_kg'),
      ('tickets','source_physical_state'),
      ('tickets','finalized_at'),
      ('tickets','harvest_year'),
      ('tickets','processing_output_role'),
      ('tickets','linked_processing_id'),
      ('harvest_lots','id'),
      ('harvest_lots','company_id'),
      ('harvest_lots','season_id'),
      ('harvest_lots','crop_id'),
      ('harvest_lots','variety_id'),
      ('harvest_lots','reproduction_id'),
      ('harvest_lots','composition_hash'),
      ('ticket_lines','id'),
      ('ticket_lines','ticket_id'),
      ('ticket_lines','created_at'),
      ('ticket_lines','batch_id'),
      ('ticket_lines','moisture_percent'),
      ('ticket_lines','quantity'),
      ('ticket_lines','product_id'),
      ('ticket_lines','destination_batch_id'),
      ('inventory_batches','id'),
      ('inventory_batches','company_id'),
      ('inventory_batches','season_id'),
      ('inventory_batches','product_id'),
      ('inventory_batches','crop_id'),
      ('inventory_batches','variety_id'),
      ('inventory_batches','reproduction_id'),
      ('inventory_batches','source_field_id'),
      ('inventory_batches','source_ticket_id'),
      ('inventory_batches','harvest_year'),
      ('inventory_batches','batch_code'),
      ('inventory_batches','status'),
      ('inventory_batches','initial_weight_kg'),
      ('inventory_batches','current_weight_kg'),
      ('inventory_batches','moisture_percent'),
      ('inventory_batches','batch_class'),
      ('inventory_batches','parent_batch_id'),
      ('inventory_batches','source_transformation_id'),
      ('inventory_batches','origin_type'),
      ('inventory_batches','origin_ref_id'),
      ('inventory_batches','warehouse_id'),
      ('inventory_batches','received_at'),
      ('inventory_batches','source_type'),
      ('inventory_batches','composition_snapshot'),
      ('inventory_batches','composition_hash'),
      ('inventory_batches','display_name'),
      ('inventory_batches','is_mixed_harvest'),
      ('inventory_batches','physical_state'),
      ('inventory_batches','crop_structure_id'),
      ('batch_transformation_inputs','company_id'),
      ('batch_transformation_inputs','transformation_id'),
      ('batch_transformation_inputs','batch_id'),
      ('batch_transformation_inputs','warehouse_from_id'),
      ('batch_transformation_inputs','input_weight_kg'),
      ('batch_transformation_inputs','input_quality_json'),
      ('batch_transformation_inputs','source_ticket_id'),
      ('batch_transformation_inputs','source_ticket_line_id'),
      ('batch_transformation_inputs','node_warehouse_id'),
      ('batch_transformation_inputs','moisture_percent'),
      ('batch_transformation_inputs','dry_matter_kg'),
      ('batch_transformation_outputs','company_id'),
      ('batch_transformation_outputs','transformation_id'),
      ('batch_transformation_outputs','output_batch_id'),
      ('batch_transformation_outputs','warehouse_to_id'),
      ('batch_transformation_outputs','line_type'),
      ('batch_transformation_outputs','output_weight_kg'),
      ('batch_transformation_outputs','output_quality_json'),
      ('batch_transformation_outputs','batch_class'),
      ('batch_transformation_outputs','source_ticket_id'),
      ('batch_transformation_outputs','moisture_percent'),
      ('batch_transformation_outputs','output_role'),
      ('batch_transformation_outputs','is_projected_child'),
      ('batch_transformation_outputs','projected_batch_code'),
      ('batch_transformation_outputs','physical_state'),
      ('warehouses','id'),
      ('warehouses','company_id'),
      ('warehouses','place_type'),
      ('batch_transformations','id'),
      ('batch_transformations','company_id'),
      ('batch_transformations','node_warehouse_id'),
      ('batch_transformations','transformation_type'),
      ('batch_transformations','processing_method'),
      ('batch_transformations','status'),
      ('batch_transformations','shadow_mode'),
      ('batch_transformations','shadow_status'),
      ('batch_transformations','quality_state'),
      ('batch_transformations','identity_key'),
      ('batch_transformations','harvest_lot_id'),
      ('batch_transformations','source_physical_state'),
      ('batch_transformations','pass_no'),
      ('batch_transformations','started_at'),
      ('batch_transformations','created_at'),
      ('batch_transformations','note'),
      ('stock_ledger_entries','id'),
      ('stock_ledger_entries','ticket_id'),
      ('stock_ledger_entries','warehouse_id'),
      ('stock_ledger_entries','direction'),
      ('stock_ledger_entries','created_at'),
      ('stock_ledger_entries','product_id'),
      ('stock_ledger_entries','variety_id'),
      ('stock_ledger_entries','reproduction_id'),
      ('stock_ledger_entries','inventory_batch_id'),
      ('stock_ledger_entries','batch_id'),
      ('stock_ledger_entries','batch_id_text'),
      ('stock_ledger_entries','batch_class'),
      ('stock_ledger_entries','quantity'),
      ('stock_ledger_entries','delta_qty_signed'),
      ('stock_ledger_entries','uom'),
      ('stock_ledger_entries','mass_kg'),
      ('stock_ledger_entries','unit_source'),
      ('stock_ledger_entries','unit_contract_version'),
      ('stock_ledger_entries','processing_id'),
      ('harvest_lot_batches','company_id'),
      ('harvest_lot_batches','harvest_lot_id'),
      ('harvest_lot_batches','inventory_batch_id'),
      ('harvest_lot_batches','source_ticket_id'),
      ('harvest_lot_batches','crop_structure_id'),
      ('harvest_lot_batches','assignment_reason')
  )
  select pg_catalog.array_agg(
           pg_catalog.format('public.%I.%I', required.table_name, required.column_name)
           order by required.table_name, required.column_name
         )
  into v_missing_columns
  from required
  left join pg_catalog.pg_namespace n
    on n.nspname = 'public'
  left join pg_catalog.pg_class c
    on c.relnamespace = n.oid
   and c.relname = required.table_name
   and c.relkind in ('r','p')
  left join pg_catalog.pg_attribute a
    on a.attrelid = c.oid
   and a.attname = required.column_name
   and a.attnum > 0
   and not a.attisdropped
  where a.attname is null;

  if v_missing_columns is not null then
    raise exception 'TZ315 processing shadow sync prerequisite missing runtime columns: %',
      v_missing_columns
      using errcode = '55000';
  end if;

  if pg_catalog.to_regprocedure('public.recompute_grain_processing_shadow_v1(uuid)') is null then
    raise exception 'TZ315 processing shadow sync prerequisite missing public.recompute_grain_processing_shadow_v1(uuid)'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
    join pg_catalog.pg_attribute a
      on a.attrelid = tbl.oid
     and a.attname = 'source_ticket_line_id'
     and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and tbl.relname = 'batch_transformation_inputs'
      and idx.relname = 'uq_batch_transformation_inputs_ticket_line_v1'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indnkeyatts = 1
      and i.indnatts = 1
      and i.indexprs is null
      and pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid, true)),
            '[[:space:]()]',
            '',
            'g'
          ) = 'source_ticket_line_idisnotnull'
  ) then
    raise exception 'TZ315 processing shadow sync prerequisite index drift: public.uq_batch_transformation_inputs_ticket_line_v1'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
    join pg_catalog.pg_attribute a
      on a.attrelid = tbl.oid
     and a.attname = 'source_ticket_id'
     and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and tbl.relname = 'batch_transformation_outputs'
      and idx.relname = 'uq_batch_transformation_outputs_ticket_v1'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indnkeyatts = 1
      and i.indnatts = 1
      and i.indexprs is null
      and pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid, true)),
            '[[:space:]()]',
            '',
            'g'
          ) = 'source_ticket_idisnotnull'
  ) then
    raise exception 'TZ315 processing shadow sync prerequisite index drift: public.uq_batch_transformation_outputs_ticket_v1'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = tbl.relnamespace
    join pg_catalog.pg_attribute a
      on a.attrelid = tbl.oid
     and a.attname = 'inventory_batch_id'
     and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and tbl.relname = 'harvest_lot_batches'
      and idx.relname = 'harvest_lot_batches_inventory_batch_id_key'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indnkeyatts = 1
      and i.indnatts = 1
      and i.indexprs is null
      and i.indpred is null
  ) then
    raise exception 'TZ315 processing shadow sync prerequisite index drift: public.harvest_lot_batches_inventory_batch_id_key'
      using errcode = '55000';
  end if;
end;
$preflight$;

do $migration$
begin
  if pg_catalog.to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)') is null then
    execute $create_sql$
create function public.sync_grain_movement_shadow_v1(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function_body$
declare
  v_ticket public.tickets%rowtype;
  v_lot public.harvest_lots%rowtype;
  v_line public.ticket_lines%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_source_type text;
  v_destination_type text;
  v_method text;
  v_transformation_id uuid;
  v_child_batch_id uuid;
  v_output_id uuid;
  v_state text;
  v_role text;
  v_batch_class text;
  v_net numeric;
  v_moisture numeric;
  v_pass integer;
  v_existing_ids uuid[];
  v_keep_ledger_id uuid;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found or v_ticket.harvest_lot_id is null then return; end if;

  select array_agg(distinct transformation_id) into v_existing_ids from (
    select transformation_id from public.batch_transformation_inputs where source_ticket_id = p_ticket_id
    union all
    select transformation_id from public.batch_transformation_outputs where source_ticket_id = p_ticket_id
  ) q;

  if not v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status <> 'finalized' then
    delete from public.batch_transformation_inputs where source_ticket_id = p_ticket_id;
    delete from public.batch_transformation_outputs where source_ticket_id = p_ticket_id;
    if v_existing_ids is not null then
      for v_transformation_id in select unnest(v_existing_ids) loop
        perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
      end loop;
    end if;
    return;
  end if;

  select * into v_lot from public.harvest_lots
  where id = v_ticket.harvest_lot_id and company_id = v_ticket.company_id;
  if not found then raise exception 'Aggregate harvest lot not found'; end if;

  select place_type into v_source_type from public.warehouses
  where id = v_ticket.warehouse_from_id and company_id = v_ticket.company_id;
  select place_type into v_destination_type from public.warehouses
  where id = v_ticket.warehouse_to_id and company_id = v_ticket.company_id;

  v_net := coalesce(v_ticket.net_weight_kg, 0);
  if v_net <= 0 then return; end if;

  if v_destination_type in ('YARD', 'DRYER', 'CLEANER') then
    v_method := case v_destination_type
      when 'YARD' then 'NATURAL_DRYING'
      when 'DRYER' then 'MECHANICAL_DRYING'
      else 'CLEANING'
    end;
    select id into v_transformation_id from public.batch_transformations
    where company_id = v_ticket.company_id
      and node_warehouse_id = v_ticket.warehouse_to_id
      and harvest_lot_id = v_ticket.harvest_lot_id
      and source_physical_state = coalesce(v_ticket.source_physical_state, 'SOURCE')
      and processing_method = v_method
      and shadow_mode
      and status = 'draft'
    order by pass_no desc, created_at desc limit 1 for update;

    if v_transformation_id is null then
      select coalesce(max(pass_no), 0) + 1 into v_pass from public.batch_transformations
      where company_id = v_ticket.company_id
        and node_warehouse_id = v_ticket.warehouse_to_id
        and harvest_lot_id = v_ticket.harvest_lot_id
        and processing_method = v_method;
      insert into public.batch_transformations(
        company_id, node_warehouse_id, transformation_type, processing_method, status,
        shadow_mode, shadow_status, quality_state, identity_key, harvest_lot_id,
        source_physical_state, pass_no, started_at, note
      ) values (
        v_ticket.company_id, v_ticket.warehouse_to_id,
        case when v_method = 'CLEANING' then 'cleaning' else 'drying' end,
        v_method, 'draft', true, 'ACTIVE', 'READY',
        concat('grain-lot:', v_ticket.harvest_lot_id, ':', coalesce(v_ticket.source_physical_state, 'SOURCE'), ':', v_pass),
        v_ticket.harvest_lot_id, coalesce(v_ticket.source_physical_state, 'SOURCE'), v_pass,
        coalesce(v_ticket.finalized_at, now()), 'TZ281 automatic processing pass'
      ) returning id into v_transformation_id;
    end if;

    for v_line in
      select * from public.ticket_lines where ticket_id = p_ticket_id order by created_at, id
    loop
      select * into v_batch from public.inventory_batches
      where company_id = v_ticket.company_id and id::text = v_line.batch_id limit 1;
      if not found then raise exception 'Allocated source batch not found'; end if;
      v_moisture := coalesce(v_line.moisture_percent, v_batch.moisture_percent);
      insert into public.batch_transformation_inputs(
        company_id, transformation_id, batch_id, warehouse_from_id, input_weight_kg,
        input_quality_json, source_ticket_id, source_ticket_line_id, node_warehouse_id,
        moisture_percent, dry_matter_kg
      ) values (
        v_ticket.company_id, v_transformation_id, v_batch.id, v_ticket.warehouse_from_id,
        v_line.quantity, jsonb_build_object('moisture_percent', v_moisture), p_ticket_id,
        v_line.id, v_ticket.warehouse_to_id, v_moisture,
        case when v_moisture is null then null else v_line.quantity * (100 - v_moisture) / 100 end
      ) on conflict (source_ticket_line_id) where source_ticket_line_id is not null do nothing;
    end loop;
    update public.tickets set linked_processing_id = v_transformation_id where id = p_ticket_id;
    perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  end if;

  if v_source_type in ('YARD', 'DRYER', 'CLEANER') then
    v_method := case v_source_type
      when 'YARD' then 'NATURAL_DRYING'
      when 'DRYER' then 'MECHANICAL_DRYING'
      else 'CLEANING'
    end;
    select id into v_transformation_id from public.batch_transformations
    where company_id = v_ticket.company_id
      and node_warehouse_id = v_ticket.warehouse_from_id
      and harvest_lot_id = v_ticket.harvest_lot_id
      and source_physical_state = coalesce(v_ticket.source_physical_state, 'SOURCE')
      and processing_method = v_method
      and shadow_mode
      and status = 'draft'
    order by pass_no desc, created_at desc limit 1 for update;
    if v_transformation_id is null then raise exception 'Active processing pass not found for aggregate lot'; end if;

    v_role := coalesce(v_ticket.processing_output_role, 'GRAIN');
    v_state := case
      when v_role = 'SCREENINGS' then 'SCREENINGS'
      when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'
      when v_role = 'OTHER' then 'OTHER'
      when v_source_type in ('DRYER', 'YARD') then 'AFTER_DRYING'
      when v_source_type = 'CLEANER' then 'AFTER_CLEANING'
      else 'COMMODITY_GRAIN'
    end;
    v_batch_class := case when v_role = 'GRAIN' then 'commodity' else 'waste' end;

    select id into v_child_batch_id from public.inventory_batches
    where company_id = v_ticket.company_id
      and source_ticket_id = p_ticket_id
      and origin_type = 'processing_output'
    limit 1;
    if v_child_batch_id is null then
      select * into v_line from public.ticket_lines
      where ticket_id = p_ticket_id order by created_at, id limit 1;
      select * into v_batch from public.inventory_batches
      where company_id = v_ticket.company_id and id::text = v_line.batch_id limit 1;
      v_moisture := coalesce(v_line.moisture_percent, v_batch.moisture_percent);
      insert into public.inventory_batches(
        company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
        source_field_id, source_ticket_id, harvest_year, batch_code, status,
        initial_weight_kg, current_weight_kg, moisture_percent, batch_class,
        parent_batch_id, source_transformation_id, origin_type, origin_ref_id,
        warehouse_id, received_at, source_type, composition_snapshot, composition_hash,
        display_name, is_mixed_harvest, physical_state
      ) values (
        v_ticket.company_id, v_lot.season_id, v_line.product_id, v_lot.crop_id,
        v_lot.variety_id, v_lot.reproduction_id, v_batch.source_field_id, p_ticket_id,
        coalesce(v_ticket.harvest_year, v_batch.harvest_year),
        'PROC-' || upper(substr(replace(p_ticket_id::text, '-', ''), 1, 16)),
        case when v_batch_class = 'waste' then 'waste' else 'commodity' end,
        v_net, v_net, v_moisture, v_batch_class, v_batch.id, v_transformation_id,
        'processing_output', v_transformation_id, v_ticket.warehouse_to_id,
        coalesce(v_ticket.finalized_at, now()), 'weighbridge_processing_output',
        v_batch.composition_snapshot, v_lot.composition_hash, null,
        v_batch.is_mixed_harvest, v_state
      ) returning id into v_child_batch_id;

      insert into public.harvest_lot_batches(
        company_id, harvest_lot_id, inventory_batch_id, source_ticket_id,
        crop_structure_id, assignment_reason
      ) values (
        v_ticket.company_id, v_ticket.harvest_lot_id, v_child_batch_id, p_ticket_id,
        v_batch.crop_structure_id, 'processing_output_state'
      ) on conflict (inventory_batch_id) do nothing;
    end if;

    update public.ticket_lines set destination_batch_id = v_child_batch_id
    where ticket_id = p_ticket_id;

    select id into v_keep_ledger_id
    from public.stock_ledger_entries
    where ticket_id = p_ticket_id
      and warehouse_id = v_ticket.warehouse_to_id
      and direction = 'in'
    order by created_at, id
    limit 1;

    delete from public.stock_ledger_entries
    where ticket_id = p_ticket_id
      and warehouse_id = v_ticket.warehouse_to_id
      and direction = 'in'
      and id is distinct from v_keep_ledger_id;

    update public.stock_ledger_entries set
      product_id = v_line.product_id,
      variety_id = v_lot.variety_id,
      reproduction_id = v_lot.reproduction_id,
      inventory_batch_id = v_child_batch_id,
      batch_id = v_child_batch_id::text,
      batch_id_text = v_child_batch_id::text,
      batch_class = v_batch_class,
      quantity = v_net,
      delta_qty_signed = v_net,
      uom = 'kg',
      mass_kg = v_net,
      unit_source = 'processing.output_net_weight',
      unit_contract_version = 2,
      processing_id = v_transformation_id
    where id = v_keep_ledger_id;

    select moisture_percent into v_moisture from public.ticket_lines
    where ticket_id = p_ticket_id order by created_at, id limit 1;
    insert into public.batch_transformation_outputs(
      company_id, transformation_id, output_batch_id, warehouse_to_id, line_type,
      output_weight_kg, output_quality_json, batch_class, source_ticket_id,
      moisture_percent, output_role, is_projected_child, projected_batch_code, physical_state
    ) values (
      v_ticket.company_id, v_transformation_id, v_child_batch_id, v_ticket.warehouse_to_id,
      case when v_role = 'GRAIN' then 'commodity'
        when v_role = 'SCREENINGS' then 'forage_fraction'
        else 'waste_fraction' end,
      v_net, jsonb_build_object('moisture_percent', v_moisture), v_batch_class,
      p_ticket_id, v_moisture, v_role, false, null, v_state
    ) on conflict (source_ticket_id) where source_ticket_id is not null do update set
      output_batch_id = excluded.output_batch_id,
      output_weight_kg = excluded.output_weight_kg,
      moisture_percent = excluded.moisture_percent,
      output_role = excluded.output_role,
      physical_state = excluded.physical_state,
      batch_class = excluded.batch_class;

    update public.tickets set linked_processing_id = v_transformation_id where id = p_ticket_id;
    perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  end if;
end;
$function_body$;
$create_sql$;

    alter function public.sync_grain_movement_shadow_v1(uuid) owner to postgres;
    revoke all on function public.sync_grain_movement_shadow_v1(uuid)
      from public, anon, authenticated, service_role;
    grant execute on function public.sync_grain_movement_shadow_v1(uuid) to service_role;
    comment on function public.sync_grain_movement_shadow_v1(uuid) is
      'TZ281 automatic processing pass with one consolidated inbound ledger row per physical output batch.';
  end if;
end;
$migration$;

do $verify$
declare
  v_oid oid;
  v_owner_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_definition_md5 text;
  v_comment text;
  v_acl text[];
begin
  v_oid := pg_catalog.to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)');
  if v_oid is null then
    raise exception 'TZ315 processing shadow sync prerequisite is absent after corrective migration'
      using errcode = '55000';
  end if;

  select p.proowner,
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.proconfig,
         pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
         pg_catalog.obj_description(p.oid, 'pg_proc')
  into v_owner_oid,
       v_owner,
       v_security_definer,
       v_config,
       v_definition_md5,
       v_comment
  from pg_catalog.pg_proc p
  where p.oid = v_oid
    and p.prokind = 'f';

  if not found then
    raise exception 'TZ315 processing shadow sync prerequisite has unexpected object kind'
      using errcode = '55000';
  end if;

  if v_definition_md5 <> '1f943fc078f4384c6064ea077aa9b643' then
    raise exception 'TZ315 processing shadow sync prerequisite definition drift: %', v_definition_md5
      using errcode = '55000';
  end if;

  if v_owner <> 'postgres' then
    raise exception 'TZ315 processing shadow sync prerequisite owner drift: %', v_owner
      using errcode = '55000';
  end if;

  if not v_security_definer then
    raise exception 'TZ315 processing shadow sync prerequisite must remain SECURITY DEFINER'
      using errcode = '55000';
  end if;

  if v_config is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'TZ315 processing shadow sync prerequisite search_path drift: %', v_config
      using errcode = '55000';
  end if;

  select coalesce(
           pg_catalog.array_agg(
             pg_catalog.format(
               '%s:%s:%s:%s',
               case when acl.grantee = 0 then 'PUBLIC'
                    else pg_catalog.pg_get_userbyid(acl.grantee) end,
               pg_catalog.pg_get_userbyid(acl.grantor),
               acl.privilege_type,
               acl.is_grantable
             )
             order by case when acl.grantee = 0 then 'PUBLIC'
                           else pg_catalog.pg_get_userbyid(acl.grantee) end,
                      pg_catalog.pg_get_userbyid(acl.grantor),
                      acl.privilege_type,
                      acl.is_grantable
           ),
           array[]::text[]
         )
  into v_acl
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', v_owner_oid))
  ) acl
  where p.oid = v_oid;

  if v_acl is distinct from array[
    'postgres:postgres:EXECUTE:f',
    'service_role:postgres:EXECUTE:f'
  ]::text[] then
    raise exception 'TZ315 processing shadow sync prerequisite ACL drift: %', v_acl
      using errcode = '55000';
  end if;

  if v_comment is distinct from
     'TZ281 automatic processing pass with one consolidated inbound ledger row per physical output batch.' then
    raise exception 'TZ315 processing shadow sync prerequisite comment drift: %', v_comment
      using errcode = '55000';
  end if;
end;
$verify$;
