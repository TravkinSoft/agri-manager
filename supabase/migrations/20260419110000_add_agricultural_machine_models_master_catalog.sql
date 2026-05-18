/*
  Global agricultural machinery master catalog.
  Purpose:
  - Dedicated global table for self-propelled agricultural machinery models
  - Strong normalization and duplicate protection
  - Import readiness with safe upsert and invalid-row skipping
*/

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'agricultural_machine_category'
  ) then
    create type public.agricultural_machine_category as enum (
      'combine_harvester',
      'forage_harvester',
      'self_propelled_sprayer',
      'self_propelled_seeder',
      'self_propelled_spreader',
      'self_propelled_windrower',
      'self_propelled_mower',
      'tractor'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'agricultural_machine_source_type'
  ) then
    create type public.agricultural_machine_source_type as enum (
      'manufacturer',
      'official_dealer',
      'registry',
      'import_feed',
      'manual'
    );
  end if;
end $$;

create table if not exists public.agricultural_machine_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  category public.agricultural_machine_category not null,
  brand text not null,
  series text,
  model text not null,
  full_name text generated always as (
    btrim(
      concat_ws(
        ' ',
        nullif(btrim(brand), ''),
        nullif(btrim(series), ''),
        nullif(btrim(model), '')
      )
    )
  ) stored,
  power_hp numeric(10,2),
  engine text,
  tank_volume_l numeric(12,2),
  grain_tank_l numeric(12,2),
  working_width_m numeric(10,2),
  power_class text,
  dealer_name text,
  presence_in_kz boolean not null default false,
  source_url text,
  source_type public.agricultural_machine_source_type,
  is_active boolean not null default true,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  brand_norm text generated always as (
    lower(regexp_replace(btrim(brand), '\s+', ' ', 'g'))
  ) stored,
  series_norm text generated always as (
    lower(regexp_replace(coalesce(btrim(series), ''), '\s+', ' ', 'g'))
  ) stored,
  model_norm text generated always as (
    lower(regexp_replace(btrim(model), '\s+', ' ', 'g'))
  ) stored
);

alter table public.agricultural_machine_models
  add column if not exists user_id uuid,
  add column if not exists power_hp numeric(10,2),
  add column if not exists engine text,
  add column if not exists tank_volume_l numeric(12,2),
  add column if not exists grain_tank_l numeric(12,2),
  add column if not exists working_width_m numeric(10,2),
  add column if not exists power_class text,
  add column if not exists dealer_name text,
  add column if not exists presence_in_kz boolean not null default false,
  add column if not exists source_url text,
  add column if not exists source_type public.agricultural_machine_source_type,
  add column if not exists is_active boolean not null default true,
  add column if not exists notes text,
  add column if not exists archived boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agricultural_machine_models_user_id_fk'
      and conrelid = 'public.agricultural_machine_models'::regclass
  ) then
    alter table public.agricultural_machine_models
      add constraint agricultural_machine_models_user_id_fk
      foreign key (user_id)
      references public.profiles(id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uq_agricultural_machine_models_identity'
      and conrelid = 'public.agricultural_machine_models'::regclass
  ) then
    alter table public.agricultural_machine_models
      add constraint uq_agricultural_machine_models_identity
      unique (category, brand_norm, series_norm, model_norm);
  end if;
end $$;

create index if not exists idx_agricultural_machine_models_category
  on public.agricultural_machine_models(category)
  where archived = false;

create index if not exists idx_agricultural_machine_models_active
  on public.agricultural_machine_models(is_active)
  where archived = false;

create index if not exists idx_agricultural_machine_models_brand
  on public.agricultural_machine_models(brand_norm)
  where archived = false;

create index if not exists idx_agricultural_machine_models_series
  on public.agricultural_machine_models(series_norm)
  where archived = false;

create index if not exists idx_agricultural_machine_models_full_name
  on public.agricultural_machine_models using gin (full_name gin_trgm_ops)
  where archived = false;

