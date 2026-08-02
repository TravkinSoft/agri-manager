/*
  Harden global master catalogs for mass import readiness.
  Scope:
  - crops
  - varieties
  - seed_reproductions
  - products (global pesticides + fertilizers)
  - reference_machines (machinery)
  - reference_equipment (implements)
  - reference_vehicles (fleet transport domain)
*/

-- =====================================================
-- 0) Updated-at trigger helper safety
-- =====================================================
create or replace function public.ensure_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================
-- 1) Normalization dictionaries (scalable, editable)
-- =====================================================
create table if not exists public.master_crop_categories (
  code text primary key,
  name_ru text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_crop_subcategories (
  code text primary key,
  category_code text not null references public.master_crop_categories(code) on update cascade,
  name_ru text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.master_crop_priority_levels (
  level smallint primary key,
  name_ru text not null,
  is_active boolean not null default true
);

create table if not exists public.master_pesticide_categories (
  code text primary key,
  name_ru text not null,
  is_active boolean not null default true
);

create table if not exists public.master_fertilizer_types (
  code text primary key,
  name_ru text not null,
  is_active boolean not null default true
);

create table if not exists public.master_machinery_categories (
  code text primary key,
  name_ru text not null,
  is_active boolean not null default true
);

create table if not exists public.master_fleet_types (
  code text primary key,
  name_ru text not null,
  is_active boolean not null default true
);

insert into public.master_crop_priority_levels(level, name_ru, is_active) values
  (1, 'Низкий', true),
  (2, 'Базовый', true),
  (3, 'Средний', true),
  (4, 'Высокий', true),
  (5, 'Критический', true)
on conflict (level) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_crop_categories(code, name_ru, is_active) values
  ('cereal', 'Зерновые', true),
  ('cover_crop', 'Покровные культуры', true),
  ('forage', 'Кормовые', true),
  ('legume', 'Бобовые', true),
  ('melon', 'Бахчевые', true),
  ('oilseed', 'Масличные', true),
  ('other', 'Другое', true),
  ('perennial_grass', 'Многолетние травы', true),
  ('technical', 'Технические', true),
  ('vegetable', 'Овощные', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_crop_subcategories(code, category_code, name_ru, is_active) values
  ('annual', 'forage', 'Однолетние', true),
  ('bulb', 'vegetable', 'Луковичные', true),
  ('fruit', 'vegetable', 'Плодовые', true),
  ('leafy', 'vegetable', 'Листовые', true),
  ('perennial', 'forage', 'Многолетние', true),
  ('root', 'vegetable', 'Корнеплоды', true),
  ('tuber', 'vegetable', 'Клубнеплоды', true)
on conflict (code) do update
set category_code = excluded.category_code,
    name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_pesticide_categories(code, name_ru, is_active) values
  ('herbicide', 'Гербицид', true),
  ('fungicide', 'Фунгицид', true),
  ('insecticide', 'Инсектицид', true),
  ('seed_treatment', 'Протравитель', true),
  ('desiccant', 'Десикант', true),
  ('growth_regulator', 'Регулятор роста', true),
  ('adjuvant', 'Адъювант', true),
  ('biological', 'Биологический', true),
  ('surfactant', 'ПАВ', true),
  ('water_conditioner', 'Кондиционер воды', true),
  ('pH_regulator', 'pH-регулятор', true),
  ('drift_reduction_agent', 'Антидрифтовый агент', true),
  ('anti_foam', 'Антивспениватель', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_fertilizer_types(code, name_ru, is_active) values
  ('nitrogen', 'Азотное', true),
  ('phosphorus', 'Фосфорное', true),
  ('potassium', 'Калийное', true),
  ('npk', 'NPK', true),
  ('micronutrient', 'Микроэлементное', true),
  ('foliar', 'Листовое', true),
  ('organic', 'Органическое', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_machinery_categories(code, name_ru, is_active) values
  ('combine', 'Комбайн', true),
  ('seeder', 'Сеялка', true),
  ('sprayer', 'Опрыскиватель', true),
  ('cultivator', 'Культиватор', true),
  ('tractor', 'Трактор', true),
  ('drone', 'Дрон', true),
  ('other', 'Другое', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

insert into public.master_fleet_types(code, name_ru, is_active) values
  ('truck', 'Грузовик', true),
  ('grain_truck', 'Зерновоз', true),
  ('dump_truck', 'Самосвал', true),
  ('tractor_trailer', 'Трактор с прицепом', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;

-- =====================================================
-- 2) CROPS
-- =====================================================
alter table public.crops
  add column if not exists name_ru text,
  add column if not exists name_en text,
  add column if not exists slug text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists crop_kind text,
  add column if not exists default_uom text,
  add column if not exists harvest_uom text,
  add column if not exists seed_uom text,
  add column if not exists can_have_varieties boolean,
  add column if not exists can_have_seed_reproduction boolean,
  add column if not exists can_be_harvested boolean,
  add column if not exists description text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

update public.crops
set name_ru = coalesce(nullif(name_ru, ''), name)
where name_ru is null or btrim(name_ru) = '';

update public.crops
set name_en = coalesce(nullif(name_en, ''), name_ru, name)
where name_en is null or btrim(name_en) = '';

update public.crops
set category = coalesce(nullif(category, ''), nullif(crop_category, ''))
where category is null or btrim(category) = '';

update public.crops
set subcategory = coalesce(nullif(subcategory, ''), nullif(crop_subcategory, ''))
where subcategory is null or btrim(subcategory) = '';

insert into public.master_crop_categories(code, name_ru)
select distinct c.category, c.category
from public.crops c
where c.category is not null and btrim(c.category) <> ''
on conflict (code) do nothing;

insert into public.master_crop_subcategories(code, category_code, name_ru)
select distinct c.subcategory,
       coalesce(nullif(c.category, ''), 'other'),
       c.subcategory
from public.crops c
where c.subcategory is not null and btrim(c.subcategory) <> ''
on conflict (code) do nothing;

update public.crops
set crop_kind = coalesce(nullif(crop_kind, ''), 'general')
where crop_kind is null or btrim(crop_kind) = '';

update public.crops
set default_uom = coalesce(nullif(default_uom, ''), 'kg'),
    harvest_uom = coalesce(nullif(harvest_uom, ''), 'kg'),
    seed_uom = coalesce(nullif(seed_uom, ''), 'kg')
where default_uom is null
   or harvest_uom is null
   or seed_uom is null
   or btrim(default_uom) = ''
   or btrim(harvest_uom) = ''
   or btrim(seed_uom) = '';

update public.crops
set can_have_varieties = coalesce(can_have_varieties, true),
    can_have_seed_reproduction = coalesce(can_have_seed_reproduction, true),
    can_be_harvested = coalesce(can_be_harvested, true),
    is_common_in_kz = coalesce(is_common_in_kz, false),
    priority_level = case
      when priority_level is null or priority_level < 1 then 2
      when priority_level > 5 then 5
      else priority_level
    end,
    is_active = coalesce(is_active, true);

update public.crops
set slug = regexp_replace(
  lower(coalesce(nullif(name_en, ''), nullif(name_ru, ''), name)),
  '[^a-z0-9]+',
  '-',
  'g'
)
where slug is null or btrim(slug) = '';

update public.crops
set slug = trim(both '-' from slug)
where slug is not null;

update public.crops
set slug = concat('crop-', left(id::text, 8))
where slug is null or btrim(slug) = '';

alter table public.crops
  alter column name_ru set not null,
  alter column slug set not null,
  alter column crop_kind set not null,
  alter column default_uom set not null,
  alter column harvest_uom set not null,
  alter column seed_uom set not null,
  alter column can_have_varieties set not null,
  alter column can_have_seed_reproduction set not null,
  alter column can_be_harvested set not null,
  alter column is_active set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crops_priority_level_fk'
  ) then
    alter table public.crops
      add constraint crops_priority_level_fk
      foreign key (priority_level)
      references public.master_crop_priority_levels(level);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crops_category_fk'
  ) then
    alter table public.crops
      add constraint crops_category_fk
      foreign key (category)
      references public.master_crop_categories(code)
      on update cascade
      not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crops_subcategory_fk'
  ) then
    alter table public.crops
      add constraint crops_subcategory_fk
      foreign key (subcategory)
      references public.master_crop_subcategories(code)
      on update cascade
      not valid;
  end if;
end $$;

create unique index if not exists ux_crops_global_slug_active
  on public.crops (lower(slug))
  where company_id is null and archived = false;

create unique index if not exists ux_crops_global_name_ru_active
  on public.crops (lower(name_ru))
  where company_id is null and archived = false;

create index if not exists idx_crops_global_category_active
  on public.crops (category, subcategory, priority_level)
  where company_id is null and archived = false;

drop trigger if exists update_crops_updated_at on public.crops;
create trigger update_crops_updated_at
before update on public.crops
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 3) VARIETIES
-- =====================================================
alter table public.varieties
  add column if not exists breeder_or_originator text,
  add column if not exists maturity_group text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

update public.varieties
set is_common_in_kz = coalesce(is_common_in_kz, false),
    is_active = coalesce(is_active, true);

alter table public.varieties
  alter column crop_id set not null;

create unique index if not exists ux_varieties_global_crop_name_active
  on public.varieties(crop_id, lower(name))
  where company_id is null and archived = false;

create index if not exists idx_varieties_global_search
  on public.varieties(lower(name), lower(coalesce(origin_country, '')), lower(coalesce(variety_type, '')))
  where company_id is null and archived = false;

create index if not exists idx_varieties_crop_fk
  on public.varieties(crop_id);

drop trigger if exists update_varieties_updated_at on public.varieties;
create trigger update_varieties_updated_at
before update on public.varieties
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 4) SEED_REPRODUCTIONS
-- =====================================================
alter table public.seed_reproductions
  add column if not exists updated_at timestamptz not null default now();

update public.seed_reproductions
set level_order = coalesce(level_order, 0),
    is_active = coalesce(is_active, true);

create unique index if not exists ux_seed_reproductions_global_name_active
  on public.seed_reproductions(lower(name))
  where company_id is null and archived = false;

create index if not exists idx_seed_reproductions_global_level
  on public.seed_reproductions(level_order, is_active)
  where company_id is null and archived = false;

drop trigger if exists update_seed_reproductions_updated_at on public.seed_reproductions;
create trigger update_seed_reproductions_updated_at
before update on public.seed_reproductions
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 5) AGROCHEMISTRY (PRODUCTS table)
-- =====================================================
alter table public.products
  add column if not exists pesticide_category text,
  add column if not exists fertilizer_type text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists concentration text,
  add column if not exists target_pests text,
  add column if not exists target_crops text,
  add column if not exists application_rate numeric(14,4),
  add column if not exists application_unit text,
  add column if not exists application_method text,
  add column if not exists description text,
  add column if not exists registration_status_kz text,
  add column if not exists source_url text,
  add column if not exists composition text,
  add column if not exists updated_at timestamptz not null default now();

