drop policy if exists "Users can view company field season flags" on public.field_season_flags;
drop policy if exists "Users can insert company field season flags" on public.field_season_flags;
drop policy if exists "Users can update company field season flags" on public.field_season_flags;
drop policy if exists "Users can delete company field season flags" on public.field_season_flags;

create policy "Users can view company field season flags"
  on public.field_season_flags
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company field season flags"
  on public.field_season_flags
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company field season flags"
  on public.field_season_flags
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company field season flags"
  on public.field_season_flags
  for delete to authenticated
  using (company_id = public.get_user_company_id());

drop policy if exists "Users can view company field history entries" on public.field_history_entries;
drop policy if exists "Users can insert company field history entries" on public.field_history_entries;
drop policy if exists "Users can update company field history entries" on public.field_history_entries;
drop policy if exists "Users can delete company field history entries" on public.field_history_entries;

create policy "Users can view company field history entries"
  on public.field_history_entries
  for select to authenticated
  using (company_id = public.get_user_company_id());

create policy "Users can insert company field history entries"
  on public.field_history_entries
  for insert to authenticated
  with check (company_id = public.get_user_company_id());

create policy "Users can update company field history entries"
  on public.field_history_entries
  for update to authenticated
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

create policy "Users can delete company field history entries"
  on public.field_history_entries
  for delete to authenticated
  using (company_id = public.get_user_company_id());
