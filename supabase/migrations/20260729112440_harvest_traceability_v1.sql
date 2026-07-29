-- TZ-236: preserve crop-structure provenance from a finalized harvest ticket
-- through its batch, warehouse ledger entry, field history, and audit trail.

alter table public.inventory_batches
  add column if not exists crop_structure_id uuid references public.crop_structure(id) on delete restrict,
  add column if not exists harvesting_operation_id uuid references public.operations(id) on delete set null,
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete restrict,
  add column if not exists received_at timestamptz,
  add column if not exists source_type text;

create index if not exists idx_inventory_batches_harvest_trace_v1
  on public.inventory_batches(company_id, crop_structure_id, source_ticket_id)
  where origin_type = 'harvest';

create unique index if not exists uq_inventory_batches_harvest_ticket_product_v1
  on public.inventory_batches(source_ticket_id, product_id, batch_class)
  where origin_type = 'harvest' and source_ticket_id is not null;

alter table public.field_history_entries
  add column if not exists crop_structure_id uuid references public.crop_structure(id) on delete restrict,
  add column if not exists harvest_ticket_id uuid references public.tickets(id) on delete restrict,
  add column if not exists harvest_batch_id uuid references public.inventory_batches(id) on delete restrict;

create unique index if not exists uq_field_history_harvest_ticket_v1
  on public.field_history_entries(harvest_ticket_id)
  where source = 'weighbridge_harvest' and harvest_ticket_id is not null;

create or replace function public.populate_harvest_batch_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
begin
  if new.origin_type <> 'harvest' or new.source_ticket_id is null then
    return new;
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = new.source_ticket_id
    and t.company_id = new.company_id
    and t.op_type = 'harvest_incoming';

  if not found then
    raise exception 'Harvest batch source ticket is missing or belongs to another company';
  end if;

  if v_ticket.crop_structure_allocation_id is null
     or v_ticket.field_id is null
     or v_ticket.season_id is null
     or v_ticket.warehouse_to_id is null then
    raise exception 'Harvest ticket trace is incomplete';
  end if;

  new.crop_structure_id := v_ticket.crop_structure_allocation_id;
  new.harvesting_operation_id := v_ticket.linked_operation_id;
  new.warehouse_id := v_ticket.warehouse_to_id;
  new.received_at := coalesce(v_ticket.finalized_at, now());
  new.source_type := 'weighbridge_ticket';
  return new;
end;
$$;

revoke all on function public.populate_harvest_batch_trace_v1() from public, anon, authenticated;

drop trigger if exists populate_harvest_batch_trace_v1 on public.inventory_batches;
create trigger populate_harvest_batch_trace_v1
before insert or update of source_ticket_id, origin_type
on public.inventory_batches
for each row
execute function public.populate_harvest_batch_trace_v1();

create or replace function public.populate_harvest_ledger_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_operation_line_id uuid;
begin
  if new.ticket_id is null or new.direction::text <> 'in' then
    return new;
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = new.ticket_id
    and t.company_id = new.company_id
    and t.op_type = 'harvest_incoming';

  if not found then
    return new;
  end if;

  select ib.*
    into v_batch
  from public.inventory_batches ib
  where ib.company_id = new.company_id
    and ib.source_ticket_id = new.ticket_id
    and ib.product_id = new.product_id
    and ib.variety_id is not distinct from new.variety_id
    and ib.reproduction_id is not distinct from new.reproduction_id
  order by ib.created_at, ib.id
  limit 1;

  if not found then
    raise exception 'Harvest ledger posting requires its canonical harvest batch';
  end if;

  select tl.operation_line_id
    into v_operation_line_id
  from public.ticket_lines tl
  where tl.ticket_id = new.ticket_id
    and tl.product_id = new.product_id
    and tl.variety_id is not distinct from new.variety_id
    and tl.reproduction_id is not distinct from new.reproduction_id
  order by tl.created_at, tl.id
  limit 1;

  new.batch_id := v_batch.id::text;
  new.batch_id_text := v_batch.id::text;
  new.batch_class := coalesce(new.batch_class, v_batch.batch_class, 'commodity');
  new.operation_line_id := coalesce(new.operation_line_id, v_operation_line_id);
  return new;
