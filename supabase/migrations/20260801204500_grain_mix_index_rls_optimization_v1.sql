-- TZ-242 follow-up: cover crop-mix foreign keys and avoid per-row auth lookups.

create index if not exists idx_crop_structure_mix_components_variety_v1
  on public.crop_structure_mix_components(variety_id);

create index if not exists idx_crop_structure_mix_components_reproduction_v1
  on public.crop_structure_mix_components(reproduction_id);

create index if not exists idx_operation_materials_mix_component_fk_v1
  on public.operation_materials(source_mix_component_id)
  where source_mix_component_id is not null;

create index if not exists idx_warehouse_request_items_mix_component_fk_v1
  on public.warehouse_issue_request_items(source_mix_component_id)
  where source_mix_component_id is not null;

drop policy if exists crop_structure_mix_components_select on public.crop_structure_mix_components;
create policy crop_structure_mix_components_select
on public.crop_structure_mix_components for select to authenticated
using (
  company_id = (select public.get_user_company_id())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'global_admin' and p.status = 'active'
  )
);

drop policy if exists crop_structure_mix_components_insert on public.crop_structure_mix_components;
create policy crop_structure_mix_components_insert
on public.crop_structure_mix_components for insert to authenticated
with check (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_update on public.crop_structure_mix_components;
create policy crop_structure_mix_components_update
on public.crop_structure_mix_components for update to authenticated
using (company_id = (select public.get_user_company_id()))
with check (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);

drop policy if exists crop_structure_mix_components_delete on public.crop_structure_mix_components;
create policy crop_structure_mix_components_delete
on public.crop_structure_mix_components for delete to authenticated
using (
  company_id = (select public.get_user_company_id())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and p.role in ('global_admin', 'company_admin', 'agronomist')
  )
);
