begin;

-- One legal identity may act as supplier and buyer without duplicating its tax identity.
alter table public.counterparties
  add column if not exists roles text[] not null default '{}'::text[],
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists short_name text;

alter table public.global_counterparties
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists short_name text;

update public.counterparties
set roles = case counterparty_type
  when 'both' then array['supplier', 'buyer']::text[]
  when 'supplier' then array['supplier']::text[]
  when 'buyer' then array['buyer']::text[]
  when 'carrier' then array['carrier']::text[]
  when 'service' then array['service']::text[]
  else array[counterparty_type]::text[]
end
where cardinality(roles) = 0;

alter table public.counterparties
  drop constraint if exists counterparties_roles_check,
  add constraint counterparties_roles_check check (
    cardinality(roles) > 0
    and roles <@ array['supplier', 'buyer', 'carrier', 'service', 'other']::text[]
  );

create or replace function public.link_global_counterparty_role_to_company_v2(
  p_company_id uuid,
  p_global_counterparty_id uuid,
  p_role text
)
returns public.counterparties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_global public.global_counterparties%rowtype;
  v_row public.counterparties%rowtype;
  v_roles text[];
begin
  if p_role not in ('supplier', 'buyer') then raise exception 'Unsupported counterparty role'; end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin access required' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_global from public.global_counterparties
  where id = p_global_counterparty_id and archived = false and is_active = true;
  if not found then raise exception 'Global counterparty is unavailable'; end if;

  select * into v_row from public.counterparties
  where company_id = p_company_id
    and (global_counterparty_id = v_global.id or (country_code = v_global.country_code and bin_iin = v_global.tax_id))
  order by (global_counterparty_id = v_global.id) desc limit 1 for update;
  if found then
    if v_row.global_counterparty_id is not null and v_row.global_counterparty_id <> v_global.id then
      raise exception 'Tax identity is linked to another global counterparty';
    end if;
    v_roles := array(select distinct value from unnest(coalesce(v_row.roles, '{}'::text[]) || p_role) value order by value);
    update public.counterparties set
      global_counterparty_id = v_global.id,
      name = v_global.legal_name,
      bin_iin = v_global.tax_id,
      country_code = v_global.country_code,
      roles = v_roles,
      counterparty_type = case when v_roles @> array['supplier','buyer']::text[] then 'both' else p_role end,
      is_active = true,
      archived = false
    where id = v_row.id returning * into v_row;
  else
    insert into public.counterparties(
      company_id, global_counterparty_id, name, counterparty_type, roles,
      bin_iin, country_code, is_active, archived, created_by
    ) values (
      p_company_id, v_global.id, v_global.legal_name, p_role, array[p_role],
      v_global.tax_id, v_global.country_code, true, false, v_actor.id
    ) returning * into v_row;
  end if;
  return v_row;
end;
$$;

create or replace function public.create_local_counterparty_role_v2(
  p_company_id uuid,
  p_legal_name text,
  p_tax_id text,
  p_country_code text,
  p_role text,
  p_aliases text[] default '{}'::text[]
)
returns public.counterparties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_row public.counterparties%rowtype;
  v_roles text[];
