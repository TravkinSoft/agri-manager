-- TZ315 S16: allow a measured drying deviation only inside the explicit
-- operational tolerance. The deviation remains visible and auditable; it is
-- never converted into an approved process loss by this function.

create or replace function public.close_processing_material_balance_v1(
  p_transformation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.batch_transformations%rowtype;
  v_input numeric := 0;
  v_stock_output numeric := 0;
  v_process_loss numeric := 0;
  v_input_moisture numeric;
  v_output_moisture numeric;
  v_input_coverage numeric := 0;
  v_output_coverage numeric := 0;
  v_dry_matter numeric;
  v_theoretical_output numeric;
  v_moisture_loss numeric := 0;
  v_actual_shrink numeric := 0;
  v_delta numeric := 0;
  v_tolerance_absolute numeric := 10;
  v_tolerance_relative_percent numeric := 0.05;
  v_tolerance_relative_kg numeric := 0;
  v_tolerance_effective_kg numeric := 0.001;
  v_is_drying boolean := false;
  v_snapshot jsonb;
  v_now timestamptz := now();
  v_input_row record;
  v_batch public.inventory_batches%rowtype;
  v_existing_out numeric;
  v_needed_out numeric;
  v_source_out_total numeric := 0;
  v_output_in_total numeric := 0;
  v_moisture_doc_key text;
begin
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  select * into v_t from public.batch_transformations where id=p_transformation_id for update;
  if not found then raise exception 'PROCESSING_NOT_FOUND' using errcode='P0002'; end if;
  perform public.tz297_assert_processing_actor_v1(v_t.company_id,p_actor_user_id,array['global_admin','company_admin','director']);
  if v_t.status='voided' then raise exception 'PROCESSING_VOIDED' using errcode='23514'; end if;
  if v_t.processing_state='processing_closed' then
    return coalesce(v_t.balance_snapshot,'{}'::jsonb) || jsonb_build_object('ok',true,'idempotent_replay',true);
  end if;
  if v_t.processing_state <> 'processing_pending_outputs' then raise exception 'PROCESSING_SOFT_FINISH_REQUIRED' using errcode='23514'; end if;

  perform 1 from public.batch_transformation_inputs where transformation_id=v_t.id order by batch_id for update;
  perform 1 from public.inventory_batches b join public.batch_transformation_inputs i on i.batch_id=b.id where i.transformation_id=v_t.id order by b.id for update of b;
  perform 1 from public.batch_transformation_outputs where transformation_id=v_t.id order by id for update;
  perform 1 from public.batch_transformation_losses where transformation_id=v_t.id order by id for update;

  if exists(select 1 from public.tickets where linked_processing_id=v_t.id and not is_voided and not is_finalized) then
    raise exception 'PROCESSING_OPEN_OUTPUT_TICKETS' using errcode='23514';
  end if;

  if exists(
    select 1
    from public.batch_transformation_outputs o
    left join public.tickets tk
      on tk.id=o.source_ticket_id
     and tk.company_id=o.company_id
    where o.transformation_id=v_t.id
      and o.output_type in ('main_product','byproduct','stock_waste')
      and (
        tk.id is null
        or tk.company_id is distinct from v_t.company_id
        or (not coalesce(tk.is_voided,false) and tk.status<>'voided' and not tk.is_finalized)
      )
  ) then
    raise exception 'PROCESSING_OUTPUT_TICKET_REQUIRED' using errcode='23514';
  end if;

  select coalesce(sum(input_weight_kg),0),
    sum(input_weight_kg*moisture_percent) filter(where moisture_percent is not null)/nullif(sum(input_weight_kg) filter(where moisture_percent is not null),0),
    coalesce(sum(input_weight_kg) filter(where moisture_percent is not null),0)
  into v_input,v_input_moisture,v_input_coverage
  from public.batch_transformation_inputs where transformation_id=v_t.id;

  select coalesce(sum(o.output_weight_kg) filter(where o.output_type in ('main_product','byproduct','stock_waste')),0),
    sum(o.output_weight_kg*o.moisture_percent) filter(where o.output_type in ('main_product','byproduct','stock_waste') and o.moisture_percent is not null)
      /nullif(sum(o.output_weight_kg) filter(where o.output_type in ('main_product','byproduct','stock_waste') and o.moisture_percent is not null),0),
    coalesce(sum(o.output_weight_kg) filter(where o.output_type in ('main_product','byproduct','stock_waste') and o.moisture_percent is not null),0)
  into v_stock_output,v_output_moisture,v_output_coverage
  from public.batch_transformation_outputs o
  join public.tickets tk on tk.id=o.source_ticket_id and tk.company_id=o.company_id
  where o.transformation_id=v_t.id and not coalesce(tk.is_voided,false) and tk.status<>'voided';

  select coalesce(sum(qty_kg),0) into v_process_loss
  from public.batch_transformation_losses
  where transformation_id=v_t.id and loss_type<>'moisture_loss' and approved_by is not null and approved_at is not null;

  if v_input<=0 then raise exception 'PROCESSING_INPUT_REQUIRED' using errcode='23514'; end if;
  v_is_drying := coalesce(v_t.processing_method,'') in ('MECHANICAL_DRYING','NATURAL_DRYING') or v_t.transformation_type='drying';
  if v_is_drying then
    if v_input_moisture is null or v_output_moisture is null then raise exception 'PROCESSING_DRYING_MOISTURE_REQUIRED' using errcode='23514'; end if;
    if abs(v_input_coverage-v_input)>0.001 or abs(v_output_coverage-v_stock_output)>0.001 then
      raise exception 'PROCESSING_DRYING_MOISTURE_COVERAGE_REQUIRED|%|%|%|%',
        v_input_coverage,v_input,v_output_coverage,v_stock_output using errcode='23514';
    end if;
    if v_output_moisture>=100 then raise exception 'PROCESSING_DRYING_MOISTURE_INVALID' using errcode='23514'; end if;
    v_dry_matter := v_input*(1-v_input_moisture/100);
    v_theoretical_output := v_dry_matter/(1-v_output_moisture/100);
    v_moisture_loss := greatest(v_input-v_theoretical_output,0);
    v_tolerance_relative_kg := v_input*v_tolerance_relative_percent/100;
    v_tolerance_effective_kg := greatest(v_tolerance_absolute,v_tolerance_relative_kg);
  end if;

  v_actual_shrink := v_input-v_stock_output-v_process_loss;
  v_delta := round(v_actual_shrink-v_moisture_loss,3);
  if abs(v_delta)>v_tolerance_effective_kg then
    raise exception 'PROCESSING_BALANCE_TOLERANCE_EXCEEDED|%|%', v_delta, round(v_tolerance_effective_kg,3) using errcode='23514';
  end if;

  -- Drying shrink is a measured physical fate, not an approved discretionary
  -- process loss. Store one immutable document with expected/actual/deviation,
  -- then consume the actual shrink as a no-ticket source OUT.
  if v_is_drying and v_actual_shrink>0.001 then
    v_moisture_doc_key := 'system:drying-shrink:'||v_t.id::text;
    insert into public.batch_transformation_losses(
      company_id,transformation_id,loss_type,qty_kg,calculation_json,reason,idempotency_key
    ) values (
      v_t.company_id,v_t.id,'moisture_loss',round(v_actual_shrink,3),
      jsonb_build_object(
        'algorithm_version','drying_mass_balance_tolerance_v1',
        'theoretical_output_kg',round(v_theoretical_output,3),
        'expected_moisture_loss_kg',round(v_moisture_loss,3),
        'actual_shrink_kg',round(v_actual_shrink,3),
        'deviation_kg',v_delta,
        'tolerance_absolute_kg',v_tolerance_absolute,
        'tolerance_relative_percent',v_tolerance_relative_percent,
        'tolerance_relative_kg',round(v_tolerance_relative_kg,3),
        'tolerance_kg',round(v_tolerance_effective_kg,3),
        'within_tolerance',true
      ),
      'Фактическая усушка по закрытому материальному балансу',v_moisture_doc_key
    ) on conflict(company_id,transformation_id,idempotency_key) do nothing;

    if not exists(
      select 1 from public.batch_transformation_losses l
      where l.company_id=v_t.company_id and l.transformation_id=v_t.id
        and l.idempotency_key=v_moisture_doc_key and l.loss_type='moisture_loss'
        and abs(l.qty_kg-round(v_actual_shrink,3))<=0.001
    ) then
      raise exception 'PROCESSING_MOISTURE_LOSS_CONFLICT' using errcode='23514';
    end if;

    v_needed_out := round(v_actual_shrink,3);
    for v_input_row in
      select i.batch_id,i.warehouse_from_id,sum(i.input_weight_kg) input_weight_kg,
        coalesce((select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle
          where sle.company_id=v_t.company_id and sle.inventory_batch_id=i.batch_id and sle.warehouse_id=i.warehouse_from_id
            and sle.processing_id=v_t.id and (
              (not coalesce(sle.is_storno,false) and sle.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss'))
              or sle.storno_of_entry_id in (
                select base.id from public.stock_ledger_entries base
                where base.company_id=v_t.company_id and base.processing_id=v_t.id
                  and base.inventory_batch_id=i.batch_id and base.warehouse_id=i.warehouse_from_id
                  and not coalesce(base.is_storno,false)
                  and base.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss')
              )
            )),0) already_out
      from public.batch_transformation_inputs i
      where i.transformation_id=v_t.id
      group by i.batch_id,i.warehouse_from_id
      order by min(i.created_at),i.batch_id,i.warehouse_from_id
    loop
      exit when v_needed_out<=0.001;
      select * into v_batch from public.inventory_batches where id=v_input_row.batch_id;
      v_existing_out := least(v_needed_out,greatest(v_input_row.input_weight_kg-v_input_row.already_out,0));
      if v_existing_out>0 then
        insert into public.stock_ledger_entries(company_id,processing_id,product_id,crop_id,variety_id,reproduction_id,
          batch_id_text,batch_class,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,reason_ref_id,
          occurred_at,created_by,inventory_batch_id,notes,mass_kg,unit_source,unit_contract_version)
        values(v_t.company_id,v_t.id,coalesce(v_batch.product_id,v_batch.crop_id),v_batch.crop_id,v_batch.variety_id,v_batch.reproduction_id,
          v_batch.id::text,coalesce(v_batch.batch_class,'commodity'),v_input_row.warehouse_from_id,'out',v_existing_out,'kg',-v_existing_out,
          'processing_moisture_loss',v_t.id,v_now,p_actor_user_id,v_batch.id,
          'TZ315 measured drying shrink',v_existing_out,'processing.material_balance',2);
        v_needed_out := v_needed_out-v_existing_out;
      end if;
    end loop;
    if v_needed_out>0.001 then raise exception 'PROCESSING_SOURCE_BALANCE_CHANGED' using errcode='40001'; end if;
  end if;

  -- Approved non-moisture losses remain separate, explicit documents.
  v_needed_out := round(v_process_loss,3);
  if v_needed_out>0 then
    for v_input_row in
      select i.batch_id,i.warehouse_from_id,sum(i.input_weight_kg) input_weight_kg,
        coalesce((select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle
          where sle.company_id=v_t.company_id and sle.inventory_batch_id=i.batch_id and sle.warehouse_id=i.warehouse_from_id
            and sle.processing_id=v_t.id and (
              (not coalesce(sle.is_storno,false) and sle.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss'))
              or sle.storno_of_entry_id in (
                select base.id from public.stock_ledger_entries base
                where base.company_id=v_t.company_id and base.processing_id=v_t.id
                  and base.inventory_batch_id=i.batch_id and base.warehouse_id=i.warehouse_from_id
                  and not coalesce(base.is_storno,false)
                  and base.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss')
              )
            )),0) already_out
      from public.batch_transformation_inputs i
      where i.transformation_id=v_t.id
      group by i.batch_id,i.warehouse_from_id
      order by min(i.created_at),i.batch_id,i.warehouse_from_id
    loop
      exit when v_needed_out<=0.001;
      select * into v_batch from public.inventory_batches where id=v_input_row.batch_id;
      v_existing_out := least(v_needed_out,greatest(v_input_row.input_weight_kg-v_input_row.already_out,0));
      if v_existing_out>0 then
        insert into public.stock_ledger_entries(company_id,processing_id,product_id,crop_id,variety_id,reproduction_id,
          batch_id_text,batch_class,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,reason_ref_id,
          occurred_at,created_by,inventory_batch_id,notes,mass_kg,unit_source,unit_contract_version)
        values(v_t.company_id,v_t.id,coalesce(v_batch.product_id,v_batch.crop_id),v_batch.crop_id,v_batch.variety_id,v_batch.reproduction_id,
          v_batch.id::text,coalesce(v_batch.batch_class,'commodity'),v_input_row.warehouse_from_id,'out',v_existing_out,'kg',-v_existing_out,
          'processing_loss',v_t.id,v_now,p_actor_user_id,v_batch.id,'TZ297 approved non-stock process loss',
          v_existing_out,'processing.material_balance',2);
        v_needed_out := v_needed_out-v_existing_out;
      end if;
    end loop;
    if v_needed_out>0.001 then raise exception 'PROCESSING_SOURCE_BALANCE_CHANGED' using errcode='40001'; end if;
  end if;

  -- If output close and hard close share one transaction, force the deferred
  -- child-IN companion trigger now so source OUT postconditions see it.
  execute 'set constraints trg_processing_output_source_debit_v1 immediate';

  -- Canonical source OUT must consume every input allocation exactly once.
  select round(coalesce(sum(-sle.delta_qty_signed),0),3) into v_source_out_total
  from public.stock_ledger_entries sle
  where sle.company_id=v_t.company_id and sle.processing_id=v_t.id
    and (
      (not coalesce(sle.is_storno,false) and sle.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss'))
      or sle.storno_of_entry_id in (
        select base.id from public.stock_ledger_entries base
        where base.company_id=v_t.company_id and base.processing_id=v_t.id
          and not coalesce(base.is_storno,false)
          and base.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss')
      )
    );
  if abs(v_source_out_total-v_input)>0.001 then
    raise exception 'PROCESSING_SOURCE_OUT_POSTCONDITION|%|%', v_source_out_total, v_input using errcode='23514';
  end if;

  if exists(
    select 1
    from (
      select i.batch_id,i.warehouse_from_id,sum(i.input_weight_kg) input_weight_kg
      from public.batch_transformation_inputs i where i.transformation_id=v_t.id
      group by i.batch_id,i.warehouse_from_id
    ) source
    where abs(source.input_weight_kg-coalesce((
      select sum(-sle.delta_qty_signed) from public.stock_ledger_entries sle
      where sle.company_id=v_t.company_id and sle.processing_id=v_t.id
        and sle.inventory_batch_id=source.batch_id and sle.warehouse_id=source.warehouse_from_id
        and (
          (not coalesce(sle.is_storno,false) and sle.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss'))
          or sle.storno_of_entry_id in (
            select base.id from public.stock_ledger_entries base
            where base.company_id=v_t.company_id and base.processing_id=v_t.id
              and base.inventory_batch_id=source.batch_id and base.warehouse_id=source.warehouse_from_id
              and not coalesce(base.is_storno,false)
              and base.reason_type in ('processing_output_source_out','processing_moisture_loss','processing_loss')
          )
        )
    ),0))>0.001
  ) then
    raise exception 'PROCESSING_SOURCE_ALLOCATION_POSTCONDITION' using errcode='23514';
  end if;

  select round(coalesce(sum(sle.delta_qty_signed),0),3) into v_output_in_total
  from public.stock_ledger_entries sle
  where sle.company_id=v_t.company_id and sle.processing_id=v_t.id
    and sle.direction='in' and coalesce(sle.is_storno,false)=false
    and sle.ticket_id in (
      select o.source_ticket_id from public.batch_transformation_outputs o
      join public.tickets tk on tk.id=o.source_ticket_id and tk.company_id=o.company_id
      where o.transformation_id=v_t.id and o.output_type in ('main_product','byproduct','stock_waste')
        and not coalesce(tk.is_voided,false) and tk.status<>'voided'
    );
  if abs(v_output_in_total-v_stock_output)>0.001 then
    raise exception 'PROCESSING_CHILD_IN_POSTCONDITION|%|%', v_output_in_total, v_stock_output using errcode='23514';
  end if;

  for v_input_row in
    select distinct i.batch_id from public.batch_transformation_inputs i
    where i.transformation_id=v_t.id and i.batch_id is not null order by i.batch_id
  loop
    if exists(select 1 from public.harvest_lot_batches hlb where hlb.inventory_batch_id=v_input_row.batch_id) then
      perform private.reconcile_harvest_lot_batch_balance_v1(v_input_row.batch_id);
    else
      perform private.reconcile_warehouse_local_batch_balance_v1(v_input_row.batch_id);
    end if;
  end loop;

  update public.inventory_batches b set
    physical_state=case when v_t.transformation_type='drying' then 'AFTER_DRYING' else 'AFTER_CLEANING' end,
    status=case when b.status='pending_processing_close' then 'conditioned' else b.status end,
    updated_at=v_now
  where b.id in (
    select o.output_batch_id from public.batch_transformation_outputs o
    join public.tickets tk on tk.id=o.source_ticket_id and tk.company_id=o.company_id
    where o.transformation_id=v_t.id and o.output_batch_id is not null
      and not coalesce(tk.is_voided,false) and tk.status<>'voided'
  );

  update public.batch_transformation_outputs o set activated_at=coalesce(o.activated_at,v_now)
  where o.transformation_id=v_t.id and o.output_type in ('main_product','byproduct','stock_waste')
    and exists(select 1 from public.tickets tk where tk.id=o.source_ticket_id and tk.company_id=o.company_id
      and not coalesce(tk.is_voided,false) and tk.status<>'voided');

  v_snapshot := jsonb_build_object(
    'algorithm_version',case when v_is_drying then 'drying_mass_balance_tolerance_v1' else 'processing_mass_balance_v1' end,
    'input_kg',round(v_input,3),'stock_outputs_kg',round(v_stock_output,3),'approved_process_loss_kg',round(v_process_loss,3),
    'theoretical_output_kg',round(v_theoretical_output,3),'moisture_loss_kg',round(v_moisture_loss,3),
    'actual_shrink_kg',round(v_actual_shrink,3),'moisture_deviation_kg',v_delta,'balance_delta_kg',v_delta,
    'tolerance_absolute_kg',case when v_is_drying then v_tolerance_absolute else 0.001 end,
    'tolerance_relative_percent',case when v_is_drying then v_tolerance_relative_percent else 0 end,
    'tolerance_relative_kg',round(v_tolerance_relative_kg,3),'tolerance_kg',round(v_tolerance_effective_kg,3),
    'within_tolerance',abs(v_delta)<=v_tolerance_effective_kg,
    'input_moisture_percent',round(v_input_moisture,3),'output_moisture_percent',round(v_output_moisture,3),
    'input_moisture_coverage_kg',round(v_input_coverage,3),'output_moisture_coverage_kg',round(v_output_coverage,3),
    'closed_at',v_now,'closed_by',p_actor_user_id
  );
  update public.batch_transformations set processing_state='processing_closed',status='completed',completed_at=v_now,
    completed_by=p_actor_user_id,closed_at=v_now,closed_by=p_actor_user_id,closure_version='tz315_s16_v1',
    balance_snapshot=v_snapshot,input_weight_total_kg=v_input,output_weight_total_kg=v_stock_output,
    input_moisture_percent=v_input_moisture,output_moisture_percent=v_output_moisture,
    input_moisture_coverage_kg=v_input_coverage,output_moisture_coverage_kg=v_output_coverage,
    expected_water_loss_kg=v_moisture_loss,mass_difference_kg=v_delta,unexplained_variance_kg=v_delta,updated_at=v_now
  where id=v_t.id;
  insert into public.batch_processing_events(company_id,transformation_id,event_type,actor_type,actor_user_id,idempotency_key,observed_at,payload)
  values(v_t.company_id,v_t.id,'material_balance_closed','user',p_actor_user_id,p_idempotency_key,v_now,v_snapshot)
  on conflict(company_id,transformation_id,event_type,idempotency_key) do nothing;
  return v_snapshot || jsonb_build_object('ok',true,'idempotent_replay',false,'transformation_id',v_t.id);
end;
$$;

revoke all on function public.close_processing_material_balance_v1(uuid,uuid,text) from public, anon;
grant execute on function public.close_processing_material_balance_v1(uuid,uuid,text) to authenticated, service_role;

comment on function public.close_processing_material_balance_v1(uuid,uuid,text)
  is 'TZ315 S16 material balance close: drying deviation is allowed only inside max(10 kg, 0.05% input), remains auditable, and is never auto-approved as process loss.';
