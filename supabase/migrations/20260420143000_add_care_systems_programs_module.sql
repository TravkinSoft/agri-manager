/*
  Agronomist module: "Системы защиты и ухода"
  Phase 1 foundation:
  - global/company treatment program templates
  - program steps with products and risks
  - field/season assignment
  - per-step execution statuses
*/

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'program_type_code') then
    create type public.program_type_code as enum ('protection', 'care', 'integrated');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_template_status_code') then
    create type public.program_template_status_code as enum ('draft', 'approved', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_source_type_code') then
    create type public.program_source_type_code as enum ('global_master', 'company_custom', 'copied_from_global');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_step_priority_code') then
    create type public.program_step_priority_code as enum ('critical', 'recommended', 'optional');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_step_product_role_code') then
    create type public.program_step_product_role_code as enum ('main', 'partner', 'adjuvant', 'micronutrient');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_assignment_status_code') then
    create type public.program_assignment_status_code as enum ('planned', 'active', 'completed', 'stopped');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_step_execution_status_code') then
    create type public.program_step_execution_status_code as enum ('waiting', 'ready', 'planned', 'done', 'skipped', 'overdue', 'blocked', 'replaced');
  end if;
end $$;

-- Canonical source for the production operation type dictionary. The table
-- predates the tracked migration history but is required by program_steps.
create table if not exists public.operation_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_ru text not null,
  name_en text,
  category_slug text,
  requires_machine boolean not null default false,
  requires_product boolean not null default false,
  requires_field boolean not null default true,
  affects_inventory boolean not null default false,
  affects_field_history boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operation_types enable row level security;

insert into public.operation_types (
  id, slug, name_ru, name_en, category_slug,
  requires_machine, requires_product, requires_field,
  affects_inventory, affects_field_history, is_active
)
values
  ('fdc1fcab-87c4-4f74-8156-771d530314ad', 'discing', 'Дискование', 'Discing', 'soil_preparation', true, false, true, false, true, true),
  ('38d94b14-0e76-41c5-b2d6-9f23b9e74db6', 'fertilizing', 'Внесение удобрений', 'Fertilizing', 'fertilization', true, true, true, true, true, true),
  ('79a46384-4419-454f-bd64-de84a45bb23e', 'field_transfer', 'Перевозка с поля', 'Field transfer', 'logistics', false, false, true, true, false, true),
  ('5322e5c7-81e7-4b30-ae8e-1913ba1fc3df', 'harvesting', 'Уборка урожая', 'Harvesting', 'harvesting', true, false, true, true, true, true),
  ('6207c998-9786-49f0-9030-cd1de7a53d37', 'plowing', 'Вспашка', 'Plowing', 'soil_preparation', true, false, true, false, true, true),
  ('4d29d884-c6fa-40a0-8390-224adcd645bb', 'seeding', 'Посев', 'Seeding', 'seeding_planting', true, true, true, true, true, true),
  ('83ed6eb5-3edb-4f03-83c2-e036a22de767', 'spraying', 'Опрыскивание', 'Spraying', 'plant_protection', true, true, true, true, true, true)
on conflict (slug) do update
set
  name_ru = excluded.name_ru,
  name_en = excluded.name_en,
  category_slug = excluded.category_slug,
  requires_machine = excluded.requires_machine,
  requires_product = excluded.requires_product,
  requires_field = excluded.requires_field,
  affects_inventory = excluded.affects_inventory,
  affects_field_history = excluded.affects_field_history,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.program_goals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ru text not null,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_target_risks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ru text not null,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_step_type_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ru text not null,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_direction_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ru text not null,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farming_intensity_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ru text not null,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.growth_stages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  system text not null default 'custom',
  crop_specific boolean not null default false,
  crop_id uuid references public.crops(id),
  stage_code text not null,
  stage_name_ru text not null,
  stage_name_en text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  name_ru text not null,
  name_en text,
  crop_id uuid not null references public.crops(id),
  variety_id uuid references public.varieties(id),
  program_type public.program_type_code not null,
  goal_code text references public.program_goals(code),
  production_direction_code text references public.production_direction_codes(code),
  region_id uuid,
  climate_zone_id uuid,
  farming_intensity_code text references public.farming_intensity_codes(code),
  version integer not null default 1,
  status public.program_template_status_code not null default 'draft',
  description text,
  agronomic_rationale text,
  expected_result text,
  source_type public.program_source_type_code not null default 'company_custom',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_steps (
  id uuid primary key default gen_random_uuid(),
  program_template_id uuid not null references public.program_templates(id) on delete cascade,
  step_no integer not null,
  step_name text not null,
  step_type_code text references public.program_step_type_codes(code),
  growth_stage_from_id uuid references public.growth_stages(id),
  growth_stage_to_id uuid references public.growth_stages(id),
  timing_note text,
  days_after_previous_step_min integer,
  days_after_previous_step_max integer,
  agronomic_purpose text,
  condition_note text,
  priority public.program_step_priority_code not null default 'recommended',
  is_mandatory boolean not null default true,
  operation_type_id uuid references public.operation_types(id),
  default_water_rate_l_ha numeric(12,3),
  default_working_solution_note text,
  reentry_interval_hours integer,
  preharvest_interval_days integer,
  compatibility_note text,
  safety_note text,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_template_id, step_no)
);

