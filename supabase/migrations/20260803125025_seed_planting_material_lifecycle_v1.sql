-- TZ-248: canonical seed and planting material lifecycle.
-- The global catalog remains untouched. Physical stock is represented by exact
-- company-local identities and inventory batches in canonical kilograms.

create table if not exists public.company_seed_material_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid not null references public.varieties(id) on delete restrict,
  seed_reproduction_id uuid not null references public.seed_reproductions(id) on delete restrict,
  derived_product_id uuid not null references public.products(id) on delete restrict,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_seed_material_identities_unique_v1
    unique (company_id, crop_id, variety_id, seed_reproduction_id),
  constraint company_seed_material_identities_product_unique_v1
    unique (derived_product_id)
);

create index if not exists idx_company_seed_material_identities_company_v1
  on public.company_seed_material_identities(company_id, is_active);

alter table public.company_seed_material_identities enable row level security;

drop policy if exists company_seed_material_identities_select_v1
  on public.company_seed_material_identities;
create policy company_seed_material_identities_select_v1
on public.company_seed_material_identities for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'global_admin' and p.status = 'active'
  )
);

revoke all on table public.company_seed_material_identities from public, anon, authenticated;
grant select on table public.company_seed_material_identities to authenticated;

alter table public.inventory_transactions
  add column if not exists inventory_batch_id uuid references public.inventory_batches(id) on delete restrict,
  add column if not exists warehouse_issue_allocation_id uuid
    references public.warehouse_issue_request_item_allocations(id) on delete set null;

alter table public.stock_ledger_entries
  add column if not exists crop_id uuid references public.crops(id) on delete restrict,
  add column if not exists inventory_batch_id uuid references public.inventory_batches(id) on delete restrict;

create index if not exists idx_inventory_transactions_seed_batch_v1
  on public.inventory_transactions(company_id, inventory_batch_id)
  where inventory_batch_id is not null;

create index if not exists idx_stock_ledger_seed_batch_v1
  on public.stock_ledger_entries(company_id, inventory_batch_id, occurred_at)
  where inventory_batch_id is not null;

create unique index if not exists uq_stock_ledger_seed_batch_event_v1
  on public.stock_ledger_entries(
    company_id, inventory_batch_id, reason_type, reason_ref_id, direction
  )
  where inventory_batch_id is not null and reason_ref_id is not null;

alter table public.operation_mutation_receipts
  drop constraint if exists operation_mutation_receipts_action_check;
alter table public.operation_mutation_receipts
  add constraint operation_mutation_receipts_action_check
  check (action in (
    'create', 'create_v12', 'activate', 'material_request', 'material_edit',
    'request_stage', 'request_admin_v13', 'issue', 'return',
    'warehouse_return_v13', 'progress', 'progress_v12', 'complete',
    'finish_v12', 'finish_v13', 'variance_review', 'seed_receipt'
  ));

