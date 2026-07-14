/*
  Split catalogs:
  - reference_vehicles: transport for weighbridge/logistics
  - reference_machines: special equipment for field operations (not transport)
*/

create table if not exists public.reference_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  name_ru text,
  name_kz text,
  name_en text,
  vehicle_type text not null default 'truck' check (vehicle_type in ('truck', 'grain_truck', 'dump_truck', 'tractor_trailer')),
  plate_number text not null check (length(trim(plate_number)) > 0),
  capacity_kg numeric(14,3) not null default 0 check (capacity_kg > 0),
  body_volume_m3 numeric(14,3),
  status text not null default 'free' check (status in ('free', 'in_trip', 'loading', 'unloading', 'drying')),
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, plate_number)
);

create index if not exists idx_reference_vehicles_company_id on public.reference_vehicles(company_id);
create index if not exists idx_reference_vehicles_company_status on public.reference_vehicles(company_id, status);

alter table public.profiles
  add column if not exists machine_id uuid null references public.reference_vehicles(id) on delete set null;

create index if not exists idx_profiles_machine_id on public.profiles(machine_id);

alter table public.reference_vehicles enable row level security;

drop policy if exists "Company members can view reference_vehicles" on public.reference_vehicles;
create policy "Company members can view reference_vehicles"
  on public.reference_vehicles for select
  to authenticated
  using (company_id in (select company_id from public.profiles where id = auth.uid()));

drop policy if exists "Company members can manage reference_vehicles" on public.reference_vehicles;
create policy "Company members can manage reference_vehicles"
  on public.reference_vehicles for all
  to authenticated
  using (company_id in (select company_id from public.profiles where id = auth.uid()))
  with check (company_id in (select company_id from public.profiles where id = auth.uid()));

drop trigger if exists update_reference_vehicles_updated_at on public.reference_vehicles;
create trigger update_reference_vehicles_updated_at
  before update on public.reference_vehicles
  for each row execute function public.update_updated_at_column();

alter table public.reference_machines
  add column if not exists model text,
  add column if not exists status text not null default 'free',
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reference_machines_status_check'
  ) then
    alter table public.reference_machines
      add constraint reference_machines_status_check
      check (status in ('free', 'working', 'maintenance'));
  end if;
end $$;

do $$
declare
  owner_user_id uuid;
  owner_company_id uuid;
begin
  select p.id, p.company_id
  into owner_user_id, owner_company_id
  from public.profiles p
  where p.company_id is not null
  order by case when p.role = 'admin' then 0 else 1 end, p.created_at asc
  limit 1;

  if owner_user_id is null or owner_company_id is null then
    return;
  end if;

  insert into public.reference_vehicles (company_id, user_id, name, vehicle_type, plate_number, capacity_kg, status, is_active)
  values
    (owner_company_id, owner_user_id, 'КамАЗ 55111', 'truck', 'A001AA', 20000, 'free', true),
    (owner_company_id, owner_user_id, 'ЗИЛ 130', 'truck', 'A002AA', 10000, 'free', true),
    (owner_company_id, owner_user_id, 'Shacman X3000', 'dump_truck', 'A003AA', 30000, 'free', true),
    (owner_company_id, owner_user_id, 'КамАЗ зерновоз', 'grain_truck', 'A004AA', 25000, 'free', true),
    (owner_company_id, owner_user_id, 'МТЗ + прицеп', 'tractor_trailer', 'A005AA', 12000, 'free', true)
  on conflict (company_id, plate_number) do nothing;

  insert into public.reference_machines (company_id, user_id, name, type, model, status, is_active, archived)
  values
    (owner_company_id, owner_user_id, 'Claas Lexion 770', 'combine', 'Lexion 770', 'free', true, false),
    (owner_company_id, owner_user_id, 'John Deere сеялка', 'seeder', 'John Deere', 'free', true, false),
    (owner_company_id, owner_user_id, 'Amazone опрыскиватель', 'sprayer', 'Amazone', 'free', true, false)
  on conflict do nothing;
end $$;
