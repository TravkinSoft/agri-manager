create extension if not exists pgcrypto;

create table if not exists public.crop_care_schemes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  crop_id uuid not null references public.crops(id) on delete restrict,
  variety_id uuid null references public.varieties(id) on delete set null,
  name text not null,
  scheme_type text not null default 'combined'
    check (scheme_type in ('protection', 'nutrition', 'fertigation', 'combined', 'other')),
  description text null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  revision_no integer not null default 1,
  total_area_ha numeric not null default 0,
  field_count integer not null default 0,
  included_field_count integer not null default 0,
  progress_percent numeric not null default 0,
  created_by_user_id uuid null,
  updated_by_user_id uuid null,
  activated_at timestamptz null,
  paused_at timestamptz null,
  completed_at timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crop_care_scheme_fields (
  id uuid primary key default gen_random_uuid(),
  crop_care_scheme_id uuid not null references public.crop_care_schemes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  crop_structure_id uuid not null references public.crop_structure(id) on delete cascade,
  crop_id uuid null references public.crops(id) on delete set null,
  variety_id uuid null references public.varieties(id) on delete set null,
  reproduction_id uuid null references public.seed_reproductions(id) on delete set null,
  planned_area_ha numeric not null default 0,
  field_name_snapshot text null,
  crop_label_snapshot text null,
  variety_label_snapshot text null,
  reproduction_label_snapshot text null,
  irrigation_type text null,
  included boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crop_care_scheme_id, crop_structure_id)
);

create table if not exists public.crop_care_scheme_steps (
  id uuid primary key default gen_random_uuid(),
  crop_care_scheme_id uuid not null references public.crop_care_schemes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  step_no integer not null,
  title text not null,
  phenological_phase text null,
  planned_date date null,
  window_start_date date null,
  window_end_date date null,
  operation_type text not null default 'spraying',
  responsible_user_id uuid null references public.profiles(id) on delete set null,
  lead_time_days integer not null default 0,
  status text not null default 'planned'
    check (status in ('planned', 'pending', 'generated', 'in_progress', 'completed', 'skipped', 'cancelled')),
  notes text null,
  created_by_user_id uuid null,
  updated_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crop_care_scheme_id, step_no)
);

create table if not exists public.crop_care_scheme_step_materials (
  id uuid primary key default gen_random_uuid(),
  crop_care_scheme_id uuid not null references public.crop_care_schemes(id) on delete cascade,
  step_id uuid not null references public.crop_care_scheme_steps(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text null,
  product_type text null,
  rate numeric not null,
  rate_unit text not null,
  rate_basis text not null default 'per_ha'
    check (rate_basis in ('per_ha', 'per_t_solution', 'per_1000_l_solution', 'per_l_water')),
  water_rate_l_ha numeric null,
  total_solution_l_ha numeric null,
  planned_quantity numeric null,
  planned_unit text null,
  target_type text not null default 'general'
    check (target_type in ('disease', 'pest', 'weed', 'nutrition', 'stress', 'general')),
  target_id uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rate >= 0),
  check (not (rate_basis = 'per_l_water' and lower(rate_unit) in ('pcs', 'pc', 'piece', 'pieces', 'шт')))
);

