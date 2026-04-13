/*
  AgriManager Weighbridge + Warehouse Ledger + Processing foundation
  Core rules:
  - stock changes only from finalized tickets
  - no hard delete for finalized accounting facts
  - reversals via storno only
*/

-- ============================================
-- 1) Core enums
-- ============================================
do $$ begin
  create type public.ticket_status as enum ('draft', 'active', 'ready_to_close', 'finalized', 'voided');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ticket_direction as enum ('incoming', 'outgoing', 'transfer', 'processing');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.weigh_method as enum ('double_weighing', 'preset_tare', 'manual_override_with_reason');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ledger_direction as enum ('in', 'out');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.processing_type as enum (
    'drying',
    'cleaning',
    'grading',
    'treatment',
    'soil_separation',
    'washing',
    'repacking',
    'mixing'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.processing_status as enum ('draft', 'confirmed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.container_status as enum ('in_stock', 'issued', 'awaiting_return', 'returned', 'to_disposal', 'disposed');
exception when duplicate_object then null;
end $$;

-- ============================================
-- 2) Optional lookup tables (if not present)
-- ============================================
create table if not exists public.processing_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.waste_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.container_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique(company_id, code)
);

-- ============================================
-- 3) Weighbridge tickets
-- ============================================
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ticket_no text not null,
  ticket_type text not null,
  op_type text not null,
  status public.ticket_status not null default 'draft',
  direction public.ticket_direction not null,
  source_kind text not null,
  source_id text,
  destination_kind text not null,
  destination_id text,
  field_id uuid references public.fields(id),
  warehouse_from_id uuid references public.warehouses(id),
  warehouse_to_id uuid references public.warehouses(id),
  processing_point_from_id uuid references public.processing_points(id),
  processing_point_to_id uuid references public.processing_points(id),
  supplier_id uuid,
  buyer_id uuid,
  vehicle_id uuid,
  driver_id uuid,
  responsible_user_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  voided_by uuid references public.profiles(id),
  void_reason text,
  gross_weight_kg numeric(14,3),
  tare_weight_kg numeric(14,3),
  net_weight_kg numeric(14,3),
  weigh_method public.weigh_method not null default 'double_weighing',
  weighing_1_at timestamptz,
  weighing_2_at timestamptz,
  is_finalized boolean not null default false,
  is_voided boolean not null default false,
  linked_operation_id uuid references public.operations(id),
  linked_request_id uuid references public.warehouse_issue_requests(id),
  linked_processing_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  voided_at timestamptz,
  constraint tickets_ticket_no_company_unique unique(company_id, ticket_no),
  constraint tickets_transfer_not_same_wh check (
    not (direction = 'transfer' and warehouse_from_id is not null and warehouse_to_id is not null and warehouse_from_id = warehouse_to_id)
  )
);

create index if not exists idx_tickets_company_status on public.tickets(company_id, status);
create index if not exists idx_tickets_company_created_at on public.tickets(company_id, created_at desc);
create index if not exists idx_tickets_company_field on public.tickets(company_id, field_id);

create table if not exists public.ticket_weighings (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  weighing_no int not null check (weighing_no in (1,2)),
  measured_weight_kg numeric(14,3) not null check (measured_weight_kg > 0),
  measured_at timestamptz not null default now(),
  device_source text not null default 'manual',
  operator_user_id uuid references public.profiles(id),
  comment text,
  unique(ticket_id, weighing_no)
);

create index if not exists idx_ticket_weighings_ticket on public.ticket_weighings(ticket_id, weighing_no);

create table if not exists public.ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_type text,
  product_name_snapshot text,
  uom text not null default 'kg',
  gross_line_weight_kg numeric(14,3),
  tare_line_weight_kg numeric(14,3),
  net_line_weight_kg numeric(14,3),
  quantity numeric(14,3) not null check (quantity >= 0),
  moisture_percent numeric(6,3),
  dockage_percent numeric(6,3),
  dirt_tare_percent numeric(6,3),
  class_grade text,
  variety_id uuid references public.varieties(id),
  reproduction_id uuid references public.seed_reproductions(id),
  batch_id text,
  packaging_type text,
  returned_container_qty numeric(14,3),
  disposable_container_qty numeric(14,3),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_lines_ticket on public.ticket_lines(ticket_id);
create index if not exists idx_ticket_lines_product on public.ticket_lines(product_id);

