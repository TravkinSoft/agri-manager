/*
  Global master catalogs foundation for platform panel.
  Adds structured columns and global-scope support for:
  - crops
  - varieties
  - seed_reproductions
  - products (pesticides/fertilizers)
  - reference_machines
  - reference_equipment
  - reference_vehicles
*/

-- =========================
-- Crops
-- =========================
alter table public.crops
  alter column company_id drop not null;

alter table public.crops
  add column if not exists crop_category text,
  add column if not exists crop_subcategory text,
  add column if not exists is_common_in_kz boolean not null default false,
  add column if not exists priority_level integer not null default 0,
  add column if not exists is_active boolean not null default true;

create index if not exists idx_crops_global_active
  on public.crops(lower(name))
  where company_id is null and archived = false;

-- =========================
-- Varieties
-- =========================
alter table public.varieties
  alter column company_id drop not null;

alter table public.varieties
  add column if not exists origin_country text,
  add column if not exists variety_type text,
  add column if not exists is_common_in_kz boolean not null default false,
  add column if not exists is_active boolean not null default true;

create index if not exists idx_varieties_global_active
  on public.varieties(lower(name))
  where company_id is null and archived = false;

-- =========================
-- Seed reproductions
-- =========================
alter table public.seed_reproductions
  alter column company_id drop not null;

alter table public.seed_reproductions
  add column if not exists level_order integer not null default 0,
  add column if not exists description text,
  add column if not exists is_active boolean not null default true;

create index if not exists idx_seed_reproductions_global_active
  on public.seed_reproductions(lower(name))
  where company_id is null and archived = false;

-- =========================
-- Products (global pesticides/fertilizers)
-- =========================
alter table public.products
  add column if not exists is_active boolean not null default true,
  add column if not exists trade_name text,
  add column if not exists manufacturer text,
  add column if not exists formulation text,
  add column if not exists package_size numeric,
  add column if not exists package_unit text,
  add column if not exists default_unit text,
  add column if not exists notes text;

update public.products
set default_unit = coalesce(default_unit, unit, case when type = 'pesticide' then 'l' else 'kg' end)
where default_unit is null;

create index if not exists idx_products_global_type_active
  on public.products(type, lower(name))
  where company_id is null and archived = false;

-- =========================
-- Machine yard / fleet
-- =========================
alter table public.reference_machines
  alter column company_id drop not null;

alter table public.reference_machines
  add column if not exists full_name text,
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists machine_category text,
  add column if not exists machine_type text,
  add column if not exists key_parameter text;

update public.reference_machines
set full_name = coalesce(full_name, name)
where full_name is null;

alter table public.reference_equipment
  alter column company_id drop not null;

alter table public.reference_equipment
  add column if not exists full_name text,
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists model text,
  add column if not exists equipment_category text,
  add column if not exists purpose text,
  add column if not exists key_parameter text,
  add column if not exists is_active boolean not null default true;

update public.reference_equipment
set full_name = coalesce(full_name, name)
where full_name is null;

alter table public.reference_vehicles
  alter column company_id drop not null;

alter table public.reference_vehicles
  add column if not exists full_name text,
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists model text,
  add column if not exists fleet_type text;

update public.reference_vehicles
set full_name = coalesce(full_name, name)
where full_name is null;

create index if not exists idx_reference_machines_global_active
  on public.reference_machines(lower(name))
  where company_id is null and archived = false;

create index if not exists idx_reference_equipment_global_active
  on public.reference_equipment(lower(name))
  where company_id is null and archived = false;

create index if not exists idx_reference_vehicles_global_active
  on public.reference_vehicles(lower(name))
  where company_id is null and archived = false;
