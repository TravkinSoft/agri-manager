-- Canonical legacy vehicle compatibility schema.
-- transport_models is the active global transport catalog. These empty legacy
-- tables and links remain only for compatibility reads and later RLS setup.
-- Historical catalog/company seed data is intentionally not replayed.

create table if not exists public.global_vehicle_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists global_vehicle_brands_name_uidx
  on public.global_vehicle_brands (lower(name));

create table if not exists public.global_vehicle_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.global_vehicle_brands(id) on delete cascade,
  name text not null,
  type text not null default 'other',
  default_capacity_kg numeric(14,3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  model_type text not null default 'other'
);

create unique index if not exists global_vehicle_models_brand_name_uidx
  on public.global_vehicle_models (brand_id, lower(name));

alter table public.global_vehicle_models
  alter column default_capacity_kg type numeric;

alter table public.reference_specialists
  add column if not exists personnel_type text not null,
  add column if not exists status text not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_specialists'::regclass
      and conname = 'reference_specialists_personnel_type_check'
  ) then
    alter table public.reference_specialists
      add constraint reference_specialists_personnel_type_check
      check (personnel_type in ('driver', 'machine_operator'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_specialists'::regclass
      and conname = 'reference_specialists_status_check'
  ) then
    alter table public.reference_specialists
      add constraint reference_specialists_status_check
      check (status in ('active', 'inactive'));
  end if;
end
$$;

alter table public.reference_vehicles
  add column if not exists primary_responsible_personnel_id uuid,
  add column if not exists global_brand_id uuid,
  add column if not exists global_model_id uuid,
  add column if not exists custom_name text,
  add column if not exists inventory_number text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_vehicles'::regclass
      and conname = 'reference_vehicles_primary_responsible_fk'
  ) then
    alter table public.reference_vehicles
      add constraint reference_vehicles_primary_responsible_fk
      foreign key (primary_responsible_personnel_id)
      references public.reference_specialists(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_vehicles'::regclass
      and conname = 'reference_vehicles_global_brand_id_fkey'
  ) then
    alter table public.reference_vehicles
      add constraint reference_vehicles_global_brand_id_fkey
      foreign key (global_brand_id)
      references public.global_vehicle_brands(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_vehicles'::regclass
      and conname = 'reference_vehicles_global_model_id_fkey'
  ) then
    alter table public.reference_vehicles
      add constraint reference_vehicles_global_model_id_fkey
      foreign key (global_model_id)
      references public.global_vehicle_models(id)
      on delete set null;
  end if;
end
$$;