-- ============================================
-- 4) Stock ledger (single source of truth for balances)
-- ============================================
create table if not exists public.stock_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ticket_id uuid references public.tickets(id),
  processing_id uuid,
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  direction public.ledger_direction not null,
  quantity numeric(14,3) not null check (quantity > 0),
  uom text not null default 'kg',
  delta_qty_signed numeric(14,3) not null,
  reason_type text not null,
  reason_ref_id uuid,
  batch_id text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  is_storno boolean not null default false,
  storno_of_entry_id uuid references public.stock_ledger_entries(id),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_ledger_company_wh_prod on public.stock_ledger_entries(company_id, warehouse_id, product_id);
create index if not exists idx_stock_ledger_ticket on public.stock_ledger_entries(ticket_id);

-- ============================================
-- 5) Processing documents
-- ============================================
create table if not exists public.processing_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  processing_type public.processing_type not null,
  status public.processing_status not null default 'draft',
  source_warehouse_id uuid not null references public.warehouses(id),
  destination_warehouse_id uuid references public.warehouses(id),
  processing_point_id uuid references public.processing_points(id),
  source_ticket_id uuid references public.tickets(id),
  source_batch_id text,
  product_id uuid not null references public.products(id),
  input_qty_kg numeric(14,3) not null default 0,
  output_qty_kg numeric(14,3) not null default 0,
  loss_qty_kg numeric(14,3) not null default 0,
  waste_qty_kg numeric(14,3) not null default 0,
  waste_type text,
  moisture_in_percent numeric(6,3),
  moisture_out_percent numeric(6,3),
  dockage_in_percent numeric(6,3),
  dockage_out_percent numeric(6,3),
  shrink_factor numeric(10,6),
  formula_used text,
  actual_loss_method text check (actual_loss_method in ('measured', 'calculated')),
  created_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  notes text
);

create index if not exists idx_processing_docs_company_status on public.processing_documents(company_id, status);

-- ============================================
-- 6) Container registry
-- ============================================
create table if not exists public.container_registry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid references public.products(id),
  container_type text not null,
  container_status public.container_status not null default 'in_stock',
  quantity numeric(14,3) not null default 0,
  linked_ticket_id uuid references public.tickets(id),
  issued_to_user_id uuid references public.profiles(id),
  issued_for_field_id uuid references public.fields(id),
  returned_at timestamptz,
  disposed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_container_registry_company_status on public.container_registry(company_id, container_status);

-- ============================================
-- 7) Audit log
-- ============================================
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  who uuid references public.profiles(id),
  when_at timestamptz not null default now(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  reason text
);

create index if not exists idx_audit_log_company_when on public.audit_log(company_id, when_at desc);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id);

-- ============================================
-- 8) Helpers / stock balance / ticket finalization / void (storno)
-- ============================================
create or replace function public.get_stock_balance(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(delta_qty_signed), 0)
  from public.stock_ledger_entries
  where company_id = p_company_id
    and warehouse_id = p_warehouse_id
    and product_id = p_product_id;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tickets_touch_updated_at on public.tickets;
create trigger trg_tickets_touch_updated_at
before update on public.tickets
for each row execute function public.touch_updated_at();

