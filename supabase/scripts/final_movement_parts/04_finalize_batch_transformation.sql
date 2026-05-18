create or replace function public.finalize_batch_transformation(
  p_transformation_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trans public.batch_transformations%rowtype;
  v_actor public.profiles%rowtype;
  v_input public.batch_transformation_inputs%rowtype;
  v_output public.batch_transformation_outputs%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_output_batch_id uuid;
  v_output_batch_code text;
  v_batch_class text;
  v_total_input numeric := 0;
  v_total_output numeric := 0;
  v_available numeric;
  v_parent_batch_id uuid;
begin
  select *
    into v_trans
  from public.batch_transformations
  where id = p_transformation_id
  for update;

  if not found then
    raise exception 'Transformation not found';
  end if;

  if v_trans.status = 'completed' then
    return p_transformation_id;
  end if;

  if v_trans.status <> 'draft' then
    raise exception 'Only draft transformation can be finalized';
  end if;

  select *
    into v_actor
  from public.profiles
  where id = p_actor_user_id;

  if not found or v_actor.company_id <> v_trans.company_id then
    raise exception 'Actor does not belong to transformation company';
  end if;

  if coalesce(v_actor.role, '') not in ('admin', 'company_admin', 'warehouse', 'weighman') then
    raise exception 'Actor role is not allowed to finalize transformations';
  end if;

  select coalesce(sum(input_weight_kg), 0)
    into v_total_input
  from public.batch_transformation_inputs
  where transformation_id = p_transformation_id;

  select coalesce(sum(output_weight_kg), 0)
    into v_total_output
  from public.batch_transformation_outputs
  where transformation_id = p_transformation_id;

  if v_total_input <= 0 then
    raise exception 'Transformation input weight must be greater than zero';
  end if;

  if abs(v_total_input - v_total_output) > 0.001 then
    raise exception 'Outputs and losses must equal input weight. Input %, output %', v_total_input, v_total_output;
  end if;

  if exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.processing_id = p_transformation_id
      and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Transformation already has ledger entries';
  end if;

  for v_input in
    select *
    from public.batch_transformation_inputs
    where transformation_id = p_transformation_id
    order by created_at asc
  loop
    if v_input.warehouse_from_id is null then
      raise exception 'Input warehouse is required';
    end if;
    if v_input.batch_id is null then
      raise exception 'Input batch is required';
    end if;

    select *
      into v_batch
    from public.inventory_batches
    where id = v_input.batch_id
      and company_id = v_trans.company_id;

    if not found then
      raise exception 'Input batch not found';
    end if;

    v_parent_batch_id := coalesce(v_parent_batch_id, v_batch.id);

    select coalesce(sum(sbi.quantity), 0)
      into v_available
    from public.v_stock_balance_identity sbi
    where sbi.company_id = v_trans.company_id
      and sbi.warehouse_id = v_input.warehouse_from_id
      and sbi.product_id = coalesce(v_batch.product_id, v_batch.crop_id)
      and coalesce(sbi.variety_id::text, '') = coalesce(v_batch.variety_id::text, '')
      and coalesce(sbi.reproduction_id::text, '') = coalesce(v_batch.reproduction_id::text, '')
      and coalesce(sbi.batch_id, '') = coalesce(v_batch.id::text, v_batch.batch_code, '')
      and coalesce(sbi.batch_class, 'commodity') = coalesce(v_batch.batch_class, 'commodity');

    if coalesce(v_available, 0) < v_input.input_weight_kg then
      raise exception 'Insufficient input batch stock. Available %, required %', coalesce(v_available, 0), v_input.input_weight_kg;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      processing_id,
      product_id,
      variety_id,
      reproduction_id,
      batch_id_text,
      batch_class,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes
    )
    values (
      v_trans.company_id,
      v_trans.id,
      coalesce(v_batch.product_id, v_batch.crop_id),
      v_batch.variety_id,
      v_batch.reproduction_id,
      coalesce(v_batch.id::text, v_batch.batch_code),
      coalesce(v_batch.batch_class, 'commodity'),
      v_input.warehouse_from_id,
      'out',
      v_input.input_weight_kg,
      'kg',
      -abs(v_input.input_weight_kg),
      'processing_input',
      v_trans.id,
      now(),
      p_actor_user_id,
      v_trans.note
    );
  end loop;

  for v_output in
    select *
    from public.batch_transformation_outputs
    where transformation_id = p_transformation_id
    order by created_at asc
  loop
    v_batch_class := coalesce(
      v_output.batch_class,
      case
        when v_output.line_type in ('cleaned_seed', 'treated_seed', 'potato_seed') then 'seed'
        when v_output.line_type in ('forage_fraction', 'potato_small') then 'feed'
        when v_output.line_type in ('waste_fraction', 'soil', 'potato_rotten', 'potato_soil') then 'waste'
        when v_output.line_type in ('shrink_loss', 'process_loss') then 'waste'
        else 'commodity'
      end
    );

    if v_output.line_type in ('shrink_loss', 'process_loss') then
      continue;
    end if;

    if v_output.warehouse_to_id is null then
      raise exception 'Stored output requires destination warehouse';
    end if;

    select *
      into v_batch
    from public.inventory_batches
    where id = v_parent_batch_id
      and company_id = v_trans.company_id;

    v_output_batch_id := v_output.output_batch_id;

    if v_output_batch_id is null then
      v_output_batch_code := 'TR-' || left(v_trans.id::text, 8) || '-' || left(v_output.id::text, 8);

      insert into public.inventory_batches (
        company_id,
        season_id,
        product_id,
        crop_id,
        variety_id,
        reproduction_id,
        batch_code,
        status,
        batch_class,
        initial_weight_kg,
        current_weight_kg,
        parent_batch_id,
        source_transformation_id,
        origin_type,
        origin_ref_id,
        treatment_status,
        quality_json
      )
      values (
        v_trans.company_id,
        v_batch.season_id,
        v_batch.product_id,
        v_batch.crop_id,
        v_batch.variety_id,
        v_batch.reproduction_id,
        v_output_batch_code,
        case
          when v_batch_class = 'seed' and v_trans.transformation_type = 'seed_treatment' then 'treated'
          when v_batch_class = 'seed' then 'ready_for_seeding'
          when v_batch_class = 'waste' then 'waste'
          when v_trans.transformation_type = 'drying' then 'conditioned'
          when v_trans.transformation_type = 'cleaning' then 'conditioned'
          else 'commodity'
        end,
        v_batch_class,
        v_output.output_weight_kg,
        v_output.output_weight_kg,
        v_parent_batch_id,
        v_trans.id,
        'processing',
        v_trans.id,
        case
          when v_trans.transformation_type = 'seed_treatment' then 'treated'
          when v_batch_class = 'seed' then coalesce(v_batch.treatment_status, 'untreated')
          else 'not_applicable'
        end,
        v_output.output_quality_json
      )
      returning id into v_output_batch_id;

      update public.batch_transformation_outputs
      set output_batch_id = v_output_batch_id,
          batch_class = v_batch_class
      where id = v_output.id;
    end if;

    insert into public.stock_ledger_entries (
      company_id,
      processing_id,
      product_id,
      variety_id,
      reproduction_id,
      batch_id_text,
      batch_class,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes
    )
    values (
      v_trans.company_id,
      v_trans.id,
      coalesce(v_batch.product_id, v_batch.crop_id),
      v_batch.variety_id,
      v_batch.reproduction_id,
      v_output_batch_id::text,
      v_batch_class,
      v_output.warehouse_to_id,
      'in',
      v_output.output_weight_kg,
      'kg',
      abs(v_output.output_weight_kg),
      'processing_output',
      v_trans.id,
      now(),
      p_actor_user_id,
      v_trans.note
    );
  end loop;

  update public.batch_transformations
  set
    status = 'completed',
    completed_at = now(),
    completed_by = p_actor_user_id,
    updated_at = now()
  where id = p_transformation_id;

  return p_transformation_id;
end;
$$;

notify pgrst, 'reload schema';

