/*
  Finalize global crops master catalog and load baseline dataset.
  Depends on public.crop_categories(slug) being already populated.
*/

-- 1) Ensure global crops structure
alter table public.crops
  add column if not exists name_ru text,
  add column if not exists slug text,
  add column if not exists category_id uuid,
  add column if not exists subcategory text,
  add column if not exists is_common_in_kz boolean not null default false,
  add column if not exists priority_level text not null default 'medium',
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists crop_kind text,
  add column if not exists default_uom text,
  add column if not exists harvest_uom text,
  add column if not exists seed_uom text,
  add column if not exists description text,
  add column if not exists notes text,
  add column if not exists can_have_varieties boolean,
  add column if not exists can_have_seed_reproduction boolean,
  add column if not exists can_be_harvested boolean;

update public.crops
set name_ru = coalesce(nullif(name_ru, ''), name),
    slug = coalesce(nullif(slug, ''), regexp_replace(lower(coalesce(name_en, name_ru, name)), '[^a-z0-9]+', '-', 'g')),
    slug = trim(both '-' from slug)
where name_ru is null
   or btrim(name_ru) = ''
   or slug is null
   or btrim(slug) = '';

update public.crops
set slug = concat('crop-', left(id::text, 8))
where slug is null or btrim(slug) = '';

update public.crops
set priority_level =
  case
    when priority_level in ('high','medium','low') then priority_level
    when priority_level ~ '^[0-9]+$' then
      case
        when priority_level::int >= 4 then 'high'
        when priority_level::int = 3 then 'medium'
        else 'low'
      end
    else 'medium'
  end;

update public.crops
set crop_kind = coalesce(nullif(crop_kind, ''), 'general'),
    default_uom = coalesce(nullif(default_uom, ''), 'kg'),
    harvest_uom = coalesce(nullif(harvest_uom, ''), 'kg'),
    seed_uom = coalesce(nullif(seed_uom, ''), 'kg'),
    can_have_varieties = coalesce(can_have_varieties, true),
    can_have_seed_reproduction = coalesce(can_have_seed_reproduction, true),
    can_be_harvested = coalesce(can_be_harvested, true),
    is_active = coalesce(is_active, true),
    is_common_in_kz = coalesce(is_common_in_kz, false);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crops_priority_level_check_v3'
  ) then
    alter table public.crops
      add constraint crops_priority_level_check_v3
      check (priority_level in ('high','medium','low'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crops_category_id_fk'
  ) then
    alter table public.crops
      add constraint crops_category_id_fk
      foreign key (category_id)
      references public.crop_categories(id)
      on update cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crops_global_requires_category'
  ) then
    alter table public.crops
      add constraint crops_global_requires_category
      check (company_id is not null or category_id is not null);
  end if;
end $$;

create unique index if not exists ux_crops_global_slug_active_v3
  on public.crops(lower(slug))
  where company_id is null and archived = false;

create index if not exists idx_crops_slug_v3
  on public.crops(lower(slug));

create index if not exists idx_crops_category_id_v3
  on public.crops(category_id);

create index if not exists idx_crops_is_active_v3
  on public.crops(is_active);

create index if not exists idx_crops_is_common_in_kz_v3
  on public.crops(is_common_in_kz);

drop trigger if exists update_crops_updated_at on public.crops;
create trigger update_crops_updated_at
before update on public.crops
for each row execute function public.ensure_updated_at_column();

