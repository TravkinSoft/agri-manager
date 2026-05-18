/*
  Global agrochemistry foundation:
  - pesticide_categories
  - active_ingredients
  - product_active_ingredients
  - products structure readiness
*/

create extension if not exists pgcrypto;

create or replace function public.ensure_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.pesticide_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name_ru text not null,
  name_en text,
  slug text not null,
  description text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pesticide_categories_slug_key'
      and conrelid = 'public.pesticide_categories'::regclass
  ) then
    alter table public.pesticide_categories
      add constraint pesticide_categories_slug_key unique (slug);
  end if;
end $$;

create unique index if not exists ux_pesticide_categories_slug_active
  on public.pesticide_categories (lower(slug))
  where archived = false;

create index if not exists idx_pesticide_categories_slug
  on public.pesticide_categories (lower(slug));

create index if not exists idx_pesticide_categories_active
  on public.pesticide_categories (is_active)
  where archived = false;

drop trigger if exists update_pesticide_categories_updated_at on public.pesticide_categories;
create trigger update_pesticide_categories_updated_at
before update on public.pesticide_categories
for each row execute function public.ensure_updated_at_column();

create table if not exists public.active_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name_ru text not null,
  name_en text,
  slug text not null,
  ingredient_type text not null
    check (ingredient_type in ('pesticide_ai', 'adjuvant_component', 'biological_agent')),
  description text,
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'active_ingredients_slug_key'
      and conrelid = 'public.active_ingredients'::regclass
  ) then
    alter table public.active_ingredients
      add constraint active_ingredients_slug_key unique (slug);
  end if;
end $$;

create unique index if not exists ux_active_ingredients_slug_active
  on public.active_ingredients (lower(slug))
  where archived = false;

create index if not exists idx_active_ingredients_slug
  on public.active_ingredients (lower(slug));

create index if not exists idx_active_ingredients_active
  on public.active_ingredients (is_active)
  where archived = false;

drop trigger if exists update_active_ingredients_updated_at on public.active_ingredients;
create trigger update_active_ingredients_updated_at
before update on public.active_ingredients
for each row execute function public.ensure_updated_at_column();

alter table public.products
  add column if not exists category_id uuid,
  add column if not exists trade_name text,
  add column if not exists formulation text,
  add column if not exists concentration text,
  add column if not exists manufacturer text,
  add column if not exists description text,
  add column if not exists registration_status_kz text,
  add column if not exists source_url text,
  add column if not exists is_active boolean not null default true;

create table if not exists public.product_active_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  active_ingredient_id uuid not null references public.active_ingredients(id) on delete restrict,
  concentration_text text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  unique (product_id, active_ingredient_id)
);

create index if not exists idx_product_active_ingredients_product
  on public.product_active_ingredients(product_id);

create index if not exists idx_product_active_ingredients_ai
  on public.product_active_ingredients(active_ingredient_id);

insert into public.pesticide_categories (name_ru, name_en, slug, description, is_active, archived)
select v.name_ru, v.name_en, v.slug, v.description, true, false
from (
  values
    ('Гербициды', 'Herbicides', 'herbicide', 'Препараты для контроля сорной растительности'),
    ('Фунгициды', 'Fungicides', 'fungicide', 'Препараты против грибковых болезней растений'),
    ('Инсектициды', 'Insecticides', 'insecticide', 'Препараты против насекомых-вредителей растений'),
    ('Протравители семян', 'Seed treatments', 'seed_treatment', 'Препараты для обработки семян перед посевом'),
    ('Десиканты', 'Desiccants', 'desiccant', 'Препараты для подсушивания растений перед уборкой'),
    ('Регуляторы роста растений', 'Plant growth regulators', 'growth_regulator', 'Препараты для регулирования роста и развития растений'),
    ('Адъюванты', 'Adjuvants', 'adjuvant', 'Вспомогательные препараты для усиления действия рабочего раствора'),
    ('Биопрепараты', 'Biologicals', 'biological', 'Биологические препараты для растениеводства'),
    ('ПАВ', 'Surfactants', 'surfactant', 'Поверхностно-активные вещества'),
    ('Кондиционеры воды', 'Water conditioners', 'water_conditioner', 'Препараты для коррекции свойств воды'),
    ('Регуляторы pH', 'pH regulators', 'ph_regulator', 'Препараты для регулирования кислотности раствора'),
    ('Антипенные', 'Anti-foam', 'anti_foam', 'Препараты для снижения пенообразования'),
    ('Антиснос / утяжелители капли', 'Drift reduction agents', 'drift_reduction_agent', 'Препараты для снижения сноса и укрупнения капли'),
    ('Прилипатели', 'Stickers', 'sticker', 'Препараты для улучшения прилипания рабочего раствора'),
    ('Растекатели', 'Spreaders', 'spreader', 'Препараты для улучшения растекания раствора по поверхности'),
    ('Пенетранты', 'Penetrants', 'penetrant', 'Препараты для улучшения проникновения действующих веществ')
) as v(name_ru, name_en, slug, description)
on conflict (slug) do update
set name_ru = excluded.name_ru,
    name_en = excluded.name_en,
    description = excluded.description,
    is_active = true,
    archived = false;

