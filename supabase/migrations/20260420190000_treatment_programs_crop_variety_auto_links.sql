/*
  Crop+Variety treatment programs
  - program is created for crop_id + variety_id (+ optional season scope)
  - field links are auto-derived from crop_structure
*/

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'treatment_program_status') then
    create type public.treatment_program_status as enum ('draft', 'approved', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'treatment_program_link_status') then
    create type public.treatment_program_link_status as enum ('active', 'completed', 'stopped');
  end if;
  if not exists (select 1 from pg_type where typname = 'treatment_step_execution_status') then
    create type public.treatment_step_execution_status as enum ('waiting', 'ready', 'done', 'skipped', 'overdue');
  end if;
end $$;

create table if not exists public.treatment_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  season_id uuid references public.seasons(id),
  crop_id uuid not null references public.crops(id),
  variety_id uuid not null references public.varieties(id),
  name_ru text not null,
  description text,
  is_active boolean not null default true,
  status public.treatment_program_status not null default 'draft',
  created_by_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, crop_id, variety_id, season_id, name_ru)
);

create table if not exists public.treatment_program_steps (
  id uuid primary key default gen_random_uuid(),
  treatment_program_id uuid not null references public.treatment_programs(id) on delete cascade,
  step_no integer not null,
  step_name text not null,
  operation_type_id uuid,
  growth_stage_id uuid references public.growth_stages(id),
  timing_note text,
  condition_note text,
  agronomic_purpose text,
  is_mandatory boolean not null default true,
  status_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(treatment_program_id, step_no)
);

create table if not exists public.treatment_program_step_products (
  id uuid primary key default gen_random_uuid(),
  treatment_program_step_id uuid not null references public.treatment_program_steps(id) on delete cascade,
  product_id uuid not null references public.products(id),
  dose_value numeric(12,4),
  dose_unit text,
  product_role text,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(treatment_program_step_id, product_id)
);

create table if not exists public.treatment_program_field_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  treatment_program_id uuid not null references public.treatment_programs(id) on delete cascade,
  field_id uuid not null references public.fields(id),
  season_id uuid not null references public.seasons(id),
  crop_structure_row_id uuid references public.crop_structure(id) on delete set null,
  status public.treatment_program_link_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(treatment_program_id, field_id, season_id, crop_structure_row_id)
);

create table if not exists public.treatment_program_step_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  treatment_program_field_link_id uuid not null references public.treatment_program_field_links(id) on delete cascade,
  treatment_program_step_id uuid not null references public.treatment_program_steps(id) on delete cascade,
  status public.treatment_step_execution_status not null default 'waiting',
  actual_operation_id uuid references public.operations(id),
  actual_date date,
  notes text,
  updated_at timestamptz not null default now(),
  unique(treatment_program_field_link_id, treatment_program_step_id)
);

create index if not exists idx_treatment_programs_scope on public.treatment_programs(company_id, season_id, crop_id, variety_id, is_active);
create index if not exists idx_treatment_program_steps_program on public.treatment_program_steps(treatment_program_id, step_no);
create index if not exists idx_treatment_program_links_scope on public.treatment_program_field_links(company_id, season_id, field_id, status);
create index if not exists idx_treatment_program_links_program on public.treatment_program_field_links(treatment_program_id, status);
create index if not exists idx_treatment_step_exec_scope on public.treatment_program_step_executions(company_id, treatment_program_field_link_id, status);

