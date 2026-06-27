begin;

create table if not exists public.field_engineering_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  field_id uuid references public.fields(id) on delete set null,
  crop_structure_id uuid references public.crop_structure(id) on delete set null,
  object_type text not null check (
    object_type in (
      'pond',
      'pump_station',
      'main_pipe',
      'layflat_hose',
      'hydrant',
      'drip_tape',
      'irrigation_zone',
      'mixing_tank',
      'fertigation_point',
      'well',
      'connection_point',
      'technical_boundary',
      'flag',
      'other'
    )
  ),
  name text not null,
  description text,
  geometry jsonb not null,
  geometry_type text not null check (geometry_type in ('Point', 'LineString', 'Polygon')),
  properties jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_field_engineering_objects_company_season
  on public.field_engineering_objects(company_id, season_id)
  where deleted_at is null;

create index if not exists idx_field_engineering_objects_company_field
  on public.field_engineering_objects(company_id, field_id)
  where deleted_at is null;

create index if not exists idx_field_engineering_objects_company_type
  on public.field_engineering_objects(company_id, object_type)
  where deleted_at is null;

drop trigger if exists trg_field_engineering_objects_updated_at on public.field_engineering_objects;
create trigger trg_field_engineering_objects_updated_at
before update on public.field_engineering_objects
for each row execute function public.set_updated_at_timestamp();

alter table public.field_engineering_objects enable row level security;

drop policy if exists "Users can view company field engineering objects" on public.field_engineering_objects;
create policy "Users can view company field engineering objects"
  on public.field_engineering_objects for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company field engineering objects" on public.field_engineering_objects;
create policy "Users can insert company field engineering objects"
  on public.field_engineering_objects for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company field engineering objects" on public.field_engineering_objects;
create policy "Users can update company field engineering objects"
  on public.field_engineering_objects for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

commit;

notify pgrst, 'reload schema';
