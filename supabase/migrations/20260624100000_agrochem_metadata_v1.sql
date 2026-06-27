/*
  Agrochem metadata V1.

  Purpose:
  - separate storage unit from default dosing metadata
  - add minimal physical state for Product Passport V1
  - retire per_t_solution in new Crop Care rows
  - allow ml/g operation material units for chemistry calculations

  No data backfill is performed here.
*/

alter table public.products
  add column if not exists stock_unit text,
  add column if not exists default_rate_type text,
  add column if not exists default_rate_unit text,
  add column if not exists physical_state text,
  add column if not exists metadata_source_url text,
  add column if not exists metadata_confidence text,
  add column if not exists metadata_review_required boolean not null default false;

alter table public.products
  drop constraint if exists products_stock_unit_check_v1,
  drop constraint if exists products_default_rate_type_check_v1,
  drop constraint if exists products_physical_state_check_v1,
  drop constraint if exists products_metadata_confidence_check_v1;

alter table public.products
  add constraint products_stock_unit_check_v1
  check (
    stock_unit is null
    or stock_unit in ('l', 'ml', 'kg', 'g', 'pcs', 'unknown')
  ) not valid;

alter table public.products
  add constraint products_default_rate_type_check_v1
  check (
    default_rate_type is null
    or default_rate_type in (
      'per_ha',
      'per_1000_l_solution',
      'per_l_water',
      'per_t_seed',
      'per_100kg_seed',
      'per_1000_seeds',
      'manual'
    )
  ) not valid;

alter table public.products
  add constraint products_physical_state_check_v1
  check (
    physical_state is null
    or physical_state in (
      'liquid',
      'solid',
      'granule',
      'powder',
      'tablet',
      'gel',
      'unknown'
    )
  ) not valid;

alter table public.products
  add constraint products_metadata_confidence_check_v1
  check (
    metadata_confidence is null
    or metadata_confidence in ('low', 'medium', 'high')
  ) not valid;

create index if not exists idx_products_global_agrochem_metadata
  on public.products (product_type, stock_unit, default_rate_type, physical_state)
  where company_id is null and archived = false;

create index if not exists idx_products_metadata_review_required
  on public.products (metadata_review_required)
  where company_id is null and archived = false;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.operation_materials'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%unit%'
      and pg_get_constraintdef(oid) ilike '%pcs%'
      and pg_get_constraintdef(oid) ilike '%kg%'
      and pg_get_constraintdef(oid) ilike '%l%'
  loop
    execute format('alter table public.operation_materials drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.operation_materials
  drop constraint if exists operation_materials_unit_check_v2;

alter table public.operation_materials
  add constraint operation_materials_unit_check_v2
  check (unit in ('kg', 'l', 'ml', 'g', 'pcs')) not valid;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.crop_care_scheme_step_materials'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%rate_basis%'
      and pg_get_constraintdef(oid) ilike '%per_t_solution%'
  loop
    execute format('alter table public.crop_care_scheme_step_materials drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.crop_care_scheme_step_materials
  drop constraint if exists crop_care_scheme_step_materials_rate_basis_check_v2,
  drop constraint if exists crop_care_scheme_step_materials_rate_unit_check_v2;

alter table public.crop_care_scheme_step_materials
  add constraint crop_care_scheme_step_materials_rate_basis_check_v2
  check (
    rate_basis in (
      'per_ha',
      'per_1000_l_solution',
      'per_l_water',
      'per_t_seed',
      'per_100kg_seed',
      'per_1000_seeds',
      'manual'
    )
  ) not valid,
  add constraint crop_care_scheme_step_materials_rate_unit_check_v2
  check (
    not (
      rate_basis in ('per_l_water', 'per_t_seed', 'per_100kg_seed', 'per_1000_seeds')
      and lower(rate_unit) in ('pcs', 'pc', 'piece', 'pieces', 'шт')
    )
  ) not valid;
