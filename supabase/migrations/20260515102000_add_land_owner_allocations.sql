create table if not exists public.land_owner_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  owner_legal_entity_id uuid not null references public.legal_entities(id) on delete restrict,
  field_id uuid not null references public.fields(id) on delete restrict,
  cadastral_parcel_id uuid null references public.cadastral_parcels(id) on delete set null,
  crop_id uuid null references public.crops(id) on delete set null,
  area_ha numeric(14,3) not null check (area_ha > 0),
  source text not null default 'owner_sheet_import',
  source_document text null,
  raw_owner_name text null,
  raw_field_key text null,
  raw_cadastral_number text null,
  raw_crop_name text null,
  allocation_status text not null default 'manual_review'
    check (allocation_status in ('complete','partial_missing_cadastre','partial_missing_crop','manual_review')),
  missing_cadastre boolean not null default false,
  missing_crop boolean not null default false,
  notes text null,
  source_row_hash text null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_land_owner_allocations_scope
  on public.land_owner_allocations(company_id, season_id, allocation_status, archived);

create index if not exists idx_land_owner_allocations_owner
  on public.land_owner_allocations(company_id, owner_legal_entity_id, season_id, archived);

create unique index if not exists ux_land_owner_allocations_dedupe
  on public.land_owner_allocations(
    company_id,
    season_id,
    owner_legal_entity_id,
    field_id,
    coalesce(cadastral_parcel_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid),
    area_ha,
    coalesce(source_row_hash, '')
  )
  where archived = false;

drop trigger if exists trg_land_owner_allocations_updated_at on public.land_owner_allocations;

alter table public.land_owner_allocations enable row level security;

create or replace function public.get_current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

drop policy if exists "Users can view company land owner allocations" on public.land_owner_allocations;
drop policy if exists "Users can insert company land owner allocations" on public.land_owner_allocations;
drop policy if exists "Users can update company land owner allocations" on public.land_owner_allocations;
drop policy if exists "Users can delete company land owner allocations" on public.land_owner_allocations;

create policy "Users can view company land owner allocations"
  on public.land_owner_allocations
  for select
  using (company_id = public.get_current_company_id());

create policy "Users can insert company land owner allocations"
  on public.land_owner_allocations
  for insert
  with check (company_id = public.get_current_company_id());

create policy "Users can update company land owner allocations"
  on public.land_owner_allocations
  for update
  using (company_id = public.get_current_company_id())
  with check (company_id = public.get_current_company_id());

create policy "Users can delete company land owner allocations"
  on public.land_owner_allocations
  for delete
  using (company_id = public.get_current_company_id());