begin
  if p_role not in ('supplier', 'buyer') then raise exception 'Unsupported counterparty role'; end if;
  if nullif(btrim(p_legal_name), '') is null or p_tax_id !~ '^[0-9]+$' or p_country_code not in ('KZ','RU') then
    raise exception 'Invalid counterparty identity';
  end if;
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or v_actor.role not in ('global_admin', 'company_admin') then
    raise exception 'Company admin access required' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Cross-company access denied' using errcode = '42501';
  end if;
  select * into v_row from public.counterparties
  where company_id = p_company_id and country_code = p_country_code and bin_iin = p_tax_id
  limit 1 for update;
  if found then
    v_roles := array(select distinct value from unnest(coalesce(v_row.roles, '{}'::text[]) || p_role) value order by value);
    update public.counterparties set
      roles = v_roles,
      aliases = array(select distinct value from unnest(coalesce(v_row.aliases, '{}'::text[]) || coalesce(p_aliases, '{}'::text[])) value where btrim(value) <> '' order by value),
      counterparty_type = case when v_roles @> array['supplier','buyer']::text[] then 'both' else p_role end,
      is_active = true,
      archived = false
    where id = v_row.id returning * into v_row;
    return v_row;
  end if;
  insert into public.counterparties(
    company_id, name, counterparty_type, roles, aliases, bin_iin, country_code,
    is_active, archived, created_by
  ) values (
    p_company_id, btrim(p_legal_name), p_role, array[p_role], coalesce(p_aliases, '{}'::text[]),
    p_tax_id, p_country_code, true, false, v_actor.id
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.link_global_counterparty_role_to_company_v2(uuid, uuid, text) from public, anon;
revoke all on function public.create_local_counterparty_role_v2(uuid, text, text, text, text, text[]) from public, anon;
grant execute on function public.link_global_counterparty_role_to_company_v2(uuid, uuid, text) to authenticated;
grant execute on function public.create_local_counterparty_role_v2(uuid, text, text, text, text, text[]) to authenticated;

-- Invoice receipts use one document with line-specific warehouses and catalog stock units.
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
set search_path = ''
as $$
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
  if p_driver_id is not null and not exists (
    select 1 from public.reference_specialists where id = p_driver_id and company_id = p_company_id and status = 'active' and archived = false
  ) then raise exception 'Driver is unavailable'; end if;

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
$$;

revoke all on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) from public, anon;
grant execute on function public.create_supplier_invoice_atomic_v1(uuid,uuid,text,text,jsonb,uuid,uuid,uuid,text) to authenticated;

-- Inventory approval lifecycle. Counters never receive permission to post ledger adjustments.
alter table public.warehouse_inventory_documents
  add column if not exists assigned_to uuid references public.profiles(id) on delete restrict,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references public.profiles(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejection_comment text;

alter table public.warehouse_inventory_items
  add column if not exists batch_id_text text,
  add column if not exists batch_class text;

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_status_check;
alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_completion_check;

update public.warehouse_inventory_documents
set assigned_to = coalesce(assigned_to, started_by),
    approved_at = case when status = 'completed' then coalesce(completed_at, updated_at) else approved_at end,
    approved_by = case when status = 'completed' then coalesce(completed_by, started_by) else approved_by end,
    status = case when status = 'completed' then 'approved' else status end;

alter table public.warehouse_inventory_items
  drop constraint if exists warehouse_inventory_items_identity_unique;
create unique index if not exists warehouse_inventory_items_identity_v2_uidx
  on public.warehouse_inventory_items(
    inventory_id, product_id, uom,
    coalesce(batch_id_text, ''), coalesce(batch_class, 'material')
  );

alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_status_check;
alter table public.warehouse_inventory_documents drop constraint if exists warehouse_inventory_documents_completion_check;
alter table public.warehouse_inventory_documents add constraint warehouse_inventory_documents_status_check
  check (status in ('in_progress','awaiting_approval','approved','rejected','cancelled'));
alter table public.warehouse_inventory_documents add constraint warehouse_inventory_documents_approval_check check (
  (status in ('in_progress','rejected') and approved_at is null and cancelled_at is null)
  or (status = 'awaiting_approval' and submitted_at is not null and submitted_by is not null and approved_at is null and cancelled_at is null)
  or (status = 'approved' and approved_at is not null and approved_by is not null and completed_at is not null and completed_by is not null and cancelled_at is null)
  or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and approved_at is null)
);

drop index if exists public.warehouse_inventory_one_active_per_warehouse;
create unique index warehouse_inventory_one_active_per_warehouse
  on public.warehouse_inventory_documents(warehouse_id)
  where status in ('in_progress','awaiting_approval','rejected');