create table if not exists public.program_step_target_risks (
  id uuid primary key default gen_random_uuid(),
  program_step_id uuid not null references public.program_steps(id) on delete cascade,
  target_risk_id uuid not null references public.program_target_risks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_step_id, target_risk_id)
);

create table if not exists public.program_step_products (
  id uuid primary key default gen_random_uuid(),
  program_step_id uuid not null references public.program_steps(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_role public.program_step_product_role_code not null default 'main',
  dose_value numeric(12,4),
  dose_unit text,
  dose_note text,
  application_order integer,
  is_optional boolean not null default false,
  substitution_group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  program_template_id uuid not null references public.program_templates(id),
  field_id uuid not null references public.fields(id),
  season_id uuid not null references public.seasons(id),
  crop_id uuid not null references public.crops(id),
  variety_id uuid references public.varieties(id),
  assigned_by_user_id uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  status public.program_assignment_status_code not null default 'planned',
  adaptation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(field_id, season_id)
);

create table if not exists public.program_step_execution_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  program_assignment_id uuid not null references public.program_assignments(id) on delete cascade,
  program_step_id uuid not null references public.program_steps(id) on delete cascade,
  status public.program_step_execution_status_code not null default 'waiting',
  planned_date_from date,
  planned_date_to date,
  actual_operation_id uuid references public.operations(id),
  actual_growth_stage_id uuid references public.growth_stages(id),
  deviation_note text,
  approved_by_agronomist boolean,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_assignment_id, program_step_id)
);

create index if not exists idx_program_templates_scope on public.program_templates(company_id, crop_id, status, is_active);
create index if not exists idx_program_steps_template on public.program_steps(program_template_id, step_no);
create index if not exists idx_program_step_products_step on public.program_step_products(program_step_id);
create index if not exists idx_program_assignments_scope on public.program_assignments(company_id, season_id, crop_id, status);
create index if not exists idx_program_execution_scope on public.program_step_execution_statuses(company_id, program_assignment_id, status);
create index if not exists idx_growth_stages_lookup on public.growth_stages(crop_id, sort_order, is_active);

drop trigger if exists trg_program_goals_updated_at on public.program_goals;
create trigger trg_program_goals_updated_at before update on public.program_goals for each row execute function update_updated_at_column();
drop trigger if exists trg_program_target_risks_updated_at on public.program_target_risks;
create trigger trg_program_target_risks_updated_at before update on public.program_target_risks for each row execute function update_updated_at_column();
drop trigger if exists trg_program_step_type_codes_updated_at on public.program_step_type_codes;
create trigger trg_program_step_type_codes_updated_at before update on public.program_step_type_codes for each row execute function update_updated_at_column();
drop trigger if exists trg_production_direction_codes_updated_at on public.production_direction_codes;
create trigger trg_production_direction_codes_updated_at before update on public.production_direction_codes for each row execute function update_updated_at_column();
drop trigger if exists trg_farming_intensity_codes_updated_at on public.farming_intensity_codes;
create trigger trg_farming_intensity_codes_updated_at before update on public.farming_intensity_codes for each row execute function update_updated_at_column();
drop trigger if exists trg_growth_stages_updated_at on public.growth_stages;
create trigger trg_growth_stages_updated_at before update on public.growth_stages for each row execute function update_updated_at_column();
drop trigger if exists trg_program_templates_updated_at on public.program_templates;
create trigger trg_program_templates_updated_at before update on public.program_templates for each row execute function update_updated_at_column();
drop trigger if exists trg_program_steps_updated_at on public.program_steps;
create trigger trg_program_steps_updated_at before update on public.program_steps for each row execute function update_updated_at_column();
drop trigger if exists trg_program_step_target_risks_updated_at on public.program_step_target_risks;
create trigger trg_program_step_target_risks_updated_at before update on public.program_step_target_risks for each row execute function update_updated_at_column();
drop trigger if exists trg_program_step_products_updated_at on public.program_step_products;
create trigger trg_program_step_products_updated_at before update on public.program_step_products for each row execute function update_updated_at_column();
drop trigger if exists trg_program_assignments_updated_at on public.program_assignments;
create trigger trg_program_assignments_updated_at before update on public.program_assignments for each row execute function update_updated_at_column();
drop trigger if exists trg_program_step_execution_statuses_updated_at on public.program_step_execution_statuses;
create trigger trg_program_step_execution_statuses_updated_at before update on public.program_step_execution_statuses for each row execute function update_updated_at_column();

