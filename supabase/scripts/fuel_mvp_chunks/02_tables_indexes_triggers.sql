-- 02: fuel tables + indexes + triggers

create table if not exists public.fuel_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  source_type text not null default 'stationary_azs'
    check (source_type in ('stationary_azs', 'barrel', 'fuel_truck', 'mobile_tank')),
  fuel_type text not null default 'diesel'
    check (fuel_type in ('diesel', 'gasoline', 'adblue', 'oil', 'other')),
  capacity_liters numeric(14,3) null check (capacity_liters is null or capacity_liters >= 0),
  current_balance_liters numeric(14,3) not null default 0 check (current_balance_liters >= 0),
  location text null,
  assigned_vehicle_id uuid null references public.reference_vehicles(id) on delete set null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  updated_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_fuel_sources_company_name_active
  on public.fuel_sources(company_id, lower(trim(name)))
  where archived = false;
create index if not exists idx_fuel_sources_company_type
  on public.fuel_sources(company_id, fuel_type, source_type, is_active)
  where archived = false;
create index if not exists idx_fuel_sources_company_vehicle
  on public.fuel_sources(company_id, assigned_vehicle_id)
  where archived = false;

drop trigger if exists trg_fuel_sources_updated_at on public.fuel_sources;
create trigger trg_fuel_sources_updated_at
before update on public.fuel_sources
for each row execute function public.update_updated_at_column();

create table if not exists public.fuel_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  issued_at timestamptz not null default now(),
  fuel_source_id uuid not null references public.fuel_sources(id) on delete restrict,
  fuel_type text not null check (fuel_type in ('diesel', 'gasoline', 'adblue', 'oil', 'other')),
  vehicle_id uuid not null references public.reference_vehicles(id) on delete restrict,
  mechanizator_id uuid null references public.reference_specialists(id) on delete set null,
  liters numeric(14,3) not null check (liters > 0),
  comment text null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_fuel_issues_company_issued_at
  on public.fuel_issues(company_id, issued_at desc);
create index if not exists idx_fuel_issues_company_source
  on public.fuel_issues(company_id, fuel_source_id, issued_at desc);
create index if not exists idx_fuel_issues_company_vehicle
  on public.fuel_issues(company_id, vehicle_id, issued_at desc);
create index if not exists idx_fuel_issues_company_mechanizator
  on public.fuel_issues(company_id, mechanizator_id, issued_at desc);

create table if not exists public.fuel_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transferred_at timestamptz not null default now(),
  from_fuel_source_id uuid not null references public.fuel_sources(id) on delete restrict,
  to_fuel_source_id uuid not null references public.fuel_sources(id) on delete restrict,
  fuel_type text not null check (fuel_type in ('diesel', 'gasoline', 'adblue', 'oil', 'other')),
  liters numeric(14,3) not null check (liters > 0),
  operator_personnel_id uuid null references public.reference_specialists(id) on delete set null,
  comment text null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint fuel_transfers_distinct_sources check (from_fuel_source_id <> to_fuel_source_id)
);

create index if not exists idx_fuel_transfers_company_transferred_at
  on public.fuel_transfers(company_id, transferred_at desc);
create index if not exists idx_fuel_transfers_company_from
  on public.fuel_transfers(company_id, from_fuel_source_id, transferred_at desc);
create index if not exists idx_fuel_transfers_company_to
  on public.fuel_transfers(company_id, to_fuel_source_id, transferred_at desc);

create table if not exists public.fuel_limits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_month date not null,
  fuel_type text not null check (fuel_type in ('diesel', 'gasoline', 'adblue', 'oil', 'other')),
  vehicle_id uuid null references public.reference_vehicles(id) on delete cascade,
  mechanizator_id uuid null references public.reference_specialists(id) on delete cascade,
  limit_liters numeric(14,3) not null check (limit_liters > 0),
  is_active boolean not null default true,
  archived boolean not null default false,
  note text null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  updated_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_limits_target_check check (num_nonnulls(vehicle_id, mechanizator_id) = 1)
);

create unique index if not exists ux_fuel_limits_vehicle
  on public.fuel_limits(company_id, period_month, fuel_type, vehicle_id)
  where vehicle_id is not null and archived = false;
create unique index if not exists ux_fuel_limits_mechanizator
  on public.fuel_limits(company_id, period_month, fuel_type, mechanizator_id)
  where mechanizator_id is not null and archived = false;
create index if not exists idx_fuel_limits_company_period
  on public.fuel_limits(company_id, period_month desc, fuel_type)
  where archived = false;

drop trigger if exists trg_fuel_limits_updated_at on public.fuel_limits;
create trigger trg_fuel_limits_updated_at
before update on public.fuel_limits
for each row execute function public.update_updated_at_column();
