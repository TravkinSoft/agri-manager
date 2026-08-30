-- TZ315 P1: a ticket that supplied an already reversed processing cycle must
-- still be voidable through the canonical ticket storno RPC. Reversal keeps
-- its input/output/loss documents immutable as audit evidence, so the ticket
-- shadow synchronizer must preserve those documents instead of deleting them.
--
-- This corrective migration intentionally sorts after
-- 20260831021500_tz315_processing_wip_route_handoff_v1.sql. Its preflight also
-- fails closed if that WIP trigger body has not been installed yet.

do $migration$
declare
  v_trigger_definition text;
begin
  if to_regprocedure('public.tg_sync_grain_movement_shadow_v1()') is null
     or to_regprocedure('public.sync_grain_movement_shadow_v1(uuid)') is null
     or to_regprocedure('public.attach_route_processing_input_ticket_v1(uuid)') is null
     or to_regprocedure('public.recompute_grain_processing_shadow_v1(uuid)') is null
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_PREREQUISITE_MISSING' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef('public.tg_sync_grain_movement_shadow_v1()'::regprocedure)
  into v_trigger_definition;

  if pg_catalog.strpos(
       v_trigger_definition,
       'perform public.attach_route_processing_input_ticket_v1(new.id);'
     ) = 0
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_REQUIRES_WIP_HANDOFF_V1' using errcode = '55000';
  end if;
end
$migration$;

create or replace function private.reconcile_voided_ticket_processing_shadow_v1(
  p_ticket_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_transformation_id uuid;
begin
  -- Match the lock order used by canonical processing reversal before taking
  -- the immutable receipt table. This prevents a concurrent reversal from
  -- appearing between the preservation predicate and the document cleanup.
  lock table
    public.batch_transformation_inputs,
    public.batch_transformation_outputs
  in share row exclusive mode;
  lock table public.batch_processing_reversals in share row exclusive mode;

  select *
  into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for share;

  if not found then
    raise exception 'TZ315_TICKET_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_ticket.is_finalized
     and not v_ticket.is_voided
     and v_ticket.status = 'finalized'
  then
    raise exception 'TZ315_REVERSED_INPUT_VOID_REQUIRES_VOIDED_TICKET' using errcode = '23514';
  end if;

  -- A source_ticket_id is globally unique through tickets.id. Any processing
  -- document or reversal receipt under another company/season is corruption;
  -- fail closed instead of deleting or silently ignoring it.
  if exists (
    select 1
    from public.batch_transformation_inputs i
    left join public.batch_transformations t on t.id = i.transformation_id
    left join public.batch_processing_reversals r on r.transformation_id = i.transformation_id
    where i.source_ticket_id = p_ticket_id
      and (
        i.company_id is distinct from v_ticket.company_id
        or t.id is null
        or t.company_id is distinct from v_ticket.company_id
        or (r.id is not null and (
          r.company_id is distinct from v_ticket.company_id
          or r.season_id is distinct from t.season_id
        ))
      )
    union all
    select 1
    from public.batch_transformation_outputs o
    left join public.batch_transformations t on t.id = o.transformation_id
    left join public.batch_processing_reversals r on r.transformation_id = o.transformation_id
    where o.source_ticket_id = p_ticket_id
      and (
        o.company_id is distinct from v_ticket.company_id
        or t.id is null
        or t.company_id is distinct from v_ticket.company_id
        or (r.id is not null and (
          r.company_id is distinct from v_ticket.company_id
          or r.season_id is distinct from t.season_id
        ))
      )
  ) then
    raise exception 'TZ315_REVERSED_INPUT_VOID_COMPANY_SEASON_MISMATCH' using errcode = '23514';
  end if;

  -- Snapshot only mutable shadow cycles. Rows belonging to a receipt-backed
  -- reversal remain untouched forever and therefore keep the exact original
  -- ticket-to-processing audit lineage.
  for v_transformation_id in
    select q.transformation_id
    from (
      select i.transformation_id
      from public.batch_transformation_inputs i
      where i.source_ticket_id = p_ticket_id
        and i.company_id = v_ticket.company_id
      union
      select o.transformation_id
      from public.batch_transformation_outputs o
      where o.source_ticket_id = p_ticket_id
        and o.company_id = v_ticket.company_id
    ) q
    where not exists (
      select 1
      from public.batch_processing_reversals r
      where r.transformation_id = q.transformation_id
        and r.company_id = v_ticket.company_id
    )
    order by q.transformation_id
  loop
    delete from public.batch_transformation_inputs i
    where i.source_ticket_id = p_ticket_id
      and i.company_id = v_ticket.company_id
      and i.transformation_id = v_transformation_id
      and not exists (
        select 1
        from public.batch_processing_reversals r
        where r.transformation_id = i.transformation_id
          and r.company_id = v_ticket.company_id
      );

    delete from public.batch_transformation_outputs o
    where o.source_ticket_id = p_ticket_id
      and o.company_id = v_ticket.company_id
      and o.transformation_id = v_transformation_id
      and not exists (
        select 1
        from public.batch_processing_reversals r
        where r.transformation_id = o.transformation_id
          and r.company_id = v_ticket.company_id
      );

    perform public.recompute_grain_processing_shadow_v1(v_transformation_id);
  end loop;
end
$function$;

revoke all on function private.reconcile_voided_ticket_processing_shadow_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.tg_sync_grain_movement_shadow_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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

    if (not new.is_finalized or new.is_voided or new.status <> 'finalized')
       and exists (
         select 1
         from public.batch_transformation_inputs i
         join public.batch_processing_reversals r
           on r.transformation_id = i.transformation_id
         where i.source_ticket_id = new.id
         union all
         select 1
         from public.batch_transformation_outputs o
         join public.batch_processing_reversals r
           on r.transformation_id = o.transformation_id
         where o.source_ticket_id = new.id
       )
    then
      perform private.reconcile_voided_ticket_processing_shadow_v1(new.id);
      return new;
    end if;

    perform public.sync_grain_movement_shadow_v1(new.id);
  end if;
  return new;
end
$function$;

revoke all on function public.tg_sync_grain_movement_shadow_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.tg_sync_grain_movement_shadow_v1()
  to service_role;

notify pgrst, 'reload schema';