create or replace function public.finalize_ticket(
  p_ticket_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_net numeric(14,3);
  v_weigh1 numeric(14,3);
  v_weigh2 numeric(14,3);
  v_required_out numeric(14,3);
  v_available numeric(14,3);
  v_line record;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.is_finalized or v_ticket.status = 'finalized' then
    raise exception 'Ticket already finalized';
  end if;

  if v_ticket.is_voided or v_ticket.status = 'voided' then
    raise exception 'Cannot finalize voided ticket';
  end if;

  if v_ticket.created_by is null then
    raise exception 'Created by is required';
  end if;

  if v_ticket.weigh_method = 'double_weighing' then
    select measured_weight_kg into v_weigh1
    from public.ticket_weighings
    where ticket_id = p_ticket_id and weighing_no = 1;
    select measured_weight_kg into v_weigh2
    from public.ticket_weighings
    where ticket_id = p_ticket_id and weighing_no = 2;

    if v_weigh1 is null or v_weigh2 is null then
      raise exception 'Two weighings are required for double weighing method';
    end if;

    v_net := abs(v_weigh1 - v_weigh2);
  else
    if v_ticket.gross_weight_kg is null or v_ticket.tare_weight_kg is null then
      raise exception 'Gross and tare are required';
    end if;
    v_net := v_ticket.gross_weight_kg - v_ticket.tare_weight_kg;
  end if;

  if coalesce(v_net, 0) <= 0 then
    raise exception 'Net weight must be positive';
  end if;

  if v_ticket.direction = 'incoming' then
    if v_ticket.warehouse_to_id is null then
      raise exception 'warehouse_to_id is required for incoming ticket';
    end if;
  elsif v_ticket.direction = 'outgoing' then
    if v_ticket.warehouse_from_id is null then
      raise exception 'warehouse_from_id is required for outgoing ticket';
    end if;
  elsif v_ticket.direction = 'transfer' then
    if v_ticket.warehouse_from_id is null or v_ticket.warehouse_to_id is null then
      raise exception 'Both warehouses are required for transfer';
    end if;
    if v_ticket.warehouse_from_id = v_ticket.warehouse_to_id then
      raise exception 'Transfer warehouses cannot be the same';
    end if;
  end if;

  if not exists (select 1 from public.ticket_lines where ticket_id = p_ticket_id) then
    raise exception 'Ticket lines are required';
  end if;

  if v_ticket.direction in ('outgoing', 'transfer') then
    for v_line in
      select product_id, coalesce(quantity, 0) as quantity
      from public.ticket_lines
      where ticket_id = p_ticket_id
    loop
      v_required_out := v_line.quantity;
      v_available := public.get_stock_balance(v_ticket.company_id, v_ticket.warehouse_from_id, v_line.product_id);
      if v_available < v_required_out then
        raise exception 'Insufficient stock for product %, available %, required %',
          v_line.product_id, v_available, v_required_out;
      end if;
    end loop;
  end if;

  for v_line in
    select *
    from public.ticket_lines
    where ticket_id = p_ticket_id
  loop
    if v_ticket.direction = 'incoming' then
      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
        reason_type, reason_ref_id, occurred_at, created_by, notes
      ) values (
        v_ticket.company_id, p_ticket_id, v_line.product_id, v_ticket.warehouse_to_id,
        'in', v_line.quantity, coalesce(v_line.uom, 'kg'), abs(v_line.quantity),
        v_ticket.op_type, p_ticket_id, now(), p_actor_user_id, v_ticket.notes
      );
    elsif v_ticket.direction = 'outgoing' then
      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
        reason_type, reason_ref_id, occurred_at, created_by, notes
      ) values (
        v_ticket.company_id, p_ticket_id, v_line.product_id, v_ticket.warehouse_from_id,
        'out', v_line.quantity, coalesce(v_line.uom, 'kg'), -abs(v_line.quantity),
        v_ticket.op_type, p_ticket_id, now(), p_actor_user_id, v_ticket.notes
      );
    elsif v_ticket.direction = 'transfer' then
      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
        reason_type, reason_ref_id, occurred_at, created_by, notes
      ) values (
        v_ticket.company_id, p_ticket_id, v_line.product_id, v_ticket.warehouse_from_id,
        'out', v_line.quantity, coalesce(v_line.uom, 'kg'), -abs(v_line.quantity),
        v_ticket.op_type, p_ticket_id, now(), p_actor_user_id, v_ticket.notes
      );

      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
        reason_type, reason_ref_id, occurred_at, created_by, notes
      ) values (
        v_ticket.company_id, p_ticket_id, v_line.product_id, v_ticket.warehouse_to_id,
        'in', v_line.quantity, coalesce(v_line.uom, 'kg'), abs(v_line.quantity),
        v_ticket.op_type, p_ticket_id, now(), p_actor_user_id, v_ticket.notes
      );
    end if;
  end loop;

  update public.tickets
  set
    net_weight_kg = v_net,
    status = 'finalized',
    is_finalized = true,
    closed_by = p_actor_user_id,
    finalized_at = now(),
    updated_at = now()
  where id = p_ticket_id;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_ticket.company_id,
    p_actor_user_id,
    'ticket',
    p_ticket_id::text,
    'finalized',
    jsonb_build_object('status', v_ticket.status, 'is_finalized', v_ticket.is_finalized),
    jsonb_build_object('status', 'finalized', 'is_finalized', true, 'net_weight_kg', v_net),
    null
  );

  return p_ticket_id;
end;
$$;