insert into public.active_ingredients (name_ru, name_en, slug, ingredient_type, description, is_active, archived)
select v.name_ru, v.name_en, v.slug, v.ingredient_type, v.description, true, false
from (
  values
    ('Глифосат', 'Glyphosate', 'glyphosate', 'pesticide_ai', 'Неселективное гербицидное действующее вещество'),
    ('2,4-Д', '2,4-D', '2-4-d', 'pesticide_ai', 'Гербицидное действующее вещество из группы феноксиуксусных кислот'),
    ('МЦПА', 'MCPA', 'mcpa', 'pesticide_ai', 'Гербицидное действующее вещество'),
    ('Дикамба', 'Dicamba', 'dicamba', 'pesticide_ai', 'Гербицидное действующее вещество'),
    ('Метрибузин', 'Metribuzin', 'metribuzin', 'pesticide_ai', 'Гербицидное действующее вещество'),
    ('Пендиметалин', 'Pendimethalin', 'pendimethalin', 'pesticide_ai', 'Почвенное гербицидное действующее вещество'),
    ('Просульфокарб', 'Prosulfocarb', 'prosulfocarb', 'pesticide_ai', 'Гербицидное действующее вещество'),
    ('Тебуконазол', 'Tebuconazole', 'tebuconazole', 'pesticide_ai', 'Фунгицидное действующее вещество'),
    ('Азоксистробин', 'Azoxystrobin', 'azoxystrobin', 'pesticide_ai', 'Фунгицидное действующее вещество'),
    ('Дифеноконазол', 'Difenoconazole', 'difenoconazole', 'pesticide_ai', 'Фунгицидное действующее вещество'),
    ('Флудиоксонил', 'Fludioxonil', 'fludioxonil', 'pesticide_ai', 'Фунгицидное действующее вещество для протравливания'),
    ('Имидаклоприд', 'Imidacloprid', 'imidacloprid', 'pesticide_ai', 'Инсектицидное действующее вещество'),
    ('Тиаметоксам', 'Thiamethoxam', 'thiamethoxam', 'pesticide_ai', 'Инсектицидное действующее вещество'),
    ('Лямбда-цигалотрин', 'Lambda-cyhalothrin', 'lambda-cyhalothrin', 'pesticide_ai', 'Инсектицидное действующее вещество'),
    ('Хлорантранилипрол', 'Chlorantraniliprole', 'chlorantraniliprole', 'pesticide_ai', 'Инсектицидное действующее вещество'),
    ('Этефон', 'Ethephon', 'ethephon', 'pesticide_ai', 'Регулятор роста / десикация в отдельных схемах'),
    ('Гуминовые кислоты', 'Humic acids', 'humic-acids', 'adjuvant_component', 'Компоненты биостимулирующего и вспомогательного действия'),
    ('Лимонная кислота', 'Citric acid', 'citric-acid', 'adjuvant_component', 'Компонент для подкисления раствора'),
    ('Янтарная кислота', 'Succinic acid', 'succinic-acid', 'adjuvant_component', 'Компонент для регулирования свойств рабочего раствора'),
    ('Bacillus subtilis', 'Bacillus subtilis', 'bacillus-subtilis', 'biological_agent', 'Биологический агент для биопрепаратов'),
    ('Trichoderma', 'Trichoderma', 'trichoderma', 'biological_agent', 'Биологический гриб-антагонист')
) as v(name_ru, name_en, slug, ingredient_type, description)
on conflict (slug) do update
set name_ru = excluded.name_ru,
    name_en = excluded.name_en,
    ingredient_type = excluded.ingredient_type,
    description = excluded.description,
    is_active = true,
    archived = false;