insert into public.program_goals(code, name_ru, name_en) values
('yield_maximization', 'Максимизация урожайности', 'Yield maximization'),
('cost_optimized', 'Оптимизация затрат', 'Cost optimized'),
('disease_control', 'Контроль болезней', 'Disease control'),
('weed_control', 'Контроль сорняков', 'Weed control'),
('insect_control', 'Контроль вредителей', 'Insect control'),
('storage_quality', 'Качество хранения', 'Storage quality'),
('seed_production', 'Семеноводство', 'Seed production'),
('export_quality', 'Экспортное качество', 'Export quality'),
('drought_stability', 'Устойчивость к засухе', 'Drought stability'),
('intensive_technology', 'Интенсивная технология', 'Intensive technology'),
('basic_technology', 'Базовая технология', 'Basic technology')
on conflict (code) do update set name_ru = excluded.name_ru, name_en = excluded.name_en, is_active = true;

insert into public.program_target_risks(code, name_ru, name_en) values
('annual_grass_weeds', 'Однолетние злаковые сорняки', 'Annual grass weeds'),
('annual_broadleaf_weeds', 'Однолетние двудольные сорняки', 'Annual broadleaf weeds'),
('perennial_weeds', 'Многолетние сорняки', 'Perennial weeds'),
('rusts', 'Ржавчины', 'Rusts'),
('powdery_mildew', 'Мучнистая роса', 'Powdery mildew'),
('septoria', 'Септориоз', 'Septoria'),
('fusarium', 'Фузариоз', 'Fusarium'),
('late_blight', 'Фитофтороз', 'Late blight'),
('alternaria', 'Альтернариоз', 'Alternaria'),
('colorado_potato_beetle', 'Колорадский жук', 'Colorado potato beetle'),
('aphids', 'Тля', 'Aphids'),
('thrips', 'Трипсы', 'Thrips'),
('mites', 'Клещи', 'Mites'),
('lodging_risk', 'Риск полегания', 'Lodging risk'),
('stress_recovery', 'Антистресс/восстановление', 'Stress recovery'),
('haulm_drying', 'Подсушивание ботвы', 'Haulm drying'),
('storage_rot_risk', 'Риск гнилей при хранении', 'Storage rot risk')
on conflict (code) do update set name_ru = excluded.name_ru, name_en = excluded.name_en, is_active = true;

insert into public.program_step_type_codes(code, name_ru, name_en) values
('seed_treatment', 'Протравливание семян', 'Seed treatment'),
('herbicide', 'Гербицидная обработка', 'Herbicide'),
('fungicide', 'Фунгицидная обработка', 'Fungicide'),
('insecticide', 'Инсектицидная обработка', 'Insecticide'),
('acaricide', 'Акарицидная обработка', 'Acaricide'),
('biological', 'Биологическая обработка', 'Biological'),
('foliar_feeding', 'Листовая подкормка', 'Foliar feeding'),
('growth_regulator', 'Регулятор роста', 'Growth regulator'),
('desiccation', 'Десикация', 'Desiccation'),
('combined_treatment', 'Комбинированная обработка', 'Combined treatment')
on conflict (code) do update set name_ru = excluded.name_ru, name_en = excluded.name_en, is_active = true;

insert into public.production_direction_codes(code, name_ru, name_en) values
('commodity', 'Товарное производство', 'Commodity'),
('seed', 'Семеноводство', 'Seed'),
('storage', 'Хранение', 'Storage'),
('fresh_market', 'Свежий рынок', 'Fresh market'),
('processing', 'Переработка', 'Processing')
on conflict (code) do update set name_ru = excluded.name_ru, name_en = excluded.name_en, is_active = true;

