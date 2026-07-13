begin;

-- Canonical warehouse quantity contract v2.
-- This migration is intentionally additive: legacy columns and rows remain unchanged.

alter table public.products
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz;

alter table public.inventory_transactions
  add column if not exists base_quantity numeric(18,6),
  add column if not exists base_uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists batch_class text,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.stock_ledger_entries
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.ticket_lines
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.inventory_batches
  add column if not exists initial_quantity numeric(18,6),
  add column if not exists current_quantity numeric(18,6),
  add column if not exists uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_source text,
  add column if not exists unit_contract_version smallint;

alter table public.field_material_consumptions
  add column if not exists quantity numeric(18,6),
  add column if not exists uom text,
  add column if not exists mass_kg numeric(18,6),
  add column if not exists density_kg_per_l numeric(14,6),
  add column if not exists density_unit text,
  add column if not exists density_source text,
  add column if not exists density_verification_status text,
  add column if not exists density_verified_at timestamptz,
  add column if not exists unit_contract_version smallint;

-- Liquid material facts can have an unknown mass. The canonical quantity/uom remains required for v2 rows.
alter table public.field_material_consumptions
  alter column quantity_kg drop not null;

create or replace function public.canonical_stock_uom(p_uom text)
returns text
language sql
immutable
parallel safe
as $$
  select case lower(trim(coalesce(p_uom, '')))
    when 'kg' then 'kg' when 'кг' then 'kg'
    when 'g' then 'kg' when 'г' then 'kg' when 'gr' then 'kg'
    when 'l' then 'l' when 'л' then 'l' when 'lt' then 'l'
    when 'ml' then 'l' when 'мл' then 'l'
    when 'pcs' then 'pcs' when 'pc' then 'pcs' when 'шт' then 'pcs'
    else null
  end;
$$;

