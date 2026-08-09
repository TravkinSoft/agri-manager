CREATE OR REPLACE FUNCTION public.record_finalized_harvest_trace_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_structure public.crop_structure%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_history_name text;
  v_season_year integer;
  v_review_reasons text[] := array[]::text[];
begin
  if new.op_type <> 'harvest_incoming'
     or not new.is_finalized
     or new.status::text <> 'finalized'
     or (old.is_finalized and old.status::text = 'finalized') then return new; end if;

  select cs.* into v_structure from public.crop_structure cs
  where cs.id = new.crop_structure_allocation_id and cs.company_id = new.company_id
    and cs.field_id = new.field_id and cs.season_id = new.season_id
    and coalesce(cs.archived, false) = false;
  if not found then raise exception 'Finalized harvest ticket requires crop structure identity'; end if;
  if v_structure.land_use_type = 'crop' then
    v_review_reasons := string_to_array(
      replace(lower(coalesce(new.review_reason, '')), ' ', ''),
      ','
    );
    if v_structure.crop_id is null then
      raise exception 'Finalized harvest ticket requires crop identity';
    end if;
    if v_structure.variety_id is null
       and (
         not coalesce(new.requires_review, false)
         or not ('missing_variety' = any(v_review_reasons))
       ) then
      raise exception 'Finalized harvest without variety requires review_reason missing_variety';
    end if;
    if v_structure.reproduction_id is null
       and (
         not coalesce(new.requires_review, false)
         or not ('missing_reproduction' = any(v_review_reasons))
       ) then
      raise exception 'Finalized harvest without reproduction requires review_reason missing_reproduction';
    end if;
  end if;
  if v_structure.land_use_type not in ('crop', 'crop_mix') then
    raise exception 'Harvest is not allowed for this land use type';
  end if;

  select ib.* into v_batch from public.inventory_batches ib
  where ib.company_id = new.company_id and ib.source_ticket_id = new.id and ib.origin_type = 'harvest'
  order by ib.created_at, ib.id limit 1;
  if not found then raise exception 'Finalized harvest ticket requires a harvest batch'; end if;
  if v_structure.land_use_type = 'crop_mix' and (
    not v_batch.is_mixed_harvest or jsonb_array_length(v_batch.composition_snapshot) < 2
  ) then raise exception 'Mixed harvest batch requires composition snapshot'; end if;
  if not exists (
    select 1 from public.stock_ledger_entries sle
    where sle.company_id = new.company_id and sle.ticket_id = new.id
      and sle.direction::text = 'in' and sle.batch_id = v_batch.id::text
      and coalesce(sle.is_storno, false) = false
  ) then raise exception 'Finalized harvest ticket requires one linked ledger IN posting'; end if;

  if v_structure.land_use_type = 'crop_mix' then
    v_history_name := coalesce(v_batch.display_name, 'Зерносмесь');
  else
    select coalesce(c.name_ru, c.name) into v_history_name from public.crops c where c.id = v_structure.crop_id;
  end if;
  select s.year into v_season_year from public.seasons s
  where s.id = new.season_id and s.company_id = new.company_id;

  insert into public.field_history_entries (
    company_id, field_id, season_id, season_year, crop_id,
    history_value, token, original_raw_value, source, notes,
    operation_id, crop_structure_id, harvest_ticket_id, harvest_batch_id, material_facts
  ) values (
    new.company_id, new.field_id, new.season_id, v_season_year, v_structure.crop_id,
    coalesce(v_history_name, 'Урожай'), 'weighbridge:' || new.id::text,
    coalesce(new.notes, ''), 'weighbridge_harvest',
    'Урожай принят по талону ' || new.ticket_no,
    new.linked_operation_id, v_structure.id, new.id, v_batch.id,
    case when v_batch.is_mixed_harvest then v_batch.composition_snapshot else '[]'::jsonb end
  ) on conflict (harvest_ticket_id)
    where source = 'weighbridge_harvest' and harvest_ticket_id is not null
  do nothing;

  insert into public.audit_log(company_id, who, entity_type, entity_id, action, new_values)
  values (
    new.company_id, new.closed_by, 'weighbridge_ticket', new.id, 'harvest_finalized',
    jsonb_build_object(
      'ticket_id', new.id, 'batch_id', v_batch.id, 'crop_structure_id', v_structure.id,
      'operation_id', new.linked_operation_id, 'warehouse_id', new.warehouse_to_id,
      'net_weight_kg', new.net_weight_kg, 'is_mixed_harvest', v_batch.is_mixed_harvest,
      'composition_hash', v_batch.composition_hash
    )
  );
  return new;
end;
$function$
