-- Backfill rural_district for existing cadastral_parcels
-- Safe scope: only fills NULL/empty rural_district for one company.
-- Does NOT touch owners, areas, links.

-- 0) Set your company_id here
with ctx as (
  select '10000000-0000-0000-0000-000000000001'::uuid as company_id
)
select company_id from ctx;

-- 1) Preview source rows from import_batch_rows
with ctx as (
  select '10000000-0000-0000-0000-000000000001'::uuid as company_id
),
raw_candidates as (
  select
    lower(trim(row_payload->>'cadastral_number')) as cadastral_key,
    nullif(trim(row_payload->>'cadastral_number'), '') as cadastral_number,
    nullif(trim(row_payload->>'rural_district'), '') as rural_district,
    max(created_at) as last_seen_at
  from public.import_batch_rows r
  join ctx on ctx.company_id = r.company_id
  where nullif(trim(row_payload->>'cadastral_number'), '') is not null
    and nullif(trim(row_payload->>'rural_district'), '') is not null
  group by 1, 2, 3
)
select *
from raw_candidates
order by cadastral_number, rural_district;

-- 2) Preview conflicts: one cadastral number with multiple districts
with ctx as (
  select '10000000-0000-0000-0000-000000000001'::uuid as company_id
),
raw_candidates as (
  select
    lower(trim(row_payload->>'cadastral_number')) as cadastral_key,
    nullif(trim(row_payload->>'rural_district'), '') as rural_district
  from public.import_batch_rows r
  join ctx on ctx.company_id = r.company_id
  where nullif(trim(row_payload->>'cadastral_number'), '') is not null
    and nullif(trim(row_payload->>'rural_district'), '') is not null
)
select
  cadastral_key,
  count(distinct rural_district) as district_variants,
  array_agg(distinct rural_district order by rural_district) as districts
from raw_candidates
group by cadastral_key
having count(distinct rural_district) > 1
order by cadastral_key;

-- 3) Execute backfill (run only after preview looks correct)
with ctx as (
  select '10000000-0000-0000-0000-000000000001'::uuid as company_id
),
ranked_candidates as (
  select
    lower(trim(row_payload->>'cadastral_number')) as cadastral_key,
    nullif(trim(row_payload->>'rural_district'), '') as rural_district,
    row_number() over (
      partition by lower(trim(row_payload->>'cadastral_number'))
      order by created_at desc
    ) as rn
  from public.import_batch_rows r
  join ctx on ctx.company_id = r.company_id
  where nullif(trim(row_payload->>'cadastral_number'), '') is not null
    and nullif(trim(row_payload->>'rural_district'), '') is not null
),
updated as (
  update public.cadastral_parcels cp
    set rural_district = rc.rural_district
  from ranked_candidates rc, ctx
  where cp.company_id = ctx.company_id
    and lower(trim(cp.cadastral_number)) = rc.cadastral_key
    and rc.rn = 1
    and (cp.rural_district is null or btrim(cp.rural_district) = '')
  returning cp.id, cp.cadastral_number, cp.rural_district
)
select count(*) as updated_rows from updated;

-- 4) Post-check
with ctx as (
  select '10000000-0000-0000-0000-000000000001'::uuid as company_id
)
select
  count(*) filter (where nullif(trim(rural_district), '') is not null) as with_rural_district,
  count(*) filter (where nullif(trim(rural_district), '') is null) as missing_rural_district,
  count(*) as total
from public.cadastral_parcels cp
join ctx on ctx.company_id = cp.company_id
where coalesce(cp.archived, false) = false;