create or replace function public.normalize_agricultural_machine_model()
returns trigger
language plpgsql
as $$
begin
  new.brand := regexp_replace(coalesce(new.brand, ''), '\s+', ' ', 'g');
  new.brand := nullif(btrim(new.brand), '');

  new.series := regexp_replace(coalesce(new.series, ''), '\s+', ' ', 'g');
  new.series := nullif(btrim(new.series), '');

  new.model := regexp_replace(coalesce(new.model, ''), '\s+', ' ', 'g');
  new.model := nullif(btrim(new.model), '');

  new.engine := nullif(btrim(coalesce(new.engine, '')), '');
  new.power_class := nullif(btrim(coalesce(new.power_class, '')), '');
  new.dealer_name := nullif(btrim(coalesce(new.dealer_name, '')), '');
  new.source_url := nullif(btrim(coalesce(new.source_url, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');

  if new.brand is null or new.model is null then
    raise exception 'brand and model are required';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_normalize_agricultural_machine_model on public.agricultural_machine_models;
create trigger trg_normalize_agricultural_machine_model
before insert or update on public.agricultural_machine_models
for each row execute function public.normalize_agricultural_machine_model();

create or replace function public.import_agricultural_machine_models(
  _rows jsonb,
  _actor uuid default null
)
returns table(
  processed_count integer,
  upserted_count integer,
  skipped_count integer,
  skipped_rows jsonb
)
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_category_text text;
  v_category public.agricultural_machine_category;
  v_brand text;
  v_series text;
  v_model text;
  v_power_hp numeric(10,2);
  v_engine text;
  v_tank_volume_l numeric(12,2);
  v_grain_tank_l numeric(12,2);
  v_working_width_m numeric(10,2);
  v_power_class text;
  v_dealer_name text;
  v_presence_in_kz boolean;
  v_source_url text;
  v_source_type_text text;
  v_source_type public.agricultural_machine_source_type;
  v_is_active boolean;
  v_notes text;
  v_presence_text text;
  v_is_active_text text;
  v_actor uuid;
  v_skipped jsonb := '[]'::jsonb;
  v_processed integer := 0;
  v_upserted integer := 0;
  v_skipped_count integer := 0;
begin
  if _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  v_actor := _actor;
  if v_actor is null then
    select p.id
      into v_actor
    from public.profiles p
    where p.role = 'global_admin'
      and coalesce(p.status, 'active') = 'active'
    order by p.created_at
    limit 1;
  end if;

  if v_actor is null then
    select p.id
      into v_actor
    from public.profiles p
    order by p.created_at
    limit 1;
  end if;

  if v_actor is null then
    raise exception 'no actor available for import';
  end if;

  for v_row in
    select value
    from jsonb_array_elements(_rows)
  loop
    v_processed := v_processed + 1;

    v_category_text := lower(btrim(coalesce(v_row ->> 'category', '')));
    v_brand := nullif(regexp_replace(coalesce(v_row ->> 'brand', ''), '\s+', ' ', 'g'), '');
    v_brand := nullif(btrim(coalesce(v_brand, '')), '');
    v_series := nullif(regexp_replace(coalesce(v_row ->> 'series', ''), '\s+', ' ', 'g'), '');
    v_series := nullif(btrim(coalesce(v_series, '')), '');
    v_model := nullif(regexp_replace(coalesce(v_row ->> 'model', ''), '\s+', ' ', 'g'), '');
    v_model := nullif(btrim(coalesce(v_model, '')), '');

    if v_category_text = '' or v_brand is null or v_model is null then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'row', v_processed,
          'reason', 'missing_required_fields',
          'category', coalesce(v_category_text, ''),
          'brand', coalesce(v_brand, ''),
          'model', coalesce(v_model, '')
        )
      );
      continue;
    end if;

    begin
      v_category := v_category_text::public.agricultural_machine_category;
    exception
      when others then
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'row', v_processed,
            'reason', 'invalid_category',
            'category', v_category_text
          )
        );
        continue;
    end;

    begin
      v_source_type_text := lower(nullif(btrim(coalesce(v_row ->> 'source_type', '')), ''));
      if v_source_type_text is null then
        v_source_type := null;
      else
        v_source_type := v_source_type_text::public.agricultural_machine_source_type;
      end if;
    exception
      when others then
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'row', v_processed,
            'reason', 'invalid_source_type',
            'source_type', coalesce(v_source_type_text, '')
          )
        );
        continue;
    end;

    begin
      v_power_hp := nullif(btrim(coalesce(v_row ->> 'power_hp', '')), '')::numeric;
      v_tank_volume_l := nullif(btrim(coalesce(v_row ->> 'tank_volume_l', '')), '')::numeric;
      v_grain_tank_l := nullif(btrim(coalesce(v_row ->> 'grain_tank_l', '')), '')::numeric;
      v_working_width_m := nullif(btrim(coalesce(v_row ->> 'working_width_m', '')), '')::numeric;
    exception
      when others then
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'row', v_processed,
            'reason', 'invalid_numeric_value'
          )
        );
        continue;
    end;

    v_engine := nullif(btrim(coalesce(v_row ->> 'engine', '')), '');
    v_power_class := nullif(btrim(coalesce(v_row ->> 'power_class', '')), '');
    v_dealer_name := nullif(btrim(coalesce(v_row ->> 'dealer_name', '')), '');
    v_presence_text := lower(nullif(btrim(coalesce(v_row ->> 'presence_in_kz', '')), ''));
    if v_presence_text in ('true', 't', '1', 'yes', 'y', 'да', 'д', 'истина') then
      v_presence_in_kz := true;
    elsif v_presence_text in ('false', 'f', '0', 'no', 'n', 'нет', 'н', 'ложь') then
      v_presence_in_kz := false;
    else
      v_presence_in_kz := false;
    end if;

    v_source_url := nullif(btrim(coalesce(v_row ->> 'source_url', '')), '');
    v_is_active_text := lower(nullif(btrim(coalesce(v_row ->> 'is_active', '')), ''));
    if v_is_active_text in ('false', 'f', '0', 'no', 'n', 'нет', 'н', 'ложь') then
      v_is_active := false;
    else
      v_is_active := true;
    end if;

    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');

    insert into public.agricultural_machine_models (
      user_id,
      category,
      brand,
      series,
      model,
      power_hp,
      engine,
      tank_volume_l,
      grain_tank_l,
      working_width_m,
      power_class,
      dealer_name,
      presence_in_kz,
      source_url,
      source_type,
      is_active,
      notes
    )
    values (
      v_actor,
      v_category,
      v_brand,
      v_series,
      v_model,
      v_power_hp,
      v_engine,
      v_tank_volume_l,
      v_grain_tank_l,
      v_working_width_m,
      v_power_class,
      v_dealer_name,
      v_presence_in_kz,
      v_source_url,
      v_source_type,
      v_is_active,
      v_notes
    )
    on conflict on constraint uq_agricultural_machine_models_identity
    do update
      set
        power_hp = excluded.power_hp,
        engine = excluded.engine,
        tank_volume_l = excluded.tank_volume_l,
        grain_tank_l = excluded.grain_tank_l,
        working_width_m = excluded.working_width_m,
        power_class = excluded.power_class,
        dealer_name = excluded.dealer_name,
        presence_in_kz = excluded.presence_in_kz,
        source_url = excluded.source_url,
        source_type = excluded.source_type,
        is_active = excluded.is_active,
        notes = excluded.notes,
        archived = false,
        user_id = excluded.user_id;

    v_upserted := v_upserted + 1;
  end loop;

  return query
  select
    v_processed,
    v_upserted,
    v_skipped_count,
    v_skipped;
end;
$$;