create or replace function public.ensure_company_seed_material_identity_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_crop_id uuid,
  p_variety_id uuid,
  p_reproduction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crop_name text;
  v_variety_name text;
  v_reproduction_name text;
  v_display_name text;
  v_identity_key text;
  v_product public.products%rowtype;
  v_identity public.company_seed_material_identities%rowtype;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id,
    p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist', 'warehouse', 'warehouse_operator']::text[]
  );

  if auth.uid() is null then
    raise exception 'Authenticated user is required' using errcode = '42501';
  end if;

  select coalesce(c.name_ru, c.name)
    into v_crop_name
  from public.crops c
  where c.id = p_crop_id and coalesce(c.archived, false) = false;
  if v_crop_name is null then
    raise exception 'Seed crop is not available' using errcode = '23503';
  end if;

  select coalesce(v.name_ru, v.name)
    into v_variety_name
  from public.varieties v
  where v.id = p_variety_id
    and v.crop_id = p_crop_id
    and coalesce(v.archived, false) = false
    and coalesce(v.is_active, true) = true;
  if v_variety_name is null then
    raise exception 'Seed variety does not belong to the selected crop' using errcode = '23514';
  end if;

  select coalesce(sr.name_ru, sr.name, sr.code)
    into v_reproduction_name
  from public.seed_reproductions sr
  where sr.id = p_reproduction_id
    and coalesce(sr.archived, false) = false
    and coalesce(sr.is_active, true) = true;
  if v_reproduction_name is null then
    raise exception 'Seed reproduction is not available' using errcode = '23503';
  end if;

  v_display_name := concat_ws(' · ', v_crop_name, v_variety_name, v_reproduction_name);
  v_identity_key := concat_ws(':', 'seed-v1', p_crop_id, p_variety_id, p_reproduction_id);

  insert into public.products (
    name, name_ru, type, user_id, company_id, unit, base_uom,
    accounting_mode, is_seed_material, is_active, archived,
    crop_id, variety_id, seed_reproduction_id,
    is_derived_inventory, derived_identity_key, description
  ) values (
    v_display_name, v_display_name, 'seed', auth.uid(), p_company_id, 'kg', 'kg',
    'bulk_mass', true, true, false,
    p_crop_id, p_variety_id, p_reproduction_id,
    true, v_identity_key,
    'Техническая складская identity семенного или посадочного материала.'
  )
  on conflict (company_id, derived_identity_key)
    where is_derived_inventory and company_id is not null and derived_identity_key is not null
  do update set
    name = excluded.name,
    name_ru = excluded.name_ru,
    type = 'seed',
    unit = 'kg',
    base_uom = 'kg',
    accounting_mode = 'bulk_mass',
    is_seed_material = true,
    is_active = true,
    archived = false,
    crop_id = excluded.crop_id,
    variety_id = excluded.variety_id,
    seed_reproduction_id = excluded.seed_reproduction_id,
    updated_at = now()
  returning * into v_product;

  if v_product.company_id is distinct from p_company_id
     or v_product.crop_id is distinct from p_crop_id
     or v_product.variety_id is distinct from p_variety_id
     or v_product.seed_reproduction_id is distinct from p_reproduction_id then
    raise exception 'Derived seed product identity conflict' using errcode = '23514';
  end if;

  insert into public.company_seed_material_identities (
    company_id, crop_id, variety_id, seed_reproduction_id,
    derived_product_id, display_name, is_active
  ) values (
    p_company_id, p_crop_id, p_variety_id, p_reproduction_id,
    v_product.id, v_display_name, true
  )
  on conflict (company_id, crop_id, variety_id, seed_reproduction_id)
  do update set
    derived_product_id = excluded.derived_product_id,
    display_name = excluded.display_name,
    is_active = true,
    updated_at = now()
  returning * into v_identity;

  return jsonb_build_object(
    'identity_id', v_identity.id,
    'product_id', v_product.id,
    'display_name', v_identity.display_name,
    'crop_id', v_identity.crop_id,
    'variety_id', v_identity.variety_id,
    'reproduction_id', v_identity.seed_reproduction_id
  );
end;
$$;