create or replace function public.prevent_warehouse_movement_during_inventory_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reason_type <> 'warehouse_inventory_adjustment' and exists (
    select 1 from public.warehouse_inventory_documents d
    where d.company_id = new.company_id and d.warehouse_id = new.warehouse_id
      and d.status in ('in_progress','awaiting_approval','rejected')
  ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.inventory_actor_v2(p_company_id uuid, p_roles text[])
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid() and status = 'active';
  if not found or not (v_actor.role = any(p_roles)) then raise exception 'Inventory action is forbidden' using errcode='42501'; end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then raise exception 'Cross-company access denied' using errcode='42501'; end if;
  return v_actor;
end;
$$;
revoke all on function public.inventory_actor_v2(uuid,text[]) from public,anon,authenticated;

create or replace function public.start_warehouse_inventory_v2(
  p_company_id uuid, p_warehouse_id uuid, p_assigned_to uuid, p_notes text, p_inventory_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_assignee public.profiles%rowtype; v_warehouse public.warehouses%rowtype; v_at timestamptz:=clock_timestamp(); v_count integer; v_no text;
begin
  v_actor := public.inventory_actor_v2(p_company_id, array['global_admin','company_admin']);
  select * into v_warehouse from public.warehouses where id=p_warehouse_id and company_id=p_company_id and coalesce(archived,false)=false and coalesce(is_archived,false)=false;
  if not found then raise exception 'Warehouse is unavailable'; end if;
  select * into v_assignee from public.profiles where id=p_assigned_to and company_id=p_company_id and status='active';
  if not found then raise exception 'Assigned counter is unavailable'; end if;
  if coalesce(v_warehouse.warehouse_type,'') in ('grain','seed','harvest','crop','elevator') then
    if v_assignee.role <> 'weighman' then raise exception 'Grain warehouse inventory must be assigned to a weighbridge operator'; end if;
  elsif v_assignee.role not in ('warehouse','warehouse_operator') then
    raise exception 'Warehouse inventory must be assigned to a warehousekeeper';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_warehouse_id::text||':inventory',0));
  if exists(select 1 from public.warehouse_inventory_documents where warehouse_id=p_warehouse_id and status in ('in_progress','awaiting_approval','rejected')) then raise exception 'На складе уже проводится инвентаризация'; end if;
  v_no := 'INV-'||upper(substr(replace(p_inventory_id::text,'-',''),1,16));
  insert into public.warehouse_inventory_documents(id,company_id,inventory_no,warehouse_id,status,snapshot_at,started_at,started_by,assigned_to,notes)
  values(p_inventory_id,p_company_id,v_no,p_warehouse_id,'in_progress',v_at,v_at,v_actor.id,p_assigned_to,nullif(btrim(coalesce(p_notes,'')),''));
  insert into public.warehouse_inventory_items(inventory_id,company_id,product_id,product_name_snapshot,product_type,uom,book_quantity,discovered,batch_id_text,batch_class)
  select p_inventory_id,p_company_id,b.product_id,coalesce(nullif(p.trade_name,''),p.name),lower(coalesce(p.product_type,p.type,p.category)),b.uom,round(b.quantity,3),false,b.batch_id_text,b.batch_class
  from (
    select public.warehouse_canonical_product_id_v1(p_company_id,s.product_id) product_id, public.canonical_stock_uom(s.uom) uom,
      nullif(btrim(coalesce(s.batch_id_text,s.batch_id,'')),'') batch_id_text, coalesce(nullif(s.batch_class,''),'material') batch_class,
      sum(s.delta_qty_signed)::numeric quantity
    from public.stock_ledger_entries s where s.company_id=p_company_id and s.warehouse_id=p_warehouse_id
    group by 1,2,3,4 having sum(s.delta_qty_signed)>0.000001
  ) b join public.products p on p.id=b.product_id;
  get diagnostics v_count=row_count;
  update public.warehouse_inventory_documents set item_count=v_count,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'inventory_no',v_no,'status','in_progress','assigned_to',p_assigned_to,'item_count',v_count);
end;
$$;