create or replace function public.void_ticket_with_storno(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_entry record;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.status = 'voided' or v_ticket.is_voided then
    return p_ticket_id;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Void reason is required';
  end if;

  if v_ticket.status = 'finalized' then
    for v_entry in
      select *
      from public.stock_ledger_entries
      where ticket_id = p_ticket_id and coalesce(is_storno, false) = false
    loop
      insert into public.stock_ledger_entries (
        company_id, ticket_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
        reason_type, reason_ref_id, occurred_at, created_by, is_storno, storno_of_entry_id, notes
      ) values (
        v_entry.company_id, v_entry.ticket_id, v_entry.product_id, v_entry.warehouse_id,
        case when v_entry.direction = 'in' then 'out'::public.ledger_direction else 'in'::public.ledger_direction end,
        abs(v_entry.quantity),
        v_entry.uom,
        -v_entry.delta_qty_signed,
        'storno',
        p_ticket_id,
        now(),
        p_actor_user_id,
        true,
        v_entry.id,
        p_reason
      );
    end loop;
  end if;

  update public.tickets
  set
    status = 'voided',
    is_voided = true,
    voided_by = p_actor_user_id,
    void_reason = p_reason,
    voided_at = now(),
    updated_at = now()
  where id = p_ticket_id;

  insert into public.audit_log (
    company_id, who, entity_type, entity_id, action, old_values, new_values, reason
  ) values (
    v_ticket.company_id,
    p_actor_user_id,
    'ticket',
    p_ticket_id::text,
    'voided',
    jsonb_build_object('status', v_ticket.status, 'is_voided', v_ticket.is_voided),
    jsonb_build_object('status', 'voided', 'is_voided', true),
    p_reason
  );

  return p_ticket_id;
end;
$$;

-- ============================================
-- 9) RLS policies (company-scoped)
-- ============================================
alter table public.tickets enable row level security;
alter table public.ticket_weighings enable row level security;
alter table public.ticket_lines enable row level security;
alter table public.stock_ledger_entries enable row level security;
alter table public.processing_documents enable row level security;
alter table public.container_registry enable row level security;
alter table public.processing_points enable row level security;
alter table public.waste_categories enable row level security;
alter table public.container_types enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "Users can view company tickets" on public.tickets;
drop policy if exists "Users can insert company tickets" on public.tickets;
drop policy if exists "Users can update company tickets" on public.tickets;
create policy "Users can view company tickets" on public.tickets for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company tickets" on public.tickets for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company tickets" on public.tickets for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company ticket weighings" on public.ticket_weighings;
drop policy if exists "Users can insert company ticket weighings" on public.ticket_weighings;
drop policy if exists "Users can update company ticket weighings" on public.ticket_weighings;
create policy "Users can view company ticket weighings" on public.ticket_weighings for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company ticket weighings" on public.ticket_weighings for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company ticket weighings" on public.ticket_weighings for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company ticket lines" on public.ticket_lines;
drop policy if exists "Users can insert company ticket lines" on public.ticket_lines;
drop policy if exists "Users can update company ticket lines" on public.ticket_lines;
create policy "Users can view company ticket lines" on public.ticket_lines for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company ticket lines" on public.ticket_lines for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company ticket lines" on public.ticket_lines for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company stock ledger entries" on public.stock_ledger_entries;
drop policy if exists "Users can insert company stock ledger entries" on public.stock_ledger_entries;
create policy "Users can view company stock ledger entries" on public.stock_ledger_entries for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company stock ledger entries" on public.stock_ledger_entries for insert to authenticated with check (company_id = get_user_company_id());

drop policy if exists "Users can view company processing documents" on public.processing_documents;
drop policy if exists "Users can insert company processing documents" on public.processing_documents;
drop policy if exists "Users can update company processing documents" on public.processing_documents;
create policy "Users can view company processing documents" on public.processing_documents for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company processing documents" on public.processing_documents for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company processing documents" on public.processing_documents for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company containers" on public.container_registry;
drop policy if exists "Users can insert company containers" on public.container_registry;
drop policy if exists "Users can update company containers" on public.container_registry;
create policy "Users can view company containers" on public.container_registry for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company containers" on public.container_registry for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company containers" on public.container_registry for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company processing points" on public.processing_points;
drop policy if exists "Users can insert company processing points" on public.processing_points;
drop policy if exists "Users can update company processing points" on public.processing_points;
create policy "Users can view company processing points" on public.processing_points for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company processing points" on public.processing_points for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company processing points" on public.processing_points for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company waste categories" on public.waste_categories;
drop policy if exists "Users can insert company waste categories" on public.waste_categories;
drop policy if exists "Users can update company waste categories" on public.waste_categories;
create policy "Users can view company waste categories" on public.waste_categories for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company waste categories" on public.waste_categories for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company waste categories" on public.waste_categories for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company container types" on public.container_types;
drop policy if exists "Users can insert company container types" on public.container_types;
drop policy if exists "Users can update company container types" on public.container_types;
create policy "Users can view company container types" on public.container_types for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company container types" on public.container_types for insert to authenticated with check (company_id = get_user_company_id());
create policy "Users can update company container types" on public.container_types for update to authenticated using (company_id = get_user_company_id()) with check (company_id = get_user_company_id());

drop policy if exists "Users can view company audit log" on public.audit_log;
drop policy if exists "Users can insert company audit log" on public.audit_log;
create policy "Users can view company audit log" on public.audit_log for select to authenticated using (company_id = get_user_company_id());
create policy "Users can insert company audit log" on public.audit_log for insert to authenticated with check (company_id = get_user_company_id());

