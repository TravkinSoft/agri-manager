begin;

create table if not exists public.warehouse_transfer_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  transfer_no text not null,
  source_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  destination_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  canonical_product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity > 0),
  uom text not null check (uom in ('kg', 'l', 'pcs')),
  reserved_quantity numeric(18,3) not null default 0 check (reserved_quantity >= 0),
  notes text,
  status text not null default 'completed' check (status = 'completed'),
  payload_fingerprint text not null,
  posted_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint warehouse_transfer_documents_distinct_warehouses
    check (source_warehouse_id <> destination_warehouse_id),
  constraint warehouse_transfer_documents_company_number_unique
    unique (company_id, transfer_no)
);

create table if not exists public.warehouse_inventory_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  inventory_no text not null,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  snapshot_at timestamptz not null default clock_timestamp(),
  started_at timestamptz not null default clock_timestamp(),
  started_by uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  item_count integer not null default 0 check (item_count >= 0),
  difference_count integer not null default 0 check (difference_count >= 0),
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint warehouse_inventory_documents_company_number_unique
    unique (company_id, inventory_no),
  constraint warehouse_inventory_documents_completion_check check (
    (status = 'in_progress' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and completed_by is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and completed_at is null)
  )
);

create table if not exists public.warehouse_inventory_items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.warehouse_inventory_documents(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  product_type text not null,
  uom text not null check (uom in ('kg', 'l', 'pcs')),
  book_quantity numeric(18,3) not null default 0,
  actual_quantity numeric(18,3),
  difference_quantity numeric(18,3),
  discovered boolean not null default false,
  adjustment_ledger_entry_id uuid references public.stock_ledger_entries(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint warehouse_inventory_items_actual_nonnegative
    check (actual_quantity is null or actual_quantity >= 0),
  constraint warehouse_inventory_items_identity_unique
    unique (inventory_id, product_id, uom)
);

create unique index if not exists warehouse_inventory_one_active_per_warehouse
  on public.warehouse_inventory_documents(warehouse_id)
  where status = 'in_progress';
create index if not exists warehouse_transfer_documents_company_posted_idx
  on public.warehouse_transfer_documents(company_id, posted_at desc);
create index if not exists warehouse_transfer_documents_source_idx
  on public.warehouse_transfer_documents(source_warehouse_id, posted_at desc);
create index if not exists warehouse_transfer_documents_destination_idx
  on public.warehouse_transfer_documents(destination_warehouse_id, posted_at desc);
create index if not exists warehouse_inventory_documents_company_started_idx
  on public.warehouse_inventory_documents(company_id, started_at desc);
create index if not exists warehouse_inventory_items_inventory_idx
  on public.warehouse_inventory_items(inventory_id, product_name_snapshot);

alter table public.warehouse_transfer_documents enable row level security;
alter table public.warehouse_inventory_documents enable row level security;
alter table public.warehouse_inventory_items enable row level security;

drop policy if exists warehouse_transfer_documents_company_read on public.warehouse_transfer_documents;
create policy warehouse_transfer_documents_company_read
  on public.warehouse_transfer_documents for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_transfer_documents.company_id)
    )
  );

drop policy if exists warehouse_inventory_documents_company_read on public.warehouse_inventory_documents;
create policy warehouse_inventory_documents_company_read
  on public.warehouse_inventory_documents for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_inventory_documents.company_id)
    )
  );

drop policy if exists warehouse_inventory_items_company_read on public.warehouse_inventory_items;
create policy warehouse_inventory_items_company_read
  on public.warehouse_inventory_items for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and (p.role = 'global_admin' or p.company_id = warehouse_inventory_items.company_id)
    )
  );

grant select on public.warehouse_transfer_documents to authenticated;
grant select on public.warehouse_inventory_documents to authenticated;
grant select on public.warehouse_inventory_items to authenticated;
revoke insert, update, delete on public.warehouse_transfer_documents from anon, authenticated;
revoke insert, update, delete on public.warehouse_inventory_documents from anon, authenticated;
revoke insert, update, delete on public.warehouse_inventory_items from anon, authenticated;

create or replace function public.warehouse_canonical_product_id_v1(
  p_company_id uuid,
  p_product_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select company_product.id
      from public.products source_product
      join public.products company_product
        on company_product.company_id = p_company_id
       and company_product.master_product_id = coalesce(source_product.master_product_id, source_product.id)
       and coalesce(company_product.archived, false) = false
       and coalesce(company_product.is_active, true) = true
      where source_product.id = p_product_id
      order by company_product.created_at, company_product.id
      limit 1
    ),
    (
      select case
        when source_product.company_id = p_company_id then source_product.id
        else coalesce(source_product.master_product_id, source_product.id)
      end
      from public.products source_product
      where source_product.id = p_product_id
    )
  );
