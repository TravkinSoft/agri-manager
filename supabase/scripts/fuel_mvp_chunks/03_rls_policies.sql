-- 03: RLS + policies for fuel tables

alter table public.fuel_sources enable row level security;
alter table public.fuel_issues enable row level security;
alter table public.fuel_transfers enable row level security;
alter table public.fuel_limits enable row level security;

drop policy if exists "Users can view company fuel sources" on public.fuel_sources;
create policy "Users can view company fuel sources"
  on public.fuel_sources
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can manage company fuel sources" on public.fuel_sources;
create policy "Users can manage company fuel sources"
  on public.fuel_sources
  for all
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  )
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel issues" on public.fuel_issues;
create policy "Users can view company fuel issues"
  on public.fuel_issues
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can insert company fuel issues" on public.fuel_issues;
create policy "Users can insert company fuel issues"
  on public.fuel_issues
  for insert
  to authenticated
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel transfers" on public.fuel_transfers;
create policy "Users can view company fuel transfers"
  on public.fuel_transfers
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can insert company fuel transfers" on public.fuel_transfers;
create policy "Users can insert company fuel transfers"
  on public.fuel_transfers
  for insert
  to authenticated
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );

drop policy if exists "Users can view company fuel limits" on public.fuel_limits;
create policy "Users can view company fuel limits"
  on public.fuel_limits
  for select
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    )
  );

drop policy if exists "Users can manage company fuel limits" on public.fuel_limits;
create policy "Users can manage company fuel limits"
  on public.fuel_limits
  for all
  to authenticated
  using (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  )
  with check (
    company_id in (
      select p.company_id from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.status, 'active') = 'active'
        and p.role in ('global_admin', 'company_admin', 'warehouse', 'fuel_operator')
    )
  );
