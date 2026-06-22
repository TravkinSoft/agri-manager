/*
  Machinery Schema V1

  Expands the global agricultural machinery catalog so it can store both
  self-propelled machinery and implements without mixing it with local company
  fleet, warehouses, operations, or inventory.
*/

create extension if not exists pgcrypto;

alter type public.agricultural_machine_category add value if not exists 'trailed_sprayer';
alter type public.agricultural_machine_category add value if not exists 'mounted_sprayer';
alter type public.agricultural_machine_category add value if not exists 'potato_planter';
alter type public.agricultural_machine_category add value if not exists 'potato_harvester';
alter type public.agricultural_machine_category add value if not exists 'planter';
alter type public.agricultural_machine_category add value if not exists 'seeder';
alter type public.agricultural_machine_category add value if not exists 'cultivator';
alter type public.agricultural_machine_category add value if not exists 'plow';
alter type public.agricultural_machine_category add value if not exists 'disc_harrow';
alter type public.agricultural_machine_category add value if not exists 'fertilizer_spreader';
alter type public.agricultural_machine_category add value if not exists 'loader';
alter type public.agricultural_machine_category add value if not exists 'telehandler';
alter type public.agricultural_machine_category add value if not exists 'trailer';
alter type public.agricultural_machine_category add value if not exists 'other';

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'machinery_asset_group'
  ) then
    create type public.machinery_asset_group as enum (
      'self_propelled_machine',
      'implement',
      'trailer',
      'truck'
    );
  end if;
end $$;

alter table public.agricultural_machine_models
  add column if not exists asset_group public.machinery_asset_group not null default 'self_propelled_machine',
  add column if not exists transmission text,
  add column if not exists weight_kg numeric(12,2),
  add column if not exists fuel_tank_l numeric(12,2),
  add column if not exists tank_capacity_l numeric(12,2),
  add column if not exists rows_count integer,
  add column if not exists capacity text,
  add column if not exists required_power_hp numeric(10,2);

create index if not exists idx_agricultural_machine_models_asset_group
  on public.agricultural_machine_models(asset_group)
  where archived = false;

insert into public.master_machinery_categories(code, name_ru, is_active) values
  ('combine_harvester', 'Комбайн', true),
  ('forage_harvester', 'Кормоуборочный комбайн', true),
  ('self_propelled_sprayer', 'Самоходный опрыскиватель', true),
  ('trailed_sprayer', 'Прицепной опрыскиватель', true),
  ('mounted_sprayer', 'Навесной опрыскиватель', true),
  ('potato_planter', 'Картофелесажалка', true),
  ('potato_harvester', 'Картофелеуборочная техника', true),
  ('planter', 'Сажалка', true),
  ('seeder', 'Сеялка', true),
  ('cultivator', 'Культиватор', true),
  ('plow', 'Плуг', true),
  ('disc_harrow', 'Дисковая борона', true),
  ('fertilizer_spreader', 'Разбрасыватель удобрений', true),
  ('loader', 'Погрузчик', true),
  ('telehandler', 'Телескопический погрузчик', true),
  ('trailer', 'Прицеп', true),
  ('tractor', 'Трактор', true),
  ('other', 'Прочее', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    is_active = excluded.is_active;