$$;

revoke all on function public.warehouse_canonical_product_id_v1(uuid, uuid) from public, anon, authenticated;

create or replace function public.assert_warehouse_v11_actor_v1(
  p_company_id uuid,
  p_warehouse_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_actor
  from public.profiles
  where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'Active actor profile not found' using errcode = '42501';
  end if;
  if v_actor.role not in ('global_admin', 'company_admin', 'warehouse', 'warehouse_operator') then
    raise exception 'Actor role is not allowed for warehouse operations' using errcode = '42501';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from p_company_id then
    raise exception 'Actor does not belong to warehouse company' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.company_id = p_company_id
      and coalesce(w.archived, false) = false
      and coalesce(w.is_archived, false) = false
      and coalesce(w.warehouse_type, '') in ('agrochemical', 'pesticide', 'fertilizer', 'additive', 'universal')
  ) then
    raise exception 'Agrochemical warehouse is not available to the actor' using errcode = '42501';
  end if;
  return v_actor.id;
end;
$$;

revoke all on function public.assert_warehouse_v11_actor_v1(uuid, uuid) from public, anon, authenticated;

create or replace function public.warehouse_reserved_quantity_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_uom text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(coalesce(i.prepared_quantity, 0) - coalesce(i.issued_quantity, 0), 0)), 0)
  from public.warehouse_issue_requests r
  join public.warehouse_issue_request_items i on i.request_id = r.id and i.company_id = r.company_id
  where r.company_id = p_company_id
    and r.source_warehouse_id = p_warehouse_id
    and r.status in ('new', 'active', 'preparing', 'ready', 'received_confirmed')
    and coalesce(r.warehouse_request_status, '') not in ('issued', 'closed', 'return_received', 'cancelled')
    and public.warehouse_canonical_product_id_v1(
      p_company_id,
      coalesce(i.actual_product_id, i.product_id)
    ) = p_product_id
    and public.canonical_stock_uom(coalesce(i.prepared_unit, i.issued_unit, i.unit)) = public.canonical_stock_uom(p_uom);
$$;