create or replace function public.save_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_input jsonb; v_item public.warehouse_inventory_items%rowtype; v_actual numeric; v_saved int:=0;
begin
  v_actor := public.inventory_actor_v2(p_company_id,array['global_admin','warehouse','warehouse_operator','weighman']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_actor.role<>'global_admin' and v_actor.id<>v_doc.assigned_to then raise exception 'Only the assigned counter can enter quantities' using errcode='42501'; end if;
  if v_doc.status not in ('in_progress','rejected') then raise exception 'Inventory is not editable'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Inventory items must be an array'; end if;
  for v_input in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_actual:=nullif(v_input->>'actual_quantity','')::numeric;
    if v_actual is null or v_actual<0 then raise exception 'Фактическое количество должно быть нулём или положительным'; end if;
    select * into v_item from public.warehouse_inventory_items where id=(v_input->>'item_id')::uuid and inventory_id=p_inventory_id for update;
    if not found then raise exception 'Строка инвентаризации не найдена'; end if;
    update public.warehouse_inventory_items set actual_quantity=round(v_actual,3),difference_quantity=round(v_actual-book_quantity,3),updated_at=clock_timestamp() where id=v_item.id;
    v_saved:=v_saved+1;
  end loop;
  update public.warehouse_inventory_documents d set status='in_progress',rejected_at=null,rejected_by=null,rejection_comment=null,
    difference_count=(select count(*) from public.warehouse_inventory_items i where i.inventory_id=d.id and abs(coalesce(i.difference_quantity,0))>0.000001),updated_at=clock_timestamp()
  where d.id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'saved_items',v_saved,'status','in_progress');
end;
$$;

create or replace function public.submit_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','warehouse','warehouse_operator','weighman']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_actor.role<>'global_admin' and v_actor.id<>v_doc.assigned_to then raise exception 'Only the assigned counter can submit' using errcode='42501'; end if;
  if v_doc.status not in ('in_progress','rejected') then raise exception 'Inventory cannot be submitted'; end if;
  if exists(select 1 from public.warehouse_inventory_items where inventory_id=p_inventory_id and actual_quantity is null) then raise exception 'Укажите фактическое количество для всех позиций'; end if;
  update public.warehouse_inventory_documents set status='awaiting_approval',submitted_at=v_at,submitted_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','awaiting_approval','ledger_rows',0);
end;
$$;

create or replace function public.approve_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_item public.warehouse_inventory_items%rowtype; v_current numeric; v_diff numeric; v_ledger uuid; v_at timestamptz:=clock_timestamp(); v_rows int:=0;
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_doc.status='approved' then return jsonb_build_object('inventory_id',p_inventory_id,'status','approved','idempotent_replay',true); end if;
  if v_doc.status<>'awaiting_approval' then raise exception 'Inventory is not awaiting approval'; end if;
  if v_actor.id=v_doc.assigned_to then raise exception 'Counter cannot approve own inventory' using errcode='42501'; end if;
  for v_item in select * from public.warehouse_inventory_items where inventory_id=p_inventory_id order by id for update loop
    select coalesce(sum(s.delta_qty_signed),0) into v_current from public.stock_ledger_entries s where s.company_id=p_company_id and s.warehouse_id=v_doc.warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id,s.product_id)=v_item.product_id and public.canonical_stock_uom(s.uom)=v_item.uom
      and nullif(btrim(coalesce(s.batch_id_text,s.batch_id,'')),'') is not distinct from v_item.batch_id_text
      and coalesce(nullif(s.batch_class,''),'material')=coalesce(v_item.batch_class,'material');
    if abs(v_current-v_item.book_quantity)>0.000001 then raise exception 'Учётный остаток изменился после начала инвентаризации'; end if;
    v_diff:=round(v_item.actual_quantity-v_item.book_quantity,3);
    if abs(v_diff)<=0.000001 then continue; end if;
    v_ledger:=gen_random_uuid();
    insert into public.stock_ledger_entries(id,company_id,product_id,warehouse_id,direction,quantity,uom,delta_qty_signed,reason_type,reason_ref_id,batch_id_text,batch_class,occurred_at,created_by,notes,mass_kg,unit_source,unit_contract_version)
    values(v_ledger,p_company_id,v_item.product_id,v_doc.warehouse_id,case when v_diff>0 then 'in'::public.ledger_direction else 'out'::public.ledger_direction end,abs(v_diff),v_item.uom,v_diff,'warehouse_inventory_adjustment',p_inventory_id,v_item.batch_id_text,coalesce(v_item.batch_class,'material'),v_at,v_actor.id,'Инвентаризация '||v_doc.inventory_no,case when v_item.uom='kg' then abs(v_diff) else null end,'warehouse_inventory:'||p_inventory_id::text,2);
    update public.warehouse_inventory_items set adjustment_ledger_entry_id=v_ledger,difference_quantity=v_diff,updated_at=v_at where id=v_item.id;
    v_rows:=v_rows+1;
  end loop;
  update public.warehouse_inventory_documents set status='approved',approved_at=v_at,approved_by=v_actor.id,completed_at=v_at,completed_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','approved','ledger_rows',v_rows,'idempotent_replay',false);