drop trigger if exists trg_treatment_programs_updated_at on public.treatment_programs;
create trigger trg_treatment_programs_updated_at before update on public.treatment_programs for each row execute function update_updated_at_column();
drop trigger if exists trg_treatment_program_steps_updated_at on public.treatment_program_steps;
create trigger trg_treatment_program_steps_updated_at before update on public.treatment_program_steps for each row execute function update_updated_at_column();
drop trigger if exists trg_treatment_program_step_products_updated_at on public.treatment_program_step_products;
create trigger trg_treatment_program_step_products_updated_at before update on public.treatment_program_step_products for each row execute function update_updated_at_column();
drop trigger if exists trg_treatment_program_field_links_updated_at on public.treatment_program_field_links;
create trigger trg_treatment_program_field_links_updated_at before update on public.treatment_program_field_links for each row execute function update_updated_at_column();
drop trigger if exists trg_treatment_program_step_executions_updated_at on public.treatment_program_step_executions;
create trigger trg_treatment_program_step_executions_updated_at before update on public.treatment_program_step_executions for each row execute function update_updated_at_column();

alter table public.treatment_programs enable row level security;
alter table public.treatment_program_steps enable row level security;
alter table public.treatment_program_step_products enable row level security;
alter table public.treatment_program_field_links enable row level security;
alter table public.treatment_program_step_executions enable row level security;

drop policy if exists treatment_programs_rw on public.treatment_programs;
create policy treatment_programs_rw on public.treatment_programs
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_programs.company_id)
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_programs.company_id)
  )
);

drop policy if exists treatment_program_steps_rw on public.treatment_program_steps;
create policy treatment_program_steps_rw on public.treatment_program_steps
for all
using (
  exists (
    select 1
    from public.treatment_programs tp
    join public.profiles p on p.id = auth.uid()
    where tp.id = treatment_program_steps.treatment_program_id
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = tp.company_id)
  )
)
with check (
  exists (
    select 1
    from public.treatment_programs tp
    join public.profiles p on p.id = auth.uid()
    where tp.id = treatment_program_steps.treatment_program_id
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = tp.company_id)
  )
);

drop policy if exists treatment_program_step_products_rw on public.treatment_program_step_products;
create policy treatment_program_step_products_rw on public.treatment_program_step_products
for all
using (
  exists (
    select 1
    from public.treatment_program_steps tps
    join public.treatment_programs tp on tp.id = tps.treatment_program_id
    join public.profiles p on p.id = auth.uid()
    where tps.id = treatment_program_step_products.treatment_program_step_id
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = tp.company_id)
  )
)
with check (
  exists (
    select 1
    from public.treatment_program_steps tps
    join public.treatment_programs tp on tp.id = tps.treatment_program_id
    join public.profiles p on p.id = auth.uid()
    where tps.id = treatment_program_step_products.treatment_program_step_id
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = tp.company_id)
  )
);

drop policy if exists treatment_program_field_links_rw on public.treatment_program_field_links;
create policy treatment_program_field_links_rw on public.treatment_program_field_links
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_program_field_links.company_id)
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_program_field_links.company_id)
  )
);

drop policy if exists treatment_program_step_executions_rw on public.treatment_program_step_executions;
create policy treatment_program_step_executions_rw on public.treatment_program_step_executions
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_program_step_executions.company_id)
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or p.company_id = treatment_program_step_executions.company_id)
  )
);

