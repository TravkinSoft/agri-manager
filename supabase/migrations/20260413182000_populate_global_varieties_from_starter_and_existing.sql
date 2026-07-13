/*
  Global varieties hardening + mass population.
  Rules:
  - No fake data generation
  - Starter set inserted exactly
  - Expansion only from already existing real rows in DB
  - Global scope only (company_id is null)
*/

-- =====================================================
-- 1) Verify/finalize table structure
-- =====================================================
alter table public.varieties
  add column if not exists origin_country text,
  add column if not exists breeder_or_originator text,
  add column if not exists variety_type text,
  add column if not exists maturity_group text,
  add column if not exists notes text,
  add column if not exists is_common_in_kz boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.varieties
  alter column crop_id set not null,
  alter column name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'varieties_crop_id_fk_v3'
  ) then
    alter table public.varieties
      add constraint varieties_crop_id_fk_v3
      foreign key (crop_id) references public.crops(id) on delete cascade;
  end if;
end $$;

create unique index if not exists ux_varieties_global_crop_name_active_v4
  on public.varieties(crop_id, lower(name))
  where company_id is null and archived = false and coalesce(is_active, true) = true;

create index if not exists idx_varieties_crop_id_v4
  on public.varieties(crop_id);

create index if not exists idx_varieties_name_v4
  on public.varieties(lower(name));

create index if not exists idx_varieties_common_kz_v4
  on public.varieties(is_common_in_kz);

create index if not exists idx_varieties_is_active_v4
  on public.varieties(is_active);

drop trigger if exists update_varieties_updated_at on public.varieties;
create trigger update_varieties_updated_at
before update on public.varieties
for each row execute function public.ensure_updated_at_column();

-- =====================================================
-- 2) Mandatory starter set (exact)
-- =====================================================
with starter(crop_slug,name,origin_country,breeder_or_originator,variety_type,maturity_group,notes,is_common_in_kz) as (
  values
    ('wheat','Гадис','Франция','Limagrain','яровая','среднеспелый',null,true),
    ('wheat','Астана','Казахстан',null,'яровая','среднеспелый',null,true),
    ('wheat','Шортандинская 95','Казахстан',null,'яровая','среднеспелый',null,true),
    ('wheat','Омская 36','Россия',null,'яровая','среднеспелый',null,true),
    ('wheat','Айна','Казахстан',null,'яровая','среднеспелый',null,true),
    ('wheat','Казахстанская раннеспелая','Казахстан',null,'яровая','раннеспелый',null,true),
    ('wheat','Степная 50','Казахстан',null,'яровая','среднеспелый',null,true),
    ('wheat','Ликамеро','Германия',null,'яровая','среднеспелый',null,true),
    ('potato','Гала','Германия',null,'столовый','ранний',null,true),
    ('potato','Агрия','Нидерланды',null,'столовый','среднепоздний',null,true),
    ('potato','Ред Скарлетт','Нидерланды',null,'столовый','ранний',null,true),
    ('potato','Беллароза','Германия',null,'столовый','ранний',null,true),
    ('potato','Коломбо','Нидерланды',null,'столовый','ранний',null,true),
    ('potato','Санте','Нидерланды',null,'столовый','среднеранний',null,true),
    ('potato','Импала','Нидерланды',null,'столовый','ранний',null,true),
    ('potato','Невский','Россия',null,'столовый','среднеранний',null,true),
    ('potato','Ривьера','Нидерланды',null,'столовый','очень ранний',null,true),
    ('potato','Каратоп','Германия',null,'столовый','ранний',null,true),
    ('potato','Queen Anne','Германия',null,'столовый','среднеранний',null,true),
    ('potato','Laura','Германия',null,'столовый','среднеранний',null,true),
    ('potato','Innovator','Нидерланды',null,'переработка','среднепоздний',null,true),
    ('potato','Fontane','Бельгия',null,'переработка','среднепоздний',null,true),
    ('potato','Lady Claire','Нидерланды',null,'переработка','среднеранний',null,true),
    ('potato','Arizona','Нидерланды',null,'столовый','ранний',null,true),
    ('potato','Baltic Rose','Германия','NORIKA','столовый','среднеранний',null,true),
    ('carrot','Нантская 4','Россия',null,'столовый','среднеспелый',null,true),
    ('carrot','Шантане 2461','Россия',null,'столовый','среднеспелый',null,true),
    ('carrot','Балтимор F1','Нидерланды',null,'гибрид','среднеранний',null,true),
    ('carrot','Канада F1','Нидерланды',null,'гибрид','поздний',null,true),
    ('carrot','Абако F1','Нидерланды',null,'гибрид','ранний',null,true),
    ('carrot','Каскад F1','Нидерланды',null,'гибрид','среднепоздний',null,true),
    ('carrot','Нелли F1','Нидерланды',null,'гибрид','ранний',null,true),
    ('carrot','Карини','Нидерланды',null,'столовый','среднеспелый',null,true)
),
mapped as (
  select
    c.id as crop_id,
    s.name,
    s.origin_country,
    s.breeder_or_originator,
    s.variety_type,
    s.maturity_group,
    s.notes,
    s.is_common_in_kz
  from starter s
  join public.crops c
    on lower(c.slug) = lower(s.crop_slug)
  where c.company_id is null
    and c.archived = false
),
upd as (
  update public.varieties v
  set
    origin_country = m.origin_country,
    breeder_or_originator = m.breeder_or_originator,
    variety_type = m.variety_type,
    maturity_group = m.maturity_group,
    notes = m.notes,
    is_common_in_kz = m.is_common_in_kz,
    is_active = true,
    archived = false,
    updated_at = now()
  from mapped m
  where v.crop_id = m.crop_id
    and lower(v.name) = lower(m.name)
    and v.company_id is null
  returning v.id, v.crop_id
),
ins as (
  insert into public.varieties (
    crop_id, name, origin_country, breeder_or_originator,
    variety_type, maturity_group, notes, is_common_in_kz,
    is_active, company_id, archived, user_id
  )
  select
    m.crop_id, m.name, m.origin_country, m.breeder_or_originator,
    m.variety_type, m.maturity_group, m.notes, m.is_common_in_kz,
    true, null, false,
    (
      select p.id
      from public.profiles p
      where p.role in ('global_admin','admin')
        and p.status = 'active'
      order by case when p.role = 'global_admin' then 0 else 1 end, p.created_at asc
      limit 1
    ) as owner_user_id
  from mapped m
  where not exists (
    select 1
    from public.varieties v
    where v.crop_id = m.crop_id
      and lower(v.name) = lower(m.name)
      and v.company_id is null
      and v.archived = false
  )
  returning id, crop_id
)
select
  (select count(*) from mapped) as starter_mapped_rows,
  (select count(*) from upd) as starter_updated_rows,
  (select count(*) from ins) as starter_inserted_rows;

