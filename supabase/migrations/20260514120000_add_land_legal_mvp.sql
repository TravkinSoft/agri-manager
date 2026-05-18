-- Land Legal MVP: cadastral/legal contour over agronomic fields.
-- Scope: additive schema only, no ledger/stock logic touched.

begin;

create table if not exists public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  short_name text null,
  entity_type text not null default 'company'
    check (entity_type in ('company', 'individual', 'ip', 'government', 'other')),
  bin_iin text null,
  legal_address text null,
  contact_person text null,
  phone text null,
  email text null,
  notes text null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_legal_entities_company_name_active
  on public.legal_entities(company_id, lower(trim(name)))
  where archived = false;

create index if not exists idx_legal_entities_company_type
  on public.legal_entities(company_id, entity_type, is_active)
  where archived = false;

drop trigger if exists trg_legal_entities_updated_at on public.legal_entities;
create trigger trg_legal_entities_updated_at
before update on public.legal_entities
for each row execute function public.update_updated_at_column();

create table if not exists public.cadastral_parcels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cadastral_number text not null check (length(trim(cadastral_number)) > 0),
  region text null,
  district text null,
  rural_district text null,
  locality text null,
  declared_area_ha numeric(14,3) not null check (declared_area_ha > 0),
  land_category text null,
  land_use_purpose text null,
  ownership_status text null,
  owner_legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  current_user_legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  notes text null,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_cadastral_parcels_company_number_active
  on public.cadastral_parcels(company_id, lower(trim(cadastral_number)))
  where archived = false;

create index if not exists idx_cadastral_parcels_company_location
  on public.cadastral_parcels(company_id, region, district, rural_district)
  where archived = false;

create index if not exists idx_cadastral_parcels_owner
  on public.cadastral_parcels(company_id, owner_legal_entity_id, current_user_legal_entity_id)
  where archived = false;

drop trigger if exists trg_cadastral_parcels_updated_at on public.cadastral_parcels;
create trigger trg_cadastral_parcels_updated_at
before update on public.cadastral_parcels
for each row execute function public.update_updated_at_column();

create table if not exists public.land_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cadastral_parcel_id uuid not null references public.cadastral_parcels(id) on delete cascade,
  legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  right_type text not null default 'lease'
    check (right_type in ('ownership', 'lease', 'sublease', 'use', 'service', 'other')),
  document_type text not null default 'contract'
    check (document_type in ('contract', 'certificate', 'act', 'agreement', 'other')),
  document_number text null,
  document_date date null,
  valid_from date null,
  valid_to date null,
  status text not null default 'draft'
    check (status in ('active', 'expired', 'draft', 'terminated')),
  file_url text null,
  notes text null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint land_documents_valid_dates_check
    check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index if not exists idx_land_documents_company_cadastre
  on public.land_documents(company_id, cadastral_parcel_id, status)
  where archived = false;

create index if not exists idx_land_documents_valid_to
  on public.land_documents(company_id, valid_to)
  where archived = false;

drop trigger if exists trg_land_documents_updated_at on public.land_documents;
create trigger trg_land_documents_updated_at
before update on public.land_documents
for each row execute function public.update_updated_at_column();

