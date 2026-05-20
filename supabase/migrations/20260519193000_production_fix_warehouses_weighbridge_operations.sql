begin;

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
        'director',
        'legal_operator',
        'specialist',
        'warehouse',
        'warehouse_operator',
        'weighman',
        'fuel_operator',
        'brigadier'
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
    'director',
    'legal_operator',
    'specialist',
    'warehouse',
    'warehouse_operator',
    'weighman',
    'fuel_operator',
    'brigadier'
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

alter table public.warehouses
  add column if not exists capacity_value numeric(14,3),
  add column if not exists capacity_unit text,
  add column if not exists responsible_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists location text,
  add column if not exists description text,
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'warehouses'
      and column_name = 'storage_capacity_kg'
  ) then
    update public.warehouses
      set capacity_value = coalesce(capacity_value, storage_capacity_kg),
          capacity_unit = coalesce(capacity_unit, case when storage_capacity_kg is not null then 'kg' else null end)
    where (capacity_value is null or capacity_unit is null);
  end if;

  update public.warehouses
    set is_archived = coalesce(archived, false)
  where is_archived is distinct from coalesce(archived, false);

  update public.warehouses
    set created_by_user_id = coalesce(created_by_user_id, user_id)
  where created_by_user_id is null and user_id is not null;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'warehouses'
      and constraint_name = 'warehouses_capacity_unit_check'
  ) then
    alter table public.warehouses
      add constraint warehouses_capacity_unit_check
      check (capacity_unit is null or capacity_unit in ('kg','t','m3','l'));
  end if;
end $$;

create index if not exists idx_warehouses_company_archived_name
  on public.warehouses(company_id, is_archived, archived, name);

create index if not exists idx_warehouses_company_type
  on public.warehouses(company_id, warehouse_type);

create table if not exists public.operation_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  field_id uuid references public.fields(id) on delete set null,
  crop_id uuid references public.crops(id) on delete set null,
  variety_id uuid references public.varieties(id) on delete set null,
  reproduction_id uuid references public.seed_reproductions(id) on delete set null,
  planned_area_ha numeric(12,3) not null default 0 check (planned_area_ha >= 0),
  actual_area_ha numeric(12,3) check (actual_area_ha is null or actual_area_ha >= 0),
  row_count integer check (row_count is null or row_count >= 0),
  row_spacing_m numeric(10,4) check (row_spacing_m is null or row_spacing_m > 0),
  seed_spacing_cm numeric(10,4) check (seed_spacing_cm is null or seed_spacing_cm > 0),
  calculated_plants_per_ha numeric(16,4),
  calculated_total_plants numeric(18,4),
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.operation_lines_recalculate_metrics()
returns trigger
language plpgsql
as $$
declare
  v_row_meters_per_ha numeric;
begin
  if coalesce(new.row_spacing_m, 0) > 0 and coalesce(new.seed_spacing_cm, 0) > 0 then
    v_row_meters_per_ha := 10000 / new.row_spacing_m;
    new.calculated_plants_per_ha := v_row_meters_per_ha / (new.seed_spacing_cm / 100);
    if new.actual_area_ha is not null then
      new.calculated_total_plants := new.calculated_plants_per_ha * new.actual_area_ha;
    else
      new.calculated_total_plants := null;
    end if;
  else
    new.calculated_plants_per_ha := null;
    new.calculated_total_plants := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_operation_lines_recalculate_metrics on public.operation_lines;
create trigger trg_operation_lines_recalculate_metrics
before insert or update on public.operation_lines
for each row execute function public.operation_lines_recalculate_metrics();

create index if not exists idx_operation_lines_company_operation
  on public.operation_lines(company_id, operation_id);

create index if not exists idx_operation_lines_company_field
  on public.operation_lines(company_id, field_id);

create index if not exists idx_operation_lines_company_crop
  on public.operation_lines(company_id, crop_id);

create index if not exists idx_operation_lines_completed_at
  on public.operation_lines(completed_at desc);

alter table public.operation_lines enable row level security;

drop policy if exists "Users can view company operation lines" on public.operation_lines;
drop policy if exists "Users can insert company operation lines" on public.operation_lines;
drop policy if exists "Users can update company operation lines" on public.operation_lines;
drop policy if exists "Users can delete company operation lines" on public.operation_lines;

create policy "Users can view company operation lines"
  on public.operation_lines for select
  to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company operation lines"
  on public.operation_lines for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company operation lines"
  on public.operation_lines for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company operation lines"
  on public.operation_lines for delete
  to authenticated
  using (company_id = public.get_user_company_id());

alter table public.field_material_consumptions
  add column if not exists operation_line_id uuid references public.operation_lines(id) on delete set null;

alter table public.stock_ledger_entries
  add column if not exists operation_line_id uuid references public.operation_lines(id) on delete set null;

create index if not exists idx_field_material_consumptions_operation_line
  on public.field_material_consumptions(operation_line_id);

create index if not exists idx_stock_ledger_entries_operation_line
  on public.stock_ledger_entries(operation_line_id);

commit;

notify pgrst, 'reload schema';
