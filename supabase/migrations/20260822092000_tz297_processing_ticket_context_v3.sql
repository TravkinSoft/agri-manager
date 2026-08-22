-- TZ297: expose the unique active processing context to an output ticket before TARE/finalize.
-- This only links metadata. Stock, weights, batches and ledger remain unchanged.

create or replace function public.link_active_processing_ticket_context_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matches uuid[];
  v_impurity_type text;
begin
  if new.linked_processing_id is not null
     or new.harvest_lot_id is null
     or new.warehouse_from_id is null
     or coalesce(new.is_voided, false)
  then
    return new;
  end if;

  select array_agg(candidate.id order by candidate.started_at desc nulls last, candidate.created_at desc, candidate.id)
  into v_matches
  from (
    select t.id, t.started_at, t.created_at
    from public.batch_transformations t
    where t.company_id = new.company_id
      and t.node_warehouse_id = new.warehouse_from_id
      and t.harvest_lot_id = new.harvest_lot_id
      and coalesce(t.source_physical_state, 'SOURCE') = coalesce(new.source_physical_state, 'SOURCE')
      and t.processing_state in ('in_processing', 'processing_pending_outputs')
      and t.status <> 'voided'
    order by t.started_at desc nulls last, t.created_at desc, t.id
    limit 2
  ) candidate;

  if cardinality(v_matches) = 1 then
    new.linked_processing_id := v_matches[1];
    if new.op_type = 'weighbridge_impurities' and new.processing_output_role is null then
      v_impurity_type := coalesce(new.audit_json ->> 'impurity_type', 'other');
      new.processing_output_role := case
        when v_impurity_type in ('soil_and_trash', 'plant_residues') then 'SCREENINGS'
        else 'OTHER'
      end;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.link_active_processing_ticket_context_v1() from public, anon, authenticated;
grant execute on function public.link_active_processing_ticket_context_v1() to service_role;

drop trigger if exists trg_link_active_processing_ticket_context_v1 on public.tickets;
create trigger trg_link_active_processing_ticket_context_v1
before insert or update of harvest_lot_id, warehouse_from_id, source_physical_state, linked_processing_id
on public.tickets
for each row
execute function public.link_active_processing_ticket_context_v1();
