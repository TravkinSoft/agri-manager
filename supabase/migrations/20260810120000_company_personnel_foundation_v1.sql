begin;

alter table public.company_people
  add column if not exists position text,
  add column if not exists department text;

comment on column public.company_people.position is
  'Original personnel position imported from the company source document.';
comment on column public.company_people.department is
  'Company department or business direction from the personnel source document.';

create index if not exists company_people_company_active_role_name_idx
  on public.company_people (company_id, role_type, full_name)
  where status = 'active' and deleted_at is null;

create or replace function public.create_supplier_invoice_atomic_v1(
  p_company_id uuid,
  p_supplier_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_supplier public.counterparties%rowtype;
  v_existing public.tickets%rowtype;
  v_line jsonb;
  v_product public.products%rowtype;
  v_warehouse_id uuid;
  v_quantity numeric;
  v_uom text;
  v_ticket_no text;
  v_line_count integer := 0;
begin
  if p_idempotency_key is null or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'Idempotency key and fingerprint are required';
  end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin','company_admin','warehouse','warehouse_operator','weighman') then
    raise exception 'Actor role is not allowed for supplier invoice' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_supplier from public.counterparties
  where id = p_supplier_id and company_id = p_company_id and is_active = true and archived = false
    and (roles @> array['supplier']::text[] or counterparty_type in ('supplier','both'));
  if not found then raise exception 'Supplier is unavailable'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one invoice line is required';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.reference_vehicles where id = p_vehicle_id and company_id = p_company_id and is_active = true and archived = false
  ) then raise exception 'Vehicle is unavailable'; end if;
  if p_driver_id is not null
    and not exists (
      select 1
      from public.company_people
      where id = p_driver_id
        and company_id = p_company_id
        and status = 'active'
        and deleted_at is null
        and role_type in ('driver', 'mechanic_operator')
    )
    and not exists (
      select 1
      from public.reference_specialists
      where id = p_driver_id
        and company_id = p_company_id
        and status = 'active'
        and archived = false
    )
  then raise exception 'Driver is unavailable'; end if;

  select * into v_existing from public.tickets where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if coalesce(v_existing.audit_json ->> 'request_fingerprint', '') <> p_request_fingerprint then
      raise exception 'Idempotency key was already used with another payload';
    end if;
    return jsonb_build_object('receipt_id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_warehouse_id := nullif(v_line ->> 'warehouse_id', '')::uuid;
    v_quantity := nullif(v_line ->> 'quantity', '')::numeric;
    if v_warehouse_id is null or coalesce(v_quantity, 0) <= 0 then raise exception 'Each line requires warehouse and positive quantity'; end if;
    if not exists (select 1 from public.warehouses where id = v_warehouse_id and company_id = p_company_id and coalesce(archived,false)=false and coalesce(is_archived,false)=false) then
      raise exception 'Line warehouse is unavailable';
    end if;
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid
      and (company_id = p_company_id or company_id is null) and coalesce(archived,false)=false and coalesce(is_active,true)=true;
    if not found then raise exception 'Line product is unavailable'; end if;
    v_uom := lower(btrim(coalesce(v_product.stock_unit, '')));
    if v_uom not in ('kg','l','pcs') then raise exception 'Product stock_unit is required'; end if;
  end loop;

  v_ticket_no := 'WR-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.tickets(
    id, company_id, ticket_no, ticket_type, op_type, status, direction,
    source_kind, source_id, supplier_id, destination_kind, responsible_user_id,
    created_by, weigh_method, receipt_mode, supplier_receipt_kind,
    supplier_document_no, manual_correction_reason, vehicle_id, driver_id,
    notes, audit_json, created_at, updated_at
  ) values (
    p_idempotency_key, p_company_id, v_ticket_no, 'receipt', 'supplier_receipt', 'ready_to_close', 'incoming',
    'supplier', v_supplier.name, v_supplier.id, 'warehouse', v_actor.id,
    v_actor.id, 'manual_override_with_reason', 'direct', 'generic',
    nullif(btrim(coalesce(p_document_no,'')), ''), 'Supplier invoice', p_vehicle_id, p_driver_id,
    nullif(btrim(coalesce(p_notes,'')), ''), jsonb_build_object(
      'source', 'weighbridge_invoice_v1', 'request_fingerprint', p_request_fingerprint,
      'line_count', jsonb_array_length(p_lines)
    ), clock_timestamp(), clock_timestamp()
  );

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_warehouse_id := (v_line ->> 'warehouse_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_uom := lower(btrim(v_product.stock_unit));
    insert into public.ticket_lines(
      ticket_id, company_id, product_id, product_type, product_name_snapshot,
      uom, quantity, warehouse_to_id, lot_id, batch_class, line_type,
      mass_kg, unit_source, unit_contract_version, unit_price, notes
    ) values (
      p_idempotency_key, p_company_id, v_product.id,
      coalesce(v_product.product_type, v_product.type, v_product.category),
      coalesce(nullif(v_product.trade_name,''), v_product.name),
      v_uom, round(v_quantity,3), v_warehouse_id,
      nullif(btrim(coalesce(v_line ->> 'lot_number','')), ''),
      case when coalesce(v_product.is_seed_material,false) then 'seed' else 'material' end,
      'material', case when v_uom='kg' then round(v_quantity,3) else null end,
      'supplier_invoice:' || p_idempotency_key::text, 2,
      nullif(v_line ->> 'unit_price','')::numeric,
      nullif(btrim(coalesce(v_line ->> 'notes','')), '')
    );
    v_line_count := v_line_count + 1;
  end loop;
  perform public.finalize_weighbridge_ticket_v2(p_idempotency_key, v_actor.id);
  return jsonb_build_object('receipt_id', p_idempotency_key, 'receipt_no', v_ticket_no, 'status', 'finalized', 'line_count', v_line_count, 'idempotent_replay', false);
end;
$function$;

revoke all on function public.create_supplier_invoice_atomic_v1(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, text) from public;
grant execute on function public.create_supplier_invoice_atomic_v1(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, text) to authenticated;

commit;
