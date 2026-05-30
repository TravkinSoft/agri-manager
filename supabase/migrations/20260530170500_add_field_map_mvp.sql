begin;

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.field_map_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_file_name text not null,
  source_kml_text text,
  status text not null default 'draft' check (status in ('draft', 'imported', 'archived', 'failed')),
  total_polygons integer not null default 0,
  matched_polygons integer not null default 0,
  unmatched_polygons integer not null default 0,
  error_count integer not null default 0,
  preview_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  imported_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_field_map_imports_company_created_at
  on public.field_map_imports(company_id, created_at desc);

create index if not exists idx_field_map_imports_company_active
  on public.field_map_imports(company_id, is_active);

drop trigger if exists trg_field_map_imports_updated_at on public.field_map_imports;
create trigger trg_field_map_imports_updated_at
before update on public.field_map_imports
for each row execute function public.set_updated_at_timestamp();

create table if not exists public.field_geometries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  import_id uuid references public.field_map_imports(id) on delete set null,
  source_file_name text,
  geometry_geojson jsonb not null,
  area_from_kml_ha numeric(14, 4),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_field_geometries_company_field
  on public.field_geometries(company_id, field_id);

create index if not exists idx_field_geometries_company_import
  on public.field_geometries(company_id, import_id);

create index if not exists idx_field_geometries_company_active
  on public.field_geometries(company_id, is_active);

create unique index if not exists idx_field_geometries_active_per_field
  on public.field_geometries(company_id, field_id)
  where is_active = true;

drop trigger if exists trg_field_geometries_updated_at on public.field_geometries;
create trigger trg_field_geometries_updated_at
before update on public.field_geometries
for each row execute function public.set_updated_at_timestamp();

alter table public.field_map_imports enable row level security;
alter table public.field_geometries enable row level security;

drop policy if exists "Users can view company field map imports" on public.field_map_imports;
create policy "Users can view company field map imports"
  on public.field_map_imports for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company field map imports" on public.field_map_imports;
create policy "Users can insert company field map imports"
  on public.field_map_imports for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company field map imports" on public.field_map_imports;
create policy "Users can update company field map imports"
  on public.field_map_imports for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company field map imports" on public.field_map_imports;
create policy "Users can delete company field map imports"
  on public.field_map_imports for delete
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company field geometries" on public.field_geometries;
create policy "Users can view company field geometries"
  on public.field_geometries for select
  to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can insert company field geometries" on public.field_geometries;
create policy "Users can insert company field geometries"
  on public.field_geometries for insert
  to authenticated
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can update company field geometries" on public.field_geometries;
create policy "Users can update company field geometries"
  on public.field_geometries for update
  to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

drop policy if exists "Users can delete company field geometries" on public.field_geometries;
create policy "Users can delete company field geometries"
  on public.field_geometries for delete
  to authenticated
  using (company_id = public.get_user_company_id());

commit;

notify pgrst, 'reload schema';
