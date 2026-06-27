-- Seed Schema V1
-- Adds the global seed catalog foundation without importing varieties or seed products.

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.seed_originators (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  name text not null,
  normalized_name text,
  country text,
  website text,
  notes text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_seed_originators_updated_at on public.seed_originators;
create trigger update_seed_originators_updated_at
before update on public.seed_originators
for each row execute function public.update_updated_at_column();

create unique index if not exists seed_originators_global_normalized_name_uidx
  on public.seed_originators (normalized_name)
  where company_id is null and archived = false and normalized_name is not null;

create index if not exists seed_originators_company_idx
  on public.seed_originators (company_id)
  where archived = false;

alter table public.varieties
  add column if not exists originator_id uuid references public.seed_originators(id) on delete set null,
  add column if not exists purpose text,
  add column if not exists skin_color text,
  add column if not exists flesh_color text,
  add column if not exists disease_resistance jsonb,
  add column if not exists storage_quality text,
  add column if not exists source_url text;

create index if not exists varieties_originator_id_idx
  on public.varieties (originator_id)
  where archived = false;

create index if not exists varieties_crop_originator_idx
  on public.varieties (crop_id, originator_id)
  where archived = false;

alter table public.products
  add column if not exists variety_id uuid references public.varieties(id) on delete set null,
  add column if not exists seed_reproduction_id uuid references public.seed_reproductions(id) on delete set null;

create index if not exists products_seed_identity_idx
  on public.products (company_id, crop_id, variety_id, seed_reproduction_id)
  where archived = false
    and (
      type = 'seed'
      or category = 'seed'
      or is_seed_material = true
    );

alter table public.inventory_batches
  add column if not exists supplier_id uuid references public.counterparties(id) on delete set null,
  add column if not exists lot_number text,
  add column if not exists certificate_number text,
  add column if not exists seed_class text,
  add column if not exists calibration text,
  add column if not exists tuber_size_fraction text;

create index if not exists inventory_batches_supplier_id_idx
  on public.inventory_batches (supplier_id);

create index if not exists inventory_batches_seed_identity_idx
  on public.inventory_batches (
    company_id,
    crop_id,
    variety_id,
    reproduction_id,
    supplier_id
  )
  where batch_class = 'seed';

create index if not exists inventory_batches_lot_number_idx
  on public.inventory_batches (company_id, lot_number)
  where lot_number is not null;

comment on table public.seed_originators is
  'Global/local originators of seed varieties. Originators are not seed suppliers.';

comment on column public.varieties.originator_id is
  'Canonical originator/breeder of the variety. Legacy breeder_or_originator text remains as fallback.';

comment on column public.varieties.disease_resistance is
  'Structured variety resistance notes by disease/source when available.';

comment on column public.products.variety_id is
  'Optional variety link for seed products. Actual stock lot identity remains in inventory_batches.';

comment on column public.products.seed_reproduction_id is
  'Optional default/catalog seed reproduction for seed products.';

comment on column public.inventory_batches.supplier_id is
  'Local counterparty that supplied the actual seed lot.';

comment on column public.inventory_batches.lot_number is
  'External seed lot number from supplier or certificate. Internal batch code remains batch_code.';

comment on column public.inventory_batches.tuber_size_fraction is
  'Potato seed tuber fraction, for example 35-55, 45-60, 55+.';