create table if not exists public.crop_care_scheme_operations (
  id uuid primary key default gen_random_uuid(),
  crop_care_scheme_id uuid not null references public.crop_care_schemes(id) on delete cascade,
  step_id uuid not null references public.crop_care_scheme_steps(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid not null references public.operations(id) on delete cascade,
  idempotency_key text null,
  sync_mode text not null default 'generated',
  status text not null default 'active'
    check (status in ('active', 'superseded', 'cancelled')),
  generated_by_user_id uuid null,
  generated_at timestamptz not null default now(),
  notes text null,
  unique (step_id, operation_id)
);

create unique index if not exists idx_crop_care_scheme_operations_one_active
  on public.crop_care_scheme_operations(step_id)
  where status = 'active';

create table if not exists public.crop_care_scheme_revisions (
  id uuid primary key default gen_random_uuid(),
  crop_care_scheme_id uuid not null references public.crop_care_schemes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  revision_no integer not null,
  change_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crop_care_schemes_company_season
  on public.crop_care_schemes(company_id, season_id, status);
create index if not exists idx_crop_care_schemes_crop
  on public.crop_care_schemes(company_id, crop_id, variety_id);
create index if not exists idx_crop_care_scheme_fields_scheme
  on public.crop_care_scheme_fields(crop_care_scheme_id, included);
create index if not exists idx_crop_care_scheme_steps_scheme
  on public.crop_care_scheme_steps(crop_care_scheme_id, step_no);
create index if not exists idx_crop_care_scheme_step_materials_step
  on public.crop_care_scheme_step_materials(step_id);

create or replace function public.crop_care_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_crop_care_schemes_updated_at on public.crop_care_schemes;
create trigger trg_crop_care_schemes_updated_at
before update on public.crop_care_schemes
for each row execute function public.crop_care_touch_updated_at();

drop trigger if exists trg_crop_care_scheme_fields_updated_at on public.crop_care_scheme_fields;
create trigger trg_crop_care_scheme_fields_updated_at
before update on public.crop_care_scheme_fields
for each row execute function public.crop_care_touch_updated_at();

drop trigger if exists trg_crop_care_scheme_steps_updated_at on public.crop_care_scheme_steps;
create trigger trg_crop_care_scheme_steps_updated_at
before update on public.crop_care_scheme_steps
for each row execute function public.crop_care_touch_updated_at();

drop trigger if exists trg_crop_care_scheme_step_materials_updated_at on public.crop_care_scheme_step_materials;
create trigger trg_crop_care_scheme_step_materials_updated_at
before update on public.crop_care_scheme_step_materials
for each row execute function public.crop_care_touch_updated_at();

alter table public.crop_care_schemes enable row level security;
alter table public.crop_care_scheme_fields enable row level security;
alter table public.crop_care_scheme_steps enable row level security;
alter table public.crop_care_scheme_step_materials enable row level security;
alter table public.crop_care_scheme_operations enable row level security;
alter table public.crop_care_scheme_revisions enable row level security;

drop policy if exists "Company users can view crop care schemes" on public.crop_care_schemes;
create policy "Company users can view crop care schemes"
  on public.crop_care_schemes for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_schemes.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can manage crop care schemes" on public.crop_care_schemes;
create policy "Company planners can manage crop care schemes"
  on public.crop_care_schemes for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_schemes.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_schemes.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );

drop policy if exists "Company users can view crop care scheme fields" on public.crop_care_scheme_fields;
create policy "Company users can view crop care scheme fields"
  on public.crop_care_scheme_fields for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_fields.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can manage crop care scheme fields" on public.crop_care_scheme_fields;
create policy "Company planners can manage crop care scheme fields"
  on public.crop_care_scheme_fields for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_fields.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_fields.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );

drop policy if exists "Company users can view crop care scheme steps" on public.crop_care_scheme_steps;
create policy "Company users can view crop care scheme steps"
  on public.crop_care_scheme_steps for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_steps.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can manage crop care scheme steps" on public.crop_care_scheme_steps;
create policy "Company planners can manage crop care scheme steps"
  on public.crop_care_scheme_steps for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_steps.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_steps.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );

drop policy if exists "Company users can view crop care scheme materials" on public.crop_care_scheme_step_materials;
create policy "Company users can view crop care scheme materials"
  on public.crop_care_scheme_step_materials for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_step_materials.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can manage crop care scheme materials" on public.crop_care_scheme_step_materials;
create policy "Company planners can manage crop care scheme materials"
  on public.crop_care_scheme_step_materials for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_step_materials.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_step_materials.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );

drop policy if exists "Company users can view crop care generated operations" on public.crop_care_scheme_operations;
create policy "Company users can view crop care generated operations"
  on public.crop_care_scheme_operations for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_operations.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can manage crop care generated operations" on public.crop_care_scheme_operations;
create policy "Company planners can manage crop care generated operations"
  on public.crop_care_scheme_operations for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_operations.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_operations.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );

drop policy if exists "Company users can view crop care revisions" on public.crop_care_scheme_revisions;
create policy "Company users can view crop care revisions"
  on public.crop_care_scheme_revisions for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_revisions.company_id or p.role = 'global_admin')
    )
  );

drop policy if exists "Company planners can insert crop care revisions" on public.crop_care_scheme_revisions;
create policy "Company planners can insert crop care revisions"
  on public.crop_care_scheme_revisions for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.company_id = crop_care_scheme_revisions.company_id or p.role = 'global_admin')
        and p.role in ('global_admin', 'company_admin', 'agronomist', 'director')
    )
  );
