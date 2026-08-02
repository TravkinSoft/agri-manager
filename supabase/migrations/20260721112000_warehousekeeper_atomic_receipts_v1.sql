begin;

create or replace function public.create_warehouse_receipt_atomic_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_received_at timestamptz,
  p_supplier text,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.profiles%rowtype;
  v_warehouse public.warehouses%rowtype;
  v_ticket public.tickets%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_quantity numeric;
  v_uom text;
  v_category text;
  v_payload jsonb;
  v_fingerprint text;
  v_ticket_no text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if not found then
    raise exception 'Active actor profile not found';
  end if;

  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed to create warehouse receipts';
  end if;

  if v_actor.role <> 'global_admin' and v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to receipt company';
  end if;

  if p_idempotency_key is null then
    raise exception 'Idempotency key is required';
  end if;
  if coalesce(nullif(trim(p_supplier), ''), '') = '' then
    raise exception 'Supplier is required';
  end if;
  if p_received_at is null then
    raise exception 'Receipt date is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one receipt line is required';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = p_warehouse_id
    and company_id = p_company_id
    and coalesce(archived, false) = false
    and coalesce(is_archived, false) = false;

  if not found then
    raise exception 'Destination warehouse not found in receipt company';
  end if;

  if v_actor.role in ('warehouse', 'warehouse_operator')
     and coalesce(v_warehouse.warehouse_type, '') not in (
       'agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal'
     ) then
    raise exception 'Warehousekeeper can receive only into an agrochemical warehouse';
  end if;

  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'warehouse_id', p_warehouse_id,
    'received_at', p_received_at,
    'supplier', trim(p_supplier),
    'document_no', nullif(trim(coalesce(p_document_no, '')), ''),
    'notes', nullif(trim(coalesce(p_notes, '')), ''),
    'lines', p_lines
  );
  v_fingerprint := md5(v_payload::text);

  select * into v_ticket
  from public.tickets
  where id = p_idempotency_key
    and company_id = p_company_id;

  if found then
    if coalesce(v_ticket.audit_json ->> 'receipt_fingerprint', '') <> v_fingerprint then
      raise exception 'Idempotency key was already used with another receipt payload';
    end if;
    return jsonb_build_object(
      'receipt_id', v_ticket.id,
      'receipt_no', v_ticket.ticket_no,
      'status', v_ticket.status,
      'idempotent_replay', true
    );
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if coalesce(v_line ->> 'product_id', '') = '' then
      raise exception 'Receipt line product_id is required';
    end if;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if coalesce(v_quantity, 0) <= 0 then
      raise exception 'Receipt line quantity must be greater than zero';
    end if;

    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null)
      and coalesce(archived, false) = false
      and coalesce(is_active, true) = true;

    if not found then
      raise exception 'Receipt material is unavailable for this company';
    end if;

    v_category := lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''));
    if v_category not in ('pesticide', 'fertilizer', 'additive') then
      raise exception 'Only pesticides, fertilizers and additives are allowed in warehouse receipts';
    end if;

    v_uom := lower(trim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit, '')));
    if v_uom not in ('kg', 'l', 'pcs') then
      raise exception 'Receipt line has unsupported stock unit';
    end if;
    if v_uom <> lower(trim(coalesce(v_product.base_uom, v_product.unit, ''))) then
      raise exception 'Receipt unit must match the material stock unit';
    end if;
  end loop;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));

  insert into public.tickets (
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, destination_kind, destination_id,
    warehouse_to_id, responsible_user_id, created_by, weigh_method,
    receipt_mode, supplier_receipt_kind, supplier_document_no,
    manual_correction_reason, notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt',
    'ready_to_close', 'incoming', 'supplier', trim(p_supplier), 'warehouse',
    p_warehouse_id::text, p_warehouse_id, v_actor.id, v_actor.id,
    'manual_override_with_reason', 'direct', 'generic',
    nullif(trim(coalesce(p_document_no, '')), ''), 'Warehouse receipt document',
    nullif(trim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'source', 'warehousekeeper_receipt_v1',
      'receipt_fingerprint', v_fingerprint,
      'receipt_payload', v_payload
    ),
    p_received_at, now()
  ) returning * into v_ticket;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_uom := lower(trim(coalesce(v_line ->> 'uom', v_product.base_uom, v_product.unit)));

    insert into public.ticket_lines (
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      quality_json, mass_kg, unit_source, unit_contract_version, notes
    ) values (
      v_ticket.id, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name, ''), v_product.name),
      v_uom, v_quantity, p_warehouse_id,
      nullif(trim(coalesce(v_line ->> 'lot_number', '')), ''),
      'material', 'material',
      jsonb_strip_nulls(jsonb_build_object(
        'manufactured_at', nullif(v_line ->> 'manufactured_at', ''),
        'expires_at', nullif(v_line ->> 'expires_at', ''),
        'package_count', nullif(v_line ->> 'package_count', '')::numeric,
        'package_size', nullif(v_line ->> 'package_size', '')::numeric
      )),
      case when v_uom = 'kg' then v_quantity else null end,
      'warehouse_receipt:' || v_ticket.id::text, 2,
      nullif(trim(coalesce(v_line ->> 'notes', '')), '')
    );
  end loop;

  perform public.finalize_weighbridge_ticket_v2(v_ticket.id, v_actor.id);

  update public.stock_ledger_entries
  set occurred_at = p_received_at
  where ticket_id = v_ticket.id;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  return jsonb_build_object(
    'receipt_id', v_ticket.id,
    'receipt_no', v_ticket.ticket_no,
    'status', v_ticket.status,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) to authenticated;

comment on function public.create_warehouse_receipt_atomic_v1(
  uuid, uuid, timestamptz, text, text, text, jsonb, uuid
) is 'Creates and finalizes an agrochemical warehouse receipt atomically using tickets, ticket_lines and the canonical stock ledger.';

commit;

notify pgrst, 'reload schema';
