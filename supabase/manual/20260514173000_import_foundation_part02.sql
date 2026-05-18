alter table public.import_batches enable row level security;
alter table public.import_batch_rows enable row level security;
alter table public.field_season_flags enable row level security;
alter table public.field_history_entries enable row level security;

drop policy if exists "Users can view company import batches" on public.import_batches;
drop policy if exists "Users can insert company import batches" on public.import_batches;
drop policy if exists "Users can update company import batches" on public.import_batches;
drop policy if exists "Users can delete company import batches" on public.import_batches;

create policy "Users can view company import batches"
  on public.import_batches
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company import batches"
  on public.import_batches
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company import batches"
  on public.import_batches
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company import batches"
  on public.import_batches
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can insert company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can update company import batch rows" on public.import_batch_rows;
drop policy if exists "Users can delete company import batch rows" on public.import_batch_rows;

create policy "Users can view company import batch rows"
  on public.import_batch_rows
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company import batch rows"
  on public.import_batch_rows
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company import batch rows"
  on public.import_batch_rows
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company import batch rows"
  on public.import_batch_rows
  for delete to authenticated
  using (company_id = public.get_user_company_id());