update public.products
set trade_name = coalesce(nullif(trade_name, ''), name)
where type in ('pesticide', 'fertilizer')
  and (trade_name is null or btrim(trade_name) = '');

update public.products
set active_ingredient = coalesce(nullif(active_ingredient, ''), 'unknown')
where type in ('pesticide', 'fertilizer')
  and (active_ingredient is null or btrim(active_ingredient) = '');

update public.products
set pesticide_category = coalesce(nullif(pesticide_category, ''), case when type = 'pesticide' then 'herbicide' else null end),
    category = coalesce(nullif(category, ''), nullif(pesticide_category, ''), case when type = 'fertilizer' then fertilizer_type else null end),
    subcategory = coalesce(nullif(subcategory, ''), case when array_length(pesticide_subcategories, 1) > 0 then pesticide_subcategories[1] else null end),
    application_unit = coalesce(nullif(application_unit, ''), nullif(default_unit, ''), nullif(unit, ''), case when type = 'pesticide' then 'l/ha' else 'kg/ha' end),
    composition = coalesce(nullif(composition, ''), case when type = 'fertilizer' then active_ingredient else null end),
    is_active = coalesce(is_active, true)
where type in ('pesticide', 'fertilizer');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_pesticide_category_check_v2'
  ) then
    alter table public.products
      add constraint products_pesticide_category_check_v2
      check (
        case
          when type = 'pesticide' then pesticide_category in (
            'herbicide','fungicide','insecticide','seed_treatment','desiccant',
            'growth_regulator','adjuvant','biological','surfactant','water_conditioner',
            'pH_regulator','drift_reduction_agent','anti_foam'
          )
          else true
        end
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_fertilizer_type_check_v2'
  ) then
    alter table public.products
      add constraint products_fertilizer_type_check_v2
      check (
        case
          when type = 'fertilizer' then fertilizer_type in (
            'nitrogen','phosphorus','potassium','npk','micronutrient','foliar','organic'
          )
          else true
        end
      );
  end if;
