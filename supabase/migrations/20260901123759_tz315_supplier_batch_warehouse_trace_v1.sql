begin;

-- Supplier receipts use the canonical inventory-batch/ledger contract. The
-- legacy finalizer creates the physical batch before its ledger row, so the
-- destination warehouse must already be present when the ledger trace guard
-- validates product + warehouse + batch identity.
create or replace function public.populate_supplier_batch_warehouse_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ticket public.tickets%rowtype;
begin
  if new.origin_type is distinct from 'supplier'
     or new.source_ticket_id is null then
    return new;
  end if;

  select ticket.*
    into v_ticket
  from public.tickets ticket
  where ticket.id = new.source_ticket_id
    and ticket.company_id = new.company_id
    and ticket.op_type = 'supplier_receipt';

  if not found then
    raise exception 'Supplier batch source ticket is missing or belongs to another company'
      using errcode = '23503';
  end if;

  if v_ticket.warehouse_to_id is null then
    raise exception 'Supplier receipt destination warehouse is missing'
      using errcode = '23514';
  end if;

  if new.warehouse_id is not null
     and new.warehouse_id is distinct from v_ticket.warehouse_to_id then
    raise exception 'Supplier batch warehouse does not match its source ticket'
      using errcode = '23514';
  end if;

  new.warehouse_id := v_ticket.warehouse_to_id;
  new.received_at := coalesce(new.received_at, v_ticket.finalized_at, now());
  new.source_type := coalesce(new.source_type, 'weighbridge_ticket');
  return new;
end
$function$;

alter function public.populate_supplier_batch_warehouse_trace_v1() owner to postgres;
revoke all on function public.populate_supplier_batch_warehouse_trace_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists populate_supplier_batch_warehouse_trace_v1
  on public.inventory_batches;
create trigger populate_supplier_batch_warehouse_trace_v1
before insert or update of source_ticket_id, origin_type, warehouse_id
on public.inventory_batches
for each row
execute function public.populate_supplier_batch_warehouse_trace_v1();

notify pgrst, 'reload schema';

commit;
