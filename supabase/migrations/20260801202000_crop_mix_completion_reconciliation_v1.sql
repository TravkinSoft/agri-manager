-- Grain mix planting uses the warehouse issue workflow for every seed component.
-- Keep the legacy weighbridge issue contract unchanged for ordinary seed operations.

create or replace function public.operation_completion_dependencies_v12(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation_id uuid,
  p_material_facts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.operations%rowtype;
  v_material public.operation_materials%rowtype;
  v_item public.warehouse_issue_request_items%rowtype;
  v_fact jsonb;
  v_consumed numeric;
  v_returned numeric;
  v_loss numeric;
  v_actual_rate numeric;
  v_seed_quantity numeric;
  v_seed_item_count integer;
  v_seed_issued numeric;
  v_seed_consumed numeric;
  v_seed_returned numeric;
  v_seed_return_received numeric;
  v_seed_loss numeric;
  v_seed_reconciled boolean;
  v_is_crop_mix boolean;
  v_material_rows jsonb := '[]'::jsonb;
begin
  select o.* into v_operation
  from public.operations o
  where o.id = p_operation_id
    and o.company_id = p_company_id
  for update of o;
  if not found then
    raise exception 'Operation was not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.crop_structure cs
    where cs.id = v_operation.crop_structure_id
      and cs.company_id = p_company_id
      and cs.land_use_type = 'crop_mix'
      and coalesce(cs.archived, false) = false
  ) into v_is_crop_mix;

  perform 1
  from public.operation_materials m
  where m.operation_id = p_operation_id
    and m.company_id = p_company_id
  for update;

  perform 1
  from public.warehouse_issue_requests r
  where r.operation_id = p_operation_id
    and r.company_id = p_company_id
  for update;

  perform 1
  from public.warehouse_issue_request_items i
  join public.warehouse_issue_requests r on r.id = i.request_id
  where r.operation_id = p_operation_id
    and i.company_id = p_company_id
  for update of i;

  if exists (
    select 1
    from public.operation_materials m
    where m.operation_id = p_operation_id
      and m.company_id = p_company_id
      and m.material_type in (
        'fertilizer', 'pesticide', 'adjuvant', 'ph_corrector', 'defoamer',
        'biological', 'organic', 'other'
      )
  ) and not exists (
    select 1
    from public.warehouse_issue_requests r
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
  ) then
    raise exception 'Material request is missing for agrochemical materials' using errcode = '23514';
  end if;

  for v_material in
    select *
    from public.operation_materials
    where operation_id = p_operation_id
      and company_id = p_company_id
    order by created_at, id
    for update
  loop
    if v_material.material_type = 'seed' then
      if v_is_crop_mix then
        select count(*)::integer,
               coalesce(sum(coalesce(i.issued_quantity, 0)), 0),
               coalesce(sum(coalesce(i.consumed_quantity, 0)), 0),
               coalesce(sum(coalesce(i.returned_quantity, 0)), 0),
               coalesce(sum(coalesce(i.return_received_quantity, 0)), 0),
               coalesce(sum(coalesce(i.loss_quantity, 0)), 0),
               coalesce(bool_and(coalesce(i.reconciliation_status, 'pending') = 'reconciled'), false)
          into v_seed_item_count, v_seed_issued, v_seed_consumed,
               v_seed_returned, v_seed_return_received, v_seed_loss, v_seed_reconciled
        from public.warehouse_issue_request_items i
        join public.warehouse_issue_requests r
          on r.id = i.request_id and r.company_id = i.company_id
        where r.operation_id = p_operation_id
          and r.company_id = p_company_id
          and i.company_id = p_company_id
          and i.product_id = v_material.product_id
          and i.source_mix_component_id is not null
          and coalesce(r.warehouse_request_status, '') <> 'cancelled';

        if v_seed_item_count <> 1 then
          raise exception 'Every grain mix component requires exactly one warehouse request item'
            using errcode = '23514';
        end if;
        if v_seed_issued <= 0.000001
           or abs(v_seed_issued - v_seed_consumed - v_seed_returned - v_seed_loss) > 0.0001
           or v_seed_return_received + 0.000001 < v_seed_returned
           or not v_seed_reconciled then
          raise exception 'Every grain mix seed component must be reconciled before operation close'
            using errcode = '23514';
        end if;

        v_actual_rate := case
          when coalesce(v_operation.completed_area_ha, 0) > 0
            then round(v_seed_consumed / v_operation.completed_area_ha, 4)
          else null
        end;
        update public.operation_materials
        set issued_quantity = round(v_seed_issued, 4),
            consumed_quantity = round(v_seed_consumed, 4),
            returned_quantity = round(v_seed_returned, 4),
            loss_quantity = round(v_seed_loss, 4),
            actual_rate = v_actual_rate,
            updated_by_user_id = auth.uid(),
            updated_at = now()
        where id = v_material.id;

        v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
          'material_id', v_material.id,
          'product_id', v_material.product_id,
          'source', 'warehouse',
          'source_mix_component', true,
          'planned_quantity', coalesce(v_material.planned_quantity, 0),
          'issued_quantity', v_seed_issued,
          'consumed_quantity', v_seed_consumed,
          'returned_quantity', v_seed_returned,
          'loss_quantity', v_seed_loss,
          'actual_rate', v_actual_rate
        ));
        continue;
      end if;

      select coalesce(sum(coalesce(tl.quantity, tl.net_line_weight_kg, 0)), 0)
        into v_seed_quantity
      from public.tickets t
      join public.ticket_lines tl on tl.ticket_id = t.id
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and t.op_type = 'issue_to_field'
        and t.is_finalized = true
        and coalesce(t.is_voided, false) = false
        and tl.product_id = v_material.product_id;

      if v_seed_quantity <= 0.000001 then
        raise exception 'Finalized weighbridge seed issue is required before completion' using errcode = '23514';
      end if;

      update public.operation_materials
      set issued_quantity = round(v_seed_quantity, 4),
          consumed_quantity = round(v_seed_quantity, 4),
          returned_quantity = 0,
          loss_quantity = 0,
          actual_rate = case
            when coalesce(v_operation.completed_area_ha, 0) > 0
              then round(v_seed_quantity / v_operation.completed_area_ha, 4)
            else null
          end,
          updated_by_user_id = auth.uid(),
          updated_at = now()
      where id = v_material.id;

      v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
        'material_id', v_material.id,
        'product_id', v_material.product_id,
        'source', 'weighbridge',
        'planned_quantity', coalesce(v_material.planned_quantity, 0),
        'issued_quantity', v_seed_quantity,
        'consumed_quantity', v_seed_quantity,
        'returned_quantity', 0,
        'loss_quantity', 0
      ));
      continue;
    end if;

    if v_material.material_type in ('water', 'fuel') then
      continue;
    end if;

    select value into v_fact
    from jsonb_array_elements(coalesce(p_material_facts, '[]'::jsonb))
    where value ->> 'material_id' = v_material.id::text
       or value ->> 'materialId' = v_material.id::text
       or value ->> 'operation_material_id' = v_material.id::text
       or value ->> 'operationMaterialId' = v_material.id::text
       or value ->> 'product_id' = v_material.product_id::text
       or value ->> 'productId' = v_material.product_id::text
    limit 1;

    if v_fact is null then
      raise exception 'Material fact is required for every issued agrochemical material' using errcode = '23514';
    end if;

    v_consumed := coalesce(nullif(v_fact ->> 'consumed_quantity', '')::numeric,
                           nullif(v_fact ->> 'consumedQuantity', '')::numeric, 0);
    v_returned := coalesce(nullif(v_fact ->> 'returned_quantity', '')::numeric,
                           nullif(v_fact ->> 'returnedQuantity', '')::numeric, 0);
    v_loss := coalesce(nullif(v_fact ->> 'loss_quantity', '')::numeric,
                       nullif(v_fact ->> 'lossQuantity', '')::numeric, 0);
    v_actual_rate := coalesce(nullif(v_fact ->> 'actual_rate', '')::numeric,
                              nullif(v_fact ->> 'actualRate', '')::numeric);

    if v_consumed < 0 or v_returned < 0 or v_loss < 0 or coalesce(v_actual_rate, 0) < 0 then
      raise exception 'Material fact values must be zero or positive' using errcode = '23514';
    end if;
    if abs(coalesce(v_material.issued_quantity, 0) - v_consumed - v_returned - v_loss) > 0.0001 then
      raise exception 'Material reconciliation failed: issued must equal consumed plus returned plus loss'
        using errcode = '23514';
    end if;

    select i.* into v_item
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and i.product_id = v_material.product_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
    order by i.created_at
    limit 1
    for update of i;

    if not found then
      raise exception 'Warehouse request item is missing for operation material' using errcode = '23514';
    end if;
    if coalesce(v_item.return_received_quantity, 0) + 0.000001 < v_returned then
      raise exception 'Declared material return has not been accepted by warehouse' using errcode = '23514';
    end if;
    if coalesce(v_item.substitution_status, 'none') not in ('none', 'approved') then
      raise exception 'Material substitution is not approved' using errcode = '23514';
    end if;
    if abs(coalesce(v_item.consumed_quantity, 0) - v_consumed) > 0.0001
       or abs(coalesce(v_item.returned_quantity, 0) - v_returned) > 0.0001
       or abs(coalesce(v_item.loss_quantity, 0) - v_loss) > 0.0001
       or coalesce(v_item.reconciliation_status, 'pending') <> 'reconciled' then
      raise exception 'Material reconciliation is required before operation close' using errcode = '23514';
    end if;

    update public.operation_materials
    set consumed_quantity = round(v_consumed, 4),
        returned_quantity = round(v_returned, 4),
        loss_quantity = round(v_loss, 4),
        actual_rate = v_actual_rate,
        updated_by_user_id = auth.uid(),
        updated_at = now()
    where id = v_material.id;

    v_material_rows := v_material_rows || jsonb_build_array(jsonb_build_object(
      'material_id', v_material.id,
      'product_id', v_material.product_id,
      'source', 'warehouse',
      'planned_quantity', coalesce(v_material.planned_quantity, 0),
      'issued_quantity', coalesce(v_material.issued_quantity, 0),
      'consumed_quantity', v_consumed,
      'returned_quantity', v_returned,
      'loss_quantity', v_loss,
      'actual_rate', v_actual_rate
    ));
  end loop;

  if exists (
    select 1
    from public.warehouse_issue_request_items i
    join public.warehouse_issue_requests r on r.id = i.request_id
    where r.operation_id = p_operation_id
      and r.company_id = p_company_id
      and i.company_id = p_company_id
      and coalesce(r.warehouse_request_status, '') <> 'cancelled'
      and coalesce(i.reconciliation_status, 'pending') <> 'reconciled'
  ) then
    raise exception 'Material reconciliation is required before operation close' using errcode = '23514';
  end if;

  if coalesce(v_operation.operation_category_slug, '') = 'harvesting'
     or coalesce(v_operation.operation_type_slug, '') = 'harvesting' then
    if exists (
      select 1
      from public.tickets t
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and coalesce(t.is_voided, false) = false
        and not (t.is_finalized or t.status::text in ('finalized', 'closed'))
    ) then
      raise exception 'Linked weighbridge tickets must be finalized before harvest completion'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.tickets t
      where t.company_id = p_company_id
        and t.linked_operation_id = p_operation_id
        and t.op_type = 'harvest_incoming'
        and coalesce(t.is_voided, false) = false
        and (t.is_finalized or t.status::text in ('finalized', 'closed'))
    ) then
      raise exception 'Finalized harvest weighbridge ticket is required before completion'
        using errcode = '23514';
    end if;
  end if;

  return v_material_rows;
end;
$$;

revoke all on function public.operation_completion_dependencies_v12(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

comment on function public.operation_completion_dependencies_v12(uuid, uuid, uuid, jsonb)
  is 'Validates crop-mix seed completion from exact reconciled warehouse component rows; preserves weighbridge seed issue for ordinary planting.';
