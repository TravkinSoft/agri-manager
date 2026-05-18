-- Personnel + Vehicles master upgrade
-- Safe additive migration

create table if not exists public.global_vehicle_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  country text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lower(name))
);

create table if not exists public.global_vehicle_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.global_vehicle_brands(id) on delete cascade,
  name text not null,
  model_type text not null check (model_type in ('truck','tractor','combine','trailer','loader','sprayer','seeder','other')),
  default_capacity_kg numeric(14,3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, lower(name), model_type)
);

create index if not exists idx_global_vehicle_models_brand on public.global_vehicle_models(brand_id);
create index if not exists idx_global_vehicle_models_type on public.global_vehicle_models(model_type);

alter table public.reference_specialists
  add column if not exists personnel_type text,
  add column if not exists phone text,
  add column if not exists status text not null default 'active',
  add column if not exists note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_specialists_personnel_type_check'
  ) then
    alter table public.reference_specialists
      add constraint reference_specialists_personnel_type_check
      check (personnel_type in ('driver', 'machine_operator') or personnel_type is null);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reference_specialists_status_check'
  ) then
    alter table public.reference_specialists
      add constraint reference_specialists_status_check
      check (status in ('active','inactive'));
  end if;
end $$;

alter table public.reference_vehicles
  add column if not exists global_brand_id uuid references public.global_vehicle_brands(id) on delete set null,
  add column if not exists global_model_id uuid references public.global_vehicle_models(id) on delete set null,
  add column if not exists custom_name text,
  add column if not exists inventory_number text,
  add column if not exists primary_responsible_personnel_id uuid references public.reference_specialists(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='reference_vehicles' and column_name='vehicle_type'
  ) then
    alter table public.reference_vehicles
      drop constraint if exists reference_vehicles_vehicle_type_check;
    alter table public.reference_vehicles
      add constraint reference_vehicles_vehicle_type_check
      check (vehicle_type in ('truck','tractor','combine','trailer','loader','sprayer','seeder','other','grain_truck','dump_truck','tractor_trailer'));
  end if;
end $$;

create index if not exists idx_reference_vehicles_primary_personnel on public.reference_vehicles(primary_responsible_personnel_id);
create index if not exists idx_reference_vehicles_global_model on public.reference_vehicles(global_model_id);

-- triggers for updated_at
drop trigger if exists trg_global_vehicle_brands_updated_at on public.global_vehicle_brands;
create trigger trg_global_vehicle_brands_updated_at
before update on public.global_vehicle_brands
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_global_vehicle_models_updated_at on public.global_vehicle_models;
create trigger trg_global_vehicle_models_updated_at
before update on public.global_vehicle_models
for each row execute function public.update_updated_at_column();

-- Seed global brands/models (idempotent)
with b as (
  insert into public.global_vehicle_brands(name, category, country, is_active)
  values
    ('KAMAZ','truck','RU',true),
    ('Shacman','truck','CN',true),
    ('HOWO','truck','CN',true),
    ('ZIL','truck','RU',true),
    ('GAZ','truck','RU',true),
    ('MTZ','tractor','BY',true),
    ('John Deere','tractor','US',true),
    ('CLAAS','combine','DE',true),
    ('CASE IH','combine','US',true)
  on conflict (lower(name)) do update set is_active = true
  returning id, name
)
insert into public.global_vehicle_models(brand_id, name, model_type, default_capacity_kg, is_active)
select b.id, x.model_name, x.model_type, x.default_capacity_kg, true
from (
  values
    ('KAMAZ','55111','truck',20000::numeric),
    ('KAMAZ','65115','truck',25000::numeric),
    ('Shacman','X3000','truck',30000::numeric),
    ('HOWO','A7','truck',30000::numeric),
    ('ZIL','130','truck',10000::numeric),
    ('GAZ','3307','truck',5000::numeric),
    ('MTZ','82','tractor',null::numeric),
    ('John Deere','7830','tractor',null::numeric),
    ('CLAAS','Lexion 760','combine',null::numeric),
    ('CASE IH','2388','combine',null::numeric)
) as x(brand_name, model_name, model_type, default_capacity_kg)
join b on lower(b.name) = lower(x.brand_name)
on conflict (brand_id, lower(name), model_type) do update set is_active = true;

-- Seed company data for ТОО "Астык-STEM"
do $$
declare
  v_company_id uuid;
  v_user_id uuid;
