begin;

create table if not exists public.weighbridge_active_harvests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  crop_structure_id uuid not null references public.crop_structure(id) on delete restrict,
  field_id uuid not null references public.fields(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, season_id, crop_structure_id, warehouse_id)
);

create index if not exists weighbridge_active_harvests_company_season_status_idx
  on public.weighbridge_active_harvests(company_id, season_id, status, created_at);

create index if not exists weighbridge_active_harvests_route_idx
  on public.weighbridge_active_harvests(company_id, crop_structure_id, warehouse_id);

create or replace function private.validate_weighbridge_active_harvest_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_structure public.crop_structure%rowtype;
  v_season public.seasons%rowtype;
  v_field public.fields%rowtype;
  v_warehouse public.warehouses%rowtype;
begin
  select * into v_structure
  from public.crop_structure
  where id = new.crop_structure_id;

  if not found
    or v_structure.company_id is distinct from new.company_id
    or v_structure.season_id is distinct from new.season_id
    or v_structure.field_id is distinct from new.field_id
    or coalesce(v_structure.archived, false)
    or v_structure.crop_id is null then
    raise exception 'Active harvest crop structure is invalid' using errcode = '23514';
  end if;

  select * into v_season
  from public.seasons
  where id = new.season_id;

  if not found
    or v_season.company_id is distinct from new.company_id
    or coalesce(v_season.archived, false) then
    raise exception 'Active harvest season is invalid' using errcode = '23514';
  end if;

  select * into v_field
  from public.fields
  where id = new.field_id;

  if not found
    or v_field.company_id is distinct from new.company_id
    or coalesce(v_field.archived, false) then
    raise exception 'Active harvest field is invalid' using errcode = '23514';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = new.warehouse_id;

  if not found
    or v_warehouse.company_id is distinct from new.company_id
    or coalesce(v_warehouse.archived, false)
    or lower(coalesce(v_warehouse.warehouse_type, '')) not in (
      'grain', 'seed', 'vegetable', 'potato_storage', 'temporary'
    ) then
    raise exception 'Active harvest reception warehouse is invalid' using errcode = '23514';
  end if;

  new.updated_at := now();
  if new.status = 'active' then
    new.closed_at := null;
    new.closed_by := null;
  elsif new.closed_at is null then
    new.closed_at := now();
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_weighbridge_active_harvest_v1
  on public.weighbridge_active_harvests;
create trigger validate_weighbridge_active_harvest_v1
before insert or update on public.weighbridge_active_harvests
for each row execute function private.validate_weighbridge_active_harvest_v1();

alter table public.weighbridge_active_harvests enable row level security;

drop policy if exists weighbridge_active_harvests_select_v1
  on public.weighbridge_active_harvests;
create policy weighbridge_active_harvests_select_v1
on public.weighbridge_active_harvests
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.status, 'active')) = 'active'
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weighbridge_active_harvests.company_id
      )
  )
);

drop policy if exists weighbridge_active_harvests_insert_v1
  on public.weighbridge_active_harvests;
create policy weighbridge_active_harvests_insert_v1
on public.weighbridge_active_harvests
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'company_admin', 'weighman')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weighbridge_active_harvests.company_id
      )
  )
);

drop policy if exists weighbridge_active_harvests_update_v1
  on public.weighbridge_active_harvests;
create policy weighbridge_active_harvests_update_v1
on public.weighbridge_active_harvests
for update to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'company_admin', 'weighman')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weighbridge_active_harvests.company_id
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.status, 'active')) = 'active'
      and lower(coalesce(p.role, '')) in ('global_admin', 'company_admin', 'weighman')
      and (
        lower(coalesce(p.role, '')) = 'global_admin'
        or p.company_id = weighbridge_active_harvests.company_id
      )
  )
);

grant select, insert, update on public.weighbridge_active_harvests to authenticated;
revoke delete on public.weighbridge_active_harvests from anon, authenticated;
revoke all on function private.validate_weighbridge_active_harvest_v1() from public, anon, authenticated;

do $block$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'weighbridge_active_harvests'
    ) then
    alter publication supabase_realtime add table public.weighbridge_active_harvests;
  end if;
end;
$block$;

commit;