revoke all on function public.ensure_company_seed_material_identity_v1(
  uuid, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.ensure_company_seed_material_identity_v1(
  uuid, uuid, uuid, uuid, uuid
) to authenticated;

create or replace function public.get_seed_material_stock_v1(
  p_company_id uuid,
  p_crop_id uuid,
  p_variety_id uuid,
  p_reproduction_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_product_id uuid;
  v_available numeric;
  v_batch_count integer;
begin
  select p.* into v_actor
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';
  if not found or (
    v_actor.role <> 'global_admin'
    and v_actor.company_id is distinct from p_company_id
  ) then
    raise exception 'Company seed stock is not available to this actor' using errcode = '42501';
  end if;

  select i.derived_product_id into v_product_id
  from public.company_seed_material_identities i
  where i.company_id = p_company_id
    and i.crop_id = p_crop_id
    and i.variety_id = p_variety_id
    and i.seed_reproduction_id = p_reproduction_id
    and i.is_active;

  select coalesce(sum(greatest(b.current_quantity, 0)), 0), count(*)::integer
    into v_available, v_batch_count
  from public.inventory_batches b
  where b.company_id = p_company_id
    and b.crop_id = p_crop_id
    and b.variety_id = p_variety_id
    and b.reproduction_id = p_reproduction_id
    and b.batch_class = 'seed'
    and b.uom = 'kg'
    and b.warehouse_id is not null
    and b.current_quantity > 0;

  return jsonb_build_object(
    'product_id', v_product_id,
    'available_kg', coalesce(v_available, 0),
    'batch_count', coalesce(v_batch_count, 0),
    'stock_status', case when coalesce(v_available, 0) > 0 then 'available' else 'deficit' end
  );
end;
$$;

revoke all on function public.get_seed_material_stock_v1(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.get_seed_material_stock_v1(uuid, uuid, uuid, uuid)
  to authenticated;

create or replace function public.validate_exact_seed_material_row_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_material_kind text;
  v_source_mix_component_id uuid;
  v_product_id uuid;
  v_crop_id uuid;
  v_variety_id uuid;
  v_reproduction_id uuid;
begin
  if tg_table_name = 'operation_materials' then
    v_material_kind := new.material_type;
    v_source_mix_component_id := new.source_mix_component_id;
    v_product_id := new.product_id;
    v_crop_id := new.crop_id;
    v_variety_id := new.variety_id;
    v_reproduction_id := new.reproduction_id;
  else
    v_material_kind := coalesce(new.material_kind, new.product_category);
    v_source_mix_component_id := new.source_mix_component_id;
    v_product_id := coalesce(new.actual_product_id, new.product_id);
    v_crop_id := new.crop_id;
    v_variety_id := new.variety_id;
    v_reproduction_id := new.reproduction_id;
  end if;

  if v_material_kind <> 'seed' or v_source_mix_component_id is not null then
    return new;
  end if;

  if v_product_id is null or v_crop_id is null or v_variety_id is null or v_reproduction_id is null then
    raise exception 'Ordinary seed material requires exact product, crop, variety and reproduction'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = v_product_id
      and p.company_id = new.company_id
      and p.type = 'seed'
      and p.is_seed_material
      and p.is_derived_inventory
      and p.crop_id = v_crop_id
      and p.variety_id = v_variety_id
      and p.seed_reproduction_id = v_reproduction_id
      and coalesce(p.archived, false) = false
  ) then
    raise exception 'Seed product does not match exact crop, variety and reproduction'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_exact_seed_material_row_v1()
  from public, anon, authenticated;

drop trigger if exists validate_exact_seed_operation_material_v1 on public.operation_materials;
create trigger validate_exact_seed_operation_material_v1
before insert or update of product_id, material_type, crop_id, variety_id, reproduction_id, source_mix_component_id
on public.operation_materials
for each row execute function public.validate_exact_seed_material_row_v1();

drop trigger if exists validate_exact_seed_request_item_v1 on public.warehouse_issue_request_items;
create trigger validate_exact_seed_request_item_v1
before insert or update of product_id, actual_product_id, product_category, material_kind,
  crop_id, variety_id, reproduction_id, source_mix_component_id
on public.warehouse_issue_request_items
for each row execute function public.validate_exact_seed_material_row_v1();

-- The shared operation RPC predates exact material identity columns. Extend its
-- two INSERT statements in place so ordinary seed rows are valid before the
-- validation triggers run. Non-seed rows keep null identity fields.
do $patch_create_operation$
declare
  v_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.create_operation_plan_atomic_v1(' ||
    'uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text)'
  )) into v_definition;
  if v_definition is null then
    raise exception 'Atomic operation creation RPC is missing';
  end if;
  -- pg_get_functiondef can preserve CRLF from legacy function bodies.
  v_definition := replace(v_definition, E'\r\n', E'\n');
  if position('m.crop_id, m.variety_id, m.reproduction_id, m.material_type' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      $old$      material_type, unit, planned_rate, actual_rate, planned_quantity,
      issued_quantity, notes, created_by_user_id, updated_by_user_id$old$,
      $new$      material_type, unit, planned_rate, actual_rate, planned_quantity,
      issued_quantity, notes, crop_id, variety_id, reproduction_id,
      created_by_user_id, updated_by_user_id$new$
    );
    v_definition := replace(
      v_definition,
      $old$      nullif(v_material ->> 'notes', ''),
      auth.uid(), auth.uid()$old$,
      $new$      nullif(v_material ->> 'notes', ''),
      nullif(v_material ->> 'crop_id', '')::uuid,
      nullif(v_material ->> 'variety_id', '')::uuid,
      nullif(v_material ->> 'reproduction_id', '')::uuid,
      auth.uid(), auth.uid()$new$
    );
    v_definition := replace(
      v_definition,
      $old$      prepared_unit, issued_unit, received_unit, package_unit
    )
    select$old$,
      $new$      prepared_unit, issued_unit, received_unit, package_unit,
      crop_id, variety_id, reproduction_id, material_kind
    )
    select$new$
    );
    v_definition := replace(
      v_definition,
      $old$      m.unit, m.unit, m.unit, m.unit
    from public.operation_materials m$old$,
      $new$      m.unit, m.unit, m.unit, m.unit,
      m.crop_id, m.variety_id, m.reproduction_id, m.material_type
    from public.operation_materials m$new$
    );
    if position('m.crop_id, m.variety_id, m.reproduction_id, m.material_type' in v_definition) = 0 then
      raise exception 'Exact seed identity could not be installed in operation creation RPC';
    end if;
    execute v_definition;
  end if;