create or replace function public.sync_treatment_program_links(
  p_company_id uuid,
  p_season_id uuid,
  p_field_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with src as (
    select
      cs.id as crop_structure_row_id,
      cs.company_id,
      cs.field_id,
      cs.season_id,
      cs.crop_id,
      cs.variety_id
    from public.crop_structure cs
    where cs.company_id = p_company_id
      and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
      and cs.crop_id is not null
      and cs.variety_id is not null
      and (p_field_id is null or cs.field_id = p_field_id)
  ),
  matched as (
    select
      s.*,
      tp.id as treatment_program_id,
      row_number() over (
        partition by s.crop_structure_row_id
        order by (tp.season_id = s.season_id) desc, tp.created_at desc
      ) as rn
    from src s
    join public.treatment_programs tp
      on tp.company_id = s.company_id
     and tp.crop_id = s.crop_id
     and tp.variety_id = s.variety_id
     and tp.is_active = true
     and tp.status <> 'archived'
     and (tp.season_id is null or tp.season_id = s.season_id)
  ),
  chosen as (
    select * from matched where rn = 1
  )
  insert into public.treatment_program_field_links (
    company_id,
    treatment_program_id,
    field_id,
    season_id,
    crop_structure_row_id,
    status
  )
  select
    c.company_id,
    c.treatment_program_id,
    c.field_id,
    c.season_id,
    c.crop_structure_row_id,
    'active'::public.treatment_program_link_status
  from chosen c
  on conflict (treatment_program_id, field_id, season_id, crop_structure_row_id)
  do update set
    status = 'active',
    updated_at = now();

  with src as (
    select
      cs.id as crop_structure_row_id,
      cs.company_id,
      cs.field_id,
      cs.season_id,
      cs.crop_id,
      cs.variety_id
    from public.crop_structure cs
    where cs.company_id = p_company_id
      and cs.season_id = p_season_id
      and coalesce(cs.archived, false) = false
      and cs.crop_id is not null
      and cs.variety_id is not null
      and (p_field_id is null or cs.field_id = p_field_id)
  ),
  matched as (
    select
      s.*,
      tp.id as treatment_program_id,
      row_number() over (
        partition by s.crop_structure_row_id
        order by (tp.season_id = s.season_id) desc, tp.created_at desc
      ) as rn
    from src s
    join public.treatment_programs tp
      on tp.company_id = s.company_id
     and tp.crop_id = s.crop_id
     and tp.variety_id = s.variety_id
     and tp.is_active = true
     and tp.status <> 'archived'
     and (tp.season_id is null or tp.season_id = s.season_id)
  ),
  chosen as (
    select * from matched where rn = 1
  )
  update public.treatment_program_field_links l
  set status = 'stopped',
      updated_at = now()
  where l.company_id = p_company_id
    and l.season_id = p_season_id
    and (p_field_id is null or l.field_id = p_field_id)
    and l.status = 'active'
    and not exists (
      select 1
      from chosen c
      where c.treatment_program_id = l.treatment_program_id
        and c.field_id = l.field_id
        and c.season_id = l.season_id
        and c.crop_structure_row_id = l.crop_structure_row_id
    );

  insert into public.treatment_program_step_executions (
    company_id,
    treatment_program_field_link_id,
    treatment_program_step_id,
    status
  )
  select
    l.company_id,
    l.id,
    s.id,
    'waiting'::public.treatment_step_execution_status
  from public.treatment_program_field_links l
  join public.treatment_program_steps s
    on s.treatment_program_id = l.treatment_program_id
  where l.company_id = p_company_id
    and l.season_id = p_season_id
    and (p_field_id is null or l.field_id = p_field_id)
    and l.status = 'active'
  on conflict (treatment_program_field_link_id, treatment_program_step_id) do nothing;
end;
$$;

create or replace function public.trg_sync_treatment_program_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_season_id uuid;
  v_field_id uuid;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.company_id;
    v_season_id := old.season_id;
    v_field_id := old.field_id;
  else
    v_company_id := new.company_id;
    v_season_id := new.season_id;
    v_field_id := new.field_id;
  end if;

  if v_company_id is not null and v_season_id is not null and v_field_id is not null then
    perform public.sync_treatment_program_links(v_company_id, v_season_id, v_field_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_crop_structure_sync_treatment_links_ins on public.crop_structure;
create trigger trg_crop_structure_sync_treatment_links_ins
after insert on public.crop_structure
for each row execute function public.trg_sync_treatment_program_links();

drop trigger if exists trg_crop_structure_sync_treatment_links_upd on public.crop_structure;
create trigger trg_crop_structure_sync_treatment_links_upd
after update of crop_id, variety_id, season_id, field_id, archived on public.crop_structure
for each row execute function public.trg_sync_treatment_program_links();

drop trigger if exists trg_crop_structure_sync_treatment_links_del on public.crop_structure;
create trigger trg_crop_structure_sync_treatment_links_del
after delete on public.crop_structure
for each row execute function public.trg_sync_treatment_program_links();
