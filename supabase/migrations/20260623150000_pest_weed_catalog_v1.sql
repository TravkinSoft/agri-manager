-- Pest and Weed Catalog V1
-- Adds global/local catalogs for crop pests and weeds without importing data.

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.pests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  name_ru text not null,
  name_en text,
  latin_name text,
  normalized_name text not null,
  pest_type text not null default 'unknown'
    check (pest_type in (
      'insect',
      'mite',
      'nematode',
      'mollusk',
      'mammal',
      'bird',
      'other',
      'unknown'
    )),
  life_cycle text,
  damage_symptoms text,
  development_conditions text,
  risk_stage text,
  source_url text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  notes text,
  image_url text,
  is_sensitive boolean not null default false,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_pests_updated_at on public.pests;
create trigger update_pests_updated_at
before update on public.pests
for each row execute function public.update_updated_at_column();

create unique index if not exists pests_global_normalized_name_uidx
  on public.pests (normalized_name)
  where company_id is null and archived = false;

create index if not exists pests_company_idx
  on public.pests (company_id)
  where archived = false;

create index if not exists pests_type_idx
  on public.pests (pest_type)
  where archived = false;

create index if not exists pests_sensitive_idx
  on public.pests (is_sensitive)
  where archived = false;

create table if not exists public.crop_pests (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops(id) on delete cascade,
  pest_id uuid not null references public.pests(id) on delete cascade,
  damage_on_crop text,
  risk_stage text,
  common_in_region boolean not null default false,
  source_url text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_crop_pests_updated_at on public.crop_pests;
create trigger update_crop_pests_updated_at
before update on public.crop_pests
for each row execute function public.update_updated_at_column();

create unique index if not exists crop_pests_crop_pest_uidx
  on public.crop_pests (crop_id, pest_id);

create index if not exists crop_pests_crop_idx
  on public.crop_pests (crop_id);

create index if not exists crop_pests_pest_idx
  on public.crop_pests (pest_id);

create table if not exists public.pest_aliases (
  id uuid primary key default gen_random_uuid(),
  pest_id uuid not null references public.pests(id) on delete cascade,
  alias text not null,
  language text,
  normalized_alias text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists pest_aliases_unique_idx
  on public.pest_aliases (pest_id, normalized_alias);

create index if not exists pest_aliases_lookup_idx
  on public.pest_aliases (normalized_alias);

create table if not exists public.pest_images (
  id uuid primary key default gen_random_uuid(),
  pest_id uuid not null references public.pests(id) on delete cascade,
  crop_id uuid null references public.crops(id) on delete set null,
  image_url text not null,
  image_type text,
  plant_part text,
  pest_stage text,
  source_url text,
  license text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists pest_images_pest_idx
  on public.pest_images (pest_id);

create index if not exists pest_images_crop_idx
  on public.pest_images (crop_id);

create table if not exists public.weeds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  name_ru text not null,
  name_en text,
  latin_name text,
  normalized_name text not null,
  weed_type text not null default 'unknown'
    check (weed_type in (
      'annual',
      'perennial',
      'grass',
      'broadleaf',
      'sedge',
      'parasitic',
      'other',
      'unknown'
    )),
  life_cycle text,
  morphology text,
  harmfulness text,
  development_conditions text,
  source_url text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  notes text,
  image_url text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_weeds_updated_at on public.weeds;
create trigger update_weeds_updated_at
before update on public.weeds
for each row execute function public.update_updated_at_column();

create unique index if not exists weeds_global_normalized_name_uidx
  on public.weeds (normalized_name)
  where company_id is null and archived = false;

create index if not exists weeds_company_idx
  on public.weeds (company_id)
  where archived = false;

create index if not exists weeds_type_idx
  on public.weeds (weed_type)
  where archived = false;

create table if not exists public.crop_weeds (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops(id) on delete cascade,
  weed_id uuid not null references public.weeds(id) on delete cascade,
  harm_on_crop text,
  risk_stage text,
  common_in_region boolean not null default false,
  source_url text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_crop_weeds_updated_at on public.crop_weeds;
create trigger update_crop_weeds_updated_at
before update on public.crop_weeds
for each row execute function public.update_updated_at_column();

create unique index if not exists crop_weeds_crop_weed_uidx
  on public.crop_weeds (crop_id, weed_id);

create index if not exists crop_weeds_crop_idx
  on public.crop_weeds (crop_id);

create index if not exists crop_weeds_weed_idx
  on public.crop_weeds (weed_id);

create table if not exists public.weed_aliases (
  id uuid primary key default gen_random_uuid(),
  weed_id uuid not null references public.weeds(id) on delete cascade,
  alias text not null,
  language text,
  normalized_alias text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists weed_aliases_unique_idx
  on public.weed_aliases (weed_id, normalized_alias);

create index if not exists weed_aliases_lookup_idx
  on public.weed_aliases (normalized_alias);

create table if not exists public.weed_images (
  id uuid primary key default gen_random_uuid(),
  weed_id uuid not null references public.weeds(id) on delete cascade,
  crop_id uuid null references public.crops(id) on delete set null,
  image_url text not null,
  image_type text,
  plant_part text,
  growth_stage text,
  source_url text,
  license text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists weed_images_weed_idx
  on public.weed_images (weed_id);

create index if not exists weed_images_crop_idx
  on public.weed_images (crop_id);

comment on table public.pests is
  'Global/local catalog of crop pests. Mammals and birds can be marked sensitive and filtered at company level.';

comment on table public.crop_pests is
  'Crop-specific pest context. Future treatment recommendations should link through crop_pests.';

comment on table public.weeds is
  'Global/local catalog of weeds. Herbicide treatment links are intentionally out of scope for Weed Catalog V1.';

comment on table public.crop_weeds is
  'Crop-specific weed context. Future herbicide recommendations should link through crop_weeds.';