revoke all on function public.warehouse_reserved_quantity_v1(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.prevent_warehouse_movement_during_inventory_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason_type <> 'warehouse_inventory_adjustment'
     and exists (
       select 1 from public.warehouse_inventory_documents d
       where d.company_id = new.company_id
         and d.warehouse_id = new.warehouse_id
         and d.status = 'in_progress'
     ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_warehouse_movement_during_inventory_v1 on public.stock_ledger_entries;
create trigger trg_prevent_warehouse_movement_during_inventory_v1
before insert on public.stock_ledger_entries
for each row execute function public.prevent_warehouse_movement_during_inventory_v1();

revoke all on function public.prevent_warehouse_movement_during_inventory_v1() from public, anon, authenticated;

create or replace function public.create_warehouse_transfer_atomic_v1(
  p_company_id uuid,
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_product public.products%rowtype;
  v_existing public.warehouse_transfer_documents%rowtype;
  v_product_id uuid;
  v_uom text;
  v_balance numeric;
  v_reserved numeric;
  v_available numeric;
  v_remaining numeric;
  v_take numeric;
  v_posted_at timestamptz := clock_timestamp();
  v_fingerprint text;
  v_transfer_no text;
  v_bucket record;
  v_ledger_rows integer := 0;
begin
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_source_warehouse_id = p_destination_warehouse_id then
    raise exception 'Нельзя переместить материал в тот же склад';
  end if;
  if p_quantity is null or p_quantity::text !~ '^[0-9]+([.][0-9]+)?$' or p_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля';
  end if;

  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, p_source_warehouse_id);
  perform public.assert_warehouse_v11_actor_v1(p_company_id, p_destination_warehouse_id);
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_source_warehouse_id::text || ':' || p_product_id::text, 0
  ));

  select * into v_product from public.products
  where id = p_product_id
    and (company_id = p_company_id or company_id is null)
    and coalesce(archived, false) = false
    and coalesce(is_active, true) = true;
  if not found then raise exception 'Материал недоступен для этой компании'; end if;
  if lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''))
     not in ('pesticide', 'fertilizer', 'additive') then
    raise exception 'Перемещение доступно только для агрохимических материалов';
  end if;
  v_product_id := public.warehouse_canonical_product_id_v1(p_company_id, p_product_id);
  if v_product_id is null then raise exception 'Не удалось определить материал'; end if;
  select * into v_product from public.products where id = v_product_id;
  v_uom := public.canonical_stock_uom(coalesce(v_product.base_uom, v_product.unit));
  if v_uom not in ('kg', 'l', 'pcs') then
    raise exception 'Для материала не задана единица хранения';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'company_id', p_company_id,
    'source_warehouse_id', p_source_warehouse_id,
    'destination_warehouse_id', p_destination_warehouse_id,
    'product_id', v_product_id,
    'quantity', round(p_quantity, 3),
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text);
  select * into v_existing from public.warehouse_transfer_documents
  where id = p_idempotency_key and company_id = p_company_id;
  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used with another transfer payload';
    end if;
    return jsonb_build_object(
      'transfer_id', v_existing.id,
      'transfer_no', v_existing.transfer_no,
      'posted_at', v_existing.posted_at,
      'quantity', v_existing.quantity,
      'uom', v_existing.uom,
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1 from public.warehouse_inventory_documents d
    where d.company_id = p_company_id
      and d.warehouse_id in (p_source_warehouse_id, p_destination_warehouse_id)
      and d.status = 'in_progress'
  ) then
    raise exception 'На складе проводится инвентаризация. Новые движения временно недоступны';
  end if;

  select coalesce(sum(sle.delta_qty_signed), 0) into v_balance
  from public.stock_ledger_entries sle
  where sle.company_id = p_company_id
    and sle.warehouse_id = p_source_warehouse_id
    and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_product_id
    and public.canonical_stock_uom(sle.uom) = v_uom;
  v_reserved := public.warehouse_reserved_quantity_v1(
    p_company_id, p_source_warehouse_id, v_product_id, v_uom
  );
  v_available := greatest(v_balance - v_reserved, 0);
  if p_quantity > v_available + 0.000001 then
    raise exception 'Недостаточно доступного остатка. Доступно: % %', round(v_available, 3), v_uom;
  end if;

  v_transfer_no := 'WT-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 16));
  insert into public.warehouse_transfer_documents(
    id, company_id, transfer_no, source_warehouse_id, destination_warehouse_id,
    canonical_product_id, quantity, uom, reserved_quantity, notes, status,
    payload_fingerprint, posted_at, created_by
  ) values (
    p_idempotency_key, p_company_id, v_transfer_no, p_source_warehouse_id,
    p_destination_warehouse_id, v_product_id, round(p_quantity, 3), v_uom,
    round(v_reserved, 3), nullif(btrim(coalesce(p_notes, '')), ''), 'completed',
    v_fingerprint, v_posted_at, v_actor_id
  );

  v_remaining := round(p_quantity, 3);
  for v_bucket in
    select
      sle.product_id,
      nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') as batch_id_text,
      coalesce(nullif(sle.batch_class, ''), 'material') as batch_class,
      sum(sle.delta_qty_signed)::numeric as quantity,
      min(sle.occurred_at) as first_at
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id
      and sle.warehouse_id = p_source_warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_product_id
      and public.canonical_stock_uom(sle.uom) = v_uom
    group by sle.product_id,
      nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), ''),
      coalesce(nullif(sle.batch_class, ''), 'material')
    having sum(sle.delta_qty_signed) > 0.000001
    order by (nullif(btrim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') is null), min(sle.occurred_at)
  loop
    exit when v_remaining <= 0.000001;
    v_take := least(v_remaining, v_bucket.quantity);
    insert into public.stock_ledger_entries(
      company_id, product_id, warehouse_id, direction, quantity, uom,
      delta_qty_signed, reason_type, reason_ref_id, batch_id_text, batch_class,
      occurred_at, created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values
    (
      p_company_id, v_bucket.product_id, p_source_warehouse_id, 'out', v_take, v_uom,
      -v_take, 'warehouse_transfer', p_idempotency_key, v_bucket.batch_id_text,
      v_bucket.batch_class, v_posted_at, v_actor_id,
      nullif(btrim(coalesce(p_notes, '')), ''), case when v_uom = 'kg' then v_take else null end,
      'warehouse_transfer:' || p_idempotency_key::text, 2
    ),
    (
      p_company_id, v_bucket.product_id, p_destination_warehouse_id, 'in', v_take, v_uom,
      v_take, 'warehouse_transfer', p_idempotency_key, v_bucket.batch_id_text,
      v_bucket.batch_class, v_posted_at, v_actor_id,
      nullif(btrim(coalesce(p_notes, '')), ''), case when v_uom = 'kg' then v_take else null end,
      'warehouse_transfer:' || p_idempotency_key::text, 2
    );
    v_ledger_rows := v_ledger_rows + 2;
    v_remaining := round(v_remaining - v_take, 3);
  end loop;
  if v_remaining > 0.000001 then
    raise exception 'Не удалось распределить перемещение по доступным партиям';
  end if;

  return jsonb_build_object(
    'transfer_id', p_idempotency_key,
    'transfer_no', v_transfer_no,
    'posted_at', v_posted_at,
    'quantity', round(p_quantity, 3),
    'uom', v_uom,
    'reserved_quantity', round(v_reserved, 3),
    'ledger_rows', v_ledger_rows,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.create_warehouse_transfer_atomic_v1(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) from public, anon;
grant execute on function public.create_warehouse_transfer_atomic_v1(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) to authenticated;

create or replace function public.start_warehouse_inventory_v1(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_notes text,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_snapshot_at timestamptz := clock_timestamp();
  v_inventory_no text;
  v_item_count integer;
begin
  if p_inventory_id is null then raise exception 'Inventory id is required'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, p_warehouse_id);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || p_warehouse_id::text || ':inventory', 0));

  if exists (
    select 1 from public.warehouse_inventory_documents
    where warehouse_id = p_warehouse_id and status = 'in_progress'
  ) then
    raise exception 'На складе уже проводится инвентаризация';
  end if;

  v_inventory_no := 'INV-' || upper(substr(replace(p_inventory_id::text, '-', ''), 1, 16));
  insert into public.warehouse_inventory_documents(
    id, company_id, inventory_no, warehouse_id, status, snapshot_at,
    started_at, started_by, notes
  ) values (
    p_inventory_id, p_company_id, v_inventory_no, p_warehouse_id, 'in_progress',
    v_snapshot_at, v_snapshot_at, v_actor_id, nullif(btrim(coalesce(p_notes, '')), '')
  );

  insert into public.warehouse_inventory_items(
    inventory_id, company_id, product_id, product_name_snapshot, product_type,
    uom, book_quantity, discovered
  )
  select
    p_inventory_id,
    p_company_id,
    balance.product_id,
    coalesce(nullif(product.trade_name, ''), product.name),
    lower(coalesce(product.product_type, product.type, product.category)),
    balance.uom,
    round(balance.quantity, 3),
    false
  from (
    select
      public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) as product_id,
      public.canonical_stock_uom(sle.uom) as uom,
      sum(sle.delta_qty_signed)::numeric as quantity
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id and sle.warehouse_id = p_warehouse_id
    group by public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id),
      public.canonical_stock_uom(sle.uom)
    having sum(sle.delta_qty_signed) > 0.000001
  ) balance
  join public.products product on product.id = balance.product_id
  where lower(coalesce(product.product_type, product.type, product.category, ''))
    in ('pesticide', 'fertilizer', 'additive');

  get diagnostics v_item_count = row_count;
  update public.warehouse_inventory_documents
  set item_count = v_item_count, updated_at = clock_timestamp()
  where id = p_inventory_id;

  return jsonb_build_object(
    'inventory_id', p_inventory_id,
    'inventory_no', v_inventory_no,
    'status', 'in_progress',
    'snapshot_at', v_snapshot_at,
    'item_count', v_item_count
  );
