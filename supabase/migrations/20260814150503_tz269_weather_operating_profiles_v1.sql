begin;

create table if not exists public.weather_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  wind_enabled boolean not null default false,
  max_wind_ms numeric(6,2),
  gust_enabled boolean not null default false,
  max_gust_ms numeric(6,2),
  precipitation_enabled boolean not null default false,
  precipitation_mode text not null default 'forbidden',
  max_precipitation_mmh numeric(7,2),
  precipitation_probability_enabled boolean not null default false,
  max_precipitation_probability_pct numeric(5,2),
  temperature_enabled boolean not null default false,
  min_temperature_c numeric(6,2),
  max_temperature_c numeric(6,2),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weather_profiles_name_length_v1 check (char_length(btrim(name)) between 1 and 80),
  constraint weather_profiles_wind_v1 check (max_wind_ms is null or max_wind_ms between 0 and 100),
  constraint weather_profiles_gust_v1 check (max_gust_ms is null or max_gust_ms between 0 and 150),
  constraint weather_profiles_precipitation_mode_v1 check (precipitation_mode in ('forbidden', 'maximum')),
  constraint weather_profiles_precipitation_v1 check (max_precipitation_mmh is null or max_precipitation_mmh between 0 and 500),
  constraint weather_profiles_probability_v1 check (max_precipitation_probability_pct is null or max_precipitation_probability_pct between 0 and 100),
  constraint weather_profiles_temperature_v1 check (
    (min_temperature_c is null or min_temperature_c between -100 and 100)
    and (max_temperature_c is null or max_temperature_c between -100 and 100)
    and (min_temperature_c is null or max_temperature_c is null or min_temperature_c <= max_temperature_c)
  )
);

create unique index if not exists weather_profiles_user_name_unique_v1
  on public.weather_profiles (company_id, user_id, lower(btrim(name)));
create unique index if not exists weather_profiles_one_default_v1
  on public.weather_profiles (company_id, user_id)
  where is_default;
create index if not exists weather_profiles_user_lookup_v1
  on public.weather_profiles (user_id, company_id, updated_at desc);

alter table public.weather_profiles enable row level security;

revoke all on table public.weather_profiles from public, anon;
grant select, insert, update, delete on table public.weather_profiles to authenticated;

drop policy if exists weather_profiles_owner_select_v1 on public.weather_profiles;
create policy weather_profiles_owner_select_v1 on public.weather_profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'agronomist')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weather_profiles.company_id
      )
  )
);

drop policy if exists weather_profiles_owner_insert_v1 on public.weather_profiles;
create policy weather_profiles_owner_insert_v1 on public.weather_profiles
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'agronomist')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weather_profiles.company_id
      )
  )
);

drop policy if exists weather_profiles_owner_update_v1 on public.weather_profiles;
create policy weather_profiles_owner_update_v1 on public.weather_profiles
for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'agronomist')
      and (lower(coalesce(p.role, '')) = 'global_admin' or p.company_id = weather_profiles.company_id)
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'agronomist')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weather_profiles.company_id
      )
  )
);

drop policy if exists weather_profiles_owner_delete_v1 on public.weather_profiles;
create policy weather_profiles_owner_delete_v1 on public.weather_profiles
for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'agronomist')
      and (lower(coalesce(p.role, '')) = 'global_admin' or p.company_id = weather_profiles.company_id)
  )
);

drop trigger if exists weather_profiles_updated_at_v1 on public.weather_profiles;
create trigger weather_profiles_updated_at_v1
before update on public.weather_profiles
for each row execute function public.update_updated_at_column();

comment on table public.weather_profiles is
  'TZ269 user-owned weather operating limits. Values are user settings, not agronomic recommendations.';

commit;
