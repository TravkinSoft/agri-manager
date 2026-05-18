-- Land Legal 2026: audit + owner fallback backfill
-- Safe for manual run in Supabase SQL editor.
-- Scope: operational company Astyk-STEM.

begin;

-- 0) Company scope (change if needed)
with target_company as (
  select id, name
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
)
select * from target_company;

-- 1) Core counts
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
),
season_2026 as (
  select s.id
  from public.seasons s
  join target_company c on c.id = s.company_id
  where s.year = 2026
  limit 1
)
select
  (select count(*) from public.fields f join target_company c on c.id = f.company_id where coalesce(f.archived, false) = false) as fields_count,
  (select count(*) from public.crop_structure cs join target_company c on c.id = cs.company_id join season_2026 s on s.id = cs.season_id where coalesce(cs.archived, false) = false) as crop_structure_2026_count,
  (select count(*) from public.cadastral_parcels cp join target_company c on c.id = cp.company_id where coalesce(cp.archived, false) = false) as cadastral_parcels_count,
  (select count(*) from public.field_cadastre_links l join target_company c on c.id = l.company_id join season_2026 s on s.id = l.season_id where l.status <> 'archived') as field_cadastre_links_2026_count,
  (select count(*) from public.land_owner_allocations o join target_company c on c.id = o.company_id join season_2026 s on s.id = o.season_id where coalesce(o.archived, false) = false) as owner_allocations_2026_count,
  (select count(*) from public.legal_entities le join target_company c on c.id = le.company_id where coalesce(le.archived, false) = false) as legal_entities_count;

-- 2) Detect garbage field names (System.Xml...)
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
)
select
  f.id,
  f.name as technical_name,
  case
    when f.notes like '{%' then nullif((f.notes::jsonb ->> 'original_field_key'), '')
    else null
  end as original_field_key,
  case
    when f.name ~* 'system\.xml\.xmlelement-[0-9]+$' then regexp_replace(f.name, '^.*-([0-9]+)$', '\1')
    when f.name ~* 'system\.xml\.xmlelement' then null
    when f.name ~ '^[0-9]+(?:-[0-9]+)+$' then regexp_replace(f.name, '-[0-9]+$', '')
    else f.name
  end as suggested_display_name
from public.fields f
join target_company c on c.id = f.company_id
where coalesce(f.archived, false) = false
  and f.name ~* 'system\.xml'
order by f.name;

-- 3) Source-document coverage in legal links (season 2026)
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
),
season_2026 as (
  select s.id
  from public.seasons s
  join target_company c on c.id = s.company_id
  where s.year = 2026
  limit 1
)
select
  coalesce(nullif(trim(l.source_document), ''), 'Нет данных') as source_document,
  count(*) as links_count
from public.field_cadastre_links l
join target_company c on c.id = l.company_id
join season_2026 s on s.id = l.season_id
where l.status <> 'archived'
group by 1
order by 2 desc, 1;

-- 4) Ensure legal entities for STEM / Караагаш exist
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
)
insert into public.legal_entities (
  company_id,
  name,
  entity_type,
  is_active,
  archived,
  notes
)
select
  c.id,
  x.name,
  'company',
  true,
  false,
  'Auto-created for legal source owner fallback'
from target_company c
cross join (
  values
    ('ТОО "Астык-STEM"'),
    ('ТОО "Астык-Караагаш"')
) as x(name)
where not exists (
  select 1
  from public.legal_entities le
  where le.company_id = c.id
    and lower(trim(le.name)) = lower(trim(x.name))
    and coalesce(le.archived, false) = false
);

-- 5) Backfill owner fallback by source_document (only where owner is missing)
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
),
season_2026 as (
  select s.id
  from public.seasons s
  join target_company c on c.id = s.company_id
  where s.year = 2026
  limit 1
),
stem_entity as (
  select le.id
  from public.legal_entities le
  join target_company c on c.id = le.company_id
  where lower(trim(le.name)) = lower(trim('ТОО "Астык-STEM"'))
    and coalesce(le.archived, false) = false
  limit 1
),
karagash_entity as (
  select le.id
  from public.legal_entities le
  join target_company c on c.id = le.company_id
  where lower(trim(le.name)) = lower(trim('ТОО "Астык-Караагаш"'))
    and coalesce(le.archived, false) = false
  limit 1
),
fill_stem as (
  update public.field_cadastre_links l
  set owner_legal_entity_id = (select id from stem_entity)
  where l.company_id = (select id from target_company)
    and l.season_id = (select id from season_2026)
    and l.status <> 'archived'
    and l.owner_legal_entity_id is null
    and (
      lower(coalesce(l.source_document, '')) like '%стем%'
      or lower(coalesce(l.source_document, '')) like '%stem%'
    )
  returning l.id
),
fill_karagash as (
  update public.field_cadastre_links l
  set owner_legal_entity_id = (select id from karagash_entity)
  where l.company_id = (select id from target_company)
    and l.season_id = (select id from season_2026)
    and l.status <> 'archived'
    and l.owner_legal_entity_id is null
    and (
      lower(coalesce(l.source_document, '')) like '%карагаш%'
      or lower(coalesce(l.source_document, '')) like '%караагаш%'
      or lower(coalesce(l.source_document, '')) like '%karagash%'
      or lower(coalesce(l.source_document, '')) like '%karaagash%'
    )
  returning l.id
)
select
  (select count(*) from fill_stem) as filled_stem,
  (select count(*) from fill_karagash) as filled_karagash;

-- 6) Post-check owner coverage
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
),
season_2026 as (
  select s.id
  from public.seasons s
  join target_company c on c.id = s.company_id
  where s.year = 2026
  limit 1
)
select
  count(*) filter (where l.owner_legal_entity_id is null) as missing_owner_rows,
  count(*) filter (where l.owner_legal_entity_id is not null) as filled_owner_rows,
  count(*) as total_rows
from public.field_cadastre_links l
join target_company c on c.id = l.company_id
join season_2026 s on s.id = l.season_id
where l.status <> 'archived';

-- 7) Rural district coverage
with target_company as (
  select id
  from public.companies
  where name ilike '%Астык-STEM%'
  limit 1
)
select
  count(*) as cadastres_total,
  count(*) filter (where nullif(trim(cp.rural_district), '') is not null) as cadastres_with_district,
  count(*) filter (where nullif(trim(cp.rural_district), '') is null) as cadastres_without_district
from public.cadastral_parcels cp
join target_company c on c.id = cp.company_id
where coalesce(cp.archived, false) = false;

commit;