end $$;

create unique index if not exists ux_products_global_pesticide_trade_ai_active
  on public.products(
    lower(coalesce(trade_name, name)),
    lower(active_ingredient),
    coalesce(pesticide_category, '')
  )
  where company_id is null and type = 'pesticide' and archived = false;

create unique index if not exists ux_products_global_fertilizer_name_type_active
  on public.products(
    lower(coalesce(trade_name, name)),
    coalesce(fertilizer_type, ''),
    lower(coalesce(composition, ''))
  )
  where company_id is null and type = 'fertilizer' and archived = false;

create index if not exists idx_products_global_agrochem_search
  on public.products(
    type,
    lower(coalesce(trade_name, name)),
    lower(active_ingredient),
    lower(coalesce(manufacturer, ''))
  )
  where company_id is null and archived = false and type in ('pesticide', 'fertilizer');

create index if not exists idx_products_global_agrochem_filters
  on public.products(type, pesticide_category, fertilizer_type, is_active)
  where company_id is null and archived = false and type in ('pesticide', 'fertilizer');

drop trigger if exists update_products_updated_at on public.products;
create trigger update_products_updated_at
before update on public.products
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 6) MACHINERY (reference_machines)
-- =====================================================
alter table public.reference_machines
  add column if not exists category text,
  add column if not exists machinery_type text,
  add column if not exists key_spec text,
  add column if not exists description text,
  add column if not exists source_url text,
  add column if not exists updated_at timestamptz not null default now();

