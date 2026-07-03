/*
  Company assets canonical model links.

  Draft migration only until explicitly applied.

  Intent:
  - add a canonical global equipment model table;
  - let company machines/equipment/vehicles point to canonical global models;
  - keep the migration additive and nullable so existing UI/data keeps working;
  - do not import, seed, update, delete, merge, or clean up any rows here.
*/

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1) Global equipment / implement model catalog
-- ---------------------------------------------------------------------------

create table if not exists public.equipment_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.profiles(id) on delete set null,
  name text not null,
  brand text,
  manufacturer text,
  series text,
  model text,
  category text not null,
  equipment_type text,
  asset_group text not null default 'implement',
  description text,
  aliases text[] not null default '{}'::text[],
  source text,
  source_url text,
  source_notes text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null default '',
  name_norm text not null default '',
  brand_norm text not null default '',
  series_norm text not null default '',
  model_norm text not null default '',
  category_norm text not null default ''
);

alter table public.equipment_models
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists name text,
  add column if not exists brand text,
  add column if not exists manufacturer text,
  add column if not exists series text,
  add column if not exists model text,
  add column if not exists category text,
  add column if not exists equipment_type text,
  add column if not exists asset_group text not null default 'implement',
  add column if not exists description text,
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists source text,
  add column if not exists source_url text,
  add column if not exists source_notes text,
  add column if not exists is_active boolean not null default true,
  add column if not exists archived boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists full_name text not null default '',
  add column if not exists name_norm text not null default '',
  add column if not exists brand_norm text not null default '',
  add column if not exists series_norm text not null default '',
  add column if not exists model_norm text not null default '',
  add column if not exists category_norm text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.equipment_models'::regclass
      and conname = 'equipment_models_name_not_blank'
  ) then
    alter table public.equipment_models
      add constraint equipment_models_name_not_blank
      check (length(btrim(name)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.equipment_models'::regclass
      and conname = 'equipment_models_category_not_blank'
  ) then
    alter table public.equipment_models
      add constraint equipment_models_category_not_blank
      check (length(btrim(category)) > 0);
  end if;
end $$;

create or replace function public.normalize_equipment_model_row()
returns trigger
language plpgsql
as $$
declare
  v_full_name text;
begin
  new.name := nullif(regexp_replace(btrim(coalesce(new.name, '')), '\s+', ' ', 'g'), '');
  new.brand := nullif(regexp_replace(btrim(coalesce(new.brand, '')), '\s+', ' ', 'g'), '');
  new.manufacturer := nullif(regexp_replace(btrim(coalesce(new.manufacturer, '')), '\s+', ' ', 'g'), '');
  new.series := nullif(regexp_replace(btrim(coalesce(new.series, '')), '\s+', ' ', 'g'), '');
  new.model := nullif(regexp_replace(btrim(coalesce(new.model, '')), '\s+', ' ', 'g'), '');
  new.category := nullif(regexp_replace(btrim(coalesce(new.category, '')), '\s+', ' ', 'g'), '');
  new.equipment_type := nullif(regexp_replace(btrim(coalesce(new.equipment_type, '')), '\s+', ' ', 'g'), '');
  new.asset_group := coalesce(nullif(regexp_replace(btrim(coalesce(new.asset_group, '')), '\s+', ' ', 'g'), ''), 'implement');
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.source := nullif(btrim(coalesce(new.source, '')), '');
  new.source_url := nullif(btrim(coalesce(new.source_url, '')), '');
  new.source_notes := nullif(btrim(coalesce(new.source_notes, '')), '');

  if new.name is null then
    raise exception 'equipment model name is required';
  end if;

  if new.category is null then
    raise exception 'equipment model category is required';
  end if;

  v_full_name := nullif(
    btrim(
      concat_ws(
        ' ',
        nullif(btrim(coalesce(new.brand, '')), ''),
        nullif(btrim(coalesce(new.series, '')), ''),
        nullif(btrim(coalesce(new.model, '')), '')
      )
    ),
    ''
  );

  new.full_name := coalesce(v_full_name, new.name);
  new.name_norm := lower(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.brand_norm := lower(regexp_replace(coalesce(new.brand, ''), '\s+', ' ', 'g'));
  new.series_norm := lower(regexp_replace(coalesce(new.series, ''), '\s+', ' ', 'g'));
  new.model_norm := lower(regexp_replace(coalesce(new.model, ''), '\s+', ' ', 'g'));
  new.category_norm := lower(regexp_replace(new.category, '\s+', ' ', 'g'));
  new.updated_at := now();

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.equipment_models'::regclass
      and tgname = 'trg_normalize_equipment_model_row'
  ) then
    create trigger trg_normalize_equipment_model_row
    before insert or update on public.equipment_models
    for each row execute function public.normalize_equipment_model_row();
  end if;
end $$;

create unique index if not exists ux_equipment_models_identity_active
  on public.equipment_models(
    brand_norm,
    series_norm,
    model_norm,
    category_norm,
    name_norm
  )
  where is_active = true and archived = false;

create index if not exists idx_equipment_models_identity_lookup
  on public.equipment_models(brand_norm, model_norm, category_norm)
  where archived = false;

create index if not exists idx_equipment_models_category_active
  on public.equipment_models(category_norm, is_active)
  where archived = false;

create index if not exists idx_equipment_models_active
  on public.equipment_models(is_active)
  where archived = false;

create index if not exists idx_equipment_models_full_name_trgm
  on public.equipment_models using gin (full_name gin_trgm_ops)
  where archived = false;

alter table public.equipment_models enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'equipment_models'
      and policyname = 'Allow public read active global catalog'
  ) then
    execute $policy$
      create policy "Allow public read active global catalog"
        on public.equipment_models
        for select
        to anon, authenticated
        using (coalesce(is_active, true) = true and coalesce(archived, false) = false)
    $policy$;
  end if;
