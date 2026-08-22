-- TZ297 QA P0 #4: WIP output accounting is finalized atomically and must not
-- be replayed as an ordinary warehouse transfer by the legacy shadow trigger.

create or replace function public.tg_sync_grain_movement_shadow_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
    perform public.sync_grain_movement_shadow_v1(new.id);
  end if;
  return new;
end;
$function$;
