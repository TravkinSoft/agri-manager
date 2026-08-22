-- TZ297 QA P0 #3: processing stock outputs require a physical destination.

create or replace function public.close_processing_output_ticket_atomic_v1(
  p_ticket_id uuid,
  p_session_token text,
  p_tare_weight_kg numeric,
  p_moisture_percent numeric default null,
  p_tare_variance_confirmed boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_transformation public.batch_transformations%rowtype;
  v_destination public.warehouses%rowtype;
  v_line public.ticket_lines%rowtype;
  v_destination_batch public.inventory_batches%rowtype;
  v_existing_output public.batch_transformation_outputs%rowtype;
  v_close jsonb;
  v_role text;
  v_line_type text;
  v_output_type text;
  v_batch_class text;
  v_physical_state text;
  v_net numeric(18,3);
  v_weighing_count integer;
  v_out_count integer;
  v_in_count integer;
  v_output_count integer;
  v_out_total numeric(18,3);
  v_in_total numeric(18,3);
  v_unallocated numeric(18,3);
begin
  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  v_role := upper(coalesce(v_ticket.processing_output_role, ''));
  if v_ticket.direction::text <> 'transfer'
     or v_ticket.op_type <> 'warehouse_transfer'
     or v_ticket.linked_processing_id is null
     or v_role not in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
  then
    raise exception 'Processing output ticket contract is invalid' using errcode = '22023';
  end if;

  if v_ticket.warehouse_from_id is null or v_ticket.warehouse_to_id is null then
    raise exception 'Укажите, куда будет доставлен выход обработки.' using errcode = '22023';
  end if;
  if v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
    raise exception 'Место назначения должно отличаться от источника обработки.' using errcode = '22023';
  end if;

  select * into v_transformation
  from public.batch_transformations
  where id = v_ticket.linked_processing_id
    and company_id = v_ticket.company_id
  for update;

  if not found
     or v_transformation.node_warehouse_id is distinct from v_ticket.warehouse_from_id
     or v_transformation.harvest_lot_id is distinct from v_ticket.harvest_lot_id
     or v_transformation.processing_state not in ('in_processing','processing_pending_outputs')
     or v_transformation.status = 'voided'
  then
    raise exception 'Контекст обработки больше не доступен. Обновите карточку обработки.' using errcode = '40001';
  end if;

  select * into v_destination
  from public.warehouses
  where id = v_ticket.warehouse_to_id
    and company_id = v_ticket.company_id
    and not coalesce(archived, false)
    and not coalesce(is_archived, false)
  for update;

  if not found then
    raise exception 'Выберите активное место назначения выхода обработки.' using errcode = '22023';
  end if;

  v_close := public.close_transfer_ticket_atomic_v2(
    p_ticket_id,
    p_session_token,
    p_tare_weight_kg,
    p_moisture_percent,
    p_tare_variance_confirmed,
    p_idempotency_key
  );

  if not coalesce((v_close ->> 'ok')::boolean, false)
     or coalesce((v_close ->> 'requires_confirmation')::boolean, false)
  then
    return v_close;
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  select * into v_line
  from public.ticket_lines
  where ticket_id = p_ticket_id and company_id = v_ticket.company_id
  order by id
  limit 1
  for update;

  if not found or v_line.destination_batch_id is null then
    raise exception 'Processing output destination batch was not created';
  end if;

  select * into v_destination_batch
  from public.inventory_batches
  where id = v_line.destination_batch_id
    and company_id = v_ticket.company_id
  for update;

  if not found or v_destination_batch.warehouse_id is distinct from v_ticket.warehouse_to_id then
    raise exception 'Processing output batch does not belong to destination';
  end if;

  v_net := round(coalesce(v_ticket.physical_net_kg, v_ticket.net_weight_kg), 3);
  if v_net is null or v_net <= 0 then
    raise exception 'Processing output net weight must be positive';
  end if;

  v_line_type := case
    when v_role = 'GRAIN' then 'commodity'
    when v_role in ('SCREENINGS','FEED') then 'forage_fraction'
    else 'waste_fraction'
  end;
  v_output_type := case
    when v_role = 'GRAIN' then 'main_product'
    when v_role in ('SCREENINGS','FEED') then 'byproduct'
    else 'stock_waste'
  end;
  v_batch_class := case
    when v_role = 'GRAIN' then 'commodity'
    when v_role = 'FEED' then 'feed'
    else 'waste'
  end;
  v_physical_state := case
    when v_role = 'GRAIN' and v_transformation.transformation_type = 'drying' then 'DRIED'
    when v_role = 'GRAIN' then 'AFTER_CLEANING'
    when v_role in ('SCREENINGS','FEED') then 'SCREENINGS'
    when v_role = 'TRIER_WASTE' then 'TRIER_WASTE'
    else 'OTHER'
  end;

  update public.inventory_batches
  set batch_class = v_batch_class,
      physical_state = v_physical_state,
      source_transformation_id = v_transformation.id,
      origin_type = 'processing',
      origin_ref_id = v_transformation.id,
      moisture_percent = p_moisture_percent,
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'processing_output', jsonb_build_object(
          'transformation_id', v_transformation.id,
          'source_ticket_id', v_ticket.id,
          'output_role', v_role,
          'destination_warehouse_id', v_ticket.warehouse_to_id
        )
      ),
      updated_at = now()
  where id = v_destination_batch.id;

  update public.ticket_lines
  set batch_class = v_batch_class,
      line_type = v_line_type,
      quality_json = coalesce(quality_json, '{}'::jsonb) || jsonb_build_object(
        'processing_output_role', v_role,
        'processing_transformation_id', v_transformation.id
      ),
      updated_at = now()
  where id = v_line.id;

  update public.stock_ledger_entries
  set processing_id = v_transformation.id,
      batch_class = case when direction::text = 'in' then v_batch_class else batch_class end
  where ticket_id = v_ticket.id
    and company_id = v_ticket.company_id
    and not coalesce(is_storno, false);

  select * into v_existing_output
  from public.batch_transformation_outputs
  where company_id = v_ticket.company_id
    and source_ticket_id = v_ticket.id
  for update;

  if found then
    if v_existing_output.transformation_id is distinct from v_transformation.id
       or v_existing_output.output_batch_id is distinct from v_destination_batch.id
       or v_existing_output.warehouse_to_id is distinct from v_ticket.warehouse_to_id
       or v_existing_output.output_role is distinct from v_role
       or abs(v_existing_output.output_weight_kg - v_net) > 0.001
    then
      raise exception 'Existing processing output does not match finalized ticket';
    end if;
  else
    insert into public.batch_transformation_outputs(
      company_id,
      transformation_id,
      output_batch_id,
      warehouse_to_id,
      line_type,
      output_weight_kg,
      output_quality_json,
      batch_class,
      source_ticket_id,
      moisture_percent,
      output_role,
      is_projected_child,
      physical_state,
      output_type,
      activated_at
    ) values (
      v_ticket.company_id,
      v_transformation.id,
      v_destination_batch.id,
      v_ticket.warehouse_to_id,
      v_line_type,
      v_net,
      jsonb_build_object(
        'source', 'weighbridge_processing_output',
        'ticket_id', v_ticket.id,
        'destination_warehouse_id', v_ticket.warehouse_to_id
      ),
      v_batch_class,
      v_ticket.id,
      p_moisture_percent,
      v_role,
      false,
      v_physical_state,
      v_output_type,
      null
    );
  end if;

  update public.tickets
  set audit_json = coalesce(audit_json, '{}'::jsonb) || jsonb_build_object(
        'processing_output_destination', jsonb_build_object(
          'contract_version', 'tz297_destination_v1',
          'transformation_id', v_transformation.id,
          'output_role', v_role,
          'warehouse_from_id', v_ticket.warehouse_from_id,
          'warehouse_to_id', v_ticket.warehouse_to_id,
          'destination_batch_id', v_destination_batch.id
        )
      ),
      updated_at = now()
  where id = v_ticket.id;

  perform public.recompute_grain_processing_shadow_v1(v_transformation.id);

  select count(*) into v_weighing_count
  from public.ticket_weighings
  where ticket_id = v_ticket.id;

  select count(*), round(coalesce(sum(abs(delta_qty_signed)), 0), 3)
  into v_out_count, v_out_total
  from public.stock_ledger_entries
  where ticket_id = v_ticket.id
    and company_id = v_ticket.company_id
    and direction::text = 'out'
    and warehouse_id = v_ticket.warehouse_from_id
    and not coalesce(is_storno, false);

  select count(*), round(coalesce(sum(abs(delta_qty_signed)), 0), 3)
  into v_in_count, v_in_total
  from public.stock_ledger_entries
  where ticket_id = v_ticket.id
    and company_id = v_ticket.company_id
    and direction::text = 'in'
    and warehouse_id = v_ticket.warehouse_to_id
    and inventory_batch_id = v_destination_batch.id
    and not coalesce(is_storno, false);

  select count(*) into v_output_count
  from public.batch_transformation_outputs
  where company_id = v_ticket.company_id
    and source_ticket_id = v_ticket.id
    and transformation_id = v_transformation.id;

  if v_weighing_count <> 2
     or v_out_count <> 1
     or v_in_count <> 1
     or v_output_count <> 1
     or abs(v_out_total - v_net) > 0.001
     or abs(v_in_total - v_net) > 0.001
  then
    raise exception 'Atomic processing output close postcondition failed';
  end if;

  select round(greatest(coalesce(input_weight_total_kg, 0) - coalesce(output_weight_total_kg, 0), 0), 3)
  into v_unallocated
  from public.batch_transformations
  where id = v_transformation.id;

  return v_close || jsonb_build_object(
    'processing_output', true,
    'processing_id', v_transformation.id,
    'output_role', v_role,
    'destination_warehouse_id', v_ticket.warehouse_to_id,
    'destination_batch_id', v_destination_batch.id,
    'ledger_in_count', v_in_count,
    'ledger_in_kg', v_in_total,
    'unallocated_kg', v_unallocated
  );
end
$function$;

revoke all on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)
  from public, anon;
grant execute on function public.close_processing_output_ticket_atomic_v1(uuid,text,numeric,numeric,boolean,text)
  to authenticated, service_role;
