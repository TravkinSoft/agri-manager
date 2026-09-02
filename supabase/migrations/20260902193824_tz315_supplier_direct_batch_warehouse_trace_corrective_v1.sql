begin;

-- Direct supplier documents keep destination warehouses on ticket_lines because
-- one document may distribute different products to different warehouses.
-- Preserve that canonical contract while retaining the legacy single-warehouse
-- ticket path for weighed supplier receipts.
create or replace function public.populate_supplier_batch_warehouse_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ticket public.tickets%rowtype;
  v_expected_warehouse_id uuid;
  v_matching_warehouse_count integer := 0;
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

  v_expected_warehouse_id := v_ticket.warehouse_to_id;

  if v_expected_warehouse_id is null
     and coalesce(v_ticket.receipt_mode, '') = 'direct' then
    select
      count(distinct line.warehouse_to_id)::integer,
      min(line.warehouse_to_id::text)::uuid
      into v_matching_warehouse_count, v_expected_warehouse_id
    from public.ticket_lines line
    where line.ticket_id = new.source_ticket_id
      and line.company_id = new.company_id
      and line.product_id = new.product_id
      and line.warehouse_to_id is not null
      and (
        (
          nullif(btrim(coalesce(line.lot_id, '')), '') is not null
          and btrim(line.lot_id) = new.batch_code
        )
        or (
          nullif(btrim(coalesce(line.lot_id, '')), '') is null
          and new.batch_code like 'SUP-%-' || left(line.id::text, 8)
        )
      );

    if v_matching_warehouse_count is distinct from 1
       or v_expected_warehouse_id is null then
      raise exception 'Direct supplier batch destination warehouse cannot be resolved unambiguously'
        using errcode = '23514';
    end if;
  end if;

  if v_expected_warehouse_id is null then
    raise exception 'Supplier receipt destination warehouse is missing'
      using errcode = '23514';
  end if;

  if new.warehouse_id is not null
     and new.warehouse_id is distinct from v_expected_warehouse_id then
    raise exception 'Supplier batch warehouse does not match its source ticket'
      using errcode = '23514';
  end if;

  new.warehouse_id := v_expected_warehouse_id;
  new.received_at := coalesce(new.received_at, v_ticket.finalized_at, now());
  new.source_type := coalesce(new.source_type, 'weighbridge_ticket');
  return new;
end
$function$;

alter function public.populate_supplier_batch_warehouse_trace_v1() owner to postgres;
revoke all on function public.populate_supplier_batch_warehouse_trace_v1()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
