-- Company people directory
-- Canonical human directory for workers, drivers, machine operators, cooks, guards and managers.
-- Safe additive migration: keeps reference_specialists as compatibility layer for existing modules.

create table if not exists public.company_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid null references public.profiles(id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  short_name text null,
  role_type text not null default 'worker'
    check (role_type in ('driver','machine_operator','worker','cook','office','guard','manager','other')),
  employment_type text not null default 'unknown'
    check (employment_type in ('permanent','temporary','seasonal','contractor','unknown')),
  phone text null,
  iin text null,
  status text not null default 'active'
    check (status in ('active','inactive','archived')),
  notes text null,
  created_by_user_id uuid null references public.profiles(id) on delete set null,
  updated_by_user_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_company_people_company_status
  on public.company_people(company_id, status);

create index if not exists idx_company_people_company_role
  on public.company_people(company_id, role_type);

create index if not exists idx_company_people_company_name
  on public.company_people(company_id, lower(full_name));

create unique index if not exists ux_company_people_company_iin_live
  on public.company_people(company_id, iin)
  where iin is not null and length(trim(iin)) > 0 and deleted_at is null;

drop trigger if exists trg_company_people_updated_at on public.company_people;
create trigger trg_company_people_updated_at
before update on public.company_people
for each row execute function public.update_updated_at_column();

alter table public.company_people enable row level security;

drop policy if exists "Company members can view company_people" on public.company_people;
create policy "Company members can view company_people"
  on public.company_people for select
  to authenticated
  using (
    company_id in (select company_id from public.profiles where id = auth.uid())
  );

drop policy if exists "Company members can manage company_people" on public.company_people;
create policy "Company members can manage company_people"
  on public.company_people for all
  to authenticated
  using (
    company_id in (select company_id from public.profiles where id = auth.uid())
  )
  with check (
    company_id in (select company_id from public.profiles where id = auth.uid())
  );

alter table public.reference_specialists
  add column if not exists person_id uuid null references public.company_people(id) on delete set null;

create index if not exists idx_reference_specialists_person_id
  on public.reference_specialists(person_id);

create unique index if not exists ux_reference_specialists_person_live
  on public.reference_specialists(person_id)
  where person_id is not null and archived = false;

-- Backfill canonical people from existing drivers / machine operators without creating duplicates.
with source_specialists as (
  select
    rs.*,
    case
      when rs.personnel_type = 'machine_operator' then 'machine_operator'
      else 'driver'
    end as mapped_role_type,
    case
      when coalesce(rs.archived, false) then 'archived'
      when coalesce(rs.status, 'active') = 'inactive' then 'inactive'
      else 'active'
    end as mapped_status,
    case
      when exists (select 1 from public.profiles p where p.id = rs.user_id) then rs.user_id
      else null
    end as profile_user_id
  from public.reference_specialists rs
)
insert into public.company_people (
  company_id,
  full_name,
  role_type,
  employment_type,
  phone,
  status,
  notes,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
select
  ss.company_id,
  trim(ss.full_name),
  ss.mapped_role_type,
  'unknown',
  null,
  ss.mapped_status,
  null,
  ss.profile_user_id,
  ss.profile_user_id,
  coalesce(ss.created_at, now()),
  coalesce(ss.updated_at, now())
from source_specialists ss
where not exists (
  select 1
  from public.company_people cp
  where cp.company_id = ss.company_id
    and lower(trim(cp.full_name)) = lower(trim(ss.full_name))
    and cp.role_type = ss.mapped_role_type
    and cp.deleted_at is null
);

update public.reference_specialists rs
set person_id = cp.id
from public.company_people cp
where rs.person_id is null
  and cp.company_id = rs.company_id
  and lower(trim(cp.full_name)) = lower(trim(rs.full_name))
  and cp.role_type = case
    when rs.personnel_type = 'machine_operator' then 'machine_operator'
    else 'driver'
  end
  and cp.deleted_at is null;

drop index if exists public.idx_profiles_company_full_name;