end $$;

comment on table public.equipment_models is
  'Canonical global equipment and implement model catalog. Company assets link to this table; source inventory data must stay on company asset rows.';

-- ---------------------------------------------------------------------------
-- 2) Company machine assets -> global self-propelled machine models
-- ---------------------------------------------------------------------------

alter table public.reference_machines
  add column if not exists global_machine_model_id uuid,
  add column if not exists import_source text,
  add column if not exists import_source_row integer,
  add column if not exists inventory_number text,
  add column if not exists license_plate text,
  add column if not exists vin text,
  add column if not exists serial_number text,
  add column if not exists manufacture_year integer,
  add column if not exists amount_begin_debit numeric,
  add column if not exists source_raw_name text,
  add column if not exists source_clean_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_machines'::regclass
      and conname = 'reference_machines_global_machine_model_id_fkey'
  ) then
    alter table public.reference_machines
      add constraint reference_machines_global_machine_model_id_fkey
      foreign key (global_machine_model_id)
      references public.agricultural_machine_models(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_reference_machines_global_machine_model_id
  on public.reference_machines(global_machine_model_id)
  where global_machine_model_id is not null;

create index if not exists idx_reference_machines_company_id
  on public.reference_machines(company_id);

create unique index if not exists ux_reference_machines_company_import_source_row
  on public.reference_machines(company_id, import_source, import_source_row)
  where import_source is not null and import_source_row is not null;

-- ---------------------------------------------------------------------------
-- 3) Company equipment assets -> global equipment models
-- ---------------------------------------------------------------------------

alter table public.reference_equipment
  add column if not exists global_equipment_model_id uuid,
  add column if not exists import_source text,
  add column if not exists import_source_row integer,
  add column if not exists inventory_number text,
  add column if not exists serial_number text,
  add column if not exists manufacture_year integer,
  add column if not exists amount_begin_debit numeric,
  add column if not exists source_raw_name text,
  add column if not exists source_clean_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_equipment'::regclass
      and conname = 'reference_equipment_global_equipment_model_id_fkey'
  ) then
    alter table public.reference_equipment
      add constraint reference_equipment_global_equipment_model_id_fkey
      foreign key (global_equipment_model_id)
      references public.equipment_models(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_reference_equipment_global_equipment_model_id
  on public.reference_equipment(global_equipment_model_id)
  where global_equipment_model_id is not null;

create index if not exists idx_reference_equipment_company_id
  on public.reference_equipment(company_id);

create unique index if not exists ux_reference_equipment_company_import_source_row
  on public.reference_equipment(company_id, import_source, import_source_row)
  where import_source is not null and import_source_row is not null;

-- ---------------------------------------------------------------------------
-- 4) Company transport assets -> global transport models
-- ---------------------------------------------------------------------------

alter table public.reference_vehicles
  add column if not exists transport_model_id uuid,
  add column if not exists import_source text,
  add column if not exists import_source_row integer,
  add column if not exists inventory_number text,
  add column if not exists license_plate text,
  add column if not exists vin text,
  add column if not exists serial_number text,
  add column if not exists manufacture_year integer,
  add column if not exists amount_begin_debit numeric,
  add column if not exists source_raw_name text,
  add column if not exists source_clean_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reference_vehicles'::regclass
      and conname = 'reference_vehicles_transport_model_id_fkey'
  ) then
    alter table public.reference_vehicles
      add constraint reference_vehicles_transport_model_id_fkey
      foreign key (transport_model_id)
      references public.transport_models(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_reference_vehicles_transport_model_id
  on public.reference_vehicles(transport_model_id)
  where transport_model_id is not null;

create index if not exists idx_reference_vehicles_company_id
  on public.reference_vehicles(company_id);

create unique index if not exists ux_reference_vehicles_company_import_source_row
  on public.reference_vehicles(company_id, import_source, import_source_row)
  where import_source is not null and import_source_row is not null;

alter table public.reference_vehicles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'reference_vehicles'
      and policyname = 'Company members can view reference_vehicles'
  ) then
    execute $policy$
      create policy "Company members can view reference_vehicles"
        on public.reference_vehicles
        for select
        to authenticated
        using (
          company_id in (
            select company_id
            from public.profiles
            where id = auth.uid()
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'reference_vehicles'
      and policyname = 'Company members can manage reference_vehicles'
  ) then
    execute $policy$
      create policy "Company members can manage reference_vehicles"
        on public.reference_vehicles
        for all
        to authenticated
        using (
          company_id in (
            select company_id
            from public.profiles
            where id = auth.uid()
          )
        )
        with check (
          company_id in (
            select company_id
            from public.profiles
            where id = auth.uid()
          )
        )
    $policy$;
  end if;
end $$;

comment on column public.reference_vehicles.global_model_id is
  'Legacy vehicle-model link to global_vehicle_models. Keep for compatibility; new fixed-asset import must use transport_model_id.';
