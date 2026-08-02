/*
  Global transport reference catalog (master, not company fleet).
  Ready for safe CSV/JSON batch imports.
*/

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'transport_model_category'
  ) then
    create type public.transport_model_category as enum (
      'light_vehicle',
      'truck',
      'tractor_unit',
      'trailer',
      'bus',
      'special_vehicle'
    );
  end if;
end $$;

create table if not exists public.transport_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  category public.transport_model_category not null,
  brand text not null,
  series text,
  model text not null,
  full_name text not null,
  engine text,
  dealer_name text,
  presence_in_kz boolean not null default false,
  is_active boolean not null default true,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transport_models
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists category public.transport_model_category,
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists model text,
  add column if not exists full_name text,
  add column if not exists engine text,
  add column if not exists dealer_name text,
  add column if not exists presence_in_kz boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists notes text,
  add column if not exists archived boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.transport_models
set
  category = coalesce(category, 'truck'::public.transport_model_category),
  brand = coalesce(nullif(trim(brand), ''), 'unknown'),
  model = coalesce(nullif(trim(model), ''), 'unknown'),
  full_name = trim(concat_ws(' ', nullif(trim(brand), ''), nullif(trim(series), ''), nullif(trim(model), ''))),
  updated_at = now()
where
  category is null
  or coalesce(trim(brand), '') = ''
  or coalesce(trim(model), '') = ''
  or coalesce(trim(full_name), '') = '';

alter table public.transport_models
  alter column category set not null,
  alter column brand set not null,
  alter column model set not null,
  alter column full_name set not null,
  alter column user_id set not null;

drop index if exists ux_transport_models_identity_active;
create unique index if not exists ux_transport_models_identity_active
  on public.transport_models(
    category,
    lower(trim(brand)),
    lower(coalesce(trim(series), '')),
    lower(trim(model))
  )
  where archived = false;

create index if not exists idx_transport_models_full_name_trgm
  on public.transport_models using gin (full_name gin_trgm_ops)
  where archived = false;

create index if not exists idx_transport_models_category_active
  on public.transport_models(category, is_active)
  where archived = false;

create index if not exists idx_transport_models_brand_active
  on public.transport_models(lower(trim(brand)), is_active)
  where archived = false;

create or replace function public.normalize_transport_model_row()
returns trigger
language plpgsql
as $$
begin
  new.brand := nullif(regexp_replace(trim(coalesce(new.brand, '')), '\s+', ' ', 'g'), '');
  new.series := nullif(regexp_replace(trim(coalesce(new.series, '')), '\s+', ' ', 'g'), '');
  new.model := nullif(regexp_replace(trim(coalesce(new.model, '')), '\s+', ' ', 'g'), '');
  new.engine := nullif(trim(coalesce(new.engine, '')), '');
  new.dealer_name := nullif(trim(coalesce(new.dealer_name, '')), '');
  new.notes := nullif(trim(coalesce(new.notes, '')), '');

  if new.brand is null then raise exception 'brand is required'; end if;
  if new.model is null then raise exception 'model is required'; end if;
  if lower(new.brand) = lower(new.model) then raise exception 'model must not duplicate brand'; end if;

  new.full_name := trim(concat_ws(' ', nullif(trim(new.brand), ''), nullif(trim(new.series), ''), nullif(trim(new.model), '')));
  if new.full_name = '' then raise exception 'full_name is empty after normalization'; end if;

  new.updated_at := now();
  return new;
end;
$$;

drop index if exists public.idx_transport_models_brand_active;
drop index if exists public.idx_transport_models_category_active;
drop index if exists public.idx_transport_models_full_name_trgm;

drop trigger if exists trg_transport_models_normalize on public.transport_models;
create trigger trg_transport_models_normalize
before insert or update on public.transport_models
for each row execute function public.normalize_transport_model_row();

