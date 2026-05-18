-- MVP fuel module (AZS/GSM) for company-scoped operational issuing
-- Additive migration: roles + fuel tables + atomic RPCs

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'valid_role'
  ) then
    alter table public.profiles drop constraint valid_role;
  end if;

  alter table public.profiles
    add constraint valid_role
    check (
      role in (
        'global_admin',
        'company_admin',
        'agronomist',
        'specialist',
        'warehouse',
        'weighman',
        'fuel_operator'
      )
    );
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  invite_company_id uuid;
  user_role text;
  user_full_name text;
  valid_roles text[] := array[
    'global_admin',
    'company_admin',
    'agronomist',
    'specialist',
    'warehouse',
    'weighman',
    'fuel_operator'
  ];
begin
  user_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  if user_role = 'admin' then
    user_role := 'company_admin';
  end if;
  if user_role is null or user_role = '' or not (user_role = any(valid_roles)) then
    user_role := 'agronomist';
  end if;

  user_full_name := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g'), '');

  begin
    invite_company_id := (new.raw_user_meta_data->>'invited_by_company')::uuid;
  exception when others then
    invite_company_id := null;
  end;

  if invite_company_id is not null then
    if exists (select 1 from public.companies where id = invite_company_id) then
      insert into public.profiles (id, full_name, email, role, company_id, is_owner)
      values (new.id, user_full_name, new.email, user_role, invite_company_id, false)
      on conflict (id) do nothing;
    else
      insert into public.companies (name)
      values (new.email || '''s Company')
      returning id into new_company_id;

      insert into public.profiles (id, full_name, email, role, company_id, is_owner)
      values (new.id, user_full_name, new.email, user_role, new_company_id, true)
      on conflict (id) do nothing;
    end if;
  else
    insert into public.companies (name)
    values (coalesce(new.raw_user_meta_data->>'company_name', new.email || '''s Company'))
    returning id into new_company_id;

    insert into public.profiles (id, full_name, email, role, company_id, is_owner)
    values (new.id, user_full_name, new.email, user_role, new_company_id, true)
    on conflict (id) do nothing;
  end if;

  return new;
exception when others then
  raise warning 'handle_new_user failed for user %: % %', new.id, sqlerrm, sqlstate;
  return new;
end;
$$;

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

alter table public.fuel_sources enable row level security;
alter table public.fuel_issues enable row level security;
alter table public.fuel_transfers enable row level security;
alter table public.fuel_limits enable row level security;

drop policy if exists "Users can view company fuel sources" on public.fuel_sources;
create policy "Users can view company fuel sources"
  on public.fuel_sources
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can manage company fuel sources" on public.fuel_sources;
create policy "Users can manage company fuel sources"
  on public.fuel_sources
  for all
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  )
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel issues" on public.fuel_issues;
create policy "Users can view company fuel issues"
  on public.fuel_issues
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can insert company fuel issues" on public.fuel_issues;
create policy "Users can insert company fuel issues"
  on public.fuel_issues
  for insert
  to authenticated
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel transfers" on public.fuel_transfers;
create policy "Users can view company fuel transfers"
  on public.fuel_transfers
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can insert company fuel transfers" on public.fuel_transfers;
create policy "Users can insert company fuel transfers"
  on public.fuel_transfers
  for insert
  to authenticated
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel limits" on public.fuel_limits;
create policy "Users can view company fuel limits"
  on public.fuel_limits
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can manage company fuel limits" on public.fuel_limits;
create policy "Users can manage company fuel limits"
  on public.fuel_limits
  for all
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  )
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