insert into public.farming_intensity_codes(code, name_ru, name_en) values
('low_input', 'Низкоинтенсивная', 'Low input'),
('standard', 'Стандартная', 'Standard'),
('intensive', 'Интенсивная', 'Intensive'),
('high_value', 'Высокомаржинальная', 'High value')
on conflict (code) do update set name_ru = excluded.name_ru, name_en = excluded.name_en, is_active = true;

insert into public.growth_stages(code, system, crop_specific, crop_id, stage_code, stage_name_ru, stage_name_en, sort_order, is_active) values
('bbch_emergence', 'BBCH', false, null, '09-11', 'Всходы', 'Emergence', 10, true),
('bbch_tillering', 'BBCH', false, null, '20-29', 'Кущение', 'Tillering', 20, true),
('bbch_stem_elongation', 'BBCH', false, null, '30-39', 'Выход в трубку', 'Stem elongation', 30, true),
('bbch_heading', 'BBCH', false, null, '50-59', 'Колошение', 'Heading', 40, true),
('bbch_flowering', 'BBCH', false, null, '60-69', 'Цветение', 'Flowering', 50, true),
('bbch_tuber_initiation', 'BBCH', false, null, '40-45', 'Начало клубнеобразования', 'Tuber initiation', 35, true),
('bbch_row_closure', 'BBCH', false, null, '31-39', 'Смыкание ботвы', 'Row closure', 45, true),
('bbch_pre_harvest', 'BBCH', false, null, '89-97', 'Предуборочная фаза', 'Pre-harvest', 90, true)
on conflict (code) do update
set stage_name_ru = excluded.stage_name_ru,
    stage_name_en = excluded.stage_name_en,
    sort_order = excluded.sort_order,
    is_active = true;

do $$
declare
  v_actor uuid;
  v_crop_wheat uuid;
  v_crop_potato uuid;
  v_template_wheat uuid;
  v_template_potato uuid;
  v_step_id uuid;
  v_spraying_op uuid;
  v_fertilizing_op uuid;