end;
$$;

create or replace function public.save_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_input jsonb;
  v_item public.warehouse_inventory_items%rowtype;
  v_product public.products%rowtype;
  v_actual numeric;
  v_uom text;
  v_saved integer := 0;
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  perform public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status <> 'in_progress' then
    raise exception 'Завершённую инвентаризацию нельзя редактировать';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Inventory items must be an array';
  end if;

  for v_input in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_actual := nullif(v_input ->> 'actual_quantity', '')::numeric;
    if v_actual is null or v_actual::text !~ '^[0-9]+([.][0-9]+)?$' or v_actual < 0 then
      raise exception 'Фактическое количество должно быть нулём или положительным числом';
    end if;

    if nullif(v_input ->> 'item_id', '') is not null then
      select * into v_item from public.warehouse_inventory_items
      where id = (v_input ->> 'item_id')::uuid and inventory_id = p_inventory_id
      for update;
      if not found then raise exception 'Строка инвентаризации не найдена'; end if;
      update public.warehouse_inventory_items
      set actual_quantity = round(v_actual, 3),
          difference_quantity = round(v_actual - book_quantity, 3),
          updated_at = clock_timestamp()
      where id = v_item.id;
      v_saved := v_saved + 1;
    else
      select * into v_product from public.products
      where id = (v_input ->> 'product_id')::uuid
        and (company_id = p_company_id or company_id is null)
        and coalesce(archived, false) = false
        and coalesce(is_active, true) = true;
      if not found then raise exception 'Обнаруженный материал недоступен'; end if;
      if lower(coalesce(v_product.product_type, v_product.type, v_product.category, ''))
         not in ('pesticide', 'fertilizer', 'additive') then
        raise exception 'Инвентаризация поддерживает только агрохимические материалы';
      end if;
      v_product.id := public.warehouse_canonical_product_id_v1(p_company_id, v_product.id);
      select * into v_product from public.products where id = v_product.id;
      v_uom := public.canonical_stock_uom(coalesce(v_product.base_uom, v_product.unit));
      if v_uom not in ('kg', 'l', 'pcs') then
        raise exception 'Для материала не задана единица хранения';
      end if;
      insert into public.warehouse_inventory_items(
        inventory_id, company_id, product_id, product_name_snapshot, product_type,
        uom, book_quantity, actual_quantity, difference_quantity, discovered
      ) values (
        p_inventory_id, p_company_id, v_product.id,
        coalesce(nullif(v_product.trade_name, ''), v_product.name),
        lower(coalesce(v_product.product_type, v_product.type, v_product.category)),
        v_uom, 0, round(v_actual, 3), round(v_actual, 3), true
      )
      on conflict (inventory_id, product_id, uom) do update
      set actual_quantity = excluded.actual_quantity,
          difference_quantity = excluded.difference_quantity,
          updated_at = clock_timestamp();
      v_saved := v_saved + 1;
    end if;
  end loop;

  update public.warehouse_inventory_documents d
  set item_count = (select count(*) from public.warehouse_inventory_items i where i.inventory_id = d.id),
      difference_count = (
        select count(*) from public.warehouse_inventory_items i
        where i.inventory_id = d.id and abs(coalesce(i.difference_quantity, 0)) > 0.000001
      ),
      updated_at = clock_timestamp()
  where d.id = p_inventory_id;

  return jsonb_build_object('inventory_id', p_inventory_id, 'saved_items', v_saved);