end;
$patch_create_operation$;

create or replace function public.validate_seed_batch_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.warehouse_issue_request_items%rowtype;
  v_batch public.inventory_batches%rowtype;
begin
  if new.batch_id is null then return new; end if;
  select * into v_item from public.warehouse_issue_request_items i
  where i.id = new.request_item_id and i.company_id = new.company_id;
  if not found or coalesce(v_item.material_kind, v_item.product_category) <> 'seed'
     or v_item.source_mix_component_id is not null then
    return new;
  end if;
  select * into v_batch from public.inventory_batches b
  where b.id = new.batch_id and b.company_id = new.company_id and b.warehouse_id = new.warehouse_id;
  if not found then
    raise exception 'Seed batch belongs to another company or warehouse' using errcode = '23503';
  end if;
  if v_batch.batch_class <> 'seed'
     or v_batch.product_id is distinct from coalesce(v_item.actual_product_id, v_item.product_id)
     or v_batch.crop_id is distinct from v_item.crop_id
     or v_batch.variety_id is distinct from v_item.variety_id
     or v_batch.reproduction_id is distinct from v_item.reproduction_id then
    raise exception 'Selected batch has another crop, variety or reproduction'
      using errcode = '23514';
  end if;
  if new.batch_id_text is distinct from new.batch_id::text then
    raise exception 'Seed batch technical identity is inconsistent' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_seed_batch_allocation_v1()
  from public, anon, authenticated;

drop trigger if exists validate_seed_batch_allocation_v1
  on public.warehouse_issue_request_item_allocations;
create trigger validate_seed_batch_allocation_v1
before insert or update of batch_id, batch_id_text, request_item_id, warehouse_id
on public.warehouse_issue_request_item_allocations
for each row execute function public.validate_seed_batch_allocation_v1();

create or replace function public.populate_seed_ledger_batch_trace_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allocation public.warehouse_issue_request_item_allocations%rowtype;
  v_batch public.inventory_batches%rowtype;
begin
  if new.inventory_batch_id is null and new.warehouse_issue_allocation_id is not null then
    select * into v_allocation
    from public.warehouse_issue_request_item_allocations a
    where a.id = new.warehouse_issue_allocation_id and a.company_id = new.company_id;
    if not found then
      raise exception 'Ledger allocation does not belong to the target company' using errcode = '23503';
    end if;
    new.inventory_batch_id := v_allocation.batch_id;
  end if;
  if new.inventory_batch_id is null then return new; end if;

  select * into v_batch from public.inventory_batches b
  where b.id = new.inventory_batch_id and b.company_id = new.company_id;
  if not found then
    raise exception 'Ledger seed batch does not belong to the target company' using errcode = '23503';
  end if;
  if v_batch.product_id is distinct from new.product_id
     or v_batch.warehouse_id is distinct from new.warehouse_id then
    raise exception 'Ledger product or warehouse does not match the seed batch'
      using errcode = '23514';
  end if;
  if v_batch.batch_class = 'seed' then
    if v_batch.uom <> 'kg' or new.uom <> 'kg'
       or v_batch.crop_id is null or v_batch.variety_id is null or v_batch.reproduction_id is null then
      raise exception 'Seed batch must use exact identity and canonical kg' using errcode = '23514';
    end if;
    new.crop_id := v_batch.crop_id;
    new.variety_id := v_batch.variety_id;
    new.reproduction_id := v_batch.reproduction_id;
    new.batch_class := 'seed';
    new.batch_id_text := v_batch.id::text;
  end if;
  return new;
end;
$$;

revoke all on function public.populate_seed_ledger_batch_trace_v1()
  from public, anon, authenticated;

drop trigger if exists populate_seed_ledger_batch_trace_v1 on public.stock_ledger_entries;
create trigger populate_seed_ledger_batch_trace_v1
before insert or update of inventory_batch_id, warehouse_issue_allocation_id,
  product_id, warehouse_id, uom, batch_class, batch_id_text
on public.stock_ledger_entries
for each row execute function public.populate_seed_ledger_batch_trace_v1();