begin
  select c.id into v_company_id
  from public.companies c
  where lower(c.name) in (lower('ТОО "Астык-STEM"'), lower('ТОО Астык-STEM'), lower('Астык-STEM'))
  order by c.created_at asc
  limit 1;

  if v_company_id is null then
    return;
  end if;

  select p.id into v_user_id
  from public.profiles p
  where p.company_id = v_company_id
  order by case when p.role in ('global_admin','company_admin','admin') then 0 else 1 end, p.created_at asc
  limit 1;

  if v_user_id is null then
    return;
  end if;

  insert into public.reference_specialists(company_id, user_id, full_name, role, personnel_type, status, archived)
  values
    (v_company_id, v_user_id, 'Рустем Сарсенов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Нурлан Шаймерденов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Ержан Касымов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Айбек Муратов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Болат Ибраев', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Самат Тлеубаев', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Данияр Омаров', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Асхат Нурпеисов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Марат Смагулов', 'driver', 'driver', 'active', false),
    (v_company_id, v_user_id, 'Тимур Жаксылыков', 'driver', 'driver', 'active', false)
  on conflict do nothing;

  insert into public.reference_vehicles(company_id, user_id, name, custom_name, vehicle_type, plate_number, capacity_kg, status, is_active, archived)
  values
    (v_company_id, v_user_id, 'KAMAZ 55111', 'KAMAZ 55111', 'truck', 'KZ-55111', 20000, 'free', true, false),
    (v_company_id, v_user_id, 'KAMAZ 65115', 'KAMAZ 65115', 'truck', 'KZ-65115', 25000, 'free', true, false),
    (v_company_id, v_user_id, 'Shacman X3000', 'Shacman X3000', 'truck', 'KZ-X3000', 30000, 'free', true, false),
    (v_company_id, v_user_id, 'HOWO A7', 'HOWO A7', 'truck', 'KZ-HOWOA7', 30000, 'free', true, false),
    (v_company_id, v_user_id, 'ZIL 130', 'ZIL 130', 'truck', 'KZ-ZIL130', 10000, 'free', true, false),
    (v_company_id, v_user_id, 'GAZ 3307', 'GAZ 3307', 'truck', 'KZ-GAZ3307', 5000, 'free', true, false),
    (v_company_id, v_user_id, 'MTZ 82', 'MTZ 82', 'tractor', 'KZ-MTZ82', 0, 'free', true, false),
    (v_company_id, v_user_id, 'John Deere 7830', 'John Deere 7830', 'tractor', 'KZ-JD7830', 0, 'free', true, false),
    (v_company_id, v_user_id, 'CLAAS Lexion 760', 'CLAAS Lexion 760', 'combine', 'KZ-CL760', 0, 'free', true, false),
    (v_company_id, v_user_id, 'CASE IH 2388', 'CASE IH 2388', 'combine', 'KZ-CASE2388', 0, 'free', true, false)
  on conflict (company_id, plate_number) do nothing;

  update public.reference_vehicles rv
     set primary_responsible_personnel_id = rs.id
    from public.reference_specialists rs
   where rv.company_id = v_company_id
     and rs.company_id = v_company_id
     and rv.plate_number = 'KZ-55111'
     and rs.full_name = 'Рустем Сарсенов';

  update public.reference_vehicles rv
     set primary_responsible_personnel_id = rs.id
    from public.reference_specialists rs
   where rv.company_id = v_company_id
     and rs.company_id = v_company_id
     and rv.plate_number = 'KZ-65115'
     and rs.full_name = 'Нурлан Шаймерденов';

  update public.reference_vehicles rv
     set primary_responsible_personnel_id = rs.id
    from public.reference_specialists rs
   where rv.company_id = v_company_id
     and rs.company_id = v_company_id
     and rv.plate_number = 'KZ-X3000'
     and rs.full_name = 'Ержан Касымов';

  update public.reference_vehicles rv
     set primary_responsible_personnel_id = rs.id
    from public.reference_specialists rs
   where rv.company_id = v_company_id
     and rs.company_id = v_company_id
     and rv.plate_number = 'KZ-HOWOA7'
     and rs.full_name = 'Айбек Муратов';

  update public.reference_vehicles rv
     set primary_responsible_personnel_id = rs.id
    from public.reference_specialists rs
   where rv.company_id = v_company_id
     and rs.company_id = v_company_id
     and rv.plate_number = 'KZ-ZIL130'
     and rs.full_name = 'Болат Ибраев';
end $$;

