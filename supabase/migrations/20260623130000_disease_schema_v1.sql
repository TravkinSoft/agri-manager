-- Disease Schema V1
-- Adds a global crop disease catalog foundation without importing diseases.

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.diseases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  name_ru text not null,
  name_en text,
  latin_name text,
  normalized_name text not null,
  disease_type text not null default 'unknown',
  pathogen_type text not null default 'unknown'
    check (pathogen_type in (
      'fungus',
      'bacteria',
      'virus',
      'oomycete',
      'physiological',
      'unknown'
    )),
  symptoms text,
  development_conditions text,
  risk_stage text,
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

drop trigger if exists update_diseases_updated_at on public.diseases;
create trigger update_diseases_updated_at
before update on public.diseases
for each row execute function public.update_updated_at_column();

create unique index if not exists diseases_global_normalized_name_uidx
  on public.diseases (normalized_name)
  where company_id is null and archived = false;

create index if not exists diseases_company_idx
  on public.diseases (company_id)
  where archived = false;

create index if not exists diseases_pathogen_type_idx
  on public.diseases (pathogen_type)
  where archived = false;

create table if not exists public.crop_diseases (
  id uuid primary key default gen_random_uuid(),
  crop_id uuid not null references public.crops(id) on delete cascade,
  disease_id uuid not null references public.diseases(id) on delete cascade,
  severity_notes text,
  common_in_region boolean not null default false,
  risk_stage text,
  symptoms_on_crop text,
  source_url text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_crop_diseases_updated_at on public.crop_diseases;
create trigger update_crop_diseases_updated_at
before update on public.crop_diseases
for each row execute function public.update_updated_at_column();

create unique index if not exists crop_diseases_crop_disease_uidx
  on public.crop_diseases (crop_id, disease_id);

create index if not exists crop_diseases_crop_idx
  on public.crop_diseases (crop_id);

create index if not exists crop_diseases_disease_idx
  on public.crop_diseases (disease_id);

create table if not exists public.disease_aliases (
  id uuid primary key default gen_random_uuid(),
  disease_id uuid not null references public.diseases(id) on delete cascade,
  alias text not null,
  language text,
  normalized_alias text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists disease_aliases_unique_idx
  on public.disease_aliases (disease_id, normalized_alias);

create index if not exists disease_aliases_lookup_idx
  on public.disease_aliases (normalized_alias);

create table if not exists public.disease_images (
  id uuid primary key default gen_random_uuid(),
  disease_id uuid not null references public.diseases(id) on delete cascade,
  crop_id uuid null references public.crops(id) on delete set null,
  image_url text not null,
  image_type text,
  plant_part text,
  symptom_stage text,
  source_url text,
  license text,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists disease_images_disease_idx
  on public.disease_images (disease_id);

create index if not exists disease_images_crop_idx
  on public.disease_images (crop_id);

comment on table public.diseases is
  'Global/local catalog of crop diseases. Pests, weeds and treatment links are intentionally out of scope for Disease Schema V1.';

comment on table public.crop_diseases is
  'Crop-specific disease context. Future treatment recommendations should link through crop_diseases, not directly through diseases.';

comment on table public.disease_images is
  'Image references for future AI Vision disease identification. Images are not imported by this migration.';