create or replace function public.apply_seed_ledger_batch_balance_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_class text;
begin
  if new.inventory_batch_id is null or new.is_storno then return new; end if;
  select b.batch_class into v_batch_class
  from public.inventory_batches b
  where b.id = new.inventory_batch_id and b.company_id = new.company_id;
  if not found then
    raise exception 'Inventory batch is unavailable for ledger balance update'
      using errcode = '23503';
  end if;
  if v_batch_class <> 'seed' then return new; end if;
  update public.inventory_batches b
  set current_quantity = round(coalesce(b.current_quantity, 0) + new.delta_qty_signed, 4),
      current_weight_kg = round(coalesce(b.current_weight_kg, 0) + new.delta_qty_signed, 4),
      updated_at = now()
  where b.id = new.inventory_batch_id
    and b.company_id = new.company_id
    and b.batch_class = 'seed'
    and coalesce(b.current_quantity, 0) + new.delta_qty_signed >= -0.000001;
  if not found then
    raise exception 'Seed batch balance would become negative or batch is unavailable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.apply_seed_ledger_batch_balance_v1()
  from public, anon, authenticated;

drop trigger if exists apply_seed_ledger_batch_balance_v1 on public.stock_ledger_entries;
create trigger apply_seed_ledger_batch_balance_v1
after insert on public.stock_ledger_entries
for each row execute function public.apply_seed_ledger_batch_balance_v1();

create or replace function public.create_seed_planting_operation_plan_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_operation jsonb,
  p_lines jsonb,
  p_materials jsonb,
  p_structure_change jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_crop_id uuid := nullif(p_operation ->> 'crop_id', '')::uuid;
  v_variety_id uuid := nullif(p_operation ->> 'variety_id', '')::uuid;
  v_reproduction_id uuid := nullif(p_operation ->> 'reproduction_id', '')::uuid;
  v_identity jsonb;
  v_product_id uuid;
  v_seed_count integer;
  v_materials jsonb;
  v_response jsonb;
  v_operation_id uuid;
  v_material_rows jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'company_admin', 'agronomist']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'create', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;
  if coalesce(p_operation ->> 'operation_category_slug', '') <> 'planting' then
    raise exception 'Canonical seed lifecycle is available only for ordinary planting'
      using errcode = '23514';
  end if;
  if v_crop_id is null or v_variety_id is null or v_reproduction_id is null then
    raise exception 'Planting structure requires crop, variety and reproduction'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line
    where nullif(line ->> 'crop_id', '')::uuid is distinct from v_crop_id
       or nullif(line ->> 'variety_id', '')::uuid is distinct from v_variety_id
       or nullif(line ->> 'reproduction_id', '')::uuid is distinct from v_reproduction_id
  ) then
    raise exception 'Выбранные участки имеют разные культуры, сорта или репродукции. Создайте отдельные планы.'
      using errcode = '23514';
  end if;

  select count(*)::integer into v_seed_count
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) m
  where coalesce(m ->> 'material_type', m ->> 'component_type') = 'seed';
  if v_seed_count <> 1 then
    raise exception 'Ordinary planting requires exactly one primary seed material row'
      using errcode = '23514';
  end if;

  v_identity := public.ensure_company_seed_material_identity_v1(
    p_company_id, p_actor_profile_id, v_crop_id, v_variety_id, v_reproduction_id
  );
  v_product_id := (v_identity ->> 'product_id')::uuid;

  select jsonb_agg(
    case when coalesce(value ->> 'material_type', value ->> 'component_type') = 'seed'
      then value || jsonb_build_object(
        'product_id', v_product_id,
        'material_type', 'seed',
        'component_type', 'seed',
        'unit', 'kg',
        'crop_id', v_crop_id,
        'variety_id', v_variety_id,
        'reproduction_id', v_reproduction_id,
        'identity_label', v_identity ->> 'display_name'
      )
      else value
    end order by ordinality
  ) into v_materials
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
    with ordinality as material(value, ordinality);

  v_response := public.create_operation_plan_atomic_v1(
    p_company_id, p_actor_profile_id, p_operation, p_lines, v_materials,
    p_structure_change, p_idempotency_key, p_request_fingerprint
  );
  v_operation_id := nullif(v_response -> 'operation' ->> 'id', '')::uuid;
  if v_operation_id is null then
    raise exception 'Atomic seed operation did not return an operation id' using errcode = '23514';
  end if;

  update public.operation_materials m
  set crop_id = v_crop_id,
      variety_id = v_variety_id,
      reproduction_id = v_reproduction_id,
      updated_at = now()
  where m.company_id = p_company_id and m.operation_id = v_operation_id
    and m.material_type = 'seed' and m.product_id = v_product_id;

  update public.warehouse_issue_request_items i
  set crop_id = v_crop_id,
      variety_id = v_variety_id,
      reproduction_id = v_reproduction_id,
      material_kind = 'seed',
      product_category = 'seed',
      planned_product_id = v_product_id,
      actual_product_id = v_product_id
  from public.warehouse_issue_requests r
  where r.id = i.request_id and r.operation_id = v_operation_id
    and i.company_id = p_company_id and i.product_id = v_product_id;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_material_rows
  from public.operation_materials m
  where m.company_id = p_company_id and m.operation_id = v_operation_id;

  v_response := v_response
    || jsonb_build_object(
      'operation_materials', v_material_rows,
      'seed_identity', v_identity
    );

  update public.operation_mutation_receipts
  set response_payload = v_response
  where company_id = p_company_id and action = 'create'
    and idempotency_key = p_idempotency_key
    and request_fingerprint = p_request_fingerprint;

  return v_response;
