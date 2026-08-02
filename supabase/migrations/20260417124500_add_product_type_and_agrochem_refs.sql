/*
  Refactor agrochemistry product structure:
  - products.product_type
  - normalized reference tables for manufacturer / formulation / mode of action
  - FK columns in products
  - backfill existing data
*/

create extension if not exists pgcrypto;

create table if not exists public.agrochem_manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agrochem_formulations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name_ru text not null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agrochem_mode_of_actions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name_ru text not null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Canonical source for the production supplier/passport baseline. These
-- objects existed in production without a tracked migration source.
create table if not exists public.global_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  aliases text[] not null default '{}'::text[],
  notes text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_global_suppliers_normalized_active
  on public.global_suppliers (lower(normalized_name))
  where archived = false;

create table if not exists public.global_supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.global_suppliers(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_global_supplier_aliases_norm
  on public.global_supplier_aliases (lower(normalized_alias));

create table if not exists public.global_product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_global_product_aliases_product_norm
  on public.global_product_aliases (product_id, lower(normalized_alias));

create table if not exists public.global_product_supplier_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.global_suppliers(id) on delete cascade,
  role text not null default 'supplier'::text,
  source text,
  created_at timestamptz not null default now(),
  unique (product_id, supplier_id, role)
);

create unique index if not exists ux_agrochem_manufacturers_name_active
  on public.agrochem_manufacturers (lower(name))
  where archived = false;

create unique index if not exists ux_agrochem_formulations_code_active
  on public.agrochem_formulations (upper(code))
  where archived = false;

create unique index if not exists ux_agrochem_mode_of_actions_slug_active
  on public.agrochem_mode_of_actions (lower(slug))
  where archived = false;

insert into public.agrochem_formulations (code, name_ru, is_active, archived)
values
  ('SL', 'Растворимый концентрат', true, false),
  ('EC', 'Концентрат эмульсии', true, false),
  ('SC', 'Суспензионный концентрат', true, false),
  ('WG', 'Водно-диспергируемые гранулы', true, false),
  ('FS', 'Текучий концентрат суспензии для обработки семян', true, false),
  ('CS', 'Капсульная суспензия', true, false)
on conflict do nothing;

insert into public.agrochem_mode_of_actions (slug, name_ru, is_active, archived)
values
  ('systemic', 'Системный', true, false),
  ('contact', 'Контактный', true, false),
  ('translaminar', 'Трансламинарный', true, false),
  ('systemic_local', 'Локально-системный', true, false)
on conflict do nothing;

alter table public.products
  add column if not exists product_type text,
  add column if not exists mode_of_action_type text,
  add column if not exists manufacturer_id uuid,
  add column if not exists formulation_id uuid,
  add column if not exists mode_of_action_type_id uuid,
  add column if not exists application_rate_text text,
  add column if not exists normalized_name text,
  add column if not exists ui_group text,
  add column if not exists import_confidence text,
  add column if not exists requires_review boolean not null default false,
  add column if not exists operation_template text,
  add column if not exists global_supplier_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_product_type_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_product_type_check
      check (product_type is null or product_type in ('pesticide', 'fertilizer', 'growth_regulator', 'adjuvant'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_manufacturer_id_fk'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_manufacturer_id_fk
      foreign key (manufacturer_id)
      references public.agrochem_manufacturers(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_formulation_id_fk'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_formulation_id_fk
      foreign key (formulation_id)
      references public.agrochem_formulations(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_mode_of_action_type_id_fk'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_mode_of_action_type_id_fk
      foreign key (mode_of_action_type_id)
      references public.agrochem_mode_of_actions(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_category_id_fk'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_category_id_fk
      foreign key (category_id)
      references public.pesticide_categories(id)
      on update cascade on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_global_supplier_id_fkey'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_global_supplier_id_fkey
      foreign key (global_supplier_id)
      references public.global_suppliers(id)
      on delete set null;
  end if;
end $$;

insert into public.agrochem_manufacturers (name, is_active, archived)
select distinct trim(p.manufacturer), true, false
from public.products p
where p.manufacturer is not null
  and trim(p.manufacturer) <> ''
on conflict do nothing;

update public.products p
set manufacturer_id = m.id
from public.agrochem_manufacturers m
where p.manufacturer_id is null
  and p.manufacturer is not null
  and trim(p.manufacturer) <> ''
  and lower(trim(m.name)) = lower(trim(p.manufacturer));

update public.products p
set formulation_id = f.id
from public.agrochem_formulations f
where p.formulation_id is null
  and p.formulation is not null
  and trim(p.formulation) <> ''
  and upper(trim(f.code)) = upper(trim(p.formulation));

update public.products p
set mode_of_action_type_id = mo.id
from public.agrochem_mode_of_actions mo
where p.mode_of_action_type_id is null
  and p.mode_of_action_type is not null
  and trim(p.mode_of_action_type) <> ''
  and lower(trim(mo.slug)) = lower(trim(p.mode_of_action_type));

update public.products p
set product_type = case
  when lower(coalesce(pc.slug, '')) = 'growth_regulator' then 'growth_regulator'
  when lower(coalesce(pc.slug, '')) in ('adjuvant', 'surfactant', 'water_conditioner', 'ph_regulator', 'anti_foam', 'drift_reduction_agent', 'sticker', 'spreader', 'penetrant') then 'adjuvant'
  when lower(coalesce(pc.slug, '')) in ('herbicide', 'fungicide', 'insecticide', 'seed_treatment', 'desiccant', 'biological') then 'pesticide'
  when lower(coalesce(p.type, '')) = 'fertilizer' then 'fertilizer'
  when lower(coalesce(p.type, '')) = 'pesticide' then 'pesticide'
  when lower(coalesce(p.product_type, '')) in ('pesticide', 'fertilizer', 'growth_regulator', 'adjuvant') then lower(p.product_type)
  else p.product_type
end
from public.pesticide_categories pc
where p.category_id = pc.id;

update public.products p
set product_type = case
  when lower(coalesce(p.type, '')) = 'fertilizer' then 'fertilizer'
  when lower(coalesce(p.type, '')) = 'pesticide' then 'pesticide'
  else p.product_type
end
where p.product_type is null
  and p.category_id is null;

create index if not exists idx_products_product_type on public.products(product_type);
create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_manufacturer_id on public.products(manufacturer_id);
create index if not exists idx_products_formulation_id on public.products(formulation_id);
create index if not exists idx_products_mode_of_action_type_id on public.products(mode_of_action_type_id);

alter table public.products
  alter column updated_at drop not null;