create or replace function public.import_transport_models(
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
  v_actor uuid;
  v_processed integer := 0;
  v_upserted integer := 0;
  v_skipped_count integer := 0;
  v_skipped jsonb := '[]'::jsonb;

  v_category_text text;
  v_category public.transport_model_category;
  v_brand text;
  v_series text;
  v_model text;
  v_engine text;
  v_dealer_name text;
  v_presence_text text;
  v_presence boolean;
  v_is_active_text text;
  v_is_active boolean;
  v_notes text;
  v_existing_id uuid;
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
    raise exception 'no actor available for transport import';
  end if;

  for v_row in
    select value from jsonb_array_elements(_rows)
  loop
    v_processed := v_processed + 1;

    v_category_text := lower(trim(coalesce(v_row ->> 'category', '')));
    v_brand := nullif(regexp_replace(trim(coalesce(v_row ->> 'brand', '')), '\s+', ' ', 'g'), '');
    v_series := nullif(regexp_replace(trim(coalesce(v_row ->> 'series', '')), '\s+', ' ', 'g'), '');
    v_model := nullif(regexp_replace(trim(coalesce(v_row ->> 'model', '')), '\s+', ' ', 'g'), '');
    v_engine := nullif(trim(coalesce(v_row ->> 'engine', '')), '');
    v_dealer_name := nullif(trim(coalesce(v_row ->> 'dealer_name', '')), '');
    v_notes := nullif(trim(coalesce(v_row ->> 'notes', '')), '');

    if v_category_text = '' or v_brand is null or v_model is null then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'row', v_processed,
          'reason', 'missing_required_fields'
        )
      );
      continue;
    end if;

    if lower(v_brand) = lower(v_model) then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'row', v_processed,
          'reason', 'brand_equals_model',
          'brand', v_brand,
          'model', v_model
        )
      );
      continue;
    end if;

    begin
      v_category := v_category_text::public.transport_model_category;
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

    v_presence_text := lower(nullif(trim(coalesce(v_row ->> 'presence_in_kz', '')), ''));
    if v_presence_text in ('true', 't', '1', 'yes', 'y', 'да', 'д') then
      v_presence := true;
    elsif v_presence_text in ('false', 'f', '0', 'no', 'n', 'нет', 'н') then
      v_presence := false;
    else
      v_presence := false;
    end if;

    v_is_active_text := lower(nullif(trim(coalesce(v_row ->> 'is_active', '')), ''));
    if v_is_active_text in ('false', 'f', '0', 'no', 'n', 'нет', 'н') then
      v_is_active := false;
    else
      v_is_active := true;
    end if;

    select tm.id
      into v_existing_id
    from public.transport_models tm
    where tm.archived = false
      and tm.category = v_category
      and lower(trim(tm.brand)) = lower(trim(v_brand))
      and lower(coalesce(trim(tm.series), '')) = lower(coalesce(trim(v_series), ''))
      and lower(trim(tm.model)) = lower(trim(v_model))
    limit 1;

    if v_existing_id is null then
      insert into public.transport_models (
        user_id,
        category,
        brand,
        series,
        model,
        engine,
        dealer_name,
        presence_in_kz,
        is_active,
        notes,
        archived
      )
      values (
        v_actor,
        v_category,
        v_brand,
        v_series,
        v_model,
        v_engine,
        v_dealer_name,
        v_presence,
        v_is_active,
        v_notes,
        false
      );
    else
      update public.transport_models
      set
        engine = v_engine,
        dealer_name = v_dealer_name,
        presence_in_kz = v_presence,
        is_active = v_is_active,
        notes = v_notes,
        archived = false,
        user_id = v_actor
      where id = v_existing_id;
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  return query
  select v_processed, v_upserted, v_skipped_count, v_skipped;
end;
$$;