create or replace function public.issue_fuel_mvp(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_fuel_source_id uuid,
  p_vehicle_id uuid,
  p_mechanizator_id uuid default null,
  p_liters numeric default 0,
  p_issued_at timestamptz default now(),
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_source public.fuel_sources%rowtype;
  v_vehicle public.reference_vehicles%rowtype;
  v_specialist public.reference_specialists%rowtype;
  v_issue_id uuid;
begin
  if p_liters is null or p_liters <= 0 then
    raise exception 'Issued liters must be greater than zero';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_user_id
  limit 1;

  if not found then
    raise exception 'Actor profile not found';
  end if;
  if v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;
  if coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Actor profile is not active';
  end if;
  if coalesce(v_actor.role, '') not in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator') then
    raise exception 'Actor role cannot issue fuel';
  end if;

  select * into v_source
  from public.fuel_sources
  where id = p_fuel_source_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Fuel source not found';
  end if;
  if v_source.archived or not v_source.is_active then
    raise exception 'Fuel source is not active';
  end if;
  if v_source.current_balance_liters < p_liters then
    raise exception 'Insufficient fuel balance. Available %, requested %', v_source.current_balance_liters, p_liters;
  end if;

  select * into v_vehicle
  from public.reference_vehicles
  where id = p_vehicle_id
    and company_id = p_company_id
  limit 1;
  if not found then
    raise exception 'Vehicle not found in company';
  end if;
  if coalesce(v_vehicle.archived, false) then
    raise exception 'Vehicle is archived';
  end if;

  if p_mechanizator_id is not null then
    select * into v_specialist
    from public.reference_specialists
    where id = p_mechanizator_id
      and company_id = p_company_id
    limit 1;
    if not found then
      raise exception 'Mechanizator/responsible person not found in company';
    end if;
    if coalesce(v_specialist.archived, false) then
      raise exception 'Mechanizator/responsible person is archived';
    end if;
  end if;

  insert into public.fuel_issues (
    company_id,
    issued_at,
    fuel_source_id,
    fuel_type,
    vehicle_id,
    mechanizator_id,
    liters,
    comment,
    created_by_user_id
  ) values (
    p_company_id,
    coalesce(p_issued_at, now()),
    p_fuel_source_id,
    v_source.fuel_type,
    p_vehicle_id,
    p_mechanizator_id,
    p_liters,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_actor_user_id
  )
  returning id into v_issue_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters - p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_fuel_source_id;

  return v_issue_id;
end;
$$;

create or replace function public.transfer_fuel_mvp(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_from_fuel_source_id uuid,
  p_to_fuel_source_id uuid,
  p_liters numeric default 0,
  p_transferred_at timestamptz default now(),
  p_operator_personnel_id uuid default null,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_from public.fuel_sources%rowtype;
  v_to public.fuel_sources%rowtype;
  v_specialist public.reference_specialists%rowtype;
  v_transfer_id uuid;
begin
  if p_from_fuel_source_id = p_to_fuel_source_id then
    raise exception 'Source and destination fuel sources must be different';
  end if;
  if p_liters is null or p_liters <= 0 then
    raise exception 'Transfer liters must be greater than zero';
  end if;

  select * into v_actor
  from public.profiles
  where id = p_actor_user_id
  limit 1;
  if not found then
    raise exception 'Actor profile not found';
  end if;
  if v_actor.company_id <> p_company_id then
    raise exception 'Actor does not belong to company';
  end if;
  if coalesce(v_actor.status, 'active') <> 'active' then
    raise exception 'Actor profile is not active';
  end if;
  if coalesce(v_actor.role, '') not in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator') then
    raise exception 'Actor role cannot transfer fuel';
  end if;

  select * into v_from
  from public.fuel_sources
  where id = p_from_fuel_source_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Source fuel tank not found';
  end if;

  select * into v_to
  from public.fuel_sources
  where id = p_to_fuel_source_id
    and company_id = p_company_id
  for update;
  if not found then
    raise exception 'Destination fuel tank not found';
  end if;

  if v_from.archived or not v_from.is_active then
    raise exception 'Source fuel tank is not active';
  end if;
  if v_to.archived or not v_to.is_active then
    raise exception 'Destination fuel tank is not active';
  end if;
  if v_from.fuel_type <> v_to.fuel_type then
    raise exception 'Fuel type mismatch between tanks (% vs %)', v_from.fuel_type, v_to.fuel_type;
  end if;
  if v_from.current_balance_liters < p_liters then
    raise exception 'Insufficient source balance. Available %, requested %', v_from.current_balance_liters, p_liters;
  end if;

  if p_operator_personnel_id is not null then
    select * into v_specialist
    from public.reference_specialists
    where id = p_operator_personnel_id
      and company_id = p_company_id
    limit 1;
    if not found then
      raise exception 'Operator person not found in company';
    end if;
    if coalesce(v_specialist.archived, false) then
      raise exception 'Operator person is archived';
    end if;
  end if;

  insert into public.fuel_transfers (
    company_id,
    transferred_at,
    from_fuel_source_id,
    to_fuel_source_id,
    fuel_type,
    liters,
    operator_personnel_id,
    comment,
    created_by_user_id
  ) values (
    p_company_id,
    coalesce(p_transferred_at, now()),
    p_from_fuel_source_id,
    p_to_fuel_source_id,
    v_from.fuel_type,
    p_liters,
    p_operator_personnel_id,
    nullif(trim(coalesce(p_comment, '')), ''),
    p_actor_user_id
  )
  returning id into v_transfer_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters - p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_from_fuel_source_id;

  update public.fuel_sources
  set
    current_balance_liters = current_balance_liters + p_liters,
    updated_by_user_id = p_actor_user_id,
    updated_at = now()
  where id = p_to_fuel_source_id;

  return v_transfer_id;
end;
$$;

grant execute on function public.issue_fuel_mvp(uuid, uuid, uuid, uuid, uuid, numeric, timestamptz, text) to authenticated;
grant execute on function public.transfer_fuel_mvp(uuid, uuid, uuid, uuid, numeric, timestamptz, uuid, text) to authenticated;

notify pgrst, 'reload schema';