end;
$$;

revoke all on function public.populate_harvest_ledger_trace_v1() from public, anon, authenticated;

drop trigger if exists populate_harvest_ledger_trace_v1 on public.stock_ledger_entries;
create trigger populate_harvest_ledger_trace_v1
before insert
on public.stock_ledger_entries
for each row
execute function public.populate_harvest_ledger_trace_v1();

create or replace function public.record_finalized_harvest_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_structure public.crop_structure%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_crop_name text;
  v_season_year integer;
begin
  if new.op_type <> 'harvest_incoming'
     or not new.is_finalized
     or new.status::text <> 'finalized'
     or (old.is_finalized and old.status::text = 'finalized') then
    return new;
  end if;

  select cs.*
    into v_structure
  from public.crop_structure cs
  where cs.id = new.crop_structure_allocation_id
    and cs.company_id = new.company_id
    and cs.field_id = new.field_id
    and cs.season_id = new.season_id
    and coalesce(cs.archived, false) = false;

  if not found
     or v_structure.crop_id is null
     or v_structure.variety_id is null
     or v_structure.reproduction_id is null then
    raise exception 'Finalized harvest ticket requires complete crop structure identity';
  end if;

  select ib.*
    into v_batch
  from public.inventory_batches ib
  where ib.company_id = new.company_id
    and ib.source_ticket_id = new.id
    and ib.origin_type = 'harvest'
  order by ib.created_at, ib.id
  limit 1;

  if not found then
    raise exception 'Finalized harvest ticket requires a harvest batch';
  end if;

  if not exists (
    select 1
    from public.stock_ledger_entries sle
    where sle.company_id = new.company_id
      and sle.ticket_id = new.id
      and sle.direction::text = 'in'
      and sle.batch_id = v_batch.id::text
      and coalesce(sle.is_storno, false) = false
  ) then
    raise exception 'Finalized harvest ticket requires one linked ledger IN posting';
  end if;

  select coalesce(c.name_ru, c.name)
    into v_crop_name
  from public.crops c
  where c.id = v_structure.crop_id;

  select s.year
    into v_season_year
  from public.seasons s
  where s.id = new.season_id
    and s.company_id = new.company_id;

  insert into public.field_history_entries (
    company_id,
    field_id,
    season_id,
    season_year,
    crop_id,
    history_value,
    token,
    original_raw_value,
    source,
    notes,
    operation_id,
    crop_structure_id,
    harvest_ticket_id,
    harvest_batch_id
  )
  values (
    new.company_id,
    new.field_id,
    new.season_id,
    v_season_year,
    v_structure.crop_id,
    coalesce(v_crop_name, 'Урожай'),
    'weighbridge:' || new.id::text,
    coalesce(new.notes, ''),
    'weighbridge_harvest',
    'Урожай принят по талону ' || new.ticket_no,
    new.linked_operation_id,
    v_structure.id,
    new.id,
    v_batch.id
  )
  on conflict (harvest_ticket_id)
    where source = 'weighbridge_harvest' and harvest_ticket_id is not null
  do nothing;

  insert into public.audit_log (
    company_id,
    who,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    new.company_id,
    new.closed_by,
    'weighbridge_ticket',
    new.id,
    'harvest_finalized',
    jsonb_build_object(
      'ticket_id', new.id,
      'batch_id', v_batch.id,
      'crop_structure_id', v_structure.id,
      'operation_id', new.linked_operation_id,
      'warehouse_id', new.warehouse_to_id,
      'net_weight_kg', new.net_weight_kg
    )
  );

  return new;
end;
$$;