-- =====================================================
-- 3) Expand from existing DB-only reliable varieties
--    (no external hallucinated generation)
-- =====================================================
with existing_non_global as (
  select distinct
    c_global.id as crop_id,
    btrim(v.name) as name,
    nullif(btrim(v.origin_country), '') as origin_country,
    nullif(btrim(v.breeder_or_originator), '') as breeder_or_originator,
    nullif(btrim(v.variety_type), '') as variety_type,
    nullif(btrim(v.maturity_group), '') as maturity_group,
    nullif(btrim(v.notes), '') as notes,
    coalesce(v.is_common_in_kz, false) as is_common_in_kz
  from public.varieties v
  join public.crops c_src on c_src.id = v.crop_id
  join public.crops c_global
    on lower(c_global.slug) = lower(c_src.slug)
   and c_global.company_id is null
   and c_global.archived = false
  where v.company_id is not null
    and v.archived = false
    and v.name is not null
    and btrim(v.name) <> ''
),
upd2 as (
  update public.varieties g
  set
    origin_country = coalesce(g.origin_country, e.origin_country),
    breeder_or_originator = coalesce(g.breeder_or_originator, e.breeder_or_originator),
    variety_type = coalesce(g.variety_type, e.variety_type),
    maturity_group = coalesce(g.maturity_group, e.maturity_group),
    notes = coalesce(g.notes, e.notes),
    is_common_in_kz = coalesce(g.is_common_in_kz, e.is_common_in_kz),
    is_active = true,
    archived = false,
    updated_at = now()
  from existing_non_global e
  where g.crop_id = e.crop_id
    and lower(g.name) = lower(e.name)
    and g.company_id is null
  returning g.id, g.crop_id
),
ins2 as (
  insert into public.varieties (
    crop_id, name, origin_country, breeder_or_originator,
    variety_type, maturity_group, notes, is_common_in_kz,
    is_active, company_id, archived, user_id
  )
  select
    e.crop_id, e.name, e.origin_country, e.breeder_or_originator,
    e.variety_type, e.maturity_group, e.notes, e.is_common_in_kz,
    true, null, false,
    (
      select p.id
      from public.profiles p
      where p.role in ('global_admin','admin')
        and p.status = 'active'
      order by case when p.role = 'global_admin' then 0 else 1 end, p.created_at asc
      limit 1
    ) as owner_user_id
  from existing_non_global e
  where not exists (
    select 1
    from public.varieties g
    where g.crop_id = e.crop_id
      and lower(g.name) = lower(e.name)
      and g.company_id is null
      and g.archived = false
  )
  returning id, crop_id
)
select
  (select count(*) from upd2) as promoted_updated_rows,
  (select count(*) from ins2) as promoted_inserted_rows;

-- =====================================================
-- 4) Stats: totals and per crop
-- =====================================================
select
  count(*) as global_varieties_total
from public.varieties v
where v.company_id is null
  and v.archived = false;

select
  c.slug as crop_slug,
  c.name_ru as crop_name_ru,
  count(*) as varieties_count
from public.varieties v
join public.crops c on c.id = v.crop_id
where v.company_id is null
  and v.archived = false
group by c.slug, c.name_ru
order by varieties_count desc, c.slug asc;

-- NORIKA subset visibility
select
  c.slug as crop_slug,
  v.name,
  v.origin_country,
  v.breeder_or_originator
from public.varieties v
join public.crops c on c.id = v.crop_id
where v.company_id is null
  and v.archived = false
  and lower(coalesce(v.breeder_or_originator, '')) like '%norika%'
order by c.slug, v.name;
