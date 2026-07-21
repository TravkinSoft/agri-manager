begin;

drop policy if exists "Company members can manage company_people" on public.company_people;
drop policy if exists "Company members can manage reference_specialists" on public.reference_specialists;
drop policy if exists "Company members can manage reference_machines" on public.reference_machines;
drop policy if exists "Company members can manage reference_equipment" on public.reference_equipment;
drop policy if exists "Company members can manage reference_vehicles" on public.reference_vehicles;

create policy "Company admins can manage company_people"
on public.company_people for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = company_people.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = company_people.company_id))
  )
);

create policy "Company admins can manage reference_specialists"
on public.reference_specialists for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_specialists.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_specialists.company_id))
  )
);

create policy "Company admins can manage reference_machines"
on public.reference_machines for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_machines.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_machines.company_id))
  )
);

create policy "Company admins can manage reference_equipment"
on public.reference_equipment for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_equipment.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_equipment.company_id))
  )
);

create policy "Company admins can manage reference_vehicles"
on public.reference_vehicles for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_vehicles.company_id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and (p.role = 'global_admin' or (p.role = 'company_admin' and p.company_id = reference_vehicles.company_id))
  )
);

commit;

notify pgrst, 'reload schema';