revoke all on function public.record_finalized_harvest_trace_v1() from public, anon, authenticated;

drop trigger if exists record_finalized_harvest_trace_v1 on public.tickets;
create trigger record_finalized_harvest_trace_v1
after update of is_finalized, status
on public.tickets
for each row
execute function public.record_finalized_harvest_trace_v1();

create or replace function public.set_harvest_ticket_weights_for_session_v1(
  p_ticket_id uuid,
  p_patch jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_ticket public.tickets%rowtype;
  v_line public.ticket_lines%rowtype;
  v_gross numeric;
  v_tare numeric;
  v_net numeric;
  v_status text;
begin
  if v_auth_user_id is null then
    raise exception 'Authenticated session is required';
  end if;

  select p.*
    into v_actor
  from public.profiles p
  where p.id = v_auth_user_id
    and coalesce(p.status, 'active') = 'active';

  if not found or v_actor.role not in (
    'global_admin', 'admin', 'company_admin', 'director',
    'warehouse', 'warehouse_operator', 'warehouse_manager',
    'weighman', 'weighbridge_operator'
  ) then
    raise exception 'Actor role is not allowed to update weighbridge tickets';
  end if;

  select t.*
    into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;
  if v_actor.role <> 'global_admin' and v_actor.company_id is distinct from v_ticket.company_id then
    raise exception 'Actor does not belong to ticket company';
  end if;
  if v_ticket.op_type <> 'harvest_incoming' then
    raise exception 'Only harvest tickets are supported';
  end if;
  if v_ticket.is_finalized or v_ticket.is_voided or v_ticket.status::text in ('finalized', 'voided') then
    raise exception 'Finalized/voided ticket is read-only';
  end if;

  v_gross := coalesce((p_patch ->> 'gross_weight_kg')::numeric, v_ticket.gross_weight_kg);
  v_tare := coalesce((p_patch ->> 'tare_weight_kg')::numeric, v_ticket.tare_weight_kg);
  if v_gross is null or v_tare is null then
    raise exception 'Gross and tare are required';
  end if;
  if v_gross <= 0 then
    raise exception 'Gross weight must be greater than zero';
  end if;
  if v_tare < 0 then
    raise exception 'Tare weight must be non-negative';
  end if;
  if v_tare >= v_gross then
    raise exception 'Tare weight must be lower than gross weight';
  end if;
  v_net := v_gross - v_tare;

  select tl.*
    into v_line
  from public.ticket_lines tl
  where tl.ticket_id = p_ticket_id
    and tl.company_id = v_ticket.company_id
    and public.canonical_stock_uom(tl.uom) = 'kg'
  order by tl.created_at, tl.id
  limit 1;

  if not found or (
    select count(*)
    from public.ticket_lines tl
    where tl.ticket_id = p_ticket_id
  ) <> 1 then
    raise exception 'Harvest ticket must contain exactly one kilogram line before closing';
  end if;

  v_status := coalesce(nullif(trim(p_patch ->> 'status'), ''), v_ticket.status::text);
  if v_status not in ('draft', 'active', 'ready_to_close') then
    raise exception 'Invalid status for harvest ticket update';
  end if;

  update public.ticket_lines
  set
    quantity = v_net,
    mass_kg = v_net,
    net_line_weight_kg = v_net
  where id = v_line.id;

  update public.tickets
  set
    gross_weight_kg = v_gross,
    tare_weight_kg = v_tare,
    net_weight_kg = v_net,
    notes = case when p_patch ? 'notes' then nullif(trim(p_patch ->> 'notes'), '') else notes end,
    status = v_status::public.ticket_status,
    updated_at = now()
  where id = p_ticket_id;

  return p_ticket_id;
end;
$$;

revoke all on function public.set_harvest_ticket_weights_for_session_v1(uuid, jsonb) from public, anon;
grant execute on function public.set_harvest_ticket_weights_for_session_v1(uuid, jsonb) to authenticated, service_role;
