-- Integrations for weighbridge workflows

alter table public.warehouse_issue_requests
  add column if not exists linked_ticket_id uuid references public.tickets(id);

create index if not exists idx_warehouse_issue_requests_linked_ticket
  on public.warehouse_issue_requests(linked_ticket_id);

create or replace function public.confirm_processing_document(
  p_processing_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.processing_documents%rowtype;
  v_available numeric;
begin
  select * into v_doc
  from public.processing_documents
  where id = p_processing_id
  for update;

  if not found then
    raise exception 'Processing document not found';
  end if;

  if v_doc.status = 'confirmed' then
    return p_processing_id;
  end if;

  if v_doc.status = 'cancelled' then
    raise exception 'Cancelled processing document cannot be confirmed';
  end if;

  if coalesce(v_doc.input_qty_kg, 0) <= 0 then
    raise exception 'Input quantity must be positive';
  end if;

  if coalesce(v_doc.output_qty_kg, 0) < 0 then
    raise exception 'Output quantity cannot be negative';
  end if;

  v_available := public.get_stock_balance(v_doc.company_id, v_doc.source_warehouse_id, v_doc.product_id);
  if v_available < v_doc.input_qty_kg then
    raise exception 'Insufficient stock for processing. Available %, required %', v_available, v_doc.input_qty_kg;
  end if;

  insert into public.stock_ledger_entries (
    company_id,
    processing_id,
    product_id,
    warehouse_id,
    direction,
    quantity,
    uom,
    delta_qty_signed,
    reason_type,
    reason_ref_id,
    occurred_at,
    created_by,
    notes
  ) values (
    v_doc.company_id,
    v_doc.id,
    v_doc.product_id,
    v_doc.source_warehouse_id,
    'out',
    v_doc.input_qty_kg,
    'kg',
    -abs(v_doc.input_qty_kg),
    'processing_input',
    v_doc.id,
    now(),
    p_actor_user_id,
    v_doc.notes
  );

  if coalesce(v_doc.output_qty_kg, 0) > 0 then
    insert into public.stock_ledger_entries (
      company_id,
      processing_id,
      product_id,
      warehouse_id,
      direction,
      quantity,
      uom,
      delta_qty_signed,
      reason_type,
      reason_ref_id,
      occurred_at,
      created_by,
      notes
    ) values (
      v_doc.company_id,
      v_doc.id,
      v_doc.product_id,
      coalesce(v_doc.destination_warehouse_id, v_doc.source_warehouse_id),
      'in',
      v_doc.output_qty_kg,
      'kg',
      abs(v_doc.output_qty_kg),
      'processing_output',
      v_doc.id,
      now(),
      p_actor_user_id,
      v_doc.notes
    );
  end if;

  update public.processing_documents
  set
    status = 'confirmed',
    confirmed_by = p_actor_user_id,
    confirmed_at = now()
  where id = p_processing_id;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_doc.company_id,
    p_actor_user_id,
    'processing_document',
    p_processing_id::text,
    'confirmed',
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'confirmed', 'input_qty_kg', v_doc.input_qty_kg, 'output_qty_kg', v_doc.output_qty_kg),
    null
  );

  return p_processing_id;
end;
$$;