update public.reference_machines
set full_name = coalesce(nullif(full_name, ''), name),
    category = coalesce(nullif(category, ''), nullif(machine_category, ''), 'other'),
    machinery_type = coalesce(nullif(machinery_type, ''), nullif(machine_type, ''), type, 'other'),
    key_spec = coalesce(nullif(key_spec, ''), nullif(key_parameter, '')),
    is_active = coalesce(is_active, true)
where true;

alter table public.reference_machines
  alter column full_name set not null,
  alter column category set not null,
  alter column machinery_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_machines_category_check_v2'
  ) then
    alter table public.reference_machines
      add constraint reference_machines_category_check_v2
      check (category in ('combine','seeder','sprayer','cultivator','tractor','drone','other'));
  end if;
end $$;

create unique index if not exists ux_reference_machines_global_identity_active
  on public.reference_machines(
    lower(full_name),
    lower(coalesce(brand, '')),
    lower(coalesce(model, ''))
  )
  where company_id is null and archived = false;

create index if not exists idx_reference_machines_global_filters
  on public.reference_machines(category, machinery_type, lower(coalesce(brand, '')), is_active)
  where company_id is null and archived = false;

drop trigger if exists update_reference_machines_updated_at on public.reference_machines;
create trigger update_reference_machines_updated_at
before update on public.reference_machines
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 7) IMPLEMENTS (reference_equipment)
-- =====================================================
alter table public.reference_equipment
  add column if not exists category text,
  add column if not exists key_spec text,
  add column if not exists description text,
  add column if not exists source_url text,
  add column if not exists updated_at timestamptz not null default now();

update public.reference_equipment
set full_name = coalesce(nullif(full_name, ''), name),
    category = coalesce(nullif(category, ''), nullif(equipment_category, ''), nullif(category, ''), 'general'),
    key_spec = coalesce(nullif(key_spec, ''), nullif(key_parameter, '')),
    is_active = coalesce(is_active, true)
where true;

alter table public.reference_equipment
  alter column full_name set not null,
  alter column category set not null;

create unique index if not exists ux_reference_equipment_global_identity_active
  on public.reference_equipment(
    lower(full_name),
    lower(coalesce(brand, '')),
    lower(coalesce(model, ''))
  )
  where company_id is null and archived = false;

create index if not exists idx_reference_equipment_global_filters
  on public.reference_equipment(category, lower(coalesce(brand, '')), is_active)
  where company_id is null and archived = false;

drop trigger if exists update_reference_equipment_updated_at on public.reference_equipment;
create trigger update_reference_equipment_updated_at
before update on public.reference_equipment
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 8) FLEET TRANSPORT DOMAIN (reference_vehicles)
-- =====================================================
alter table public.reference_vehicles
  add column if not exists capacity numeric(14,3),
  add column if not exists description text,
  add column if not exists source_url text,
  add column if not exists updated_at timestamptz not null default now();

update public.reference_vehicles
set full_name = coalesce(nullif(full_name, ''), name),
    capacity = coalesce(capacity, capacity_kg),
    fleet_type = coalesce(nullif(fleet_type, ''), nullif(vehicle_type, ''), 'truck'),
    is_active = coalesce(is_active, true)
where true;

alter table public.reference_vehicles
  alter column full_name set not null,
  alter column fleet_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_vehicles_fleet_type_check_v2'
  ) then
    alter table public.reference_vehicles
      add constraint reference_vehicles_fleet_type_check_v2
      check (fleet_type in ('truck','grain_truck','dump_truck','tractor_trailer'));
  end if;
end $$;

create unique index if not exists ux_reference_vehicles_global_identity_active
  on public.reference_vehicles(
    lower(full_name),
    lower(coalesce(brand, '')),
    lower(coalesce(model, ''))
  )
  where company_id is null and archived = false;

create index if not exists idx_reference_vehicles_global_filters
  on public.reference_vehicles(fleet_type, lower(coalesce(brand, '')), is_active)
  where company_id is null and archived = false;

drop trigger if exists update_reference_vehicles_updated_at on public.reference_vehicles;
create trigger update_reference_vehicles_updated_at
before update on public.reference_vehicles
for each row execute function public.ensure_updated_at_column();

create unique index if not exists ux_master_pesticide_categories_code_ci
  on public.master_pesticide_categories(lower(code));

-- Optional compatibility view for "fleet_transport" naming in analytics/import docs
create or replace view public.fleet_transport as
select
  id,
  full_name,
  brand,
  series,
  model,
  fleet_type,
  capacity,
  description,
  source_url,
  is_active,
  created_at,
  updated_at
from public.reference_vehicles
where company_id is null and archived = false;
