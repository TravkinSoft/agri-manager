/*
  Link specialists/drivers to transport vehicles for weighbridge autofill.
*/

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'machine_id'
  ) then
    alter table public.profiles
      add column machine_id uuid null references public.reference_vehicles(id) on delete set null;
  end if;
end $$;

create index if not exists idx_profiles_machine_id on public.profiles(machine_id);

