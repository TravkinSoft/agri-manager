-- Weighbridge route contract: a yard stores lots; only dryers and cleaners transform them.

create or replace function public.attach_route_processing_input_ticket_v1(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place_type text;
begin
  select upper(coalesce(w.place_type, 'WAREHOUSE'))
  into v_place_type
  from public.tickets t
  join public.warehouses w
    on w.id = t.warehouse_to_id
   and w.company_id = t.company_id
  where t.id = p_ticket_id;

  if coalesce(v_place_type, 'WAREHOUSE') not in ('DRYER', 'CLEANER') then
    return null;
  end if;

  return public.attach_processing_input_ticket_live_v1(p_ticket_id);
end;
$$;

revoke all on function public.attach_route_processing_input_ticket_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.attach_route_processing_input_ticket_v1(uuid)
  to service_role;

create or replace function public.tg_sync_grain_movement_shadow_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input_transformation_id uuid;
begin
  if new.source_kind = 'processing_wip'
     and new.linked_processing_id is not null
     and new.processing_output_role in ('GRAIN','SCREENINGS','FEED','WASTE','TRIER_WASTE','OTHER')
     and new.is_finalized
     and not new.is_voided
     and new.status = 'finalized'
  then
    return new;
  end if;

  if new.harvest_lot_id is not null
     and (
       old.is_finalized is distinct from new.is_finalized
       or old.status is distinct from new.status
       or old.is_voided is distinct from new.is_voided
     )
  then
    if new.is_finalized and not new.is_voided and new.status = 'finalized' then
      v_input_transformation_id := public.attach_route_processing_input_ticket_v1(new.id);
      if v_input_transformation_id is not null then
        return new;
      end if;
    end if;
    perform public.sync_grain_movement_shadow_v1(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.tg_sync_grain_movement_shadow_v1()
  from public, anon, authenticated;

comment on function public.attach_route_processing_input_ticket_v1(uuid) is
  'Routes finalized lot tickets into DRYER/CLEANER transformations; YARD remains ordinary storage movement.';
