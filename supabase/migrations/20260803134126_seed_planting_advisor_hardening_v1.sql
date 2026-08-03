-- TZ-248: follow-up for QA advisor findings on the seed identity table.

create index if not exists idx_company_seed_material_identities_crop_v1
  on public.company_seed_material_identities(crop_id);

create index if not exists idx_company_seed_material_identities_variety_v1
  on public.company_seed_material_identities(variety_id);

create index if not exists idx_company_seed_material_identities_reproduction_v1
  on public.company_seed_material_identities(seed_reproduction_id);

drop policy if exists company_seed_material_identities_select_v1
  on public.company_seed_material_identities;

create policy company_seed_material_identities_select_v1
on public.company_seed_material_identities for select to authenticated
using (
  company_id = public.get_user_company_id()
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'global_admin'
      and p.status = 'active'
  )
);