create or replace function public.validate_stock_quantity_contract(
  p_product_id uuid,
  p_quantity numeric,
  p_uom text,
  p_batch_class text,
  p_mass_kg numeric default null,
  p_density_kg_per_l numeric default null,
  p_density_unit text default null,
  p_density_source text default null,
  p_density_verification_status text default null,
  p_density_verified_at timestamptz default null
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_product_uom text;
  v_product_type text;
  v_is_seed boolean;
  v_uom text := public.canonical_stock_uom(p_uom);
begin
  select public.canonical_stock_uom(coalesce(nullif(base_uom, ''), unit)),
         lower(trim(coalesce(product_type, type, ''))),
         coalesce(is_seed_material, false)
    into v_product_uom, v_product_type, v_is_seed
  from public.products
  where id = p_product_id;

  if not found then raise exception 'Stock product not found'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Stock quantity must be positive'; end if;
  if v_uom is null then raise exception 'Unknown warehouse unit. Allowed units: kg, l, pcs'; end if;
  if v_product_uom is null then raise exception 'Product warehouse unit is missing or unsupported'; end if;
  if v_uom <> v_product_uom then raise exception 'Movement unit does not match product warehouse unit'; end if;
  if p_batch_class is null or p_batch_class not in ('commodity','seed','material','feed','waste','processing','rejected') then
    raise exception 'Canonical batch class is required';
  end if;
  if (v_is_seed or v_product_type in ('seed','seeds','planting_material')) and p_batch_class <> 'seed' then
    raise exception 'Seed material cannot be stored as commodity or material';
  end if;
  if v_product_type in ('pesticide','fertilizer','additive','adjuvant','defoamer','fuel','material','organic')
     and p_batch_class = 'commodity' then
    raise exception 'Material cannot be stored as commodity';
  end if;
  if p_mass_kg is not null and p_mass_kg < 0 then raise exception 'Mass must be non-negative'; end if;
  if v_uom = 'kg' and abs(coalesce(p_mass_kg, -1) - p_quantity) > 0.000001 then
    raise exception 'Kilogram quantity and mass must match';
  end if;
  if v_uom = 'pcs' and p_mass_kg is not null then
    raise exception 'Piece quantity cannot silently become mass';
  end if;
  if v_uom = 'l' and p_mass_kg is not null and not (
    p_density_kg_per_l > 0
    and lower(trim(coalesce(p_density_unit, ''))) = 'kg/l'
    and nullif(trim(coalesce(p_density_source, '')), '') is not null
    and lower(trim(coalesce(p_density_verification_status, ''))) = 'verified'
    and p_density_verified_at is not null
    and abs(p_mass_kg - p_quantity * p_density_kg_per_l) <= 0.001
  ) then
    raise exception 'Verified density evidence is required for liquid mass';
  end if;
end;
$$;

alter table public.inventory_batches drop constraint if exists inventory_batches_batch_class_check;
alter table public.inventory_batches add constraint inventory_batches_batch_class_check
  check (batch_class in ('commodity','seed','material','feed','waste','processing','rejected')) not valid;
alter table public.stock_ledger_entries drop constraint if exists stock_ledger_entries_batch_class_check;
alter table public.stock_ledger_entries add constraint stock_ledger_entries_batch_class_check
  check (batch_class is null or batch_class in ('commodity','seed','material','feed','waste','processing','rejected')) not valid;
alter table public.ticket_lines drop constraint if exists ticket_lines_batch_class_check;
alter table public.ticket_lines add constraint ticket_lines_batch_class_check
  check (batch_class is null or batch_class in ('commodity','seed','material','feed','waste','processing','rejected')) not valid;
alter table public.field_material_consumptions drop constraint if exists field_material_consumptions_batch_class_check;
alter table public.field_material_consumptions add constraint field_material_consumptions_batch_class_check
  check (batch_class is null or batch_class in ('commodity','seed','material','feed','waste','processing','rejected')) not valid;

alter table public.products
  add constraint products_density_contract_v2 check (
    density_kg_per_l is null or (
      density_kg_per_l > 0
      and lower(trim(density_unit)) = 'kg/l'
      and nullif(trim(density_source), '') is not null
      and lower(trim(density_verification_status)) = 'verified'
      and density_verified_at is not null
    )
  ) not valid;

alter table public.inventory_transactions
  add constraint inventory_transactions_unit_contract_v2 check (
    unit_contract_version is null or (
      unit_contract_version = 2 and base_quantity > 0 and base_uom in ('kg','l','pcs')
      and batch_class in ('commodity','seed','material','feed','waste','processing','rejected')
      and nullif(trim(unit_source), '') is not null
    )
  ) not valid;
alter table public.stock_ledger_entries
  add constraint stock_ledger_entries_unit_contract_v2 check (
    unit_contract_version is null or (
      unit_contract_version = 2 and quantity > 0 and uom in ('kg','l','pcs')
      and batch_class in ('commodity','seed','material','feed','waste','processing','rejected')
      and nullif(trim(unit_source), '') is not null
    )
  ) not valid;
alter table public.ticket_lines
  add constraint ticket_lines_unit_contract_v2 check (
    unit_contract_version is null or (
      unit_contract_version = 2 and quantity > 0 and uom in ('kg','l','pcs')
      and batch_class in ('commodity','seed','material','feed','waste','processing','rejected')
      and nullif(trim(unit_source), '') is not null
    )
  ) not valid;
alter table public.inventory_batches
  add constraint inventory_batches_unit_contract_v2 check (
    unit_contract_version is null or (
      unit_contract_version = 2 and initial_quantity > 0 and current_quantity >= 0 and uom in ('kg','l','pcs')
      and batch_class in ('commodity','seed','material','feed','waste','processing','rejected')
      and nullif(trim(unit_source), '') is not null
    )
  ) not valid;
alter table public.field_material_consumptions
  add constraint field_material_consumptions_unit_contract_v2 check (
    unit_contract_version is null or (
      unit_contract_version = 2 and quantity > 0 and uom in ('kg','l','pcs')
      and batch_class in ('commodity','seed','material','feed','waste','processing','rejected')
    )
  ) not valid;

create or replace function public.enforce_stock_ledger_contract_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_source public.stock_ledger_entries%rowtype;
  v_line public.ticket_lines%rowtype;
begin
  if new.unit_contract_version is null and new.storno_of_entry_id is not null then
    select * into v_source from public.stock_ledger_entries where id = new.storno_of_entry_id;
    if not found then raise exception 'Storno source ledger entry not found'; end if;
    new.uom := v_source.uom;
    new.batch_class := v_source.batch_class;
    new.mass_kg := v_source.mass_kg;
    new.density_kg_per_l := v_source.density_kg_per_l;
    new.density_unit := v_source.density_unit;
    new.density_source := v_source.density_source;
    new.density_verification_status := v_source.density_verification_status;
    new.density_verified_at := v_source.density_verified_at;
    new.unit_source := 'storno:' || v_source.id::text;
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null and new.ticket_id is not null then
    select * into v_line
    from public.ticket_lines tl
    where tl.ticket_id = new.ticket_id
      and tl.product_id = new.product_id
      and tl.unit_contract_version = 2
      and tl.uom = public.canonical_stock_uom(new.uom)
      and tl.batch_class = new.batch_class
    order by tl.created_at
    limit 1;
    if not found then raise exception 'Canonical ticket line contract not found for ledger entry'; end if;
    new.uom := v_line.uom;
    new.batch_class := v_line.batch_class;
    new.mass_kg := case when v_line.mass_kg is null then null else v_line.mass_kg end;
    new.density_kg_per_l := v_line.density_kg_per_l;
    new.density_unit := v_line.density_unit;
    new.density_source := v_line.density_source;
    new.density_verification_status := v_line.density_verification_status;
    new.density_verified_at := v_line.density_verified_at;
    new.unit_source := 'ticket_line:' || v_line.id::text;
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null and new.processing_id is not null then
    if public.canonical_stock_uom(new.uom) <> 'kg' or new.batch_class is null then
      raise exception 'Processing ledger entry must be kg with an explicit batch class';
    end if;
    new.uom := 'kg';
    new.mass_kg := new.quantity;
    new.unit_source := 'processing.weight_kg';
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null then
    raise exception 'Canonical unit contract is required for new ledger entries';
  end if;

  perform public.validate_stock_quantity_contract(
    new.product_id, new.quantity, new.uom, new.batch_class, new.mass_kg,
    new.density_kg_per_l, new.density_unit, new.density_source,
    new.density_verification_status, new.density_verified_at
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_stock_ledger_contract_v2 on public.stock_ledger_entries;
create trigger trg_enforce_stock_ledger_contract_v2
before insert on public.stock_ledger_entries
for each row execute function public.enforce_stock_ledger_contract_v2();

create or replace function public.enforce_inventory_batch_contract_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_line public.ticket_lines%rowtype;
begin
  if new.unit_contract_version is null and new.source_ticket_id is not null then
    select * into v_line
    from public.ticket_lines tl
    where tl.ticket_id = new.source_ticket_id
      and tl.product_id = new.product_id
      and tl.unit_contract_version = 2
    order by tl.created_at
    limit 1;
    if not found then raise exception 'Canonical ticket line contract not found for inventory batch'; end if;
    new.initial_quantity := v_line.quantity;
    new.current_quantity := v_line.quantity;
    new.uom := v_line.uom;
    new.mass_kg := v_line.mass_kg;
    new.batch_class := v_line.batch_class;
    new.density_kg_per_l := v_line.density_kg_per_l;
    new.density_unit := v_line.density_unit;
    new.density_source := v_line.density_source;
    new.density_verification_status := v_line.density_verification_status;
    new.density_verified_at := v_line.density_verified_at;
    new.unit_source := 'ticket_line:' || v_line.id::text;
    new.unit_contract_version := 2;
    new.initial_weight_kg := v_line.mass_kg;
    new.current_weight_kg := v_line.mass_kg;
  elsif new.unit_contract_version is null and new.source_ticket_id is null
        and new.initial_weight_kg is not null and new.batch_class is not null then
    new.initial_quantity := new.initial_weight_kg;
    new.current_quantity := coalesce(new.current_weight_kg, new.initial_weight_kg);
    new.uom := 'kg';
    new.mass_kg := new.current_quantity;
    new.unit_source := 'processing.weight_kg';
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null then
    raise exception 'Canonical unit contract is required for new inventory batches';
  end if;
  perform public.validate_stock_quantity_contract(
    new.product_id, new.initial_quantity, new.uom, new.batch_class, new.mass_kg,
    new.density_kg_per_l, new.density_unit, new.density_source,
    new.density_verification_status, new.density_verified_at
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_inventory_batch_contract_v2 on public.inventory_batches;
create trigger trg_enforce_inventory_batch_contract_v2
before insert on public.inventory_batches
for each row execute function public.enforce_inventory_batch_contract_v2();

create or replace function public.enforce_field_material_contract_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_line public.ticket_lines%rowtype;
begin
  if new.unit_contract_version is null and new.ticket_line_id is not null then
    select * into v_line from public.ticket_lines where id = new.ticket_line_id and unit_contract_version = 2;
    if not found then raise exception 'Canonical ticket line contract not found for field material fact'; end if;
    new.quantity := v_line.quantity;
    new.uom := v_line.uom;
    new.mass_kg := v_line.mass_kg;
    new.quantity_kg := v_line.mass_kg;
    new.batch_class := v_line.batch_class;
    new.density_kg_per_l := v_line.density_kg_per_l;
    new.density_unit := v_line.density_unit;
    new.density_source := v_line.density_source;
    new.density_verification_status := v_line.density_verification_status;
    new.density_verified_at := v_line.density_verified_at;
    new.unit_contract_version := 2;
  elsif new.unit_contract_version is null then
    raise exception 'Canonical unit contract is required for new field material facts';
  end if;
  perform public.validate_stock_quantity_contract(
    new.product_id, new.quantity, new.uom, new.batch_class, new.mass_kg,
    new.density_kg_per_l, new.density_unit, new.density_source,
    new.density_verification_status, new.density_verified_at
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_field_material_contract_v2 on public.field_material_consumptions;
create trigger trg_enforce_field_material_contract_v2
before insert or update on public.field_material_consumptions
for each row execute function public.enforce_field_material_contract_v2();

create or replace function public.post_inventory_transaction_to_ledger(p_transaction_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.inventory_transactions%rowtype;
  v_inserted integer := 0;
  v_reason text;
begin
  select * into v_tx from public.inventory_transactions where id = p_transaction_id for update;
  if not found then raise exception 'Inventory transaction not found'; end if;
  if coalesce(v_tx.status, 'confirmed') <> 'confirmed' then return 0; end if;
  if v_tx.unit_contract_version <> 2 then raise exception 'Inventory transaction has no canonical unit contract'; end if;

  perform public.validate_stock_quantity_contract(
    v_tx.product_id, v_tx.base_quantity, v_tx.base_uom, v_tx.batch_class, v_tx.mass_kg,
    v_tx.density_kg_per_l, v_tx.density_unit, v_tx.density_source,
    v_tx.density_verification_status, v_tx.density_verified_at
  );
  v_reason := case v_tx.movement_type
    when 'receipt' then 'warehouse_receipt'
    when 'writeoff' then 'warehouse_writeoff'
    when 'transfer' then 'warehouse_transfer'
    when 'adjustment' then 'warehouse_adjustment'
    else 'warehouse_issue'
  end;

  insert into public.stock_ledger_entries (
    company_id, product_id, warehouse_id, direction, quantity, uom, delta_qty_signed,
    reason_type, reason_ref_id, occurred_at, created_by, notes, batch_class, mass_kg,
    density_kg_per_l, density_unit, density_source, density_verification_status,
    density_verified_at, unit_source, unit_contract_version
  )
  select v_tx.company_id, v_tx.product_id, movement.warehouse_id, movement.direction,
    v_tx.base_quantity, v_tx.base_uom,
    case when movement.direction = 'in' then v_tx.base_quantity else -v_tx.base_quantity end,
    v_reason, v_tx.id, coalesce(v_tx.operation_datetime, v_tx.confirmed_at, v_tx.created_at),
    v_tx.responsible_user_id, v_tx.notes, v_tx.batch_class, v_tx.mass_kg,
    v_tx.density_kg_per_l, v_tx.density_unit, v_tx.density_source,
    v_tx.density_verification_status, v_tx.density_verified_at,
    'inventory_transaction:' || v_tx.id::text, 2
  from (
    select coalesce(v_tx.destination_warehouse_id, v_tx.warehouse_id) as warehouse_id, 'in'::public.ledger_direction as direction
      where v_tx.movement_type = 'receipt' or (v_tx.movement_type = 'adjustment' and v_tx.transaction_type = 'in')
    union all
    select coalesce(v_tx.source_warehouse_id, v_tx.warehouse_id), 'out'::public.ledger_direction
      where v_tx.movement_type in ('issue','writeoff') or (v_tx.movement_type = 'adjustment' and v_tx.transaction_type = 'out')
    union all
    select v_tx.source_warehouse_id, 'out'::public.ledger_direction where v_tx.movement_type = 'transfer'
    union all
    select v_tx.destination_warehouse_id, 'in'::public.ledger_direction where v_tx.movement_type = 'transfer'
  ) movement
  where movement.warehouse_id is not null
    and not exists (
      select 1 from public.stock_ledger_entries sle
      where sle.company_id = v_tx.company_id and sle.reason_ref_id = v_tx.id
        and sle.reason_type = v_reason and sle.warehouse_id = movement.warehouse_id
        and sle.product_id = v_tx.product_id and sle.direction = movement.direction
    );
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Disable alternate authenticated writers that do not carry the v2 unit contract.
revoke execute on function public.issue_warehouse_request_v2(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.confirm_warehouse_request_receipt(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_ticket(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_processing_document(uuid, uuid) from public, anon, authenticated;

create or replace view public.v_stock_movements_canonical as
select
  'stock_ledger_entries'::text as source_system,
  sle.id as source_id,
  sle.company_id,
  sle.warehouse_id,
  sle.product_id,
  coalesce(sle.occurred_at, sle.created_at, now()) as occurred_at,
  'confirmed'::text as status,
  coalesce(nullif(sle.reason_type, ''), case when sle.direction = 'in' then 'receipt' else 'issue' end) as movement_type,
  case when sle.delta_qty_signed > 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_in,
  case when sle.delta_qty_signed < 0 then abs(sle.delta_qty_signed) else 0 end::numeric as quantity_out,
  sle.delta_qty_signed::numeric as delta_qty,
  case when sle.unit_contract_version = 2 then sle.uom else 'legacy/' || coalesce(public.canonical_stock_uom(sle.uom), 'unknown') end as uom,
  sle.reason_type,
  sle.ticket_id,
  sle.processing_id,
  sle.batch_class,
  sle.unit_contract_version
from public.stock_ledger_entries sle
where sle.company_id is not null;

create or replace view public.v_stock_balance_canonical as
select
  m.company_id, m.warehouse_id, m.product_id,
  sum(m.delta_qty)::numeric(18,3) as quantity,
  m.uom,
  min(m.occurred_at) as first_movement_at,
  max(m.occurred_at) as last_movement_at,
  m.batch_class
from public.v_stock_movements_canonical m
group by m.company_id, m.warehouse_id, m.product_id, m.uom, m.batch_class
having abs(sum(m.delta_qty)) > 0.000001;

create or replace view public.v_stock_balance_identity as
select
  sle.company_id, sle.warehouse_id, sle.product_id, sle.variety_id, sle.reproduction_id,
  nullif(trim(coalesce(sle.batch_id_text, sle.batch_id, '')), '') as batch_id,
  sle.batch_class,
  sum(case when sle.direction = 'in' then sle.quantity else -sle.quantity end)::numeric as quantity,
  max(sle.occurred_at) as last_movement_at,
  case when sle.unit_contract_version = 2 then sle.uom else 'legacy/' || coalesce(public.canonical_stock_uom(sle.uom), 'unknown') end as uom
from public.stock_ledger_entries sle
group by sle.company_id, sle.warehouse_id, sle.product_id, sle.variety_id, sle.reproduction_id,
  nullif(trim(coalesce(sle.batch_id_text, sle.batch_id, '')), ''), sle.batch_class,
  case when sle.unit_contract_version = 2 then sle.uom else 'legacy/' || coalesce(public.canonical_stock_uom(sle.uom), 'unknown') end;

create or replace view public.v_stock_balance_reconciliation as
with expected as (
  select it.id as transaction_id, it.company_id,
    coalesce(it.destination_warehouse_id, it.warehouse_id) as warehouse_id,
    it.product_id, it.base_quantity::numeric as delta_qty, it.base_uom as uom
  from public.inventory_transactions it
  where it.unit_contract_version = 2 and coalesce(it.status, 'confirmed') = 'confirmed'
    and (it.movement_type = 'receipt' or (it.movement_type = 'adjustment' and it.transaction_type = 'in'))
  union all
  select it.id, it.company_id, coalesce(it.source_warehouse_id, it.warehouse_id),
    it.product_id, -it.base_quantity::numeric, it.base_uom
  from public.inventory_transactions it
  where it.unit_contract_version = 2 and coalesce(it.status, 'confirmed') = 'confirmed'
    and (it.movement_type in ('issue','writeoff') or (it.movement_type = 'adjustment' and it.transaction_type = 'out'))
  union all
  select it.id, it.company_id, it.source_warehouse_id, it.product_id, -it.base_quantity::numeric, it.base_uom
  from public.inventory_transactions it
  where it.unit_contract_version = 2 and coalesce(it.status, 'confirmed') = 'confirmed' and it.movement_type = 'transfer'
  union all
  select it.id, it.company_id, it.destination_warehouse_id, it.product_id, it.base_quantity::numeric, it.base_uom
  from public.inventory_transactions it
  where it.unit_contract_version = 2 and coalesce(it.status, 'confirmed') = 'confirmed' and it.movement_type = 'transfer'
), actual as (
  select sle.reason_ref_id as transaction_id, sle.company_id, sle.warehouse_id, sle.product_id,
    sum(sle.delta_qty_signed)::numeric as delta_qty, sle.uom
  from public.stock_ledger_entries sle
  where sle.unit_contract_version = 2 and sle.reason_ref_id is not null
    and sle.reason_type like 'warehouse_%'
  group by sle.reason_ref_id, sle.company_id, sle.warehouse_id, sle.product_id, sle.uom
)
select coalesce(e.company_id, a.company_id) as company_id,
  coalesce(e.warehouse_id, a.warehouse_id) as warehouse_id,
  coalesce(e.product_id, a.product_id) as product_id,
  coalesce(e.delta_qty, 0)::numeric(18,3) as qty_inventory,
  coalesce(a.delta_qty, 0)::numeric(18,3) as qty_ledger,
  (coalesce(e.delta_qty, 0) - coalesce(a.delta_qty, 0))::numeric(18,3) as diff,
  coalesce(e.uom, a.uom) as uom
from expected e
full join actual a on a.transaction_id = e.transaction_id and a.company_id = e.company_id
  and a.warehouse_id = e.warehouse_id and a.product_id = e.product_id and a.uom = e.uom
where abs(coalesce(e.delta_qty, 0) - coalesce(a.delta_qty, 0)) > 0.000001;

create or replace function public.get_stock_balance_canonical(
  p_company_id uuid, p_warehouse_id uuid, p_product_id uuid, p_uom text
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
  from public.v_stock_balance_canonical
  where company_id = p_company_id and warehouse_id = p_warehouse_id
    and product_id = p_product_id and uom = public.canonical_stock_uom(p_uom);
$$;

create or replace function public.get_stock_balance_canonical(
  p_company_id uuid, p_warehouse_id uuid, p_product_id uuid
)
returns numeric
language plpgsql
stable
as $$
declare v_count integer; v_quantity numeric;
begin
  select count(*), sum(quantity) into v_count, v_quantity
  from public.v_stock_balance_canonical
  where company_id = p_company_id and warehouse_id = p_warehouse_id and product_id = p_product_id;
  if v_count > 1 then raise exception 'Stock has multiple units/classes; request an explicit unit'; end if;
  return coalesce(v_quantity, 0);
end;
$$;

create index if not exists idx_inventory_transactions_company_product_uom_v2
  on public.inventory_transactions(company_id, product_id, base_uom) where unit_contract_version = 2;
create index if not exists idx_stock_ledger_company_wh_product_uom_v2
  on public.stock_ledger_entries(company_id, warehouse_id, product_id, uom, batch_class);
create index if not exists idx_stock_ledger_company_wh_identity_uom_class_v2
  on public.stock_ledger_entries(company_id, warehouse_id, product_id, variety_id, reproduction_id, uom, batch_class);
create index if not exists idx_inventory_batches_company_product_uom_v2
  on public.inventory_batches(company_id, product_id, uom, batch_class) where unit_contract_version = 2;

grant select on public.v_stock_movements_canonical to authenticated;
grant select on public.v_stock_balance_canonical to authenticated;
grant select on public.v_stock_balance_identity to authenticated;
grant select on public.v_stock_balance_reconciliation to authenticated;
grant execute on function public.get_stock_balance_canonical(uuid, uuid, uuid, text) to authenticated;

comment on view public.v_stock_balance_canonical is
  'Unit-safe ledger balances. Rows are separated by company, warehouse, product, canonical uom and batch class.';
comment on column public.inventory_transactions.base_quantity_kg is
  'Legacy compatibility mass only. New stock quantity is base_quantity/base_uom; no quantity-to-kg fallback is allowed.';

commit;

notify pgrst, 'reload schema';