-- 2) Insert/update provided crop set
with src(name_ru,name_en,slug,category_slug,subcategory,is_common_in_kz,priority_level) as (
  values
    ('Пшеница','Wheat','wheat','cereal',null,true,'high'),
    ('Ячмень','Barley','barley','cereal',null,true,'high'),
    ('Овёс','Oat','oat','cereal',null,true,'medium'),
    ('Кукуруза','Maize','maize','cereal',null,true,'high'),
    ('Рожь','Rye','rye','cereal',null,true,'medium'),
    ('Тритикале','Triticale','triticale','cereal',null,true,'low'),
    ('Просо','Millet','millet','cereal',null,true,'medium'),
    ('Сорго','Sorghum','sorghum','cereal',null,true,'low'),
    ('Рис','Rice','rice','cereal',null,true,'medium'),
    ('Подсолнечник','Sunflower','sunflower','oilseed',null,true,'high'),
    ('Рапс','Rapeseed','rapeseed','oilseed',null,true,'high'),
    ('Лён (масличный)','Flax','flax-oilseed','oilseed',null,true,'high'),
    ('Соя','Soybean','soybean','oilseed',null,true,'medium'),
    ('Горчица','Mustard','mustard','oilseed',null,true,'low'),
    ('Сафлор','Safflower','safflower','oilseed',null,true,'medium'),
    ('Кунжут','Sesame','sesame','oilseed',null,false,'low'),
    ('Горох','Pea','pea','legume',null,true,'high'),
    ('Чечевица','Lentil','lentil','legume',null,true,'high'),
    ('Нут','Chickpea','chickpea','legume',null,true,'medium'),
    ('Фасоль','Bean','bean','legume',null,true,'medium'),
    ('Люпин','Lupin','lupin','legume',null,false,'low'),
    ('Люцерна','Alfalfa','alfalfa','forage','perennial',true,'high'),
    ('Клевер','Clover','clover','forage','perennial',true,'medium'),
    ('Суданская трава','Sudan grass','sudan-grass','forage','annual',true,'medium'),
    ('Кукуруза на силос','Silage maize','silage-maize','forage',null,true,'high'),
    ('Травосмеси','Grass mixtures','grass-mixtures','forage',null,true,'medium'),
    ('Картофель','Potato','potato','vegetable','tuber',true,'high'),
    ('Морковь','Carrot','carrot','vegetable','root',true,'high'),
    ('Лук репчатый','Onion','onion','vegetable','bulb',true,'high'),
    ('Свекла столовая','Beetroot','beetroot','vegetable','root',true,'medium'),
    ('Капуста','Cabbage','cabbage','vegetable','leafy',true,'medium'),
    ('Томаты','Tomato','tomato','vegetable','fruit',true,'medium'),
    ('Огурцы','Cucumber','cucumber','vegetable','fruit',true,'medium'),
    ('Перец','Pepper','pepper','vegetable','fruit',true,'low'),
    ('Баклажан','Eggplant','eggplant','vegetable','fruit',true,'low'),
    ('Сахарная свекла','Sugar beet','sugar-beet','technical',null,true,'medium'),
    ('Табак','Tobacco','tobacco','technical',null,false,'low'),
    ('Хлопчатник','Cotton','cotton','technical',null,true,'medium'),
    ('Арбуз','Watermelon','watermelon','melon',null,true,'medium'),
    ('Дыня','Melon','melon-crop','melon',null,true,'medium'),
    ('Тыква','Pumpkin','pumpkin','melon',null,true,'low'),
    ('Эспарцет','Sainfoin','sainfoin','perennial_grass',null,true,'medium'),
    ('Кострец','Brome grass','brome-grass','perennial_grass',null,true,'medium'),
    ('Тимофеевка','Timothy grass','timothy-grass','perennial_grass',null,true,'medium')
),
mapped as (
  select
    s.*,
    cc.id as category_id
  from src s
  join public.crop_categories cc
    on lower(cc.slug) = lower(s.category_slug)
),
upd as (
  update public.crops c
  set
    name = m.name_ru,
    name_ru = m.name_ru,
    name_en = m.name_en,
    category_id = m.category_id,
    subcategory = m.subcategory,
    is_common_in_kz = m.is_common_in_kz,
    priority_level = m.priority_level,
    is_active = true,
    crop_kind = coalesce(nullif(crop_kind, ''), 'general'),
    default_uom = coalesce(nullif(default_uom, ''), 'kg'),
    harvest_uom = coalesce(nullif(harvest_uom, ''), 'kg'),
    seed_uom = coalesce(nullif(seed_uom, ''), 'kg'),
    can_have_varieties = coalesce(can_have_varieties, true),
    can_have_seed_reproduction = coalesce(can_have_seed_reproduction, true),
    can_be_harvested = coalesce(can_be_harvested, true),
    archived = false,
    updated_at = now()
  from mapped m
  where lower(c.slug) = lower(m.slug)
    and c.company_id is null
  returning c.id
),
ins as (
  insert into public.crops (
    name,
    name_ru,
    name_en,
    slug,
    category_id,
    subcategory,
    is_common_in_kz,
    priority_level,
    is_active,
    company_id,
    archived,
    crop_kind,
    default_uom,
    harvest_uom,
    seed_uom,
    can_have_varieties,
    can_have_seed_reproduction,
    can_be_harvested
  )
  select
    m.name_ru,
    m.name_ru,
    m.name_en,
    m.slug,
    m.category_id,
    m.subcategory,
    m.is_common_in_kz,
    m.priority_level,
    true,
    null,
    false,
    'general',
    'kg',
    'kg',
    'kg',
    true,
    true,
    true
  from mapped m
  where not exists (
    select 1
    from public.crops c
    where lower(c.slug) = lower(m.slug)
      and c.company_id is null
      and c.archived = false
  )
  returning id
)
select
  (select count(*) from mapped) as mapped_rows,
  (select count(*) from upd) as updated_rows,
  (select count(*) from ins) as inserted_rows;

