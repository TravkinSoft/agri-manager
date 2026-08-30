-- TZ315 P1: a stock-producing processing output can be the canonical input of
-- the next DRYER/CLEANER stage. Keep the WIP guard: the output must never be
-- replayed by the generic warehouse movement shadow.

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
    perform public.attach_route_processing_input_ticket_v1(new.id);
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