create table if not exists public.field_cadastre_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid null references public.seasons(id) on delete set null,
  field_id uuid not null references public.fields(id) on delete cascade,
  cadastral_parcel_id uuid not null references public.cadastral_parcels(id) on delete cascade,
  crop_plan_allocation_id uuid null references public.crop_structure(id) on delete set null,
  crop_id uuid null references public.crops(id) on delete set null,
  variety_id uuid null references public.varieties(id) on delete set null,
  reproduction_id uuid null references public.seed_reproductions(id) on delete set null,
  area_ha numeric(14,3) not null check (area_ha > 0),
  legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  owner_legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  usage_legal_entity_id uuid null references public.legal_entities(id) on delete set null,
  allocation_method text not null default 'manual_adjusted'
    check (allocation_method in ('direct', 'proportional_by_area', 'imported', 'manual_adjusted')),
  source text not null default 'manual'
    check (source in ('manual', 'import_docx', 'import_excel', 'import_csv', 'system_generated')),
  confidence numeric(5,2) null check (confidence is null or (confidence >= 0 and confidence <= 100)),
  status text not null default 'active'
    check (status in ('active', 'draft', 'archived')),
  valid_from date null,
  valid_to date null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_cadastre_links_valid_dates_check
    check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index if not exists ux_field_cadastre_links_identity
  on public.field_cadastre_links(
    company_id,
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field_id,
    cadastral_parcel_id,
    coalesce(crop_plan_allocation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(crop_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(variety_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(reproduction_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status <> 'archived';

create index if not exists idx_field_cadastre_links_scope
  on public.field_cadastre_links(company_id, season_id, field_id, cadastral_parcel_id, status);

create index if not exists idx_field_cadastre_links_crop
  on public.field_cadastre_links(company_id, crop_id, variety_id, reproduction_id, status);

drop trigger if exists trg_field_cadastre_links_updated_at on public.field_cadastre_links;
create trigger trg_field_cadastre_links_updated_at
before update on public.field_cadastre_links
for each row execute function public.update_updated_at_column();

-- Optional hardening for season uniqueness in company scope.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'seasons_user_id_year_key'
      and conrelid = 'public.seasons'::regclass
  ) then
    alter table public.seasons drop constraint seasons_user_id_year_key;
  end if;
exception
  when undefined_table then null;
end $$;

create unique index if not exists ux_seasons_company_year
  on public.seasons(company_id, year);

alter table public.legal_entities enable row level security;
alter table public.cadastral_parcels enable row level security;
alter table public.land_documents enable row level security;
alter table public.field_cadastre_links enable row level security;

drop policy if exists "Users can view company legal entities" on public.legal_entities;
drop policy if exists "Users can insert company legal entities" on public.legal_entities;
drop policy if exists "Users can update company legal entities" on public.legal_entities;
drop policy if exists "Users can delete company legal entities" on public.legal_entities;

create policy "Users can view company legal entities"
  on public.legal_entities
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company legal entities"
  on public.legal_entities
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company legal entities"
  on public.legal_entities
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company legal entities"
  on public.legal_entities
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company cadastral parcels" on public.cadastral_parcels;
drop policy if exists "Users can insert company cadastral parcels" on public.cadastral_parcels;
drop policy if exists "Users can update company cadastral parcels" on public.cadastral_parcels;
drop policy if exists "Users can delete company cadastral parcels" on public.cadastral_parcels;

create policy "Users can view company cadastral parcels"
  on public.cadastral_parcels
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company cadastral parcels"
  on public.cadastral_parcels
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company cadastral parcels"
  on public.cadastral_parcels
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company cadastral parcels"
  on public.cadastral_parcels
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company land documents" on public.land_documents;
drop policy if exists "Users can insert company land documents" on public.land_documents;
drop policy if exists "Users can update company land documents" on public.land_documents;
drop policy if exists "Users can delete company land documents" on public.land_documents;

create policy "Users can view company land documents"
  on public.land_documents
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company land documents"
  on public.land_documents
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company land documents"
  on public.land_documents
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company land documents"
  on public.land_documents
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company field cadastre links" on public.field_cadastre_links;
drop policy if exists "Users can insert company field cadastre links" on public.field_cadastre_links;
drop policy if exists "Users can update company field cadastre links" on public.field_cadastre_links;
drop policy if exists "Users can delete company field cadastre links" on public.field_cadastre_links;

create policy "Users can view company field cadastre links"
  on public.field_cadastre_links
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company field cadastre links"
  on public.field_cadastre_links
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company field cadastre links"
  on public.field_cadastre_links
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company field cadastre links"
  on public.field_cadastre_links
  for delete to authenticated
  using (company_id = public.get_user_company_id());

create or replace view public.v_land_area_mismatches as
with grouped as (
  select
    l.company_id,
    l.season_id,
    l.field_id,
    sum(l.area_ha) as legal_area_ha,
    count(*) as link_count
  from public.field_cadastre_links l
  where l.status <> 'archived'
  group by l.company_id, l.season_id, l.field_id
)
select
  f.company_id,
  g.season_id,
  s.year as season_year,
  f.id as field_id,
  f.name as field_name,
  f.area::numeric(14,3) as agro_area_ha,
  coalesce(g.legal_area_ha, 0::numeric) as legal_area_ha,
  (coalesce(g.legal_area_ha, 0::numeric) - f.area::numeric(14,3)) as diff_area_ha,
  coalesce(g.link_count, 0)::int as link_count,
  case
    when g.field_id is null then 'missing_cadastre'
    when abs(coalesce(g.legal_area_ha, 0::numeric) - f.area::numeric(14,3)) <= 0.01 then 'ok'
    when abs(coalesce(g.legal_area_ha, 0::numeric) - f.area::numeric(14,3)) <= 1.0 then 'warning'
    else 'mismatch'
  end as mismatch_status
from public.fields f
left join grouped g
  on g.company_id = f.company_id
 and g.field_id = f.id
left join public.seasons s on s.id = g.season_id
where coalesce(f.archived, false) = false;

create or replace view public.v_land_sowing_by_cadastre as
select
  l.company_id,
  l.season_id,
  s.year as season_year,
  l.field_id,
  f.name as field_name,
  l.cadastral_parcel_id,
  cp.cadastral_number,
  cp.region,
  cp.district,
  cp.rural_district,
  cp.locality,
  l.area_ha,
  l.crop_plan_allocation_id,
  l.crop_id,
  coalesce(c.name_ru, c.name) as crop_name,
  l.variety_id,
  v.name as variety_name,
  l.reproduction_id,
  r.name as reproduction_name,
  l.legal_entity_id,
  le.name as legal_entity_name,
  l.owner_legal_entity_id,
  ole.name as owner_legal_entity_name,
  l.usage_legal_entity_id,
  ule.name as usage_legal_entity_name,
  l.allocation_method,
  l.source,
  l.status,
  l.valid_from,
  l.valid_to,
  l.notes
from public.field_cadastre_links l
join public.fields f on f.id = l.field_id
join public.cadastral_parcels cp on cp.id = l.cadastral_parcel_id
left join public.seasons s on s.id = l.season_id
left join public.crops c on c.id = l.crop_id
left join public.varieties v on v.id = l.variety_id
left join public.seed_reproductions r on r.id = l.reproduction_id
left join public.legal_entities le on le.id = l.legal_entity_id
left join public.legal_entities ole on ole.id = l.owner_legal_entity_id
left join public.legal_entities ule on ule.id = l.usage_legal_entity_id
where l.status <> 'archived'
  and coalesce(f.archived, false) = false
  and coalesce(cp.archived, false) = false;

commit;