begin
  select id into v_actor
  from public.profiles
  where role in ('global_admin', 'company_admin', 'admin')
  order by case when role = 'global_admin' then 0 else 1 end, created_at
  limit 1;

  select id into v_crop_wheat from public.crops where company_id is null and lower(coalesce(slug,'')) = 'wheat' limit 1;
  select id into v_crop_potato from public.crops where company_id is null and lower(coalesce(slug,'')) = 'potato' limit 1;

  select id into v_spraying_op from public.operation_types where lower(slug) = 'spraying' limit 1;
  select id into v_fertilizing_op from public.operation_types where lower(slug) = 'fertilizing' limit 1;

  if v_crop_wheat is not null then
    select id into v_template_wheat
    from public.program_templates
    where company_id is null and name_ru = 'Пшеница — базовая система защиты' and crop_id = v_crop_wheat
    limit 1;

    if v_template_wheat is null then
      insert into public.program_templates (
        company_id, name_ru, crop_id, program_type, goal_code, farming_intensity_code, version, status,
        description, agronomic_rationale, expected_result, source_type, is_active
      ) values (
        null, 'Пшеница — базовая система защиты', v_crop_wheat, 'protection', 'disease_control', 'standard', 1, 'approved',
        'Базовая последовательность обработок по ключевым рискам пшеницы.',
        'Снижение давления сорняков и листостебельных болезней в критические фазы.',
        'Стабильная урожайность и снижение потерь от болезней.',
        'global_master', true
      )
      returning id into v_template_wheat;
    end if;

    insert into public.program_steps(
      program_template_id, step_no, step_name, step_type_code, growth_stage_from_id, growth_stage_to_id, timing_note,
      agronomic_purpose, priority, is_mandatory, operation_type_id, default_water_rate_l_ha
    )
    values
      (v_template_wheat, 1, 'Гербицид по вегетации', 'herbicide',
        (select id from public.growth_stages where code='bbch_tillering' limit 1),
        (select id from public.growth_stages where code='bbch_stem_elongation' limit 1),
        'Окно по сорнякам в фазе кущения', 'Контроль однолетних двудольных и злаковых', 'critical', true, v_spraying_op, 200),
      (v_template_wheat, 2, 'Фунгицид Т1', 'fungicide',
        (select id from public.growth_stages where code='bbch_stem_elongation' limit 1),
        (select id from public.growth_stages where code='bbch_heading' limit 1),
        'До активного развития септориоза', 'Сдерживание листовых болезней', 'critical', true, v_spraying_op, 200),
      (v_template_wheat, 3, 'Листовая подкормка', 'foliar_feeding',
        (select id from public.growth_stages where code='bbch_stem_elongation' limit 1),
        (select id from public.growth_stages where code='bbch_flowering' limit 1),
        'Совместимо с фунгицидной обработкой', 'Стабилизация питания в стрессовых условиях', 'recommended', false, v_fertilizing_op, null)
    on conflict (program_template_id, step_no) do update
      set step_name = excluded.step_name,
          step_type_code = excluded.step_type_code,
          timing_note = excluded.timing_note,
          agronomic_purpose = excluded.agronomic_purpose,
          priority = excluded.priority,
          is_mandatory = excluded.is_mandatory,
          operation_type_id = excluded.operation_type_id,
          default_water_rate_l_ha = excluded.default_water_rate_l_ha,
          updated_at = now();

    for v_step_id in
      select id from public.program_steps where program_template_id = v_template_wheat
    loop
      insert into public.program_step_target_risks(program_step_id, target_risk_id)
      select v_step_id, r.id
      from public.program_target_risks r
      where r.code in ('annual_broadleaf_weeds', 'annual_grass_weeds', 'septoria', 'rusts')
      on conflict (program_step_id, target_risk_id) do nothing;
    end loop;
  end if;

  if v_crop_potato is not null then
    select id into v_template_potato
    from public.program_templates
    where company_id is null and name_ru = 'Картофель — интегрированная система ухода' and crop_id = v_crop_potato
    limit 1;

    if v_template_potato is null then
      insert into public.program_templates (
        company_id, name_ru, crop_id, program_type, goal_code, production_direction_code, farming_intensity_code,
        version, status, description, agronomic_rationale, expected_result, source_type, is_active
      ) values (
        null, 'Картофель — интегрированная система ухода', v_crop_potato, 'integrated', 'storage_quality', 'storage', 'intensive',
        1, 'approved',
        'Интегрированная программа фунгицидной защиты и ухода за картофелем.',
        'Управление фитофторозом, стрессом и качеством клубней до уборки.',
        'Снижение потерь в поле и на хранении.',
        'global_master', true
      )
      returning id into v_template_potato;
    end if;

    insert into public.program_steps(
      program_template_id, step_no, step_name, step_type_code, growth_stage_from_id, growth_stage_to_id, timing_note,
      agronomic_purpose, priority, is_mandatory, operation_type_id, default_water_rate_l_ha
    )
    values
      (v_template_potato, 1, 'Фунгицидная защита старт', 'fungicide',
        (select id from public.growth_stages where code='bbch_row_closure' limit 1),
        (select id from public.growth_stages where code='bbch_pre_harvest' limit 1),
        'Старт при сомкнутых рядах', 'Профилактика фитофтороза', 'critical', true, v_spraying_op, 250),
      (v_template_potato, 2, 'Антистресс + микроэлементы', 'foliar_feeding',
        (select id from public.growth_stages where code='bbch_tuber_initiation' limit 1),
        (select id from public.growth_stages where code='bbch_pre_harvest' limit 1),
        'После стрессовых погодных факторов', 'Поддержка клубнеобразования', 'recommended', false, v_spraying_op, 200),
      (v_template_potato, 3, 'Десикация перед уборкой', 'desiccation',
        (select id from public.growth_stages where code='bbch_pre_harvest' limit 1),
        (select id from public.growth_stages where code='bbch_pre_harvest' limit 1),
        'За 10-14 дней до уборки', 'Выравнивание созревания и подготовка к уборке', 'critical', true, v_spraying_op, 250)
    on conflict (program_template_id, step_no) do update
      set step_name = excluded.step_name,
          step_type_code = excluded.step_type_code,
          timing_note = excluded.timing_note,
          agronomic_purpose = excluded.agronomic_purpose,
          priority = excluded.priority,
          is_mandatory = excluded.is_mandatory,
          operation_type_id = excluded.operation_type_id,
          default_water_rate_l_ha = excluded.default_water_rate_l_ha,
          updated_at = now();

    for v_step_id in
      select id from public.program_steps where program_template_id = v_template_potato
    loop
      insert into public.program_step_target_risks(program_step_id, target_risk_id)
      select v_step_id, r.id
      from public.program_target_risks r
      where r.code in ('late_blight', 'alternaria', 'stress_recovery', 'storage_rot_risk')
      on conflict (program_step_id, target_risk_id) do nothing;
    end loop;
  end if;
end $$;