end;
$$;

revoke all on function public.create_seed_planting_operation_plan_atomic_v1(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.create_seed_planting_operation_plan_atomic_v1(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.create_seed_material_receipt_atomic_v1(
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_warehouse_id uuid,
  p_crop_id uuid,
  p_variety_id uuid,
  p_reproduction_id uuid,
  p_quantity_kg numeric,
  p_origin_type text,
  p_batch_code text,
  p_supplier_lot text,
  p_supplier_company_counterparty_id uuid,
  p_supplier_global_counterparty_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_identity jsonb;
  v_product_id uuid;
  v_display_name text;
  v_season_id uuid;
  v_batch public.inventory_batches%rowtype;
  v_supplier public.counterparties%rowtype;
  v_global_supplier public.global_counterparties%rowtype;
  v_batch_code text;
  v_ledger_id uuid;
  v_response jsonb;
begin
  perform public.assert_operation_mutation_actor_v1(
    p_company_id, p_actor_profile_id,
    array['global_admin', 'warehouse', 'warehouse_operator']::text[]
  );
  v_replay := public.operation_mutation_receipt_begin_v1(
    p_company_id, 'seed_receipt', p_idempotency_key, p_request_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if p_quantity_kg is null or p_quantity_kg <= 0 then
    raise exception 'Seed receipt quantity must be positive' using errcode = '23514';
  end if;
  if p_origin_type not in ('purchase', 'own_production', 'opening_balance') then
    raise exception 'Unsupported seed material origin' using errcode = '22023';
  end if;
  if p_origin_type = 'purchase' then
    if p_supplier_company_counterparty_id is null and p_supplier_global_counterparty_id is null then
      raise exception 'Purchased seed material requires a supplier' using errcode = '23502';
    end if;
    if p_supplier_global_counterparty_id is not null then
      select * into v_global_supplier
      from public.global_counterparties g
      where g.id = p_supplier_global_counterparty_id
        and not coalesce(g.archived, false) and coalesce(g.is_active, true);
      if not found then
        raise exception 'Global supplier is unavailable' using errcode = '23503';
      end if;
    end if;
    if p_supplier_company_counterparty_id is not null then
      select * into v_supplier
      from public.counterparties c
      where c.id = p_supplier_company_counterparty_id and c.company_id = p_company_id
        and not coalesce(c.archived, false) and coalesce(c.is_active, true);
      if not found then
        raise exception 'Company supplier is unavailable' using errcode = '23503';
      end if;
      if p_supplier_global_counterparty_id is not null
         and v_supplier.global_counterparty_id is distinct from p_supplier_global_counterparty_id then
        raise exception 'Supplier identifiers do not match' using errcode = '23514';
      end if;
    elsif p_supplier_global_counterparty_id is not null then
      select * into v_supplier
      from public.counterparties c
      where c.company_id = p_company_id
        and (
          c.global_counterparty_id = v_global_supplier.id
          or (c.country_code = v_global_supplier.country_code and c.bin_iin = v_global_supplier.tax_id)
        )
      order by (c.global_counterparty_id = v_global_supplier.id) desc
      limit 1 for update;
      if found then
        update public.counterparties
        set global_counterparty_id = v_global_supplier.id,
            name = v_global_supplier.legal_name,
            counterparty_type = 'supplier',
            is_active = true,
            archived = false
        where id = v_supplier.id
        returning * into v_supplier;
      else
        insert into public.counterparties (
          company_id, global_counterparty_id, name, counterparty_type,
          bin_iin, country_code, is_active, archived, first_used_at, created_by
        ) values (
          p_company_id, v_global_supplier.id, v_global_supplier.legal_name, 'supplier',
          v_global_supplier.tax_id, v_global_supplier.country_code,
          true, false, now(), p_actor_profile_id
        ) returning * into v_supplier;
      end if;
    end if;
  elsif p_supplier_company_counterparty_id is not null or p_supplier_global_counterparty_id is not null then
    raise exception 'Supplier is allowed only for purchased seed material' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.company_id = p_company_id
      and not coalesce(w.archived, false) and not coalesce(w.is_archived, false)
      and w.warehouse_type in ('seed', 'grain', 'vegetable', 'potato_storage', 'universal', 'temporary')
  ) then
    raise exception 'Seed receipt warehouse is unavailable or has an incompatible type'
      using errcode = '23503';
  end if;

  select s.id into v_season_id
  from public.seasons s
  where s.company_id = p_company_id and coalesce(s.archived, false) = false
  order by s.year desc, s.created_at desc
  limit 1 for share;
  if v_season_id is null then
    raise exception 'Seed receipt requires an active season' using errcode = '23514';
  end if;

  v_identity := public.ensure_company_seed_material_identity_v1(
    p_company_id, p_actor_profile_id, p_crop_id, p_variety_id, p_reproduction_id
  );
  v_product_id := (v_identity ->> 'product_id')::uuid;
  v_display_name := v_identity ->> 'display_name';
  v_batch_code := coalesce(
    nullif(btrim(p_batch_code), ''),
    'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 8)
  );

  insert into public.inventory_batches (
    company_id, season_id, product_id, crop_id, variety_id, reproduction_id,
    batch_code, status, initial_weight_kg, current_weight_kg,
    batch_class, origin_type, supplier_lot, supplier_id,
    initial_quantity, current_quantity, uom, mass_kg,
    unit_source, unit_contract_version, warehouse_id, received_at,
    source_type, display_name
  ) values (
    p_company_id, v_season_id, v_product_id, p_crop_id, p_variety_id, p_reproduction_id,
    v_batch_code, 'ready_for_seeding', p_quantity_kg, 0,
    'seed', p_origin_type, nullif(btrim(p_supplier_lot), ''), v_supplier.id,
    p_quantity_kg, 0, 'kg', p_quantity_kg,
    'seed_receipt_v1', 2, p_warehouse_id, now(),
    p_origin_type, v_display_name
  ) returning * into v_batch;

  insert into public.stock_ledger_entries (
    company_id, product_id, warehouse_id, direction, quantity, uom,
    delta_qty_signed, reason_type, reason_ref_id, occurred_at, created_by, notes,
    crop_id, variety_id, reproduction_id, batch_id_text, batch_class,
    mass_kg, unit_source, unit_contract_version, inventory_batch_id
  ) values (
    p_company_id, v_product_id, p_warehouse_id, 'in', p_quantity_kg, 'kg',
    p_quantity_kg, 'seed_receipt', v_batch.id, now(), auth.uid(),
    coalesce(nullif(btrim(p_notes), ''), 'Seed material receipt'),
    p_crop_id, p_variety_id, p_reproduction_id, v_batch.id::text, 'seed',
    p_quantity_kg, 'seed_receipt_v1', 2, v_batch.id
  ) returning id into v_ledger_id;

  select * into v_batch from public.inventory_batches b where b.id = v_batch.id;
  v_response := jsonb_build_object(
    'receipt_id', v_batch.id,
    'receipt_no', v_batch.batch_code,
    'batch_id', v_batch.id,
    'batch_code', v_batch.batch_code,
    'product_id', v_product_id,
    'identity', v_identity,
    'quantity_kg', p_quantity_kg,
    'available_kg', v_batch.current_quantity,
    'ledger_entry_id', v_ledger_id,
    'origin_type', p_origin_type,
    'supplier_id', v_supplier.id,
    'season_id', v_season_id
  );
  return public.operation_mutation_receipt_finish_v1(
    p_company_id, 'seed_receipt', v_batch.id, p_idempotency_key,
    p_request_fingerprint, p_actor_profile_id, v_response
  );
end;
$$;

revoke all on function public.create_seed_material_receipt_atomic_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, text, uuid, uuid, text, text, text
) from public, anon;
grant execute on function public.create_seed_material_receipt_atomic_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, text, uuid, uuid, text, text, text
) to authenticated;

create or replace function public.post_inventory_transaction_to_ledger(p_transaction_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tx public.inventory_transactions%rowtype;
  v_inserted integer := 0;
  v_reason text;
begin
  select * into v_tx from public.inventory_transactions where id = p_transaction_id for update;
  if not found then raise exception 'Inventory transaction not found'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = v_tx.company_id)
  ) then
    raise exception 'Inventory transaction is unavailable to this actor' using errcode = '42501';
  end if;
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
    density_verified_at, unit_source, unit_contract_version,
    inventory_batch_id, warehouse_issue_allocation_id
  )
  select v_tx.company_id, v_tx.product_id, movement.warehouse_id, movement.direction,
    v_tx.base_quantity, v_tx.base_uom,
    case when movement.direction = 'in' then v_tx.base_quantity else -v_tx.base_quantity end,
    v_reason, v_tx.id, coalesce(v_tx.operation_datetime, v_tx.confirmed_at, v_tx.created_at),
    v_tx.responsible_user_id, v_tx.notes, v_tx.batch_class, v_tx.mass_kg,
    v_tx.density_kg_per_l, v_tx.density_unit, v_tx.density_source,
    v_tx.density_verification_status, v_tx.density_verified_at,
    'inventory_transaction:' || v_tx.id::text, 2,
    v_tx.inventory_batch_id, v_tx.warehouse_issue_allocation_id
  from (
    select coalesce(v_tx.destination_warehouse_id, v_tx.warehouse_id) as warehouse_id,
           'in'::public.ledger_direction as direction
      where v_tx.movement_type = 'receipt'
         or (v_tx.movement_type = 'adjustment' and v_tx.transaction_type = 'in')
    union all
    select coalesce(v_tx.source_warehouse_id, v_tx.warehouse_id),
           'out'::public.ledger_direction
      where v_tx.movement_type in ('issue','writeoff')
         or (v_tx.movement_type = 'adjustment' and v_tx.transaction_type = 'out')
    union all
    select v_tx.source_warehouse_id, 'out'::public.ledger_direction
      where v_tx.movement_type = 'transfer'
    union all
    select v_tx.destination_warehouse_id, 'in'::public.ledger_direction
      where v_tx.movement_type = 'transfer'
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

revoke all on function public.post_inventory_transaction_to_ledger(uuid) from public, anon;
grant execute on function public.post_inventory_transaction_to_ledger(uuid) to authenticated;

do $patch_return$
declare
  v_definition text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.return_material_request_atomic_v1(' ||
    'uuid,uuid,uuid,boolean,boolean,jsonb,jsonb,text,text)'
  )) into v_definition;
  if v_definition is null then
    raise exception 'Atomic material return RPC is missing';
  end if;
  -- Keep the textual patch stable for both LF and CRLF function bodies.
  v_definition := replace(v_definition, E'\r\n', E'\n');
  if position('warehouse_issue_allocation_id' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      $old$        warehouse_issue_request_id, warehouse_issue_request_item_id,
        operation_id, field_id, quantity_input, input_uom,$old$,
      $new$        warehouse_issue_request_id, warehouse_issue_request_item_id,
        warehouse_issue_allocation_id, inventory_batch_id,
        operation_id, field_id, quantity_input, input_uom,$new$
    );
    v_definition := replace(
      v_definition,
      $old$        p_request_id, (v_tx ->> 'warehouse_issue_request_item_id')::uuid,
        v_request.operation_id, v_request.field_id,$old$,
      $new$        p_request_id, (v_tx ->> 'warehouse_issue_request_item_id')::uuid,
        nullif(v_tx ->> 'allocation_id', '')::uuid,
        nullif(v_tx ->> 'inventory_batch_id', '')::uuid,
        v_request.operation_id, v_request.field_id,$new$
    );
    if position('inventory_batch_id' in v_definition) = 0 then
      raise exception 'Seed batch trace could not be installed in return RPC';
    end if;
    execute v_definition;
  end if;
end;
$patch_return$;

do $postcheck$
begin
  if to_regclass('public.company_seed_material_identities') is null then
    raise exception 'Company seed identity table is missing';
  end if;
  if to_regprocedure(
    'public.create_seed_planting_operation_plan_atomic_v1(' ||
    'uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text)'
  ) is null then
    raise exception 'Canonical seed operation RPC is missing';
  end if;
  if to_regprocedure(
    'public.create_seed_material_receipt_atomic_v1(' ||
    'uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text,text,uuid,uuid,text,text,text)'
  ) is null then
    raise exception 'Canonical seed receipt RPC is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_ledger_entries'
      and column_name = 'inventory_batch_id'
  ) then
    raise exception 'Ledger inventory batch trace is missing';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';