end;
$$;

create or replace function public.reject_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid,p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  if nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'Комментарий для пересчёта обязателен'; end if;
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found or v_doc.status<>'awaiting_approval' then raise exception 'Inventory is not awaiting approval'; end if;
  if v_actor.id=v_doc.assigned_to then raise exception 'Counter cannot reject own inventory' using errcode='42501'; end if;
  update public.warehouse_inventory_documents set status='rejected',rejected_at=v_at,rejected_by=v_actor.id,rejection_comment=btrim(p_comment),updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','rejected','ledger_rows',0);
end;
$$;

create or replace function public.cancel_warehouse_inventory_v2(p_company_id uuid,p_inventory_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor public.profiles%rowtype; v_doc public.warehouse_inventory_documents%rowtype; v_at timestamptz:=clock_timestamp();
begin
  v_actor:=public.inventory_actor_v2(p_company_id,array['global_admin','company_admin']);
  select * into v_doc from public.warehouse_inventory_documents where id=p_inventory_id and company_id=p_company_id for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  if v_doc.status='approved' then raise exception 'Approved inventory cannot be cancelled'; end if;
  update public.warehouse_inventory_documents set status='cancelled',cancelled_at=v_at,cancelled_by=v_actor.id,updated_at=v_at where id=p_inventory_id;
  return jsonb_build_object('inventory_id',p_inventory_id,'status','cancelled');
end;
$$;

revoke execute on function public.start_warehouse_inventory_v1(uuid,uuid,text,uuid) from authenticated;
revoke execute on function public.save_warehouse_inventory_v1(uuid,uuid,jsonb) from authenticated;
revoke execute on function public.complete_warehouse_inventory_v1(uuid,uuid) from authenticated;
revoke execute on function public.cancel_warehouse_inventory_v1(uuid,uuid) from authenticated;
revoke all on function public.start_warehouse_inventory_v2(uuid,uuid,uuid,text,uuid) from public,anon;
revoke all on function public.save_warehouse_inventory_v2(uuid,uuid,jsonb) from public,anon;
revoke all on function public.submit_warehouse_inventory_v2(uuid,uuid) from public,anon;
revoke all on function public.approve_warehouse_inventory_v2(uuid,uuid) from public,anon;
revoke all on function public.reject_warehouse_inventory_v2(uuid,uuid,text) from public,anon;
revoke all on function public.cancel_warehouse_inventory_v2(uuid,uuid) from public,anon;
grant execute on function public.start_warehouse_inventory_v2(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.save_warehouse_inventory_v2(uuid,uuid,jsonb) to authenticated;
grant execute on function public.submit_warehouse_inventory_v2(uuid,uuid) to authenticated;
grant execute on function public.approve_warehouse_inventory_v2(uuid,uuid) to authenticated;
grant execute on function public.reject_warehouse_inventory_v2(uuid,uuid,text) to authenticated;
grant execute on function public.cancel_warehouse_inventory_v2(uuid,uuid) to authenticated;

comment on table public.warehouse_inventory_documents is 'System-managed inventory count and company-admin approval lifecycle.';

commit;
notify pgrst, 'reload schema';