-- Canonical production import implementation.
CREATE OR REPLACE FUNCTION public.import_transport_models(_rows jsonb, _actor uuid DEFAULT NULL::uuid)
 RETURNS TABLE(processed_count integer, upserted_count integer, skipped_count integer, skipped_rows jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $$
declare
  v_row jsonb;
  v_actor uuid;
  v_processed integer := 0;
  v_upserted integer := 0;
  v_skipped_count integer := 0;
  v_skipped jsonb := '[]'::jsonb;

  v_category_text text;
  v_category public.transport_model_category;
  v_brand text;
  v_series text;
  v_model text;
  v_engine text;
  v_dealer_name text;
  v_presence_text text;
  v_presence boolean;
  v_is_active_text text;
  v_is_active boolean;
  v_notes text;
  v_existing_id uuid;
begin
  if _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'rows must be a json array';
  end if;

  v_actor := _actor;
  if v_actor is null then
    select p.id into v_actor
    from public.profiles p
    where p.role = 'global_admin'
    order by p.created_at
    limit 1;
  end if;

  if v_actor is null then
    select p.id into v_actor
    from public.profiles p
    order by p.created_at
    limit 1;
  end if;

  if v_actor is null then
    raise exception 'no actor available for transport import';
  end if;

  for v_row in select value from jsonb_array_elements(_rows)
  loop
    v_processed := v_processed + 1;

    v_category_text := lower(trim(coalesce(v_row ->> 'category', '')));
    v_brand := nullif(regexp_replace(trim(coalesce(v_row ->> 'brand', '')), '\s+', ' ', 'g'), '');
    v_series := nullif(regexp_replace(trim(coalesce(v_row ->> 'series', '')), '\s+', ' ', 'g'), '');
    v_model := nullif(regexp_replace(trim(coalesce(v_row ->> 'model', '')), '\s+', ' ', 'g'), '');
    v_engine := nullif(trim(coalesce(v_row ->> 'engine', '')), '');
    v_dealer_name := nullif(trim(coalesce(v_row ->> 'dealer_name', '')), '');
    v_notes := nullif(trim(coalesce(v_row ->> 'notes', '')), '');

    if v_category_text = '' or v_brand is null or v_model is null then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('row', v_processed, 'reason', 'missing_required_fields'));
      continue;
    end if;

    if lower(v_brand) = lower(v_model) then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('row', v_processed, 'reason', 'brand_equals_model', 'brand', v_brand, 'model', v_model));
      continue;
    end if;

    begin
      v_category := v_category_text::public.transport_model_category;
    exception when others then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('row', v_processed, 'reason', 'invalid_category', 'category', v_category_text));
      continue;
    end;

    v_presence_text := lower(nullif(trim(coalesce(v_row ->> 'presence_in_kz', '')), ''));
    if v_presence_text in ('true','t','1','yes','y','да','д') then v_presence := true;
    elsif v_presence_text in ('false','f','0','no','n','нет','н') then v_presence := false;
    else v_presence := false;
    end if;

    v_is_active_text := lower(nullif(trim(coalesce(v_row ->> 'is_active', '')), ''));
    if v_is_active_text in ('false','f','0','no','n','нет','н') then v_is_active := false;
    else v_is_active := true;
    end if;

    select tm.id into v_existing_id
    from public.transport_models tm
    where tm.archived = false
      and tm.category = v_category
      and lower(trim(tm.brand)) = lower(trim(v_brand))
      and lower(coalesce(trim(tm.series), '')) = lower(coalesce(trim(v_series), ''))
      and lower(trim(tm.model)) = lower(trim(v_model))
    limit 1;

    if v_existing_id is null then
      insert into public.transport_models (
        user_id, category, brand, series, model, engine, dealer_name, presence_in_kz, is_active, notes, archived
      ) values (
        v_actor, v_category, v_brand, v_series, v_model, v_engine, v_dealer_name, v_presence, v_is_active, v_notes, false
      );
    else
      update public.transport_models
      set engine = v_engine,
          dealer_name = v_dealer_name,
          presence_in_kz = v_presence,
          is_active = v_is_active,
          notes = v_notes,
          archived = false,
          user_id = v_actor
      where id = v_existing_id;
    end if;

    v_upserted := v_upserted + 1;
  end loop;

  return query
  select v_processed, v_upserted, v_skipped_count, v_skipped;
end;
$$;