end;
$$;

create or replace function public.complete_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_actor_id uuid;
  v_item public.warehouse_inventory_items%rowtype;
  v_current numeric;
  v_difference numeric;
  v_ledger_id uuid;
  v_completed_at timestamptz := clock_timestamp();
  v_difference_count integer := 0;
  v_ledger_rows integer := 0;
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status = 'completed' then
    return jsonb_build_object(
      'inventory_id', v_document.id,
      'inventory_no', v_document.inventory_no,
      'status', v_document.status,
      'difference_count', v_document.difference_count,
      'idempotent_replay', true
    );
  end if;
  if v_document.status <> 'in_progress' then raise exception 'Инвентаризация отменена'; end if;
  if exists (
    select 1 from public.warehouse_inventory_items
    where inventory_id = p_inventory_id and actual_quantity is null
  ) then
    raise exception 'Укажите фактическое количество для всех материалов';
  end if;

  for v_item in
    select * from public.warehouse_inventory_items
    where inventory_id = p_inventory_id
    order by product_name_snapshot, id
    for update
  loop
    select coalesce(sum(sle.delta_qty_signed), 0) into v_current
    from public.stock_ledger_entries sle
    where sle.company_id = p_company_id
      and sle.warehouse_id = v_document.warehouse_id
      and public.warehouse_canonical_product_id_v1(p_company_id, sle.product_id) = v_item.product_id
      and public.canonical_stock_uom(sle.uom) = v_item.uom;
    if abs(v_current - v_item.book_quantity) > 0.000001 then
      raise exception 'Учётный остаток изменился после начала инвентаризации';
    end if;

    v_difference := round(v_item.actual_quantity - v_item.book_quantity, 3);
    update public.warehouse_inventory_items
    set difference_quantity = v_difference, updated_at = v_completed_at
    where id = v_item.id;
    if abs(v_difference) <= 0.000001 then continue; end if;

    v_ledger_id := gen_random_uuid();
    insert into public.stock_ledger_entries(
      id, company_id, product_id, warehouse_id, direction, quantity, uom,
      delta_qty_signed, reason_type, reason_ref_id, batch_class, occurred_at,
      created_by, notes, mass_kg, unit_source, unit_contract_version
    ) values (
      v_ledger_id, p_company_id, v_item.product_id, v_document.warehouse_id,
      case when v_difference > 0 then 'in'::public.ledger_direction else 'out'::public.ledger_direction end,
      abs(v_difference), v_item.uom, v_difference,
      'warehouse_inventory_adjustment', p_inventory_id, 'material', v_completed_at,
      v_actor_id, 'Инвентаризация ' || v_document.inventory_no,
      case when v_item.uom = 'kg' then abs(v_difference) else null end,
      'warehouse_inventory:' || p_inventory_id::text, 2
    );
    update public.warehouse_inventory_items
    set adjustment_ledger_entry_id = v_ledger_id
    where id = v_item.id;
    v_difference_count := v_difference_count + 1;
    v_ledger_rows := v_ledger_rows + 1;
  end loop;

  update public.warehouse_inventory_documents
  set status = 'completed', completed_at = v_completed_at, completed_by = v_actor_id,
      difference_count = v_difference_count, updated_at = v_completed_at
  where id = p_inventory_id
  returning * into v_document;

  return jsonb_build_object(
    'inventory_id', v_document.id,
    'inventory_no', v_document.inventory_no,
    'status', v_document.status,
    'completed_at', v_document.completed_at,
    'difference_count', v_difference_count,
    'ledger_rows', v_ledger_rows,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.cancel_warehouse_inventory_v1(
  p_company_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.warehouse_inventory_documents%rowtype;
  v_actor_id uuid;
  v_cancelled_at timestamptz := clock_timestamp();
begin
  select * into v_document
  from public.warehouse_inventory_documents
  where id = p_inventory_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Инвентаризация не найдена'; end if;
  v_actor_id := public.assert_warehouse_v11_actor_v1(p_company_id, v_document.warehouse_id);
  if v_document.status = 'completed' then raise exception 'Завершённую инвентаризацию нельзя отменить'; end if;
  if v_document.status = 'cancelled' then
    return jsonb_build_object('inventory_id', v_document.id, 'status', 'cancelled', 'idempotent_replay', true);
  end if;
  update public.warehouse_inventory_documents
  set status = 'cancelled', cancelled_at = v_cancelled_at, cancelled_by = v_actor_id,
      updated_at = v_cancelled_at
  where id = p_inventory_id;
  return jsonb_build_object('inventory_id', p_inventory_id, 'status', 'cancelled', 'idempotent_replay', false);
end;
$$;

revoke all on function public.start_warehouse_inventory_v1(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.save_warehouse_inventory_v1(uuid, uuid, jsonb) from public, anon;
revoke all on function public.complete_warehouse_inventory_v1(uuid, uuid) from public, anon;
revoke all on function public.cancel_warehouse_inventory_v1(uuid, uuid) from public, anon;
grant execute on function public.start_warehouse_inventory_v1(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.save_warehouse_inventory_v1(uuid, uuid, jsonb) to authenticated;
grant execute on function public.complete_warehouse_inventory_v1(uuid, uuid) to authenticated;
grant execute on function public.cancel_warehouse_inventory_v1(uuid, uuid) to authenticated;

create or replace function public.create_warehouse_receipt_atomic_v3(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_document_no text,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_received_at timestamptz;
begin
  select nullif(t.audit_json #>> '{receipt_payload,received_at}', '')::timestamptz
    into v_received_at
  from public.tickets t
  where t.id = p_idempotency_key and t.company_id = p_company_id;
  v_received_at := coalesce(v_received_at, clock_timestamp());
  return public.create_warehouse_receipt_atomic_v2(
    p_company_id,
    p_warehouse_id,
    v_received_at,
    p_supplier_company_counterparty_id,
    p_supplier_global_counterparty_id,
    p_document_no,
    p_notes,
    p_lines,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.create_warehouse_receipt_atomic_v3(
  uuid, uuid, uuid, uuid, text, text, jsonb, uuid
) to authenticated;

comment on table public.warehouse_transfer_documents is
  'Posted agrochemical warehouse transfers. Quantity remains sourced from stock_ledger_entries.';
comment on table public.warehouse_inventory_documents is
  'Warehouse inventory snapshots with system-managed in_progress/completed/cancelled lifecycle.';
comment on table public.warehouse_inventory_items is
  'Book-versus-actual inventory lines. Completion creates ledger adjustments for non-zero differences.';

commit;

notify pgrst, 'reload schema';
